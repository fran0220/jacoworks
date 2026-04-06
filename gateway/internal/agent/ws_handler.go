package agent

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/pi"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	wsClientWriteQueueSize = 256
	wsClientReadLimit      = 1 << 20
	wsClientPongWait       = 90 * time.Second
	upstreamPongWait       = 120 * time.Second
	wsPingPeriod           = 30 * time.Second
	wsWriteWait            = 10 * time.Second
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin:    func(r *http.Request) bool { return true },
	ReadBufferSize: 16 * 1024, WriteBufferSize: 16 * 1024,
}

// VMBackend abstracts VM lifecycle and upstream addressing.
type VMBackend interface {
	EnsureRunning(ctx context.Context, info *store.ContainerInfo) error
	UpstreamAddr(info *store.ContainerInfo) string
}

// WSHandler is a thin WebSocket relay between browser and the VM-hosted Pi wrapper.
type WSHandler struct {
	store       *store.Store
	ticketStore *TicketStore
	backend     VMBackend
	onEvent     EventCallback
	onAgentEnd  AgentEndCallback
}

func NewWSHandler(s *store.Store, ticketStore *TicketStore, backend VMBackend, onEvent EventCallback) *WSHandler {
	return &WSHandler{store: s, ticketStore: ticketStore, backend: backend, onEvent: onEvent}
}

// SetAgentEndCallback sets the callback invoked when Pi sends an agent_end event.
func (h *WSHandler) SetAgentEndCallback(cb AgentEndCallback) {
	h.onAgentEnd = cb
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if ticket == "" {
		writeWSJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing ticket"})
		return
	}
	userID, err := h.ticketStore.ValidateTicket(ticket)
	if err != nil {
		writeWSJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired ticket"})
		return
	}

	info, err := h.store.GetContainerInfo(r.Context(), userID, store.ContainerTypePiVM)
	if err != nil {
		writeWSJSON(w, http.StatusBadGateway, map[string]string{"error": "no container provisioned"})
		return
	}

	if err := h.backend.EnsureRunning(r.Context(), info); err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("ws relay: EnsureRunning failed")
		writeWSJSON(w, http.StatusBadGateway, map[string]string{"error": "container not ready"})
		return
	}

	// EnsureRunning may refresh container IP/status in the DB.
	if refreshed, err := h.store.GetContainerInfo(r.Context(), userID, store.ContainerTypePiVM); err == nil {
		info = refreshed
	}

	client, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("ws relay: upgrade failed")
		return
	}
	defer client.Close()

	upstream, _, err := websocket.DefaultDialer.DialContext(r.Context(), h.backend.UpstreamAddr(info), nil)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Str("container", info.ContainerName).Msg("ws relay: upstream dial failed")
		_ = sendJSON(client, map[string]string{"type": "proxy.error", "error": "Pi wrapper not reachable"})
		return
	}
	defer upstream.Close()

	if h.onEvent != nil {
		h.onEvent(userID, "ws_oc_connected", map[string]interface{}{"container": info.ContainerName})
		defer h.onEvent(userID, "ws_oc_disconnected", map[string]interface{}{"container": info.ContainerName})
	}

	if err := sendJSON(client, map[string]string{"type": "proxy.ready"}); err != nil {
		log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: proxy.ready failed")
		return
	}

	relay(client, upstream, userID, h.onAgentEnd)
}

// relay runs two goroutines forwarding frames in each direction.
func relay(client, upstream *websocket.Conn, userID string, onAgentEnd AgentEndCallback) {
	var once sync.Once
	done := make(chan struct{})
	shutdown := func() { once.Do(func() { close(done) }) }

	// Configure ping/pong
	client.SetReadLimit(wsClientReadLimit)
	_ = client.SetReadDeadline(time.Now().Add(wsClientPongWait))
	client.SetPongHandler(func(string) error { return client.SetReadDeadline(time.Now().Add(wsClientPongWait)) })

	upstream.SetReadLimit(wsClientReadLimit)
	_ = upstream.SetReadDeadline(time.Now().Add(upstreamPongWait))
	upstream.SetPongHandler(func(string) error { return upstream.SetReadDeadline(time.Now().Add(upstreamPongWait)) })

	// Upstream → client
	go func() {
		defer shutdown()
		for {
			msgType, data, err := upstream.ReadMessage()
			if err != nil {
				if !isNormalClose(err) {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: upstream read error")
				}
				return
			}
			if isHeartbeat(msgType, data) {
				continue
			}
			outType, outData, err := translateUpstreamFrame(msgType, data)
			if err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: translate upstream frame failed")
				outType = websocket.TextMessage
				outData = mustMarshalRelayError(err)
			}
			if outData == nil {
				continue
			}
			if onAgentEnd != nil && isAgentEndEvent(data) {
				sessionID := extractSessionID(data)
				if sessionID != "" {
					go onAgentEnd(userID, sessionID)
				}
			}
			if outType == websocket.TextMessage && len(outData) < 512 {
				log.Debug().Str("user_id", userID).Str("frame", string(data)).Msg("ws relay: upstream→client")
			} else {
				log.Debug().Str("user_id", userID).Int("size", len(outData)).Msg("ws relay: upstream→client (large)")
			}
			_ = client.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if err := client.WriteMessage(outType, outData); err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: write to client failed")
				return
			}
		}
	}()

	// Client → upstream
	go func() {
		defer shutdown()
		for {
			msgType, data, err := client.ReadMessage()
			if err != nil {
				if !isNormalClose(err) {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: client read error")
				}
				return
			}
			payloads, replies, err := translateClientFrame(msgType, data)
			if err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: translate client frame failed")
				if err := sendJSON(client, map[string]string{"type": "error", "error": err.Error()}); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: client error reply failed")
				}
				continue
			}
			if len(payloads) == 0 && len(replies) == 0 {
				continue
			}
			for _, payload := range payloads {
				if msgType == websocket.TextMessage {
					log.Debug().Str("user_id", userID).Str("frame", string(payload)).Msg("ws relay: client→upstream")
				}
				_ = upstream.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := upstream.WriteMessage(websocket.TextMessage, payload); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: write to upstream failed")
					return
				}
			}
			for _, reply := range replies {
				_ = client.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := client.WriteMessage(websocket.TextMessage, reply); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: write ack to client failed")
					return
				}
			}
		}
	}()

	// Ping ticker for both sides
	go func() {
		ticker := time.NewTicker(wsPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				dl := time.Now().Add(wsWriteWait)
				_ = client.WriteControl(websocket.PingMessage, nil, dl)
				_ = upstream.WriteControl(websocket.PingMessage, nil, dl)
			}
		}
	}()

	<-done
	_ = client.Close()
	_ = upstream.Close()
}

// isHeartbeat returns true for upstream heartbeat/ping/pong frames that should not be forwarded.
func isHeartbeat(msgType int, data []byte) bool {
	if msgType != websocket.TextMessage {
		return false
	}
	s := strings.TrimSpace(string(data))
	if s == "HEARTBEAT_OK" || s == "HEARTBEAT" || s == "PONG" {
		return true
	}
	var m map[string]interface{}
	if json.Unmarshal(data, &m) == nil {
		if t, ok := m["type"].(string); ok {
			return t == "heartbeat" || t == "ping" || t == "pong"
		}
	}
	return false
}

func isAgentEndEvent(data []byte) bool {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return false
	}
	kind, _ := payload["type"].(string)
	return kind == "agent_end"
}

func extractSessionID(data []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	sessionID, _ := payload["session_id"].(string)
	return strings.TrimSpace(sessionID)
}

func isNormalClose(err error) bool {
	if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
		return true
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}
	return false
}

func sendJSON(conn *websocket.Conn, v interface{}) error {
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, data)
}

func translateUpstreamFrame(msgType int, data []byte) (int, []byte, error) {
	if msgType != websocket.TextMessage {
		return msgType, data, nil
	}
	translated, err := pi.TranslatePiToOC(data)
	if err != nil {
		return 0, nil, err
	}
	if translated == nil {
		return 0, nil, nil
	}
	return websocket.TextMessage, translated, nil
}

func translateClientFrame(msgType int, data []byte) ([][]byte, [][]byte, error) {
	if msgType != websocket.TextMessage {
		return [][]byte{data}, nil, nil
	}
	cmd, err := pi.ParseOCCommand(data)
	if err != nil {
		return nil, nil, err
	}
	if cmd == nil || cmd.Ignore || cmd.Payload == "" {
		return nil, nil, nil
	}

	payload := []byte(cmd.Payload)
	replies := make([][]byte, 0, 1)
	if len(cmd.Ack) > 0 {
		replies = append(replies, cmd.Ack)
	}
	return [][]byte{payload}, replies, nil
}

func mustMarshalRelayError(err error) []byte {
	data, marshalErr := json.Marshal(map[string]string{"type": "error", "error": err.Error()})
	if marshalErr != nil {
		return []byte(`{"type":"error","error":"relay translation failed"}`)
	}
	return data
}

func writeWSJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
