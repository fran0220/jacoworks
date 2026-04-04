import { useCallback, useEffect, useMemo, useReducer, useRef, type MutableRefObject } from "react";
import { OpenClawClient, type OpenClawFrame, type ConnectionState } from "../lib/openclaw-client";
import { parseFrame, applyEvent, type ParsedEvent } from "../lib/event-parser";
import { contentToBlocks, extractText, streamBlocksToContent, toContentItems } from "../lib/message-extract";
import { extractFileArtifact } from "../lib/file-artifacts";
import { generateTitle } from "../lib/sessions";
import { posthog } from "../lib/posthog";
import type { ChatMessage, FileArtifact, StreamBlock } from "../types";
import type { UseWorkspaceResult } from "./useWorkspace";

interface ConversationState {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  streamingAgents: Set<string>;
  error: string | null;
  connState: ConnectionState;
}

type ConversationAction =
  | { type: "set_messages"; messages: ChatMessage[] }
  | { type: "set_blocks"; blocks: StreamBlock[] }
  | { type: "set_streaming"; streaming: boolean }
  | { type: "set_error"; error: string | null }
  | { type: "set_conn_state"; connState: ConnectionState }
  | { type: "reset" };

function createInitialState(): ConversationState {
  return {
    messages: [],
    blocks: [],
    streaming: false,
    streamingAgents: new Set<string>(),
    error: null,
    connState: "disconnected",
  };
}

function reducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "set_messages":
      return { ...state, messages: action.messages };
    case "set_blocks":
      return { ...state, blocks: action.blocks };
    case "set_streaming":
      return { ...state, streaming: action.streaming };
    case "set_error":
      return { ...state, error: action.error };
    case "set_conn_state":
      return { ...state, connState: action.connState };
    case "reset":
      return { ...state, messages: [], blocks: [], streaming: false, error: null, streamingAgents: new Set<string>() };
    default:
      return state;
  }
}

function isContentEvent(event: ParsedEvent): boolean {
  return (
    event.kind === "text_delta" ||
    event.kind === "chat_delta" ||
    event.kind === "thinking_start" ||
    event.kind === "thinking_delta" ||
    event.kind === "tool_start" ||
    event.kind === "tool_update"
  );
}

function asContentSource(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const rec = message as Record<string, unknown>;
  if (Array.isArray(rec.content)) return rec.content;
  if (typeof rec.text === "string") return [{ type: "text", text: rec.text }];
  return message;
}

function mergeArtifacts(...groups: Array<FileArtifact[] | undefined>): FileArtifact[] | undefined {
  const merged: FileArtifact[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const artifact of group) {
      if (merged.some((item) => item.id === artifact.id)) continue;
      merged.push(artifact);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function collectArtifacts(blocks: StreamBlock[]): FileArtifact[] | undefined {
  const artifacts = blocks
    .filter((block): block is Extract<StreamBlock, { type: "tool" }> => block.type === "tool")
    .map((block) => block.artifact || extractFileArtifact(block.output))
    .filter((artifact): artifact is FileArtifact => Boolean(artifact));
  return mergeArtifacts(artifacts);
}

function extractFinalMessageMeta(message: unknown): Pick<ChatMessage, "sender" | "type" | "orchestration" | "artifacts"> {
  if (!message || typeof message !== "object") return {};

  const rec = message as Record<string, unknown>;
  const sender = rec.sender;
  const orchestration = rec.orchestration;
  const type = rec.type;
  const senderRecord = sender && typeof sender === "object" ? (sender as Record<string, unknown>) : null;
  const orchestrationRecord =
    orchestration && typeof orchestration === "object" ? (orchestration as Record<string, unknown>) : null;
  const senderAgentId = typeof senderRecord?.agentId === "string" ? senderRecord.agentId : "";
  const senderAgentName = typeof senderRecord?.agentName === "string" ? senderRecord.agentName : "";
  const senderRole = typeof senderRecord?.role === "string" ? senderRecord.role : "";
  const orchestrationAction = typeof orchestrationRecord?.action === "string" ? orchestrationRecord.action : "";
  const orchestrationDetail = typeof orchestrationRecord?.detail === "string" ? orchestrationRecord.detail : "";
  const topLevelArtifacts = Array.isArray(rec.artifacts)
    ? rec.artifacts
        .map((artifact) => extractFileArtifact(artifact))
        .filter((artifact): artifact is FileArtifact => Boolean(artifact))
    : undefined;
  const contentArtifacts = collectArtifacts(contentToBlocks(asContentSource(message)));

  return {
    sender: senderRecord ? { agentId: senderAgentId, agentName: senderAgentName, role: senderRole } : undefined,
    type: type === "orchestration" || type === "text" ? type : undefined,
    orchestration: orchestrationRecord ? { action: orchestrationAction, detail: orchestrationDetail } : undefined,
    artifacts: mergeArtifacts(topLevelArtifacts, contentArtifacts),
  };
}

export interface UseConversationResult extends ConversationState {
  send: (text: string) => Promise<void>;
  abort: () => void;
  observatoryEventRef: MutableRefObject<((event: { kind: string; text?: string; toolName?: string }) => void) | null>;
}

export default function useConversation(ocToken: string | null, workspace: UseWorkspaceResult): UseConversationResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  const activeThreadRef = useRef<string | null>(workspace.activeThreadId);
  const currentWorkspaceKeyRef = useRef(workspace.ocSessionKey);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const blocksRef = useRef<StreamBlock[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const renderTimer = useRef<number | null>(null);
  const streamTextRef = useRef("");
  const streamingRef = useRef(false);
  const contentStartedRef = useRef(false);
  const threadLoadRequestId = useRef(0);
  const wsRef = useRef<OpenClawClient | null>(null);
  const observatoryEventRef = useRef<((event: { kind: string; text?: string; toolName?: string }) => void) | null>(null);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMessages = useCallback((messages: ChatMessage[]) => {
    messagesRef.current = messages;
    dispatch({ type: "set_messages", messages });
  }, []);

  const setBlocks = useCallback((blocks: StreamBlock[]) => {
    blocksRef.current = blocks;
    dispatch({ type: "set_blocks", blocks });
  }, []);

  const setStreaming = useCallback((streaming: boolean) => {
    streamingRef.current = streaming;
    dispatch({ type: "set_streaming", streaming });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "set_error", error });
  }, []);

  const setConnState = useCallback((connState: ConnectionState) => {
    dispatch({ type: "set_conn_state", connState });
  }, []);

  const clearStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current !== null) {
      window.clearTimeout(streamTimeoutRef.current as unknown as number);
      streamTimeoutRef.current = null;
    }
  }, []);

  const clearRenderTimer = useCallback(() => {
    if (renderTimer.current !== null) {
      window.clearTimeout(renderTimer.current);
      renderTimer.current = null;
    }
  }, []);

  const scheduleRender = useCallback(
    (delayMs = 50) => {
      if (renderTimer.current !== null) return;
      renderTimer.current = window.setTimeout(() => {
        renderTimer.current = null;
        setBlocks([...blocksRef.current]);
      }, delayMs);
    },
    [setBlocks],
  );

  const finishStream = useCallback(
    (finalMessage?: unknown) => {
      if (!streamingRef.current) return;
      streamingRef.current = false;
      clearStreamTimeout();

      const streamedBlocks = [...blocksRef.current];
      const fallbackText = streamedBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.content)
        .join("");

      const finalContent = toContentItems(asContentSource(finalMessage));
      const content = finalContent.length > 0 ? finalContent : streamBlocksToContent(streamedBlocks);
      const finalBlocks = finalContent.length > 0 ? contentToBlocks(finalContent) : streamedBlocks;
      const hasAnyOutput = content.length > 0 || finalBlocks.length > 0 || fallbackText.trim().length > 0;

      if (hasAnyOutput) {
        const finalMeta = extractFinalMessageMeta(finalMessage);
        const derivedArtifacts = collectArtifacts(finalBlocks);
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: content.length > 0 ? content : fallbackText,
          blocks: finalBlocks.length > 0 ? finalBlocks : undefined,
          timestamp: Date.now(),
          ...finalMeta,
          artifacts: mergeArtifacts(finalMeta.artifacts, derivedArtifacts),
        };
        const updated = [...messagesRef.current, assistantMsg];
        const assistantText = extractText(assistantMsg.content) || fallbackText;

        setMessages(updated);
        posthog.capture("chat_response_received", { length: assistantText.length });

        const threadId = activeThreadRef.current;
        if (threadId) {
          void workspaceRef.current.saveThreadMessages(threadId, updated);
          if (assistantText && updated.filter((message) => message.role === "assistant").length === 1) {
            void workspaceRef.current.renameThread(threadId, generateTitle(assistantText));
          }
        }
      }

      clearRenderTimer();
      streamTextRef.current = "";
      contentStartedRef.current = false;
      setBlocks([]);
      setStreaming(false);
    },
    [clearRenderTimer, clearStreamTimeout, setBlocks, setMessages, setStreaming],
  );

  // No client-side stream timeout — OpenClaw manages its own agent timeouts.
  // The frontend is a transparent relay; it should never kill a running agent.
  const resetStreamTimeout = useCallback(() => {
    clearStreamTimeout();
  }, [clearStreamTimeout]);

  useEffect(
    () => () => {
      clearRenderTimer();
      clearStreamTimeout();
    },
    [clearRenderTimer, clearStreamTimeout],
  );

  useEffect(() => {
    const previousWorkspaceKey = currentWorkspaceKeyRef.current;
    currentWorkspaceKeyRef.current = workspace.ocSessionKey;

    if (previousWorkspaceKey !== workspace.ocSessionKey) {
      // Reset local UI state for the new workspace view, but do NOT abort
      // any in-progress OpenClaw work — the agent keeps running server-side.
      clearRenderTimer();
      clearStreamTimeout();
      streamTextRef.current = "";
      contentStartedRef.current = false;
      setMessages([]);
      setBlocks([]);
      setStreaming(false);
      setError(null);
      wsRef.current?.setSessionKey(workspace.ocSessionKey);
      return;
    }

    wsRef.current?.setSessionKey(workspace.ocSessionKey);
  }, [clearRenderTimer, clearStreamTimeout, finishStream, setBlocks, setError, setMessages, setStreaming, workspace.ocSessionKey]);

  useEffect(() => {
    activeThreadRef.current = workspace.activeThreadId;

    const requestId = ++threadLoadRequestId.current;
    clearRenderTimer();
    clearStreamTimeout();
    streamTextRef.current = "";
    setBlocks([]);
    setError(null);
    setStreaming(false);

    if (!workspace.activeThreadId) {
      setMessages([]);
      return;
    }

    void workspace.loadThreadMessages(workspace.activeThreadId).then((messages) => {
      if (requestId !== threadLoadRequestId.current) return;
      setMessages(messages);
    });
  }, [clearRenderTimer, clearStreamTimeout, finishStream, setBlocks, setError, setMessages, setStreaming, workspace.activeThreadId, workspace.loadThreadMessages]);

  useEffect(() => {
    if (!ocToken) {
      setConnState("disconnected");
      return;
    }

    const ws = new OpenClawClient({
      onStateChange(nextState) {
        setConnState(nextState);
      },
      onFrame(frame: OpenClawFrame) {
        let parsed = parseFrame(frame);

        if (parsed.kind !== "ignore") {
          observatoryEventRef.current?.(parsed);
        }

        if (parsed.kind === "proxy_ready") {
          setConnState("connected");
          return;
        }

        if (parsed.kind === "error") {
          setError(parsed.error || "未知错误");
          posthog.capture("chat_error", { error: parsed.error });
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
      },
    });

    ws.setSessionKey(currentWorkspaceKeyRef.current);
    wsRef.current = ws;
    ws.connect();

    return () => {
      ws.dispose();
      wsRef.current = null;
      clearStreamTimeout();
    };
  }, [clearStreamTimeout, finishStream, ocToken, resetStreamTimeout, scheduleRender, setConnState, setError]);

  const send = useCallback(
    async (text: string) => {
      const ws = wsRef.current;
      if (!ws || !ws.isConnected) {
        console.warn("[chat] send blocked", { hasWs: !!ws, isConnected: ws?.isConnected });
        setError("连接尚未就绪，请稍候");
        return;
      }

      let threadId = activeThreadRef.current;
      if (!threadId) {
        threadId = await workspaceRef.current.ensureActiveThread();
        if (!threadId) return;
        activeThreadRef.current = threadId;
      }

      const userMessage: ChatMessage = {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      };
      const updated = [...messagesRef.current, userMessage];

      setMessages(updated);
      setError(null);
      contentStartedRef.current = false;
      blocksRef.current = [];
      streamTextRef.current = "";
      setStreaming(true);
      resetStreamTimeout();
      void workspaceRef.current.saveThreadMessages(threadId, updated);

      ws.sendPrompt(text);
      posthog.capture("chat_message_sent", {
        session_id: threadId,
        session_key: workspaceRef.current.ocSessionKey,
      });
    },
    [resetStreamTimeout, setError, setMessages],
  );

  const abort = useCallback(() => {
    wsRef.current?.sendAbortChat();
    finishStream();
  }, [finishStream]);

  return useMemo(
    () => ({
      ...state,
      send,
      abort,
      observatoryEventRef,
    }),
    [abort, send, state],
  );
}
