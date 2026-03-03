package openclaw

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS already handled by outer middleware
	},
	ReadBufferSize:  16 * 1024,
	WriteBufferSize: 16 * 1024,
}

// WSProxy handles WebSocket proxying between desktop clients and OpenClaw containers.
type WSProxy struct {
	store            *store.Store
	lxdClient        *lxd.SSHClient
	freezer          *lxd.Freezer
	openclawPort     int
	deviceKeys       *DeviceKeyStore
	onContainerReady func(userID, containerName string) // called after unfreeze/start
}

func NewWSProxy(s *store.Store, lxdClient *lxd.SSHClient, freezer *lxd.Freezer, openclawPort int, dataDir string) *WSProxy {
	return &WSProxy{
		store:        s,
		lxdClient:    lxdClient,
		freezer:      freezer,
		openclawPort: openclawPort,
		deviceKeys:   NewDeviceKeyStore(dataDir),
	}
}

// SetOnContainerReady sets a callback for when a container becomes ready after unfreeze/start.
func (p *WSProxy) SetOnContainerReady(fn func(userID, containerName string)) {
	p.onContainerReady = fn
}

// ServeHTTP upgrades the connection and starts bidirectional proxying.
func (p *WSProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	// Look up user's container
	info, err := p.store.GetContainerInfo(r.Context(), user.ID)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("openclaw ws: no container provisioned")
		http.Error(w, `{"error":"no container provisioned"}`, http.StatusBadGateway)
		return
	}

	// Touch freezer to prevent idle freeze
	if p.freezer != nil {
		p.freezer.Touch(info.ContainerName)
	}

	// Ensure container is running (auto-unfreeze if needed)
	if err := p.ensureRunning(r.Context(), info, user.ID); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("openclaw ws: container unavailable")
		http.Error(w, `{"error":"container unavailable, try again"}`, http.StatusServiceUnavailable)
		return
	}

	// Upgrade downstream (client → gateway)
	downstream, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("openclaw ws: upgrade failed")
		return
	}
	defer downstream.Close()

	// Connect upstream (gateway → container OpenClaw)
	upstreamURL := fmt.Sprintf("ws://%s:%d", info.ContainerIP, p.openclawPort)
	upstream, _, err := websocket.DefaultDialer.Dial(upstreamURL, nil)
	if err != nil {
		log.Error().Err(err).Str("url", upstreamURL).Str("user_id", user.ID).Msg("openclaw ws: upstream dial failed")
		writeWSError(downstream, "upstream connection failed")
		return
	}
	defer upstream.Close()

	log.Info().
		Str("user_id", user.ID).
		Str("container", info.ContainerName).
		Str("upstream", upstreamURL).
		Msg("openclaw ws: connected, starting handshake")

	// Perform Ed25519 device auth handshake with OpenClaw
	if err := p.performHandshake(upstream, info.ContainerToken); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("openclaw ws: handshake failed")
		writeWSError(downstream, "authentication with container failed: "+err.Error())
		return
	}

	// Notify client that proxy is ready
	readyMsg, _ := json.Marshal(map[string]string{"type": "proxy.ready"})
	downstream.WriteMessage(websocket.TextMessage, readyMsg)

	log.Info().
		Str("user_id", user.ID).
		Str("container", info.ContainerName).
		Msg("openclaw ws: handshake complete, forwarding")

	// Bidirectional forwarding
	p.forward(downstream, upstream, user.ID, info.ContainerName)
}

// performHandshake handles the Ed25519 challenge-response auth with OpenClaw Gateway.
// Protocol v3: connect.challenge → connect req with device signature → res ok.
func (p *WSProxy) performHandshake(upstream *websocket.Conn, gatewayToken string) error {
	privKey, pubKey := p.deviceKeys.GetOrCreate()
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(pubKey)
	deviceID := sha256Hex([]byte(pubKey))

	// Wait for connect.challenge event from Gateway
	upstream.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, msg, err := upstream.ReadMessage()
	if err != nil {
		return fmt.Errorf("read challenge: %w", err)
	}

	var envelope struct {
		Type    string `json:"type"`
		Event   string `json:"event"`
		Payload struct {
			Nonce string `json:"nonce"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(msg, &envelope); err != nil {
		return fmt.Errorf("parse challenge: %w", err)
	}
	if envelope.Event != "connect.challenge" {
		return fmt.Errorf("expected connect.challenge, got %q: %s", envelope.Event, string(msg))
	}

	nonce := envelope.Payload.Nonce
	signedAt := time.Now().UnixMilli()
	signedAtStr := fmt.Sprintf("%d", signedAt)

	// Build v2 signature payload (pipe-delimited)
	scopes := "operator.admin,operator.approvals,operator.pairing,operator.read,operator.write"
	payload := fmt.Sprintf("v2|%s|gateway-client|backend|operator|%s|%s|%s|%s",
		deviceID, scopes, signedAtStr, gatewayToken, nonce)

	signature := ed25519.Sign(privKey, []byte(payload))
	signatureB64 := base64.RawURLEncoding.EncodeToString(signature)

	// Build connect frame (OpenClaw protocol v3)
	connectFrame := map[string]interface{}{
		"type":   "req",
		"id":     "connect-" + nonce[:8],
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]string{
				"id":       "gateway-client",
				"version":  "1.0.0",
				"platform": "web",
				"mode":     "backend",
			},
			"role": "operator",
			"scopes": []string{
				"operator.admin",
				"operator.approvals",
				"operator.pairing",
				"operator.read",
				"operator.write",
			},
			"caps": []string{},
			"auth": map[string]string{
				"token": gatewayToken,
			},
			"device": map[string]interface{}{
				"id":        deviceID,
				"publicKey": pubKeyB64,
				"signedAt":  signedAt,
				"nonce":     nonce,
				"signature": signatureB64,
			},
			"locale":    "zh-CN",
			"userAgent": "JAcoworks-Gateway/1.0.0",
		},
	}
	connectJSON, _ := json.Marshal(connectFrame)
	if err := upstream.WriteMessage(websocket.TextMessage, connectJSON); err != nil {
		return fmt.Errorf("send connect: %w", err)
	}

	// Wait for connect response
	upstream.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, resp, err := upstream.ReadMessage()
	if err != nil {
		return fmt.Errorf("read connect response: %w", err)
	}

	var respEnvelope struct {
		Type  string `json:"type"`
		OK    bool   `json:"ok"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(resp, &respEnvelope); err != nil {
		return fmt.Errorf("parse connect response: %w", err)
	}
	if respEnvelope.Error != nil {
		return fmt.Errorf("connect rejected: %s - %s", respEnvelope.Error.Code, respEnvelope.Error.Message)
	}
	if !respEnvelope.OK {
		return fmt.Errorf("connect not ok: %s", string(resp))
	}

	log.Debug().Str("response", string(resp)).Msg("openclaw handshake response")

	// Clear read deadline for normal operation
	upstream.SetReadDeadline(time.Time{})
	return nil
}

// forward does zero-copy bidirectional message forwarding with heartbeat.
func (p *WSProxy) forward(downstream, upstream *websocket.Conn, userID, containerName string) {
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
					log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: downstream read error")
				}
				return
			}

			if msgType == websocket.TextMessage && isPingMessage(msg) {
				// Client ping: reply pong locally, do NOT forward to upstream
				// (OpenClaw rejects bare {"type":"ping"} as invalid request frame).
				// The server-side heartbeat goroutine handles upstream keepalive separately.
				pong, _ := json.Marshal(map[string]string{"type": "pong"})
				if err := writeDownstream(websocket.TextMessage, pong); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: downstream pong write error")
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
				log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: upstream write error")
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
					log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: upstream read error")
				}
				return
			}

			if err := writeDownstream(msgType, msg); err != nil {
				log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: downstream write error")
				return
			}
		}
	}()

	// Server-side heartbeat: WS-level ping every 20s to detect dead connections.
	// Do NOT send app-level {"type":"ping"} to upstream — OpenClaw rejects it.
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				deadline := time.Now().Add(10 * time.Second)
				if err := writeDownstreamControl(websocket.PingMessage, nil, deadline); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: downstream ping control write error")
					return
				}
				if err := writeUpstreamControl(websocket.PingMessage, nil, deadline); err != nil {
					log.Debug().Err(err).Str("user_id", userID).Msg("openclaw ws: upstream ping control write error")
					return
				}
			case <-done:
				return
			}
		}
	}()

	<-done
	log.Info().Str("user_id", userID).Str("container", containerName).Msg("openclaw ws: session ended")
}

func (p *WSProxy) ensureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	if p.lxdClient == nil {
		return nil
	}

	status, err := p.lxdClient.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	switch strings.ToUpper(status.Status) {
	case "RUNNING":
		return nil
	case "FROZEN":
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("unfreezing for ws")
		if err := p.lxdClient.Unfreeze(info.ContainerName); err != nil {
			return err
		}
		if err := p.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after unfreeze: %w", err)
		}
		if p.onContainerReady != nil {
			go p.onContainerReady(userID, info.ContainerName)
		}
		return nil
	case "STOPPED":
		log.Info().Str("container", info.ContainerName).Str("user_id", userID).Msg("starting stopped container for ws")
		if err := p.lxdClient.Start(info.ContainerName); err != nil {
			return err
		}
		ip, err := p.lxdClient.GetIP(info.ContainerName)
		if err != nil {
			return err
		}
		if err := p.store.UpdateContainerIP(ctx, userID, ip); err != nil {
			return fmt.Errorf("update container ip: %w", err)
		}
		if err := p.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after start: %w", err)
		}
		info.ContainerIP = ip
		if p.onContainerReady != nil {
			go p.onContainerReady(userID, info.ContainerName)
		}
		return nil
	default:
		return fmt.Errorf("container in unexpected state: %s", status.Status)
	}
}

// --- Device Key Store ---

// DeviceKeyStore persists an Ed25519 keypair for OpenClaw device auth.
type DeviceKeyStore struct {
	dir     string
	mu      sync.Mutex
	privKey ed25519.PrivateKey
	pubKey  ed25519.PublicKey
}

func NewDeviceKeyStore(dataDir string) *DeviceKeyStore {
	return &DeviceKeyStore{dir: dataDir}
}

func (d *DeviceKeyStore) GetOrCreate() (ed25519.PrivateKey, ed25519.PublicKey) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.privKey != nil {
		return d.privKey, d.pubKey
	}

	keyPath := filepath.Join(d.dir, "openclaw_device.key")

	// Try loading existing key
	if data, err := os.ReadFile(keyPath); err == nil {
		if privBytes, err := hex.DecodeString(strings.TrimSpace(string(data))); err == nil && len(privBytes) == ed25519.PrivateKeySize {
			d.privKey = ed25519.PrivateKey(privBytes)
			d.pubKey = d.privKey.Public().(ed25519.PublicKey)
			log.Info().Str("device_id", sha256Hex([]byte(d.pubKey))).Msg("loaded existing device key")
			return d.privKey, d.pubKey
		}
	}

	// Generate new keypair
	d.pubKey, d.privKey, _ = ed25519.GenerateKey(rand.Reader)
	os.MkdirAll(d.dir, 0700)
	os.WriteFile(keyPath, []byte(hex.EncodeToString(d.privKey)), 0600)
	log.Info().Str("device_id", sha256Hex([]byte(d.pubKey))).Msg("generated new device key")

	return d.privKey, d.pubKey
}

// GetDeviceKeyInfo returns the gateway's device key info for provisioning.
func (p *WSProxy) GetDeviceKeyInfo() *lxd.DeviceKeyInfo {
	_, pubKey := p.deviceKeys.GetOrCreate()
	return &lxd.DeviceKeyInfo{
		DeviceID:  sha256Hex([]byte(pubKey)),
		PublicKey: base64.RawURLEncoding.EncodeToString(pubKey),
	}
}

// InjectGatewayDeviceKey adds the gateway's device key to a container's paired.json
// so the container trusts the gateway on first connect (no manual pairing needed).
func (p *WSProxy) InjectGatewayDeviceKey(containerName string) error {
	_, pubKey := p.deviceKeys.GetOrCreate()
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(pubKey)
	deviceID := sha256Hex([]byte(pubKey))

	// Build a Python one-liner to inject the device entry
	script := fmt.Sprintf(`python3 -c "
import json, time, os
f = '/home/agent/.openclaw/devices/paired.json'
data = {}
if os.path.exists(f):
    with open(f) as fh:
        data = json.load(fh)
data['%s'] = {
    'deviceId': '%s',
    'publicKey': '%s',
    'platform': 'web',
    'clientId': 'gateway-client',
    'clientMode': 'backend',
    'role': 'operator',
    'roles': ['operator'],
    'scopes': ['operator.admin','operator.approvals','operator.pairing','operator.read','operator.write'],
    'approvedScopes': ['operator.admin','operator.approvals','operator.pairing','operator.read','operator.write'],
    'remoteIp': '10.10.10.1',
    'tokens': {'operator': {'token': 'auto-paired-gateway', 'role': 'operator',
        'scopes': ['operator.admin','operator.approvals','operator.pairing','operator.read','operator.write'],
        'createdAtMs': int(time.time()*1000)}},
    'createdAtMs': int(time.time()*1000),
    'approvedAtMs': int(time.time()*1000)
}
with open(f, 'w') as fh:
    json.dump(data, fh, indent=2)
"`, deviceID, deviceID, pubKeyB64)

	if p.lxdClient == nil {
		return fmt.Errorf("no lxd client")
	}

	out, err := p.lxdClient.Exec(containerName, "su", "-", "agent", "-c", script)
	if err != nil {
		return fmt.Errorf("inject device key: %w (output: %s)", err, out)
	}

	log.Info().Str("container", containerName).Str("device_id", deviceID).Msg("injected gateway device key")
	return nil
}

// --- Helpers ---

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
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
	conn.WriteMessage(websocket.TextMessage, msg)
}
