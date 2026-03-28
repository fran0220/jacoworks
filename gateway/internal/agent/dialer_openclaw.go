package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	ocpkg "github.com/fran0220/jacoworks/gateway/internal/openclaw"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

// OpenClawBackend abstracts OpenClaw container operations for the WS dialer.
// *openclaw.Client satisfies this interface.
type OpenClawBackend interface {
	EnsureRunning(ctx context.Context, info *store.ContainerInfo) error
	UpstreamAddr(info *store.ContainerInfo) string
}

// OpenClawDialer implements UpstreamDialer for OpenClaw containers.
// Messages are transparently proxied — the OC protocol is managed by the webchat client.
type OpenClawDialer struct {
	store           *store.Store
	oc              OpenClawBackend
	freezer         Freezer
	autoPairEnabled bool
}

func NewOpenClawDialer(s *store.Store, oc OpenClawBackend, freezer Freezer) *OpenClawDialer {
	return &OpenClawDialer{
		store:   s,
		oc:      oc,
		freezer: freezer,
	}
}

func (d *OpenClawDialer) SetAutoPairEnabled(enabled bool) {
	d.autoPairEnabled = enabled
}

func (d *OpenClawDialer) ContainerType() string {
	return store.ContainerTypeOpenClaw
}

func (d *OpenClawDialer) EnsureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	return d.oc.EnsureRunning(ctx, info)
}

func (d *OpenClawDialer) Dial(info *store.ContainerInfo) (*websocket.Conn, error) {
	upstreamURL := d.UpstreamURL(info)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	// Origin must match the VM's listen address for OpenClaw's controlUi.allowedOrigins.
	originURL := fmt.Sprintf("http://%s:18789", info.ContainerIP)
	if info.ContainerIP == "" {
		originURL = "http://127.0.0.1:18789"
	}
	headers := http.Header{"Origin": []string{originURL}}
	conn, _, err := dialer.Dial(upstreamURL, headers)
	if err != nil {
		return nil, err
	}

	// Complete OpenClaw challenge-response handshake so the upstream
	// connection is authenticated before we start proxying client messages.
	if err := ocpkg.HandshakeConn(conn, info.ContainerToken, 10*time.Second); err != nil {
		conn.Close()
		return nil, fmt.Errorf("openclaw handshake: %w", err)
	}

	// Start auto-pairer in background
	if d.autoPairEnabled {
		go func() {
			pairer := ocpkg.NewAutoPairer(upstreamURL, info.ContainerToken)
			if err := pairer.ApproveAll(context.Background()); err != nil {
				log.Warn().Err(err).Str("container", info.ContainerName).Msg("auto-pairing failed")
			}
		}()
	}

	return conn, nil
}

func (d *OpenClawDialer) UpstreamURL(info *store.ContainerInfo) string {
	return d.oc.UpstreamAddr(info)
}

// MapUpstreamMessage passes through all OC frames as "message" events.
func (d *OpenClawDialer) MapUpstreamMessage(msg []byte) (string, []byte, bool) {
	return "message", msg, true
}

// FormatClientMessage passes through — OC protocol is constructed by the webchat client.
func (d *OpenClawDialer) FormatClientMessage(msgType string, payload json.RawMessage, requestID string) ([]byte, error) {
	if len(payload) == 0 {
		return []byte("{}"), nil
	}
	return []byte(payload), nil
}

func (d *OpenClawDialer) GetFreezer() Freezer {
	return d.freezer
}
