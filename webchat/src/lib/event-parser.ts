import type { StreamBlock } from "../types";

/**
 * Parse a vm-agent WebSocket frame into state updates.
 * The real protocol sends:
 *   { event: "session_event", data: { type: "session_event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "..." } } } }
 */

interface AssistantMessageEvent {
  type?: string;
  delta?: string;
}

interface VMAgentEvent {
  type?: string;
  assistantMessageEvent?: AssistantMessageEvent;
  toolName?: string;
  toolCallId?: string;
}

export interface ParsedEvent {
  kind: "text_delta" | "thinking_start" | "thinking_delta" | "thinking_end" |
    "tool_start" | "tool_end" | "done" | "error" | "proxy_ready" | "proxy_error" | "ignore";
  text?: string;
  toolName?: string;
  toolId?: string;
  error?: string;
}

export function parseFrame(frame: { event?: string; data?: Record<string, unknown> }): ParsedEvent {
  const evt = frame.event || "";
  const data = frame.data || {};

  if (evt === "proxy.ready") return { kind: "proxy_ready" };
  if (evt === "proxy.error") return { kind: "proxy_error", error: String(data.error || "代理错误") };
  if (evt === "done" || data.type === "done") return { kind: "done" };
  if (evt === "error" || data.type === "error") return { kind: "error", error: String(data.error || data.message || "未知错误") };

  // session_event contains the real agent events
  if (evt === "session_event" || data.type === "session_event") {
    const agentEvent = (data.event || data) as VMAgentEvent;
    return parseAgentEvent(agentEvent);
  }

  // Legacy response format
  if (evt === "response" || data.type === "response") {
    const text = String(data.text || data.content || data.message || "");
    if (text) return { kind: "text_delta", text };
  }

  return { kind: "ignore" };
}

function parseAgentEvent(event: VMAgentEvent): ParsedEvent {
  if (!event || !event.type) return { kind: "ignore" };

  // Legacy simplified format: { event: "text", data: "..." }
  if (event.type === "text" && typeof (event as Record<string, unknown>).data === "string") {
    return { kind: "text_delta", text: String((event as Record<string, unknown>).data) };
  }

  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent;
    if (!ame) return { kind: "ignore" };
    switch (ame.type) {
      case "text_delta":
        return { kind: "text_delta", text: ame.delta || "" };
      case "thinking_start":
        return { kind: "thinking_start" };
      case "thinking_delta":
        return { kind: "thinking_delta", text: ame.delta || "" };
      case "thinking_end":
        return { kind: "thinking_end" };
      default:
        return { kind: "ignore" };
    }
  }

  if (event.type === "tool_execution_start") {
    return { kind: "tool_start", toolName: event.toolName || "tool", toolId: event.toolCallId };
  }

  if (event.type === "tool_execution_end") {
    return { kind: "tool_end", toolName: event.toolName || "tool", toolId: event.toolCallId };
  }

  // keepalive, agent_start/end, turn_start/end, auto_compaction_* → ignore
  return { kind: "ignore" };
}

/** Merge a parsed event into the current stream blocks array. Returns true if blocks changed. */
export function applyEvent(blocks: StreamBlock[], event: ParsedEvent): boolean {
  switch (event.kind) {
    case "text_delta": {
      const last = blocks[blocks.length - 1];
      if (last?.type === "text") {
        last.content += event.text || "";
      } else {
        blocks.push({ type: "text", content: event.text || "" });
      }
      return true;
    }
    case "thinking_start": {
      blocks.push({ type: "thinking", content: "" });
      return true;
    }
    case "thinking_delta": {
      const last = blocks[blocks.length - 1];
      if (last?.type === "thinking") {
        last.content += event.text || "";
      } else {
        blocks.push({ type: "thinking", content: event.text || "" });
      }
      return true;
    }
    case "thinking_end":
      return false;
    case "tool_start": {
      blocks.push({
        type: "tool",
        id: event.toolId || `tool-${Date.now()}`,
        name: event.toolName || "tool",
        status: "running",
      });
      return true;
    }
    case "tool_end": {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block.type === "tool" && block.status === "running") {
          block.status = "completed";
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}
