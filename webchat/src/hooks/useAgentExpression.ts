import { useEffect, useRef, useState } from "react";
import type { AgentExpression, StreamBlock } from "../types";

const ERROR_HOLD_MS = 2400;
const HAPPY_HOLD_MS = 1800;

function deriveStreamingExpression(blocks: StreamBlock[]): AgentExpression {
  if (blocks.length === 0) return "thinking";

  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock?.type === "tool") {
    return lastBlock.status === "error" ? "error" : "working";
  }
  if (lastBlock?.type === "text" && lastBlock.content.trim()) {
    return "speaking";
  }
  if (lastBlock?.type === "thinking") {
    return "thinking";
  }

  if (blocks.some((block) => block.type === "tool" && block.status === "running")) {
    return "working";
  }
  if (blocks.some((block) => block.type === "thinking")) {
    return "thinking";
  }
  if (blocks.some((block) => block.type === "text" && block.content.trim())) {
    return "speaking";
  }

  return "thinking";
}

export default function useAgentExpression({
  streaming,
  blocks,
  error,
}: {
  streaming: boolean;
  blocks: StreamBlock[];
  error?: string | null;
}): AgentExpression {
  const [expression, setExpression] = useState<AgentExpression>("idle");
  const previousStreamingRef = useRef(false);
  const previousErrorRef = useRef<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const clearResetTimer = () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };

    const scheduleIdle = (delayMs: number) => {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setExpression("idle");
      }, delayMs);
    };

    const isFreshError = Boolean(error && error !== previousErrorRef.current);
    const wasStreaming = previousStreamingRef.current;

    previousErrorRef.current = error ?? null;

    if (isFreshError) {
      clearResetTimer();
      setExpression("error");
      if (!streaming) scheduleIdle(ERROR_HOLD_MS);
      previousStreamingRef.current = streaming;
      return;
    }

    if (streaming) {
      clearResetTimer();
      setExpression(deriveStreamingExpression(blocks));
      previousStreamingRef.current = true;
      return;
    }

    if (wasStreaming && !error) {
      setExpression("happy");
      scheduleIdle(HAPPY_HOLD_MS);
    } else if (!error) {
      clearResetTimer();
      setExpression("idle");
    }

    previousStreamingRef.current = false;
  }, [blocks, error, streaming]);

  return expression;
}
