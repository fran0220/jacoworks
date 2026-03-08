package agent

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	dockerpkg "github.com/fran0220/jacoworks/gateway/internal/docker"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

// ── OpenClaw Gateway WS Protocol ──────────────────────────────────
//
// Handshake:
//   1. Server sends: {"type":"event","event":"connect.challenge","payload":{"nonce":"..."}}
//   2. Client sends: {"type":"req","id":"...","method":"connect","params":{...,"auth":{"token":"..."}}}
//   3. Server sends: {"type":"res","id":"...","ok":true,"payload":{"type":"hello-ok",...}}
//
// Chat:
//   Request:  {"type":"req","id":"...","method":"chat.send","params":{"sessionKey":"...","message":"...","idempotencyKey":"..."}}
//   Streaming: {"type":"event","event":"agent","payload":{"stream":"text","data":{"text":"..."},...}}
//   Final:    {"type":"event","event":"chat","payload":{"state":"final","message":{"content":[{"type":"text","text":"..."}]},...}}
//
// Abort:
//   Request:  {"type":"req","id":"...","method":"chat.abort","params":{"sessionKey":"..."}}

// OpenClawBridge handles a single webchat ↔ OpenClaw WS session.
// It transparently proxies all frames between webchat and OpenClaw.
type OpenClawBridge struct {
	store   *store.Store
	oc      *dockerpkg.OpenClawClient
	freezer Freezer
}

func NewOpenClawBridge(s *store.Store, oc *dockerpkg.OpenClawClient, freezer Freezer) *OpenClawBridge {
	return &OpenClawBridge{
		store:   s,
		oc:      oc,
		freezer: freezer,
	}
}

// ServeSession handles one webchat client for an OpenClaw container.
// Called from WSHandler when container_type == "openclaw".
func (b *OpenClawBridge) ServeSession(downstream *websocket.Conn, info *store.ContainerInfo, userID string) {
	defer downstream.Close()

	if b.freezer != nil {
		b.freezer.Touch(info.ContainerName)
	}

	// Dial upstream OpenClaw container
	upstreamURL := b.oc.UpstreamAddr(info)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	// Set Origin header to match OpenClaw's allowedOrigins
	originURL := strings.Replace(upstreamURL, "ws://", "http://", 1)
	headers := http.Header{"Origin": []string{originURL}}
	upstream, _, err := dialer.Dial(upstreamURL, headers)
	if err != nil {
		log.Error().Err(err).Str("url", upstreamURL).Str("user_id", userID).Msg("openclaw bridge: dial failed")
		writeWSError(downstream, "upstream connection failed")
		return
	}
	defer upstream.Close()

	log.Info().
		Str("user_id", userID).
		Str("container", info.ContainerName).
		Str("upstream", upstreamURL).
		Msg("openclaw bridge: connected")

	sess := &ocSession{
		downstream: downstream,
		upstream:   upstream,
		userID:     userID,
		container:  info.ContainerName,
		freezer:    b.freezer,
	}
	sess.run()
}

// ── Session (bidirectional transparent proxy) ─────────────────────

type ocSession struct {
	downstream *websocket.Conn
	upstream   *websocket.Conn
	userID     string
	container  string
	freezer    Freezer

	once sync.Once
	done chan struct{}

	downMu sync.Mutex
	upMu   sync.Mutex
}

func (s *ocSession) run() {
	s.done = make(chan struct{})
	s.configureReadLoop(s.downstream)
	s.configureReadLoop(s.upstream)

	// Upstream (OpenClaw) → downstream (webchat)
	go s.pumpUpToDown()

	// Downstream (webchat) → upstream (OpenClaw)
	go s.pumpDownToUp()

	// Heartbeat
	go s.heartbeat()

	<-s.done
	log.Info().Str("user_id", s.userID).Str("container", s.container).Msg("openclaw bridge: session ended")
}

func (s *ocSession) close() {
	s.once.Do(func() {
		close(s.done)
		_ = s.downstream.Close()
		_ = s.upstream.Close()
	})
}

func (s *ocSession) configureReadLoop(conn *websocket.Conn) {
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
}

func (s *ocSession) writeDownstream(msgType int, msg []byte) error {
	s.downMu.Lock()
	defer s.downMu.Unlock()
	_ = s.downstream.SetWriteDeadline(time.Now().Add(writeWait))
	err := s.downstream.WriteMessage(msgType, msg)
	_ = s.downstream.SetWriteDeadline(time.Time{})
	return err
}

func (s *ocSession) writeUpstream(msgType int, msg []byte) error {
	s.upMu.Lock()
	defer s.upMu.Unlock()
	_ = s.upstream.SetWriteDeadline(time.Now().Add(writeWait))
	err := s.upstream.WriteMessage(msgType, msg)
	_ = s.upstream.SetWriteDeadline(time.Time{})
	return err
}

// pumpDownToUp transparently proxies frames from webchat to OpenClaw.
func (s *ocSession) pumpDownToUp() {
	defer s.close()
	for {
		msgType, msg, err := s.downstream.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Debug().Err(err).Str("user_id", s.userID).Msg("openclaw bridge: downstream read error")
			}
			return
		}

		if s.freezer != nil {
			s.freezer.Touch(s.container)
		}

		if err := s.writeUpstream(msgType, msg); err != nil {
			log.Debug().Err(err).Str("user_id", s.userID).Msg("openclaw bridge: upstream write error")
			return
		}
	}
}

// pumpUpToDown transparently proxies frames from OpenClaw to webchat.
func (s *ocSession) pumpUpToDown() {
	defer s.close()

	for {
		msgType, msg, err := s.upstream.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Debug().Err(err).Str("user_id", s.userID).Msg("openclaw bridge: upstream read error")
			}
			return
		}

		if s.freezer != nil {
			s.freezer.Touch(s.container)
		}

		if err := s.writeDownstream(msgType, msg); err != nil {
			log.Debug().Err(err).Str("user_id", s.userID).Msg("openclaw bridge: downstream write error")
			return
		}
	}
}

// heartbeat sends WS-level pings to keep both connections alive.
func (s *ocSession) heartbeat() {
	defer s.close()
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			deadline := time.Now().Add(writeWait)

			s.downMu.Lock()
			err := s.downstream.WriteControl(websocket.PingMessage, nil, deadline)
			s.downMu.Unlock()
			if err != nil {
				return
			}

			s.upMu.Lock()
			err = s.upstream.WriteControl(websocket.PingMessage, nil, deadline)
			s.upMu.Unlock()
			if err != nil {
				return
			}
		case <-s.done:
			return
		}
	}
}

// EnsureRunning delegates to the OpenClawClient for real Docker lifecycle management.
func (b *OpenClawBridge) EnsureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	return b.oc.EnsureRunning(ctx, info)
}
