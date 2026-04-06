package pi

import (
	"encoding/json"
	"testing"
)

// ── TranslatePiToOC ──────────────────────────────────────

func TestTranslatePiToOC_TextDelta(t *testing.T) {
	t.Parallel()
	input := `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	assertEq(t, asString(m["type"]), "event")
	assertEq(t, asString(m["event"]), "agent")
	payload := asMap(m["payload"])
	assertEq(t, asString(payload["stream"]), "text")
	if _, ok := payload["sender"]; ok {
		t.Fatal("expected no sender field when Pi event does not contain sender attribution")
	}
	data := asMap(payload["data"])
	assertEq(t, asString(data["delta"]), "hello")
}

func TestTranslatePiToOC_ThinkingDelta(t *testing.T) {
	t.Parallel()
	input := `{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"reasoning..."}}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	payload := asMap(m["payload"])
	assertEq(t, asString(payload["stream"]), "thinking")
	data := asMap(payload["data"])
	assertEq(t, asString(data["delta"]), "reasoning...")
}

func TestTranslatePiToOC_TextDelta_EmptyDelta(t *testing.T) {
	t.Parallel()
	input := `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":""}}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	if got != nil {
		t.Fatalf("expected nil for empty delta, got %s", string(got))
	}
}

func TestTranslatePiToOC_ToolExecutionStart(t *testing.T) {
	t.Parallel()
	input := `{"type":"tool_execution_start","toolCallId":"tc1","toolName":"bash","args":{"command":"ls"}}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	payload := asMap(m["payload"])
	assertEq(t, asString(payload["stream"]), "tool")
	data := asMap(payload["data"])
	assertEq(t, asString(data["phase"]), "start")
	assertEq(t, asString(data["toolCallId"]), "tc1")
	assertEq(t, asString(data["name"]), "bash")
	if _, ok := data["sender"]; ok {
		t.Fatal("expected no sender field when Pi event does not contain sender attribution")
	}
	if _, ok := payload["sender"]; ok {
		t.Fatal("expected no sender field when Pi event does not contain sender attribution")
	}
}

func TestTranslatePiToOC_ToolExecutionUpdate(t *testing.T) {
	t.Parallel()
	input := `{"type":"tool_execution_update","toolCallId":"tc2","toolName":"read","partialResult":"partial"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	data := asMap(asMap(m["payload"])["data"])
	assertEq(t, asString(data["phase"]), "update")
	assertEq(t, asString(data["toolCallId"]), "tc2")
	assertEq(t, asString(data["partialResult"]), "partial")
}

func TestTranslatePiToOC_ToolExecutionEnd_Success(t *testing.T) {
	t.Parallel()
	input := `{"type":"tool_execution_end","toolCallId":"tc3","toolName":"write","result":"ok"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	data := asMap(asMap(m["payload"])["data"])
	assertEq(t, asString(data["phase"]), "result")
	assertEq(t, asString(data["result"]), "ok")
}

func TestTranslatePiToOC_ToolExecutionEnd_Error(t *testing.T) {
	t.Parallel()
	input := `{"type":"tool_execution_end","toolCallId":"tc4","toolName":"bash","isError":true,"reason":"permission denied"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	data := asMap(asMap(m["payload"])["data"])
	assertEq(t, asString(data["phase"]), "error")
	assertEq(t, asString(data["error"]), "permission denied")
}

func TestTranslatePiToOC_AgentEnd_Normal(t *testing.T) {
	t.Parallel()
	input := `{"type":"agent_end"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	assertEq(t, asString(m["event"]), "chat")
	payload := asMap(m["payload"])
	assertEq(t, asString(payload["state"]), "final")
	if _, ok := payload["sender"]; ok {
		t.Fatal("expected no sender field when Pi event does not contain sender attribution")
	}
}

func TestTranslatePiToOC_SenderPassthrough(t *testing.T) {
	t.Parallel()

	type testCase struct {
		name          string
		input         string
		wantAgentID   string
		wantAgentName string
		wantRole      string
	}

	cases := []testCase{
		{
			name:          "text_delta",
			input:         `{"type":"message_update","agentId":"planner","agentName":"Planner","agentRole":"planner","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}`,
			wantAgentID:   "planner",
			wantAgentName: "Planner",
			wantRole:      "planner",
		},
		{
			name:          "thinking_delta",
			input:         `{"type":"message_update","agentId":"analyst","agentName":"Analyst","agentRole":"researcher","assistantMessageEvent":{"type":"thinking_delta","delta":"reasoning"}}`,
			wantAgentID:   "analyst",
			wantAgentName: "Analyst",
			wantRole:      "researcher",
		},
		{
			name:          "tool_execution_start",
			input:         `{"type":"tool_execution_start","agentId":"secretary","agentName":"Secretary","agentRole":"planner","toolCallId":"tc1","toolName":"bash","args":{"command":"ls"}}`,
			wantAgentID:   "secretary",
			wantAgentName: "Secretary",
			wantRole:      "planner",
		},
		{
			name:          "tool_execution_update",
			input:         `{"type":"tool_execution_update","agentId":"designer","agentName":"Designer","agentRole":"executor","toolCallId":"tc2","toolName":"read","partialResult":"partial"}`,
			wantAgentID:   "designer",
			wantAgentName: "Designer",
			wantRole:      "executor",
		},
		{
			name:          "tool_execution_end",
			input:         `{"type":"tool_execution_end","agentId":"writer","agentName":"Writer","agentRole":"writer","toolCallId":"tc3","toolName":"write","result":"ok"}`,
			wantAgentID:   "writer",
			wantAgentName: "Writer",
			wantRole:      "writer",
		},
		{
			name:          "agent_end",
			input:         `{"type":"agent_end","agentId":"leader","agentName":"Leader","agentRole":"planner"}`,
			wantAgentID:   "leader",
			wantAgentName: "Leader",
			wantRole:      "planner",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := TranslatePiToOC([]byte(tc.input))
			assertNoErr(t, err)

			m := mustParseJSON(t, got)
			payload := asMap(m["payload"])
			sender := asMap(payload["sender"])

			assertEq(t, asString(sender["agentId"]), tc.wantAgentID)
			assertEq(t, asString(sender["agentName"]), tc.wantAgentName)
			assertEq(t, asString(sender["role"]), tc.wantRole)
		})
	}
}

func TestTranslatePiToOC_AgentEnd_Aborted(t *testing.T) {
	t.Parallel()
	input := `{"type":"agent_end","aborted":true}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	payload := asMap(m["payload"])
	assertEq(t, asString(payload["state"]), "aborted")
}

func TestTranslatePiToOC_ErrorEvent(t *testing.T) {
	t.Parallel()
	input := `{"type":"error","message":"rate limited"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	m := mustParseJSON(t, got)
	assertEq(t, asString(m["type"]), "error")
	assertEq(t, asString(m["error"]), "rate limited")
}

func TestTranslatePiToOC_SessionReady_Nil(t *testing.T) {
	t.Parallel()
	for _, typ := range []string{"session", "session_ready"} {
		input := `{"type":"` + typ + `"}`
		got, err := TranslatePiToOC([]byte(input))
		assertNoErr(t, err)
		if got != nil {
			t.Fatalf("type=%s: expected nil, got %s", typ, string(got))
		}
	}
}

func TestTranslatePiToOC_UnknownType_Nil(t *testing.T) {
	t.Parallel()
	input := `{"type":"turn_start"}`
	got, err := TranslatePiToOC([]byte(input))
	assertNoErr(t, err)
	if got != nil {
		t.Fatalf("expected nil for unknown type, got %s", string(got))
	}
}

func TestTranslatePiToOC_InvalidJSON(t *testing.T) {
	t.Parallel()
	_, err := TranslatePiToOC([]byte(`{broken`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestTranslatePiToOC_EmptyLine(t *testing.T) {
	t.Parallel()
	got, err := TranslatePiToOC([]byte("  \n  "))
	assertNoErr(t, err)
	if got != nil {
		t.Fatalf("expected nil for empty line, got %s", string(got))
	}
}

func TestExtractSender(t *testing.T) {
	t.Parallel()

	t.Run("extracts all sender fields", func(t *testing.T) {
		t.Parallel()
		sender := extractSender(map[string]any{
			"agentId":   "agent-1",
			"agentName": "Planner",
			"agentRole": "planner",
		})
		if sender == nil {
			t.Fatal("expected sender map, got nil")
		}
		assertEq(t, asString(sender["agentId"]), "agent-1")
		assertEq(t, asString(sender["agentName"]), "Planner")
		assertEq(t, asString(sender["role"]), "planner")
	})

	t.Run("returns nil when sender fields are missing", func(t *testing.T) {
		t.Parallel()
		sender := extractSender(map[string]any{
			"type": "message_update",
		})
		if sender != nil {
			t.Fatalf("expected nil sender map, got %+v", sender)
		}
	})
}

// ── ParseOCCommand ───────────────────────────────────────

func TestParseOCCommand_ChatSend(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","id":"r1","method":"chat.send","params":{"sessionKey":"s1","message":"hello"}}`
	cmd, err := ParseOCCommand([]byte(input))
	assertNoErr(t, err)
	assertEq(t, cmd.Method, "chat.send")
	assertEq(t, cmd.SessionID, "s1")
	assertEq(t, cmd.Message, "hello")
	assertEq(t, cmd.RequestID, "r1")
	if cmd.IsAbort {
		t.Fatal("expected IsAbort=false for chat.send")
	}

	// Payload should be valid Pi prompt command
	var payload map[string]any
	if err := json.Unmarshal([]byte(cmd.Payload), &payload); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	assertEq(t, asString(payload["type"]), "prompt")
	assertEq(t, asString(payload["session_id"]), "s1")
	assertEq(t, asString(payload["message"]), "hello")

	// Ack should be present
	if len(cmd.Ack) == 0 {
		t.Fatal("expected Ack to be set")
	}
	var ack map[string]any
	json.Unmarshal(cmd.Ack, &ack)
	assertEq(t, asString(ack["id"]), "r1")
	if !isTrue(ack["ok"]) {
		t.Fatal("expected Ack ok=true")
	}
}

func TestParseOCCommand_ChatAbort(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","id":"r2","method":"chat.abort","params":{"sessionKey":"s2"}}`
	cmd, err := ParseOCCommand([]byte(input))
	assertNoErr(t, err)
	assertEq(t, cmd.Method, "chat.abort")
	if !cmd.IsAbort {
		t.Fatal("expected IsAbort=true for chat.abort")
	}

	var payload map[string]any
	json.Unmarshal([]byte(cmd.Payload), &payload)
	assertEq(t, asString(payload["type"]), "abort")
	assertEq(t, asString(payload["session_id"]), "s2")
}

func TestParseOCCommand_MissingSessionKey(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","method":"chat.send","params":{"message":"hello"}}`
	_, err := ParseOCCommand([]byte(input))
	if err == nil {
		t.Fatal("expected error for missing sessionKey")
	}
}

func TestParseOCCommand_MissingMessage(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","method":"chat.send","params":{"sessionKey":"s1"}}`
	_, err := ParseOCCommand([]byte(input))
	if err == nil {
		t.Fatal("expected error for missing message")
	}
}

func TestParseOCCommand_UnsupportedMethod(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","method":"chat.unknown","params":{"sessionKey":"s1"}}`
	_, err := ParseOCCommand([]byte(input))
	if err == nil {
		t.Fatal("expected error for unsupported method")
	}
}

func TestParseOCCommand_NonReqType_Ignored(t *testing.T) {
	t.Parallel()
	input := `{"type":"event","data":"something"}`
	cmd, err := ParseOCCommand([]byte(input))
	assertNoErr(t, err)
	if !cmd.Ignore {
		t.Fatal("expected non-req type to be ignored")
	}
}

func TestParseOCCommand_NoMethod_Ignored(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","id":"r3"}`
	cmd, err := ParseOCCommand([]byte(input))
	assertNoErr(t, err)
	if !cmd.Ignore {
		t.Fatal("expected empty method to be ignored")
	}
}

func TestParseOCCommand_NoRequestID_NoAck(t *testing.T) {
	t.Parallel()
	input := `{"method":"chat.send","params":{"sessionKey":"s1","message":"hi"}}`
	cmd, err := ParseOCCommand([]byte(input))
	assertNoErr(t, err)
	if len(cmd.Ack) != 0 {
		t.Fatalf("expected no Ack when requestID is empty, got %s", string(cmd.Ack))
	}
}

func TestParseOCCommand_InvalidJSON(t *testing.T) {
	t.Parallel()
	_, err := ParseOCCommand([]byte(`not json`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

// ── TranslateOCToPi ─────────────────────────────────────

func TestTranslateOCToPi_ChatSend(t *testing.T) {
	t.Parallel()
	input := `{"type":"req","method":"chat.send","params":{"sessionKey":"s1","message":"test"}}`
	got, err := TranslateOCToPi([]byte(input))
	assertNoErr(t, err)
	var m map[string]any
	json.Unmarshal([]byte(got), &m)
	assertEq(t, asString(m["type"]), "prompt")
}

func TestTranslateOCToPi_Ignored(t *testing.T) {
	t.Parallel()
	input := `{"type":"event","data":"ignored"}`
	got, err := TranslateOCToPi([]byte(input))
	assertNoErr(t, err)
	if got != "" {
		t.Fatalf("expected empty string for ignored frame, got %q", got)
	}
}

// ── Helpers ──────────────────────────────────────────────

func assertNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func assertEq(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func mustParseJSON(t *testing.T, data []byte) map[string]any {
	t.Helper()
	if data == nil {
		t.Fatal("expected non-nil JSON data")
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("invalid JSON: %v\ndata: %s", err, string(data))
	}
	return m
}
