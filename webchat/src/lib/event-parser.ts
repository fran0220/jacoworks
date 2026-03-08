import type { StreamBlock } from "../types";
import { applyToolEvent, type ToolApplyResult } from "./tool-stream";

export interface ParsedEvent {
  kind:
    | "text_delta"
    | "chat_delta"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "done"
    | "error"
    | "proxy_ready"
    | "ignore";
  text?: string;
  error?: string;
  message?: unknown;
  toolId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolOutput?: unknown;
  toolError?: string;
}

export interface ApplyResult {
  changed: boolean;
  renderDelayMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseFrame(frame: unknown): ParsedEvent {
  const rec = asRecord(frame);
  const type = asString(rec.type);

  if (type === "proxy.ready") return { kind: "proxy_ready" };
  if (type === "error" || type === "proxy.error") {
    return { kind: "error", error: asString(rec.error || rec.message) || "未知错误" };
  }

  if (type === "res" && rec.ok === false) {
    const err = asRecord(rec.error);
    return { kind: "error", error: asString(err.message) || "请求失败" };
  }

  if (type === "event") {
    const eventName = asString(rec.event);
    const payload = asRecord(rec.payload);
    if (eventName === "connect.challenge") return { kind: "ignore" };
    if (eventName === "agent") return parseAgentEvent(payload);
    if (eventName === "chat") return parseChatEvent(payload);
    return { kind: "ignore" };
  }

  return { kind: "ignore" };
}

function parseAgentEvent(payload: Record<string, unknown>): ParsedEvent {
  const stream = asString(payload.stream);
  const data = asRecord(payload.data);

  if (stream === "text" || stream === "assistant") {
    const text = asString(data.delta || data.text);
    return text ? { kind: "text_delta", text } : { kind: "ignore" };
  }

  if (stream === "thinking" || stream === "reasoning") {
    const phase = asString(data.phase).toLowerCase();
    if (phase === "start") return { kind: "thinking_start" };
    if (phase === "end" || phase === "stop" || phase === "final") return { kind: "thinking_end" };
    const text = asString(data.text || data.delta || data.thinking);
    return text ? { kind: "thinking_delta", text } : { kind: "ignore" };
  }

  if (stream === "tool") {
    const phase = asString(data.phase).toLowerCase();
    const toolId = asString(data.toolCallId) || `tool-${Date.now()}`;
    const toolName = asString(data.name) || "tool";

    if (phase === "start") {
      return { kind: "tool_start", toolId, toolName, toolArgs: data.args };
    }
    if (phase === "update") {
      return { kind: "tool_update", toolId, toolName, toolOutput: data.partialResult ?? data.result };
    }
    if (phase === "result") {
      return { kind: "tool_end", toolId, toolName, toolOutput: data.result };
    }
    if (phase === "error") {
      return {
        kind: "tool_end",
        toolId,
        toolName,
        toolOutput: data.result,
        toolError: asString(data.error || data.message || "tool error"),
      };
    }
  }

  if (stream === "lifecycle" && asString(data.phase) === "error") {
    return { kind: "error", error: asString(data.error || data.message) || "运行错误" };
  }

  return { kind: "ignore" };
}

function parseChatEvent(payload: Record<string, unknown>): ParsedEvent {
  const state = asString(payload.state).toLowerCase();
  // Ignore chat deltas — we already get token-level text from agent stream events.
  // Using both would cause duplicate/doubled text in the UI.
  if (state === "delta") {
    return { kind: "ignore" };
  }
  if (state === "final" || state === "aborted") {
    return { kind: "done", message: payload.message };
  }
  if (state === "error") {
    return { kind: "error", error: asString(payload.errorMessage) || "未知错误" };
  }
  return { kind: "ignore" };
}

export function applyEvent(blocks: StreamBlock[], event: ParsedEvent): ApplyResult {
  switch (event.kind) {
    case "text_delta": {
      const last = blocks[blocks.length - 1];
      if (last?.type === "text") {
        last.content += event.text || "";
      } else {
        blocks.push({ type: "text", content: event.text || "" });
      }
      return { changed: true };
    }
    case "thinking_start": {
      blocks.push({ type: "thinking", content: "" });
      return { changed: true };
    }
    case "thinking_delta": {
      const last = blocks[blocks.length - 1];
      if (last?.type === "thinking") {
        last.content += event.text || "";
      } else {
        blocks.push({ type: "thinking", content: event.text || "" });
      }
      return { changed: true };
    }
    case "thinking_end":
      return { changed: false };
    case "tool_start":
    case "tool_update":
    case "tool_end": {
      const toolResult: ToolApplyResult = applyToolEvent(blocks, {
        kind: event.kind,
        toolId: event.toolId || `tool-${Date.now()}`,
        toolName: event.toolName || "tool",
        toolArgs: event.toolArgs,
        toolOutput: event.toolOutput,
        toolError: event.toolError,
      });
      return toolResult;
    }
    default:
      return { changed: false };
  }
}
