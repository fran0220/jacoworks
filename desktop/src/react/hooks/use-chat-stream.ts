import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abortNativeSession,
  requestTitleGeneration,
  startNativeStream,
} from "../lib/agent";
import { getUser } from "../lib/auth";
import {
  persistMessages,
  persistSessionMeta,
} from "../lib/session-persistence";
import { generateTitle } from "../lib/sessions";
import type {
  AttachedFile,
  ChatMessage,
  ChatSession,
  StreamBlock,
} from "../types";

function buildPrompt(text: string, files: AttachedFile[]): string {
  if (files.length === 0) return text;

  const chunks: string[] = [];
  for (const file of files) {
    if (file.type === "image") {
      chunks.push(`[图片附件] ${file.name}\n${file.data}`);
    } else {
      chunks.push(`[文本附件] ${file.name}\n${file.data}`);
    }
  }
  chunks.push(text);
  return chunks.join("\n\n");
}

function isUntitledTitle(title: string): boolean {
  return title === "新对话" || title === "新会话";
}

interface UseChatStreamOptions {
  session: ChatSession;
  pendingMessage: string | null;
  pendingFiles: AttachedFile[];
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
}

export function useChatStream({
  session,
  pendingMessage,
  pendingFiles,
  clearPending,
  onSessionUpdate,
}: UseChatStreamOptions) {
  const [localSession, setLocalSession] = useState(session);
  const [streaming, setStreaming] = useState(false);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  const localSessionRef = useRef(session);
  const abortedRef = useRef(false);
  const sendLockRef = useRef(false);
  const blocksRef = useRef<StreamBlock[]>([]);
  const streamBaseRef = useRef<ChatMessage[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const blocksRenderRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const titleRequestVersionRef = useRef(0);

  const isNearBottom = (container: HTMLDivElement) => {
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining <= 96;
  };

  const cancelRenderFrame = useCallback(() => {
    if (blocksRenderRafRef.current !== null) {
      window.cancelAnimationFrame(blocksRenderRafRef.current);
      blocksRenderRafRef.current = null;
    }
  }, []);

  const cancelScrollFrame = useCallback(() => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const scheduleBlocksRender = useCallback(() => {
    if (blocksRenderRafRef.current !== null) return;
    blocksRenderRafRef.current = window.requestAnimationFrame(() => {
      blocksRenderRafRef.current = null;
      setBlocks([...blocksRef.current]);
    });
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (!stickToBottomRef.current || scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!messagesRef.current) return;
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => {
    setLocalSession(session);
    localSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    titleRequestVersionRef.current += 1;
  }, [session.id]);

  useEffect(() => {
    localSessionRef.current = localSession;
  }, [localSession]);

  const visibleMessages = useMemo(
    () => localSession.messages.filter((message) => message.role !== "system"),
    [localSession.messages],
  );

  const lastStreamingTextIndex = useMemo(() => {
    for (let index = blocks.length - 1; index >= 0; index--) {
      if (blocks[index]?.type === "text") {
        return index;
      }
    }
    return -1;
  }, [blocks]);

  useEffect(() => {
    scheduleScrollToBottom();
  }, [visibleMessages, blocks, scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      cancelRenderFrame();
      cancelScrollFrame();
    };
  }, [cancelRenderFrame, cancelScrollFrame]);

  const persistSession = useCallback(
    async (messages: ChatMessage[], title?: string) => {
      const sessionId = localSessionRef.current.id;
      setLocalSession((prev) => ({ ...prev, messages, ...(title ? { title } : {}) }));
      await persistMessages(sessionId, messages, title);
      await onSessionUpdate();
    },
    [onSessionUpdate],
  );

  const finalizeStream = useCallback(async () => {
    const assistantText = blocksRef.current
      .filter((block): block is Extract<StreamBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.content)
      .join("\n\n");

    if (!assistantText.trim()) return;

    setBlocks([]);
    setStreaming(false);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantText,
    };
    const finalMessages = [...streamBaseRef.current, assistantMessage];

    const assistantCount = finalMessages.filter((message) => message.role === "assistant").length;
    const isUntitled = isUntitledTitle(localSessionRef.current.title);

    const fallbackTitle =
      isUntitled && assistantCount === 1
        ? generateTitle(assistantText)
        : undefined;

    await persistSession(finalMessages, fallbackTitle);

    if (isUntitled && assistantCount === 1) {
      const lastUserContent =
        streamBaseRef.current.filter((message) => message.role === "user").pop()?.content || "";
      const userMessage = typeof lastUserContent === "string" ? lastUserContent : "";
      const targetSessionId = localSessionRef.current.id;
      const titleRequestVersion = titleRequestVersionRef.current;

      requestTitleGeneration(userMessage, assistantText).then(async (aiTitle) => {
        if (!aiTitle) return;

        const latestSession = localSessionRef.current;
        if (titleRequestVersionRef.current !== titleRequestVersion) return;
        if (latestSession.id !== targetSessionId || !isUntitledTitle(latestSession.title)) return;

        setLocalSession((prev) => {
          if (prev.id !== targetSessionId || !isUntitledTitle(prev.title)) return prev;
          return { ...prev, title: aiTitle };
        });

        if (titleRequestVersionRef.current !== titleRequestVersion) return;
        await persistSessionMeta(targetSessionId, { title: aiTitle });
        await onSessionUpdate();
      }).catch((err) => {
        console.warn("[title] AI title generation failed:", err);
      });
    }
  }, [onSessionUpdate, persistSession]);

  const sendMessage = useCallback(
    async (text: string, files: AttachedFile[]) => {
      if (sendLockRef.current) return;
      sendLockRef.current = true;
      setErrorText(null);

      const sessionSnapshot = localSessionRef.current;
      const userMessage: ChatMessage = { role: "user", content: text };
      const nextMessages = [...sessionSnapshot.messages, userMessage];
      await persistSession(nextMessages);

      setStreaming(true);
      setBlocks([]);
      cancelRenderFrame();
      blocksRef.current = [];
      streamBaseRef.current = nextMessages;
      abortedRef.current = false;
      stickToBottomRef.current = true;

      try {
        const currentUser = getUser();
        const response = await startNativeStream({
          session_id: sessionSnapshot.id,
          user_id: currentUser?.id || undefined,
          model: sessionSnapshot.model,
          message: buildPrompt(text, files),
          workspace: sessionSnapshot.workspacePath || undefined,
          restricted: false,
        });

        for await (const packet of response.stream) {
          if (abortedRef.current) break;

          if (packet.type === "response") {
            if (packet.success === false) {
              throw new Error(String(packet.error || "请求失败"));
            }
            continue;
          }

          if (packet.type === "error") {
            throw new Error(String(packet.error || "请求失败"));
          }

          if (packet.type === "done") break;
          if (packet.type !== "session_event" || !packet.event) continue;

          const event = packet.event as {
            type: string;
            assistantMessageEvent?: { type?: string; delta?: string };
            toolCallId?: unknown;
            toolName?: unknown;
            isError?: unknown;
            reason?: unknown;
            attempt?: unknown;
            maxAttempts?: unknown;
          };

          if (event.type === "message_update") {
            const assistantEvent = event.assistantMessageEvent;
            if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
              const last = blocksRef.current[blocksRef.current.length - 1];
              if (last?.type === "text") {
                last.content += assistantEvent.delta;
              } else {
                blocksRef.current.push({ type: "text", content: assistantEvent.delta });
              }
              scheduleBlocksRender();
            } else if (assistantEvent?.type === "thinking_delta" && assistantEvent.delta) {
              const last = blocksRef.current[blocksRef.current.length - 1];
              if (last?.type === "thinking") {
                last.content += assistantEvent.delta;
              } else {
                blocksRef.current.push({ type: "thinking", content: assistantEvent.delta });
              }
              scheduleBlocksRender();
            }
          }

          if (event.type === "tool_execution_start") {
            blocksRef.current.push({
              type: "tool",
              id: String(event.toolCallId || `tool-${Date.now()}`),
              name: String(event.toolName || "tool"),
              status: "running",
            });
            scheduleBlocksRender();
          }

          if (event.type === "tool_execution_end") {
            for (let i = blocksRef.current.length - 1; i >= 0; i -= 1) {
              const block = blocksRef.current[i];
              if (
                block.type === "tool" &&
                block.name === String(event.toolName) &&
                block.status === "running"
              ) {
                block.status = event.isError ? "error" : "completed";
                break;
              }
            }
            scheduleBlocksRender();
          }

          if (event.type === "auto_compaction_start") {
            blocksRef.current.push({
              type: "status",
              text: `上下文压缩中 (${String(event.reason || "auto")})`,
            });
            scheduleBlocksRender();
          }

          if (event.type === "auto_retry_start") {
            blocksRef.current.push({
              type: "status",
              text: `模型重试 ${String(event.attempt || 1)}/${String(event.maxAttempts || 1)}`,
            });
            scheduleBlocksRender();
          }
        }

        if (!abortedRef.current) {
          await finalizeStream();
        }
      } catch (error) {
        if (!abortedRef.current) {
          setErrorText(error instanceof Error ? error.message : "请求失败");
        }
      } finally {
        sendLockRef.current = false;
        setStreaming(false);
        cancelRenderFrame();
        setBlocks([]);
        blocksRef.current = [];
      }
    },
    [cancelRenderFrame, finalizeStream, persistSession, scheduleBlocksRender],
  );

  const stopStreaming = useCallback(async () => {
    abortedRef.current = true;

    const sessionId = localSessionRef.current.id;
    await abortNativeSession(sessionId).catch(() => {});

    const assistantText = blocksRef.current
      .filter((block): block is Extract<StreamBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.content)
      .join("\n\n");

    if (assistantText.trim()) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText,
      };
      await persistSession([...streamBaseRef.current, assistantMessage]);
    }

    sendLockRef.current = false;
    setStreaming(false);
    cancelRenderFrame();
    setBlocks([]);
    blocksRef.current = [];
  }, [cancelRenderFrame, persistSession]);

  useEffect(() => {
    if (!pendingMessage || streaming) return;
    const filesToSend = pendingFiles;
    clearPending();
    sendMessage(pendingMessage, filesToSend);
  }, [clearPending, pendingMessage, pendingFiles, sendMessage, streaming]);

  const handleMessagesScroll = useCallback(() => {
    if (!messagesRef.current) return;
    stickToBottomRef.current = isNearBottom(messagesRef.current);
  }, []);

  const updateWorkspacePath = useCallback((workspacePath: string) => {
    const sessionId = localSessionRef.current.id;
    setLocalSession((prev) => ({ ...prev, workspacePath }));
    persistSessionMeta(sessionId, { workspacePath }).catch(() => {});
  }, []);

  const updateModel = useCallback((model: string) => {
    const sessionId = localSessionRef.current.id;
    setLocalSession((prev) => ({ ...prev, model }));
    persistSessionMeta(sessionId, { model }).catch(() => {});
  }, []);

  return {
    localSession,
    visibleMessages,
    streaming,
    blocks,
    errorText,
    lastStreamingTextIndex,
    messagesRef,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
  };
}
