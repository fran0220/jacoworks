package pi

import (
	"encoding/json"
	"fmt"
	"strings"
)

type RequestFrame struct {
	Type   string         `json:"type,omitempty"`
	ID     string         `json:"id,omitempty"`
	Method string         `json:"method,omitempty"`
	Params map[string]any `json:"params,omitempty"`
}

type ClientCommand struct {
	RequestID string
	Method    string
	SessionID string
	Message   string
	Payload   string
	Ack       []byte
	Reject    []byte
	Ignore    bool
	IsAbort   bool
}

func ParseOCCommand(ocFrame []byte) (*ClientCommand, error) {
	var req RequestFrame
	if err := json.Unmarshal(ocFrame, &req); err != nil {
		return nil, fmt.Errorf("decode browser frame: %w", err)
	}
	if req.Type != "" && req.Type != "req" {
		return &ClientCommand{Ignore: true}, nil
	}

	cmd := &ClientCommand{RequestID: strings.TrimSpace(req.ID), Method: strings.TrimSpace(req.Method)}
	if cmd.Method == "" {
		return &ClientCommand{Ignore: true}, nil
	}
	if req.Params != nil {
		if sessionID, ok := req.Params["sessionKey"].(string); ok {
			cmd.SessionID = strings.TrimSpace(sessionID)
		}
		if msg, ok := req.Params["message"].(string); ok {
			cmd.Message = msg
		}
	}

	switch cmd.Method {
	case "chat.send":
		if cmd.SessionID == "" {
			return nil, fmt.Errorf("missing sessionKey")
		}
		if strings.TrimSpace(cmd.Message) == "" {
			return nil, fmt.Errorf("missing message")
		}
		payload, err := json.Marshal(map[string]any{
			"type":       "prompt",
			"session_id": cmd.SessionID,
			"message":    cmd.Message,
		})
		if err != nil {
			return nil, err
		}
		cmd.Payload = string(payload)
	case "chat.abort":
		if cmd.SessionID == "" {
			return nil, fmt.Errorf("missing sessionKey")
		}
		payload, err := json.Marshal(map[string]any{
			"type":       "abort",
			"session_id": cmd.SessionID,
		})
		if err != nil {
			return nil, err
		}
		cmd.Payload = string(payload)
		cmd.IsAbort = true
	default:
		return nil, fmt.Errorf("unsupported method %q", cmd.Method)
	}

	if cmd.RequestID != "" {
		cmd.Ack = mustMarshal(map[string]any{
			"type":    "res",
			"id":      cmd.RequestID,
			"ok":      true,
			"payload": map[string]any{},
		})
		cmd.Reject = mustMarshal(map[string]any{
			"type": "res",
			"id":   cmd.RequestID,
			"ok":   false,
			"error": map[string]any{
				"message": "request failed",
			},
		})
	}
	return cmd, nil
}

func TranslateOCToPi(ocFrame []byte) (string, error) {
	cmd, err := ParseOCCommand(ocFrame)
	if err != nil {
		return "", err
	}
	if cmd == nil || cmd.Ignore {
		return "", nil
	}
	return cmd.Payload, nil
}

func TranslatePiToOC(piLine []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(piLine))
	if trimmed == "" {
		return nil, nil
	}

	var event map[string]any
	if err := json.Unmarshal([]byte(trimmed), &event); err != nil {
		return nil, fmt.Errorf("decode pi frame: %w", err)
	}

	switch asString(event["type"]) {
	case "session", "session_ready":
		return nil, nil
	case "message_update":
		assistantEvent := asMap(event["assistantMessageEvent"])
		switch asString(assistantEvent["type"]) {
		case "text_delta":
			delta := asString(assistantEvent["delta"])
			if delta == "" {
				return nil, nil
			}
			payload := map[string]any{
				"stream": "text",
				"data": map[string]any{
					"delta": delta,
				},
			}
			if sender := extractSender(event); sender != nil {
				payload["sender"] = sender
			}
			return mustMarshal(map[string]any{
				"type":    "event",
				"event":   "agent",
				"payload": payload,
			}), nil
		case "thinking_delta":
			delta := asString(assistantEvent["delta"])
			if delta == "" {
				return nil, nil
			}
			payload := map[string]any{
				"stream": "thinking",
				"data": map[string]any{
					"delta": delta,
				},
			}
			if sender := extractSender(event); sender != nil {
				payload["sender"] = sender
			}
			return mustMarshal(map[string]any{
				"type":    "event",
				"event":   "agent",
				"payload": payload,
			}), nil
		default:
			return nil, nil
		}
	case "tool_execution_start":
		payload := map[string]any{
			"stream": "tool",
			"data": map[string]any{
				"phase":      "start",
				"toolCallId": asString(event["toolCallId"]),
				"name":       asString(event["toolName"]),
				"args":       event["args"],
			},
		}
		if sender := extractSender(event); sender != nil {
			payload["sender"] = sender
		}
		return mustMarshal(map[string]any{
			"type":    "event",
			"event":   "agent",
			"payload": payload,
		}), nil
	case "tool_execution_update":
		payload := map[string]any{
			"stream": "tool",
			"data": map[string]any{
				"phase":         "update",
				"toolCallId":    asString(event["toolCallId"]),
				"name":          asString(event["toolName"]),
				"partialResult": firstNonNil(event["partialResult"], event["result"]),
			},
		}
		if sender := extractSender(event); sender != nil {
			payload["sender"] = sender
		}
		return mustMarshal(map[string]any{
			"type":    "event",
			"event":   "agent",
			"payload": payload,
		}), nil
	case "tool_execution_end":
		phase := "result"
		data := map[string]any{
			"phase":      "result",
			"toolCallId": asString(event["toolCallId"]),
			"name":       asString(event["toolName"]),
			"result":     event["result"],
		}
		if isTrue(event["isError"]) {
			phase = "error"
			data["phase"] = phase
			data["error"] = firstNonEmpty(asString(event["reason"]), asString(event["error"]), "tool execution failed")
		}
		payload := map[string]any{
			"stream": "tool",
			"data":   data,
		}
		if sender := extractSender(event); sender != nil {
			payload["sender"] = sender
		}
		return mustMarshal(map[string]any{
			"type":    "event",
			"event":   "agent",
			"payload": payload,
		}), nil
	case "agent_end":
		state := "final"
		if isTrue(event["aborted"]) {
			state = "aborted"
		}
		payload := map[string]any{
			"state": state,
		}
		if sender := extractSender(event); sender != nil {
			payload["sender"] = sender
		}
		return mustMarshal(map[string]any{
			"type":    "event",
			"event":   "chat",
			"payload": payload,
		}), nil
	case "error":
		return mustMarshal(map[string]any{
			"type": "error",
			"error": firstNonEmpty(
				asString(event["message"]),
				asString(event["error"]),
				"Pi wrapper error",
			),
		}), nil
	default:
		return nil, nil
	}
}

func mustMarshal(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}

func asMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func asString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

// extractSender extracts agent attribution from a Pi event if present.
func extractSender(event map[string]any) map[string]any {
	sender := map[string]any{}
	if id := asString(event["agentId"]); id != "" {
		sender["agentId"] = id
	}
	if name := asString(event["agentName"]); name != "" {
		sender["agentName"] = name
	}
	if role := asString(event["agentRole"]); role != "" {
		sender["role"] = role
	}
	if len(sender) == 0 {
		return nil
	}
	return sender
}

func isTrue(value any) bool {
	if b, ok := value.(bool); ok {
		return b
	}
	return false
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
