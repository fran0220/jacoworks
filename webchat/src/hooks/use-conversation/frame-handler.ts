import type { Dispatch, MutableRefObject } from "react";
import { applyEvent, parseFrame } from "../../lib/event-parser";
import type { ConnectionState, RelayFrame } from "../../lib/ws-relay-client";
import type { ChatSender, StreamBlock } from "../../types";
import { isContentEvent } from "./content";
import type {
  ConversationAction,
  ObservatoryBridgeEvent,
} from "./types";

interface HandleRelayFrameOptions {
  frame: RelayFrame;
  blocksRef: MutableRefObject<StreamBlock[]>;
  streamTextRef: MutableRefObject<string>;
  streamingRef: MutableRefObject<boolean>;
  contentStartedRef: MutableRefObject<boolean>;
  currentSenderRef: MutableRefObject<ChatSender | undefined>;
  observatoryEventRef: MutableRefObject<((event: ObservatoryBridgeEvent) => void) | null>;
  dispatch: Dispatch<ConversationAction>;
  setConnState: (state: ConnectionState) => void;
  setError: (error: string | null) => void;
  finishStream: (finalMessage?: unknown) => void;
  resetStreamTimeout: () => void;
  scheduleRender: (delayMs?: number) => void;
  captureChatError: (error: string | undefined) => void;
}

export function handleRelayFrame({
  frame,
  blocksRef,
  streamTextRef,
  streamingRef,
  contentStartedRef,
  currentSenderRef,
  observatoryEventRef,
  dispatch,
  setConnState,
  setError,
  finishStream,
  resetStreamTimeout,
  scheduleRender,
  captureChatError,
}: HandleRelayFrameOptions): void {
  let parsed = parseFrame(frame);

  if (parsed.sender) {
    currentSenderRef.current = parsed.sender;
  }

  if (parsed.kind !== "ignore") {
    observatoryEventRef.current?.(parsed);
  }

  if (parsed.kind === "proxy_ready") {
    setConnState("connected");
    return;
  }

  if (parsed.kind === "error") {
    setError(parsed.error || "未知错误");
    captureChatError(parsed.error);
    finishStream();
    return;
  }

  if (parsed.kind === "chat_delta") {
    const next = parsed.text || "";
    const prev = streamTextRef.current;
    if (!next) return;

    if (prev && next.startsWith(prev)) {
      const delta = next.slice(prev.length);
      streamTextRef.current = next;
      if (!delta) return;
      parsed = { kind: "text_delta", text: delta };
    } else if (!prev) {
      streamTextRef.current = next;
      parsed = { kind: "text_delta", text: next };
    } else {
      return;
    }
  }

  if (parsed.kind === "done") {
    finishStream(parsed.message);
    return;
  }

  if (isContentEvent(parsed)) {
    if (!contentStartedRef.current) {
      contentStartedRef.current = true;
      streamTextRef.current = "";
      blocksRef.current = [];
      if (!streamingRef.current) {
        streamingRef.current = true;
        dispatch({ type: "set_streaming", streaming: true });
      }
      setError(null);
    }
    if (streamingRef.current) resetStreamTimeout();
  }

  const applied = applyEvent(blocksRef.current, parsed);
  if (applied.changed) {
    scheduleRender(applied.renderDelayMs);
  }
}
