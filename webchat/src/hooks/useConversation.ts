import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { WSRelayClient, type ConnectionState, type RelayFrame } from "../lib/ws-relay-client";
import { posthog } from "../lib/posthog";
import type { ChatMessage, ChatSender, StreamBlock } from "../types";
import type { UseWorkspaceResult } from "./useWorkspace";
import { handleRelayFrame } from "./use-conversation/frame-handler";
import { conversationReducer, createInitialConversationState } from "./use-conversation/state";
import { finishStreamLifecycle } from "./use-conversation/stream-lifecycle";
import type { UseConversationResult } from "./use-conversation/types";

export default function useConversation(ocToken: string | null, workspace: UseWorkspaceResult): UseConversationResult {
  const [state, dispatch] = useReducer(
    conversationReducer,
    undefined,
    createInitialConversationState,
  );

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
  const wsRef = useRef<WSRelayClient | null>(null);
  const observatoryEventRef = useRef<((event: { kind: string; text?: string; toolName?: string }) => void) | null>(null);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSenderRef = useRef<ChatSender | undefined>(undefined);

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
      finishStreamLifecycle(finalMessage, {
        streamingRef,
        clearStreamTimeout,
        blocksRef,
        messagesRef,
        activeThreadRef,
        workspaceRef,
        clearRenderTimer,
        setBlocks,
        setStreaming,
        setMessages,
        streamTextRef,
        contentStartedRef,
        currentSenderRef,
      });
    },
    [clearRenderTimer, clearStreamTimeout, setBlocks, setMessages, setStreaming],
  );

  // No client-side stream timeout — Pi manages its own agent timeouts.
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
      // any in-progress work — the agent keeps running server-side.
      clearRenderTimer();
      clearStreamTimeout();
      streamTextRef.current = "";
      contentStartedRef.current = false;
      currentSenderRef.current = undefined;
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
    currentSenderRef.current = undefined;
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

    const ws = new WSRelayClient({
      onStateChange(nextState) {
        setConnState(nextState);
      },
      onFrame(frame: RelayFrame) {
        handleRelayFrame({
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
          captureChatError: (error) => {
            posthog.capture("chat_error", { error });
          },
        });
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
      currentSenderRef.current = undefined;
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
