package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	defaultConnectTimeout = 10 * time.Second
	defaultRequestTimeout = 5 * time.Second
)

// GatewayClient is an OpenClaw WS protocol client that performs
// challenge-response authentication and supports operator commands.
type GatewayClient struct {
	conn    *websocket.Conn
	token   string
	mu      sync.Mutex
	reqID   atomic.Int64
	pending map[string]chan *Frame
	done    chan struct{}
	once    sync.Once
}

// NewGatewayClient dials the OpenClaw container WebSocket, completes the
// challenge-response handshake, and starts a background reader goroutine.
// The returned client is ready for operator commands (pair, revoke, etc.).
func NewGatewayClient(ctx context.Context, wsURL, token string) (*GatewayClient, error) {
	dialer := websocket.Dialer{HandshakeTimeout: defaultConnectTimeout}
	originURL := strings.Replace(wsURL, "ws://", "http://", 1)
	headers := http.Header{"Origin": []string{originURL}}

	conn, _, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", wsURL, err)
	}

	gc := &GatewayClient{
		conn:    conn,
		token:   token,
		pending: make(map[string]chan *Frame),
		done:    make(chan struct{}),
	}

	if err := gc.handshake(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("handshake: %w", err)
	}

	go gc.readLoop()

	return gc, nil
}

// Close gracefully shuts down the client and its background reader.
func (gc *GatewayClient) Close() error {
	gc.once.Do(func() {
		close(gc.done)
		gc.conn.Close()
	})
	return nil
}

// ListPendingPairs sends a node.pair.list request and returns pending pairs.
func (gc *GatewayClient) ListPendingPairs(ctx context.Context) ([]PairRequest, error) {
	res, err := gc.sendRequest(ctx, "node.pair.list", nil)
	if err != nil {
		return nil, err
	}

	if res.OK == nil || !*res.OK {
		return nil, gc.resError(res, "node.pair.list")
	}

	var list PairListResponse
	if err := json.Unmarshal(res.Payload, &list); err != nil {
		return nil, fmt.Errorf("unmarshal pair list: %w", err)
	}
	return list.Pairs, nil
}

// ApprovePair approves a pending device pair request.
func (gc *GatewayClient) ApprovePair(ctx context.Context, pairingID string) error {
	params := PairApproveParams{PairingID: pairingID}
	res, err := gc.sendRequest(ctx, "node.pair.approve", params)
	if err != nil {
		return err
	}
	if res.OK == nil || !*res.OK {
		return gc.resError(res, "node.pair.approve")
	}
	return nil
}

// RevokePair revokes a paired device.
func (gc *GatewayClient) RevokePair(ctx context.Context, deviceID string) error {
	params := RevokeParams{DeviceID: deviceID}
	res, err := gc.sendRequest(ctx, "node.revoke", params)
	if err != nil {
		return err
	}
	if res.OK == nil || !*res.OK {
		return gc.resError(res, "node.revoke")
	}
	return nil
}

// ── Internal ──────────────────────────────────────────────────────

// handshake waits for connect.challenge and sends the connect request.
// It reads frames directly (before the background reader is started).
func (gc *GatewayClient) handshake(ctx context.Context) error {
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(defaultConnectTimeout)
	}
	gc.conn.SetReadDeadline(deadline)
	defer gc.conn.SetReadDeadline(time.Time{})

	// 1. Wait for connect.challenge event
	var challenge Frame
	if err := gc.conn.ReadJSON(&challenge); err != nil {
		return fmt.Errorf("read challenge: %w", err)
	}
	if challenge.Type != "event" || challenge.Event != "connect.challenge" {
		return fmt.Errorf("expected connect.challenge, got type=%q event=%q", challenge.Type, challenge.Event)
	}

	log.Debug().Msg("openclaw client: received connect.challenge")

	// 2. Send connect request
	reqID := gc.nextID()
	connectParams := ConnectParams{
		MinProtocol: 3,
		MaxProtocol: 3,
		Client: ClientInfo{
			ID:       "gateway-client",
			Version:  "1.0.0",
			Platform: "linux",
			Mode:     "backend",
		},
		Auth:   AuthInfo{Token: gc.token},
		Role:   "operator",
		Scopes: []string{"operator.read", "operator.write"},
		Caps:   []string{"tool-events"},
	}
	paramsJSON, err := json.Marshal(connectParams)
	if err != nil {
		return fmt.Errorf("marshal connect params: %w", err)
	}

	req := Frame{
		Type:   "req",
		ID:     reqID,
		Method: "connect",
		Params: paramsJSON,
	}

	gc.conn.SetWriteDeadline(deadline)
	if err := gc.conn.WriteJSON(req); err != nil {
		return fmt.Errorf("write connect: %w", err)
	}
	gc.conn.SetWriteDeadline(time.Time{})

	// 3. Wait for hello-ok response
	var res Frame
	if err := gc.conn.ReadJSON(&res); err != nil {
		return fmt.Errorf("read connect response: %w", err)
	}
	if res.Type != "res" || res.ID != reqID {
		return fmt.Errorf("unexpected response: type=%q id=%q", res.Type, res.ID)
	}
	if res.OK == nil || !*res.OK {
		return fmt.Errorf("connect rejected: %s", string(res.Error))
	}

	log.Debug().Msg("openclaw client: handshake complete")
	return nil
}

// readLoop dispatches incoming frames to pending request channels.
// Events are logged and discarded (no event subscriptions needed for pairing).
func (gc *GatewayClient) readLoop() {
	defer gc.Close()
	for {
		select {
		case <-gc.done:
			return
		default:
		}

		var frame Frame
		if err := gc.conn.ReadJSON(&frame); err != nil {
			select {
			case <-gc.done:
				return // clean shutdown
			default:
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Debug().Err(err).Msg("openclaw client: read error")
				}
				return
			}
		}

		switch frame.Type {
		case "res":
			gc.mu.Lock()
			ch, ok := gc.pending[frame.ID]
			if ok {
				delete(gc.pending, frame.ID)
			}
			gc.mu.Unlock()
			if ok {
				ch <- &frame
			}
		case "event":
			log.Debug().Str("event", frame.Event).Msg("openclaw client: event received")
		}
	}
}

// sendRequest sends a req frame and waits for the matching response.
func (gc *GatewayClient) sendRequest(ctx context.Context, method string, params interface{}) (*Frame, error) {
	reqID := gc.nextID()

	var paramsJSON json.RawMessage
	if params != nil {
		var err error
		paramsJSON, err = json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("marshal params: %w", err)
		}
	}

	req := Frame{
		Type:   "req",
		ID:     reqID,
		Method: method,
		Params: paramsJSON,
	}

	ch := make(chan *Frame, 1)
	gc.mu.Lock()
	gc.pending[reqID] = ch
	gc.mu.Unlock()

	// Ensure cleanup on all exit paths
	defer func() {
		gc.mu.Lock()
		delete(gc.pending, reqID)
		gc.mu.Unlock()
	}()

	gc.mu.Lock()
	err := gc.conn.WriteJSON(req)
	gc.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("write %s: %w", method, err)
	}

	// Wait for response with timeout
	timeout := defaultRequestTimeout
	if dl, ok := ctx.Deadline(); ok {
		if d := time.Until(dl); d < timeout {
			timeout = d
		}
	}

	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(timeout):
		return nil, fmt.Errorf("%s: response timeout after %s", method, timeout)
	case <-gc.done:
		return nil, fmt.Errorf("%s: client closed", method)
	}
}

func (gc *GatewayClient) nextID() string {
	return fmt.Sprintf("gw-%d", gc.reqID.Add(1))
}

func (gc *GatewayClient) resError(res *Frame, method string) error {
	if len(res.Error) > 0 {
		var pe ProtocolError
		if json.Unmarshal(res.Error, &pe) == nil && pe.Message != "" {
			return fmt.Errorf("%s failed: %s", method, pe.Message)
		}
		return fmt.Errorf("%s failed: %s", method, string(res.Error))
	}
	return fmt.Errorf("%s failed: ok=false", method)
}
