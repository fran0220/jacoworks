package agent

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	wsClientWriteQueueSize = 256
	wsClientReadLimit      = 1 << 20

	// Client-facing pongWait (shorter than upstream's 120s)
	wsClientPongWait = 90 * time.Second
)

var wsClientUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS already handled by outer middleware
	},
	ReadBufferSize:  16 * 1024,
	WriteBufferSize: 16 * 1024,
}

// EventCallback is invoked for key WebSocket lifecycle events (connect, disconnect, etc.).
type EventCallback func(userID, event string, properties map[string]interface{})

// WSHandler exposes unified container events/commands over browser WebSocket with ticket auth.
// Handles both vm-agent and OpenClaw containers through the ChannelPool abstraction.
type WSHandler struct {
	pool        *ChannelPool
	ticketStore *TicketStore
	onEvent     EventCallback
}

func NewWSHandler(pool *ChannelPool, ticketStore *TicketStore, onEvent EventCallback) *WSHandler {
	return &WSHandler{pool: pool, ticketStore: ticketStore, onEvent: onEvent}
}



func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil || h.ticketStore == nil {
		writeWSHTTPJSON(w, http.StatusInternalServerError, map[string]string{"error": "ws handler not initialized"})
		return
	}

	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if ticket == "" {
		writeWSHTTPJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing ticket"})
		return
	}

	userID, err := h.ticketStore.ValidateTicket(ticket)
	if err != nil {
		writeWSHTTPJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired ticket"})
		return
	}

	lastSeq, err := parseWSLastSeq(r.URL.Query().Get("lastSeq"))
	if err != nil {
		writeWSHTTPJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid lastSeq"})
		return
	}

	// Container type is mandatory — desktop must pass type=vm-agent, webchat must pass type=openclaw
	containerType := strings.TrimSpace(r.URL.Query().Get("type"))
	if containerType != store.ContainerTypeVMAgent && containerType != store.ContainerTypeOpenClaw {
		writeWSHTTPJSON(w, http.StatusBadRequest, map[string]string{"error": "missing or invalid 'type' query parameter (must be 'vm-agent' or 'openclaw')"})
		return
	}

	// Unified path: all container types go through ChannelPool
	channel, info, err := h.pool.GetOrCreate(r.Context(), userID, containerType)
	if err != nil {
		writeWSHTTPJSON(w, http.StatusBadGateway, map[string]string{"error": "no container provisioned"})
		return
	}

	conn, err := wsClientUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("ws bridge: upgrade failed")
		return
	}
	defer conn.Close()

	replay, updates, unsubscribe := channel.Subscribe(lastSeq)
	defer unsubscribe()

	containerName := ""
	if info != nil {
		containerName = info.ContainerName
	}

	log.Info().
		Str("user_id", userID).
		Str("container", containerName).
		Str("container_type", containerType).
		Uint64("last_seq", lastSeq).
		Msg("ws bridge: client connected")

	if h.onEvent != nil {
		h.onEvent(userID, "ws_oc_connected", map[string]interface{}{
			"container":      containerName,
			"container_type": containerType,
			"last_seq":       lastSeq,
		})
	}

	h.runConnection(conn, channel, userID, replay, updates)

	log.Info().
		Str("user_id", userID).
		Str("container", containerName).
		Str("container_type", containerType).
		Msg("ws bridge: client disconnected")

	if h.onEvent != nil {
		h.onEvent(userID, "ws_oc_disconnected", map[string]interface{}{
			"container":      containerName,
			"container_type": containerType,
		})
	}
}

func (h *WSHandler) runConnection(conn *websocket.Conn, channel *UserChannel, userID string, replay []Event, updates <-chan Event) {
	conn.SetReadLimit(wsClientReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(wsClientPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsClientPongWait))
	})

	outbound := make(chan []byte, wsClientWriteQueueSize)
	done := make(chan struct{})

	var closeOnce sync.Once
	closeConn := func() {
		closeOnce.Do(func() {
			close(done)
			_ = conn.Close()
		})
	}

	enqueue := func(payload []byte) bool {
		payload = append([]byte(nil), payload...)

		select {
		case <-done:
			return false
		default:
		}

		select {
		case outbound <- payload:
			return true
		case <-done:
			return false
		default:
			log.Warn().Str("user_id", userID).Int("queue_size", len(outbound)).Msg("ws bridge: outbound queue overflow")
			closeConn()
			return false
		}
	}

	go func() {
		defer closeConn()
		for {
			select {
			case <-done:
				return
			case payload := <-outbound:
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: write failed")
					return
				}
			}
		}
	}()

	// Ping ticker: keep client connection alive during long LLM streaming
	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: ping failed")
					return
				}
			}
		}
	}()

	for _, event := range replay {
		payload, err := marshalWSEventFrame(event)
		if err != nil {
			log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: skip invalid replay event")
			continue
		}
		if !enqueue(payload) {
			<-done
			return
		}
	}

	if status := channel.Status(); status.Connected {
		readyPayload, _ := json.Marshal(map[string]string{"type": "proxy.ready"})
		payload, err := marshalWSEventFrame(Event{Event: "proxy.ready", Data: readyPayload})
		if err == nil {
			if !enqueue(payload) {
				<-done
				return
			}
		}
	}

	go func() {
		defer closeConn()
		for {
			select {
			case <-done:
				return
			case event, ok := <-updates:
				if !ok {
					return
				}

				payload, err := marshalWSEventFrame(event)
				if err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: skip invalid update event")
					continue
				}
				if !enqueue(payload) {
					return
				}
			}
		}
	}()

	for {
		msgType, payload, err := conn.ReadMessage()
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				log.Info().Str("user_id", userID).Msg("ws bridge: client pong timeout")
			} else if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: read failed")
			}
			closeConn()
			<-done
			return
		}

		if msgType != websocket.TextMessage {
			continue
		}

		_, err = h.handleClientMessage(channel, payload, enqueue)
		if err != nil {
			log.Debug().Err(err).Str("user_id", userID).Msg("ws bridge: invalid client frame")
		}
	}
}

func (h *WSHandler) handleClientMessage(channel *UserChannel, payload []byte, enqueue func([]byte) bool) (bool, error) {
	var frame struct {
		Type    string          `json:"type"`
		ID      string          `json:"id"`
		Message string          `json:"message"`
		Params  json.RawMessage `json:"-"`
	}

	if err := json.Unmarshal(payload, &frame); err != nil {
		enqueueProxyError(enqueue, "invalid request frame")
		return false, err
	}

	switch frame.Type {
	case "ping":
		pong, _ := json.Marshal(map[string]string{"type": "pong"})
		enqueue(pong)
		return true, nil
	default:
		// Forward all message types through the channel's dialer
		err := channel.SendRequest(frame.Type, payload, frame.ID)
		if err != nil {
			if errors.Is(err, ErrChannelReconnecting) || errors.Is(err, ErrChannelNotConnected) {
				enqueueProxyError(enqueue, "agent reconnecting")
				return true, err
			}
			enqueueProxyError(enqueue, "failed to send command")
			return true, err
		}
		return true, nil
	}
}

func parseWSLastSeq(raw string) (uint64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}

	seq, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, err
	}
	return seq, nil
}

func marshalWSEventFrame(event Event) ([]byte, error) {
	data := event.Data
	if len(data) == 0 || !json.Valid(data) {
		data = []byte("{}")
	}

	eventType := event.Event
	if eventType == "" {
		eventType = "message"
	}

	frame := struct {
		Seq   uint64          `json:"seq"`
		Event string          `json:"event"`
		Data  json.RawMessage `json:"data"`
	}{
		Seq:   event.Seq,
		Event: eventType,
		Data:  json.RawMessage(data),
	}

	return json.Marshal(frame)
}

func enqueueProxyError(enqueue func([]byte) bool, message string) {
	payload, _ := json.Marshal(map[string]string{"type": "proxy.error", "error": message})
	enqueue(payload)
}

func writeWSHTTPJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
