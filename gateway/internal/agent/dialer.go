package agent

import (
	"context"
	"encoding/json"

	"github.com/gorilla/websocket"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

// UpstreamDialer abstracts how to connect to different container backends.
// Gateway now uses OpenClaw as the active upstream implementation.
type UpstreamDialer interface {
	// ContainerType returns the backing container type (for example: "openclaw").
	ContainerType() string

	// EnsureRunning starts/unfreezes the container if needed.
	EnsureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error

	// Dial connects to the container WS and performs any handshake.
	// Returns a ready-to-use connection.
	Dial(info *store.ContainerInfo) (*websocket.Conn, error)

	// UpstreamURL returns the WS URL for the container (for logging).
	UpstreamURL(info *store.ContainerInfo) string

	// MapUpstreamMessage maps a raw upstream message to an Event.
	// OpenClaw dialer forwards frames as "message" events.
	MapUpstreamMessage(msg []byte) (eventType string, data []byte, ok bool)

	// FormatClientMessage formats a client request for the upstream protocol.
	// OpenClaw dialer forwards payload frames without rewriting.
	FormatClientMessage(msgType string, payload json.RawMessage, requestID string) ([]byte, error)

	// GetFreezer returns the Freezer for this container type (may be nil).
	GetFreezer() Freezer
}
