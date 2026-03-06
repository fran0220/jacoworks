package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS already handled by outer middleware
	},
	ReadBufferSize:  16 * 1024,
	WriteBufferSize: 16 * 1024,
}

// Proxy handles WebSocket proxying between desktop clients and vm-agent containers.
type Proxy struct {
	store            *store.Store
	backend          ContainerBackend
	freezer          Freezer
	agentPort        int
	dockerHostIP     string // Docker host WireGuard IP (e.g. "10.0.1.3")
	token            string // GATEWAY_TOKEN for upstream auth
	containerEnvVars map[string]string
	onContainerReady func(userID, containerName string)
}

func NewProxy(s *store.Store, backend ContainerBackend, freezer Freezer, agentPort int, dockerHostIP, token string) *Proxy {
	return &Proxy{
		store:        s,
		backend:      backend,
		freezer:      freezer,
		agentPort:    agentPort,
		dockerHostIP: dockerHostIP,
		token:        token,
	}
}

// SetContainerEnvVars sets the env vars used when reprovisioning destroyed containers.
func (p *Proxy) SetContainerEnvVars(envVars map[string]string) {
	p.containerEnvVars = envVars
}

// SetOnContainerReady sets a callback for when a container becomes ready after unfreeze/start.
func (p *Proxy) SetOnContainerReady(fn func(userID, containerName string)) {
	p.onContainerReady = fn
}

// ServeHTTP upgrades the connection and starts bidirectional proxying.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	info, err := p.store.GetContainerInfo(r.Context(), user.ID)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("agent ws: no container provisioned")
		http.Error(w, `{"error":"no container provisioned"}`, http.StatusBadGateway)
		return
	}

	if p.freezer != nil {
		p.freezer.Touch(info.ContainerName)
	}

	if err := p.ensureRunning(r.Context(), info, user.ID); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("agent ws: container unavailable")
		http.Error(w, `{"error":"container unavailable, try again"}`, http.StatusServiceUnavailable)
		return
	}

	downstream, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("agent ws: upgrade failed")
		return
	}
	defer downstream.Close()

	upstreamURL := p.upstreamURL(info)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	upstream, _, err := dialer.Dial(upstreamURL, nil)
	if err != nil {
		log.Error().Err(err).Str("url", upstreamURL).Str("user_id", user.ID).Msg("agent ws: upstream dial failed")
		writeWSError(downstream, "upstream connection failed")
		return
	}
	defer upstream.Close()

	log.Info().
		Str("user_id", user.ID).
		Str("container", info.ContainerName).
		Str("upstream", upstreamURL).
		Msg("agent ws: connected, forwarding")

	readyMsg, _ := json.Marshal(map[string]string{"type": "proxy.ready"})
	_ = downstream.WriteMessage(websocket.TextMessage, readyMsg)

	p.forward(downstream, upstream, user.ID, info.ContainerName)
}

// upstreamURL builds the vm-agent WebSocket URL with token auth.
// Prefers host port mapping (dockerHostIP:hostPort) over container internal IP.
// Uses the per-container token for auth (each container has its own GATEWAY_TOKEN).
func (p *Proxy) upstreamURL(info *store.ContainerInfo) string {
	var host string
	var port int
	if info.HostPort > 0 && p.dockerHostIP != "" {
		host = p.dockerHostIP
		port = info.HostPort
	} else {
		host = info.ContainerIP
		port = p.agentPort
	}
	url := fmt.Sprintf("ws://%s:%d", host, port)
	// Prefer per-container token; fall back to global gateway token
	token := info.ContainerToken
	if token == "" {
		token = p.token
	}
	if token != "" {
		url += "?token=" + token
	}
	return url
}

// forward does zero-copy bidirectional message forwarding with heartbeat.
func (p *Proxy) forward(downstream, upstream *websocket.Conn, userID, containerName string) {
	var once sync.Once
	done := make(chan struct{})
	var downstreamWriteMu sync.Mutex
	var upstreamWriteMu sync.Mutex

	writeDownstream := func(msgType int, msg []byte) error {
		downstreamWriteMu.Lock()
		defer downstreamWriteMu.Unlock()
		return downstream.WriteMessage(msgType, msg)
	}

	writeUpstream := func(msgType int, msg []byte) error {
		upstreamWriteMu.Lock()
		defer upstreamWriteMu.Unlock()
		return upstream.WriteMessage(msgType, msg)
	}

	writeDownstreamControl := func(msgType int, data []byte, deadline time.Time) error {
		downstreamWriteMu.Lock()
		defer downstreamWriteMu.Unlock()
		return downstream.WriteControl(msgType, data, deadline)
	}

	writeUpstreamControl := func(msgType int, data []byte, deadline time.Time) error {
		upstreamWriteMu.Lock()
		defer upstreamWriteMu.Unlock()
		return upstream.WriteControl(msgType, data, deadline)
	}

	closeAll := func() {
		once.Do(func() {
			close(done)
			_ = downstream.Close()
			_ = upstream.Close()
		})
	}

	// Downstream -> upstream (client messages to container).
	go func() {
		defer closeAll()
		for {
			msgType, msg, err := downstream.ReadMessage()
			if err != nil {
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: downstream read error")
				}
				return
			}

			if msgType == websocket.TextMessage && isPingMessage(msg) {
				pong, _ := json.Marshal(map[string]string{"type": "pong"})
				if err := writeDownstream(websocket.TextMessage, pong); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: downstream pong write error")
					return
				}

				if p.freezer != nil {
					p.freezer.Touch(containerName)
				}
				continue
			}

			if p.freezer != nil {
				p.freezer.Touch(containerName)
			}

			if err := writeUpstream(msgType, msg); err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: upstream write error")
				return
			}
		}
	}()

	// Upstream -> downstream (container events to client).
	go func() {
		defer closeAll()
		for {
			msgType, msg, err := upstream.ReadMessage()
			if err != nil {
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: upstream read error")
				}
				return
			}

			if err := writeDownstream(msgType, msg); err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: downstream write error")
				return
			}
		}
	}()

	// Server-side heartbeat: WS-level ping to detect dead connections.
	go func() {
		defer closeAll()
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				deadline := time.Now().Add(writeWait)
				if err := writeDownstreamControl(websocket.PingMessage, nil, deadline); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: downstream ping control write error")
					return
				}
				if err := writeUpstreamControl(websocket.PingMessage, nil, deadline); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("agent ws: upstream ping control write error")
					return
				}
			case <-done:
				return
			}
		}
	}()

	<-done
	log.Info().Str("user_id", userID).Str("container", containerName).Msg("agent ws: session ended")
}

// ensureRunning checks and starts/unfreezes the container if needed.
// If the container is destroyed (not_found), it will be automatically reprovisioned.
func (p *Proxy) ensureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	if p.backend == nil {
		return nil
	}

	status, err := p.backend.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	switch strings.ToLower(status) {
	case "running":
		if err := p.backend.WaitForHealth(info.ContainerName, info.ContainerIP); err == nil {
			return nil
		}
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("container running but service not healthy")
		return fmt.Errorf("container running but not healthy")
	case "paused":
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("unpausing container for ws")
		if err := p.backend.Unfreeze(info.ContainerName); err != nil {
			return err
		}
		if err := p.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after unpause: %w", err)
		}
		if p.onContainerReady != nil {
			go p.onContainerReady(userID, info.ContainerName)
		}
		return p.backend.WaitForHealth(info.ContainerName, info.ContainerIP)
	case "stopped", "exited":
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("starting stopped container for ws")
		if err := p.backend.Start(info.ContainerName); err != nil {
			return err
		}
		if err := p.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after start: %w", err)
		}
		if p.onContainerReady != nil {
			go p.onContainerReady(userID, info.ContainerName)
		}
		return p.backend.WaitForHealth(info.ContainerName, info.ContainerIP)
	case "not_found":
		if p.containerEnvVars == nil {
			return fmt.Errorf("container destroyed and no env vars configured for reprovision")
		}
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("container not found, reprovisioning")
		ip, err := p.backend.Reprovision(info.ContainerName, info.ContainerToken, p.containerEnvVars, info.HostPort)
		if err != nil {
			return fmt.Errorf("reprovision: %w", err)
		}
		if err := p.store.UpdateContainerIP(ctx, userID, ip); err != nil {
			return fmt.Errorf("update IP after reprovision: %w", err)
		}
		if p.onContainerReady != nil {
			go p.onContainerReady(userID, info.ContainerName)
		}
		return nil
	default:
		return fmt.Errorf("container in unexpected state: %s", status)
	}
}

func isPingMessage(msg []byte) bool {
	var m map[string]interface{}
	if json.Unmarshal(msg, &m) == nil {
		if t, ok := m["type"].(string); ok && t == "ping" {
			return true
		}
	}
	return false
}

func writeWSError(conn *websocket.Conn, errMsg string) {
	msg, _ := json.Marshal(map[string]string{"type": "proxy.error", "error": errMsg})
	_ = conn.WriteMessage(websocket.TextMessage, msg)
}
