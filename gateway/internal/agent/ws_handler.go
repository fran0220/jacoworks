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

// OpenClawBackend abstracts VM lifecycle and addressing.
type OpenClawBackend interface {
	EnsureRunning(ctx context.Context, info *store.ContainerInfo) error
	UpstreamAddr(info *store.ContainerInfo) string
}

// WSHandler is a thin WebSocket relay between browser and OpenClaw VM.
type WSHandler struct {
	store       *store.Store
	ticketStore *TicketStore
	oc          OpenClawBackend
	onEvent     EventCallback
}

func NewWSHandler(s *store.Store, ticketStore *TicketStore, oc OpenClawBackend, onEvent EventCallback) *WSHandler {
	return &WSHandler{store: s, ticketStore: ticketStore, oc: oc, onEvent: onEvent}
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

	info, err := h.store.GetContainerInfo(r.Context(), userID, store.ContainerTypeOpenClaw)
	if err != nil {
		writeWSJSON(w, http.StatusBadGateway, map[string]string{"error": "no container provisioned"})
		return
	}

	if err := h.oc.EnsureRunning(r.Context(), info); err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("ws relay: EnsureRunning failed")
		writeWSJSON(w, http.StatusBadGateway, map[string]string{"error": "container not ready"})
		return
	}

	client, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("ws relay: upgrade failed")
		return
	}
	defer client.Close()

	// TODO(Thread 6): replace the removed OpenClaw upstream dial + handshake with
	// Pi process management and JSONL/frame translation. Ticket auth, VM wake-up,
	// relay helpers, and heartbeat filtering stay in place for that swap.
	log.Info().Str("user_id", userID).Str("container", info.ContainerName).Msg("ws relay: upstream disabled during Pi migration")
	_ = sendJSON(client, map[string]string{"type": "proxy.error", "error": "Pi upstream not wired yet"})
}

// relay runs two goroutines forwarding frames in each direction.
func relay(client, upstream *websocket.Conn, userID string) {
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
			if msgType == websocket.TextMessage && len(data) < 512 {
				log.Debug().Str("user_id", userID).Str("frame", string(data)).Msg("ws relay: upstream→client")
			} else {
				log.Debug().Str("user_id", userID).Int("size", len(data)).Msg("ws relay: upstream→client (large)")
			}
			_ = client.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if err := client.WriteMessage(msgType, data); err != nil {
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
			if msgType == websocket.TextMessage {
				log.Debug().Str("user_id", userID).Str("frame", string(data)).Msg("ws relay: client→upstream")
			}
			_ = upstream.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if err := upstream.WriteMessage(msgType, data); err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("ws relay: write to upstream failed")
				return
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

func writeWSJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
