package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ── Frame Marshaling ──────────────────────────────────────────────

func TestFrameMarshalReq(t *testing.T) {
	params, _ := json.Marshal(PairApproveParams{PairingID: "p-123"})
	f := Frame{
		Type:   "req",
		ID:     "gw-1",
		Method: "node.pair.approve",
		Params: params,
	}

	data, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got Frame
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != "req" || got.ID != "gw-1" || got.Method != "node.pair.approve" {
		t.Errorf("unexpected frame: %+v", got)
	}
}

func TestFrameMarshalRes(t *testing.T) {
	ok := true
	payload, _ := json.Marshal(HelloOKPayload{Type: "hello-ok"})
	f := Frame{
		Type:    "res",
		ID:      "gw-1",
		OK:      &ok,
		Payload: payload,
	}

	data, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	s := string(data)
	if !strings.Contains(s, `"ok":true`) {
		t.Errorf("expected ok:true in %s", s)
	}
	if !strings.Contains(s, `"hello-ok"`) {
		t.Errorf("expected hello-ok in %s", s)
	}
}

func TestFrameOmitEmpty(t *testing.T) {
	f := Frame{Type: "event", Event: "connect.challenge"}
	data, _ := json.Marshal(f)
	s := string(data)

	if strings.Contains(s, `"id"`) {
		t.Errorf("id should be omitted, got: %s", s)
	}
	if strings.Contains(s, `"method"`) {
		t.Errorf("method should be omitted, got: %s", s)
	}
	if strings.Contains(s, `"ok"`) {
		t.Errorf("ok should be omitted, got: %s", s)
	}
}

// ── Mock WebSocket Server ─────────────────────────────────────────

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

// mockOCServer simulates an OpenClaw container for testing.
type mockOCServer struct {
	token          string
	pendingPairs   []PairRequest
	pairListError  *ProtocolError
	onApprove      func(pairingID string)
	handshakeError bool
}

func (m *mockOCServer) handler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// 1. Send challenge
	nonce, _ := json.Marshal(ChallengePayload{Nonce: "test-nonce"})
	conn.WriteJSON(Frame{Type: "event", Event: "connect.challenge", Payload: nonce})

	// 2. Read connect request
	var req Frame
	if err := conn.ReadJSON(&req); err != nil {
		return
	}
	if req.Method != "connect" {
		return
	}

	// Verify token
	var params ConnectParams
	json.Unmarshal(req.Params, &params)

	if m.handshakeError || params.Auth.Token != m.token {
		ok := false
		errPayload, _ := json.Marshal(ProtocolError{Code: "auth_failed", Message: "invalid token"})
		conn.WriteJSON(Frame{Type: "res", ID: req.ID, OK: &ok, Error: errPayload})
		return
	}

	// 3. Send hello-ok
	ok := true
	helloPayload, _ := json.Marshal(HelloOKPayload{Type: "hello-ok"})
	conn.WriteJSON(Frame{Type: "res", ID: req.ID, OK: &ok, Payload: helloPayload})

	// 4. Handle subsequent requests
	for {
		var frame Frame
		if err := conn.ReadJSON(&frame); err != nil {
			return
		}
		if frame.Type != "req" {
			continue
		}

		switch frame.Method {
		case "node.pair.list":
			if m.pairListError != nil {
				okVal := false
				errPayload, _ := json.Marshal(m.pairListError)
				conn.WriteJSON(Frame{Type: "res", ID: frame.ID, OK: &okVal, Error: errPayload})
				continue
			}
			okVal := true
			payload, _ := json.Marshal(PairListResponse{Pairs: m.pendingPairs})
			conn.WriteJSON(Frame{Type: "res", ID: frame.ID, OK: &okVal, Payload: payload})

		case "node.pair.approve":
			var params PairApproveParams
			json.Unmarshal(frame.Params, &params)
			if m.onApprove != nil {
				m.onApprove(params.PairingID)
			}
			// Remove from pending
			remaining := make([]PairRequest, 0, len(m.pendingPairs))
			for _, p := range m.pendingPairs {
				if p.PairingID != params.PairingID {
					remaining = append(remaining, p)
				}
			}
			m.pendingPairs = remaining

			okVal := true
			conn.WriteJSON(Frame{Type: "res", ID: frame.ID, OK: &okVal, Payload: json.RawMessage(`{}`)})

		case "node.revoke":
			okVal := true
			conn.WriteJSON(Frame{Type: "res", ID: frame.ID, OK: &okVal, Payload: json.RawMessage(`{}`)})

		default:
			okVal := false
			errPayload, _ := json.Marshal(ProtocolError{Message: "unknown method"})
			conn.WriteJSON(Frame{Type: "res", ID: frame.ID, OK: &okVal, Error: errPayload})
		}
	}
}

func startMockServer(t *testing.T, mock *mockOCServer) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(mock.handler))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// ── Handshake Tests ───────────────────────────────────────────────

func TestHandshakeSuccess(t *testing.T) {
	mock := &mockOCServer{token: "test-token"}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := NewGatewayClient(ctx, wsURL, "test-token")
	if err != nil {
		t.Fatalf("NewGatewayClient: %v", err)
	}
	defer client.Close()
}

func TestHandshakeBadToken(t *testing.T) {
	mock := &mockOCServer{token: "correct-token"}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := NewGatewayClient(ctx, wsURL, "wrong-token")
	if err == nil {
		t.Fatal("expected error for bad token")
	}
	if !strings.Contains(err.Error(), "connect rejected") {
		t.Errorf("unexpected error: %v", err)
	}
}

// ── Operator Command Tests ────────────────────────────────────────

func TestListPendingPairs(t *testing.T) {
	mock := &mockOCServer{
		token: "tk",
		pendingPairs: []PairRequest{
			{PairingID: "p-1", Name: "device-1"},
			{PairingID: "p-2", Name: "device-2"},
		},
	}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := NewGatewayClient(ctx, wsURL, "tk")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	pairs, err := client.ListPendingPairs(ctx)
	if err != nil {
		t.Fatalf("ListPendingPairs: %v", err)
	}
	if len(pairs) != 2 {
		t.Fatalf("len = %d, want 2", len(pairs))
	}
	if pairs[0].PairingID != "p-1" {
		t.Errorf("pairs[0].PairingID = %q, want p-1", pairs[0].PairingID)
	}
}

func TestApprovePair(t *testing.T) {
	approved := make(chan string, 1)
	mock := &mockOCServer{
		token:        "tk",
		pendingPairs: []PairRequest{{PairingID: "p-42"}},
		onApprove: func(id string) {
			approved <- id
		},
	}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := NewGatewayClient(ctx, wsURL, "tk")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	if err := client.ApprovePair(ctx, "p-42"); err != nil {
		t.Fatalf("ApprovePair: %v", err)
	}

	select {
	case id := <-approved:
		if id != "p-42" {
			t.Errorf("approved ID = %q, want p-42", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("approve callback not called")
	}
}

func TestRevokePair(t *testing.T) {
	mock := &mockOCServer{token: "tk"}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := NewGatewayClient(ctx, wsURL, "tk")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	if err := client.RevokePair(ctx, "device-99"); err != nil {
		t.Fatalf("RevokePair: %v", err)
	}
}

// ── AutoPairer Tests ──────────────────────────────────────────────

func TestAutoPairerApprovesAll(t *testing.T) {
	approvedIDs := make([]string, 0)
	var mu = &struct{ ids []string }{}

	mock := &mockOCServer{
		token: "tk",
		pendingPairs: []PairRequest{
			{PairingID: "p-a", Name: "phone"},
			{PairingID: "p-b", Name: "tablet"},
		},
		onApprove: func(id string) {
			mu.ids = append(mu.ids, id)
			approvedIDs = append(approvedIDs, id)
		},
	}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ap := NewAutoPairer(wsURL, "tk").
		WithInterval(100 * time.Millisecond).
		WithDuration(1 * time.Second)

	if err := ap.ApproveAll(ctx); err != nil {
		t.Fatalf("ApproveAll: %v", err)
	}

	if len(approvedIDs) < 2 {
		t.Errorf("approved %d pairs, want at least 2", len(approvedIDs))
	}
}

func TestAutoPairerNoPairs(t *testing.T) {
	mock := &mockOCServer{token: "tk", pendingPairs: nil}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ap := NewAutoPairer(wsURL, "tk").
		WithInterval(100 * time.Millisecond).
		WithDuration(500 * time.Millisecond)

	if err := ap.ApproveAll(ctx); err != nil {
		t.Fatalf("ApproveAll with no pairs: %v", err)
	}
}

func TestAutoPairerBadToken(t *testing.T) {
	mock := &mockOCServer{token: "real-token"}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ap := NewAutoPairer(wsURL, "bad-token")
	err := ap.ApproveAll(ctx)
	if err == nil {
		t.Fatal("expected error for bad token")
	}
}

func TestAutoPairerStopsOnMissingScope(t *testing.T) {
	mock := &mockOCServer{
		token: "tk",
		pairListError: &ProtocolError{
			Code:    "forbidden",
			Message: "missing scope: operator.pairing",
		},
	}
	wsURL := startMockServer(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ap := NewAutoPairer(wsURL, "tk").
		WithInterval(500 * time.Millisecond).
		WithDuration(10 * time.Second)

	started := time.Now()
	if err := ap.ApproveAll(ctx); err != nil {
		t.Fatalf("ApproveAll with missing scope should exit cleanly: %v", err)
	}
	if time.Since(started) > 2*time.Second {
		t.Fatalf("ApproveAll should stop early on missing scope")
	}
}

func TestResErrorReturnsRequestError(t *testing.T) {
	t.Helper()
	falseVal := false
	errPayload, _ := json.Marshal(ProtocolError{Code: "forbidden", Message: "missing scope: operator.pairing"})

	err := (&GatewayClient{}).resError(&Frame{OK: &falseVal, Error: errPayload}, "node.pair.list")

	var reqErr *RequestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected RequestError, got %T", err)
	}
	if reqErr.Code != "forbidden" {
		t.Fatalf("code=%q, want forbidden", reqErr.Code)
	}
	if !IsMissingScope(err, "operator.pairing") {
		t.Fatalf("expected missing scope detection, got: %v", err)
	}
}

func TestIsMissingScopeFallback(t *testing.T) {
	err := fmt.Errorf("node.pair.list failed: missing scope: operator.pairing")
	if !IsMissingScope(err, "operator.pairing") {
		t.Fatalf("expected missing scope fallback detection")
	}
}
