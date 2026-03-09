package openclaw

import "encoding/json"

// ── OpenClaw Gateway WS Protocol Frame Types ──────────────────────
//
// Frame directions:
//   req:   client → server  {type:"req", id, method, params}
//   res:   server → client  {type:"res", id, ok, payload/error}
//   event: server → client  {type:"event", event, payload, seq}

// Frame is the unified wire format for all OpenClaw WS protocol messages.
type Frame struct {
	Type    string          `json:"type"`              // "req", "res", "event"
	ID      string          `json:"id,omitempty"`      // request/response correlation ID
	Method  string          `json:"method,omitempty"`  // req only: "connect", "node.pair.list", etc.
	Params  json.RawMessage `json:"params,omitempty"`  // req only
	Event   string          `json:"event,omitempty"`   // event only: "connect.challenge", etc.
	Payload json.RawMessage `json:"payload,omitempty"` // res/event
	OK      *bool           `json:"ok,omitempty"`      // res only
	Error   json.RawMessage `json:"error,omitempty"`   // res only (when ok=false)
}

// ── Challenge / Connect ───────────────────────────────────────────

// ChallengePayload is the payload of a connect.challenge event.
type ChallengePayload struct {
	Nonce string `json:"nonce"`
}

// ConnectParams is the params for a "connect" request.
type ConnectParams struct {
	MinProtocol int        `json:"minProtocol"`
	MaxProtocol int        `json:"maxProtocol"`
	Client      ClientInfo `json:"client"`
	Auth        AuthInfo   `json:"auth"`
	Role        string     `json:"role"`
	Scopes      []string   `json:"scopes"`
	Caps        []string   `json:"caps"`
}

// ClientInfo identifies the connecting client.
type ClientInfo struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Mode     string `json:"mode"`
}

// AuthInfo holds authentication credentials.
type AuthInfo struct {
	Token string `json:"token"`
}

// HelloOKPayload is the payload of a successful connect response.
type HelloOKPayload struct {
	Type string `json:"type"` // "hello-ok"
}

// ── Device Pairing ────────────────────────────────────────────────

// PairListResponse is the payload of a node.pair.list response.
type PairListResponse struct {
	Pairs []PairRequest `json:"pairs"`
}

// PairRequest represents a single pending device pair request.
type PairRequest struct {
	PairingID string `json:"pairingId"`
	DeviceID  string `json:"deviceId,omitempty"`
	Name      string `json:"name,omitempty"`
	Status    string `json:"status,omitempty"`
}

// PairApproveParams is the params for a node.pair.approve request.
type PairApproveParams struct {
	PairingID string `json:"pairingId"`
}

// RevokeParams is the params for a node.revoke request.
type RevokeParams struct {
	DeviceID string `json:"deviceId"`
}

// ── Error ─────────────────────────────────────────────────────────

// ProtocolError is the error payload in a failed response.
type ProtocolError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}
