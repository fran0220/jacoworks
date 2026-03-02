import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abortNativeSession,
  requestTitleGeneration,
  startNativeStream,
} from "../lib/agent";
import { getUser } from "../lib/auth";
import { getSettings } from "../lib/config";
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildPrompt(text: string, files: AttachedFile[]): string {
  if (files.length === 0) return text;

  const chunks: string[] = [];
  for (const file of files) {
    if (file.type === "image") {
      chunks.push(`[图片附件] ${file.name}\n${file.data}`);
    } else if (file.type === "binary") {
      chunks.push(`[文档附件] ${file.name} (${formatFileSize(file.size)}) — 这是一个二进制文档文件，请使用 write_file + bash 工具写一个 .mjs 脚本来读取和处理它。文件位于当前工作目录中。`);
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

function truncate(str: string | undefined, max: number): string | undefined {
  if (!str) return undefined;
  return str.length <= max ? str : `${str.slice(0, max)}\n…[截断]`;
}

function collectMetaBlocks(blocks: StreamBlock[]): StreamBlock[] {
  const result: StreamBlock[] = [];
  for (const b of blocks) {
    if (b.type === "thinking" && b.content.trim()) {
      result.push(b);
    } else if (b.type === "tool") {
      const base = b.status === "running" ? { ...b, status: "completed" as const } : { ...b };
      base.args = truncate(base.args, 1000);
      base.result = truncate(base.result, 2000);
      result.push(base);
    }
  }
  return result;
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
    // Use updater to avoid overwriting in-flight local changes (e.g. user message
    // queued by sendMessage) — React.StrictMode re-runs effects which would
    // otherwise clobber the pending setLocalSession from sendMessage.
    setLocalSession((prev) => (prev.id === session.id ? prev : session));
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

    const metaBlocks = collectMetaBlocks(blocksRef.current);

    if (!assistantText.trim() && metaBlocks.length === 0) return;

    setBlocks([]);
    setStreaming(false);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantText,
      ...(metaBlocks.length > 0 ? { blocks: metaBlocks } : {}),
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
      const fileRefs = files.length > 0
        ? files.map(f => ({ name: f.name, type: f.type, size: f.size }))
        : undefined;
      const userMessage: ChatMessage = {
        role: "user",
        content: text,
        ...(fileRefs ? { files: fileRefs } : {}),
      };
      const nextMessages = [...sessionSnapshot.messages, userMessage];
      await persistSession(nextMessages);

      setStreaming(true);
      setBlocks([]);
      cancelRenderFrame();
      blocksRef.current = [];
      streamBaseRef.current = nextMessages;
      abortedRef.current = false;
      stickToBottomRef.current = true;
      let streamTimeoutId: ReturnType<typeof setInterval> | null = null;

      try {
        const currentUser = getUser();
        const appSettings = getSettings();
        const response = await startNativeStream({
          session_id: sessionSnapshot.id,
          user_id: currentUser?.id || undefined,
          model: sessionSnapshot.model,
          message: buildPrompt(text, files),
          workspace: sessionSnapshot.workspacePath || undefined,
          restricted: false,
          thinking_level: appSettings.thinkingLevel || undefined,
        });

        const STREAM_TIMEOUT_MS = 180_000;
        let lastActivity = Date.now();
        streamTimeoutId = setInterval(() => {
          if (Date.now() - lastActivity > STREAM_TIMEOUT_MS) {
            if (streamTimeoutId) clearInterval(streamTimeoutId);
            streamTimeoutId = null;
            abortedRef.current = true;
            setErrorText("响应超时，AI 长时间未返回内容");
            abortNativeSession(sessionSnapshot.id).catch(() => {});
          }
        }, 5_000);

        for await (const packet of response.stream) {
          if (abortedRef.current) break;
          lastActivity = Date.now();

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
          if ((packet.event as { type?: string }).type === "keepalive") continue;

          const event = packet.event as {
            type: string;
            assistantMessageEvent?: { type?: string; delta?: string };
            toolCallId?: unknown;
            toolName?: unknown;
            args?: unknown;
            result?: unknown;
            isError?: unknown;
            reason?: unknown;
            attempt?: unknown;
            maxAttempts?: unknown;
          };

          if (event.type === "message_update") {
            const assistantEvent = event.assistantMessageEvent;
            if (assistantEvent?.type === "thinking_delta" || assistantEvent?.type === "thinking_start" || assistantEvent?.type === "thinking_end") {
              console.log("[thinking-ui]", assistantEvent.type, assistantEvent.delta?.slice?.(0, 50));
            }
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
            } else if (assistantEvent?.type === "toolcall_start") {
              // LLM started generating a tool call — show tool status immediately
              // Extract tool name from the partial content at contentIndex
              const partial = (assistantEvent as { partial?: { content?: Array<{ type: string; id?: string; name?: string }> }; contentIndex?: number }).partial;
              const idx = (assistantEvent as { contentIndex?: number }).contentIndex;
              const toolBlock = idx != null ? partial?.content?.[idx] : undefined;
              const toolName = toolBlock?.name || "tool";
              const toolId = toolBlock?.id || `tool-${Date.now()}`;
              blocksRef.current.push({
                type: "tool",
                id: toolId,
                name: toolName,
                status: "running",
              });
              scheduleBlocksRender();
            }
          }

          if (event.type === "tool_execution_start") {
            // Update existing block (created by toolcall_start) or create new one
            const execId = String(event.toolCallId || "");
            const existing = execId
              ? blocksRef.current.find((b) => b.type === "tool" && b.id === execId)
              : undefined;
            if (existing && existing.type === "tool") {
              existing.args = event.args ? JSON.stringify(event.args, null, 2) : undefined;
            } else {
              const argsStr = event.args ? JSON.stringify(event.args, null, 2) : undefined;
              blocksRef.current.push({
                type: "tool",
                id: String(event.toolCallId || `tool-${Date.now()}`),
                name: String(event.toolName || "tool"),
                status: "running",
                args: argsStr,
              });
            }
            scheduleBlocksRender();
          }

          if (event.type === "tool_execution_end") {
            const endId = String(event.toolCallId || "");
            for (let i = blocksRef.current.length - 1; i >= 0; i -= 1) {
              const block = blocksRef.current[i];
              if (
                block.type === "tool" &&
                (endId ? block.id === endId : block.name === String(event.toolName) && block.status === "running")
              ) {
                block.status = event.isError ? "error" : "completed";
                if (event.result !== undefined) {
                  const raw = typeof event.result === "string" ? event.result : JSON.stringify(event.result, null, 2);
                  block.result = raw.length > 4000 ? `${raw.slice(0, 4000)}\n…[截断]` : raw;
                }
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

        if (streamTimeoutId) { clearInterval(streamTimeoutId); streamTimeoutId = null; }

        if (!abortedRef.current) {
          await finalizeStream();
        } else {
          const hasPartialText = blocksRef.current.some(
            (b) => b.type === "text" && b.content.trim(),
          );
          if (hasPartialText) {
            await finalizeStream();
          }
        }
      } catch (error) {
        if (!abortedRef.current) {
          setErrorText(error instanceof Error ? error.message : "请求失败");
        }
      } finally {
        if (streamTimeoutId) clearInterval(streamTimeoutId);
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

    const metaBlocks = collectMetaBlocks(blocksRef.current);

    if (assistantText.trim() || metaBlocks.length > 0) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText,
        ...(metaBlocks.length > 0 ? { blocks: metaBlocks } : {}),
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
    messagesRef,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
  };
}
