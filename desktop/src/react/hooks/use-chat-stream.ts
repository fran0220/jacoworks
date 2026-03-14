import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  abortAgentSession,
  requestTitleGeneration,
  startAgentStream,
} from "../lib/agent";
import type { AgentRpcEvent } from "../lib/agent";
import type { AgentTransport } from "../lib/agent-transport";
import { getUser } from "../lib/auth";
import { getSettings } from "../lib/config";
import { sessionStore, syncDirtyToServer } from "../lib/session-store";
import { generateTitle } from "../lib/sessions";
import type {
  AssistantPart,
  AttachedFile,
  ChatMessage,
  ChatSession,
  StreamBlock,
} from "../types";
import { formatSize } from "../lib/file-utils";
import { syncMemory } from "../lib/memory-sync";
import {
  clearBlocks,
  finishStreaming,
  getEntryById,
  getOrCreateEntry,
  getSnapshot,
  patchSnapshot,
  scheduleBlocksPublish,
  setDirty,
  startStreaming as storeStartStreaming,
  subscribe,
  syncSessionFromProps,
  updateSessionState,
  type SessionStreamEntry,
  type StreamSessionContext,
} from "../lib/chat-stream-store";

// ─── Debounced memory sync ─────────────────────────────
let lastSyncTime = 0;
let syncInFlight = false;
const SYNC_DEBOUNCE_MS = 30_000;

async function debouncedSyncMemory() {
  if (!getSettings().memorySyncEnabled) return;
  if (syncInFlight) return;
  if (Date.now() - lastSyncTime < SYNC_DEBOUNCE_MS) return;
  syncInFlight = true;
  try {
    await syncMemory();
    lastSyncTime = Date.now();
  } finally {
    syncInFlight = false;
  }
}

function buildPrompt(text: string, files: AttachedFile[]): string {
  if (files.length === 0) return text;

  const fileList = files
    .map((f) => `- ${f.path} (${formatSize(f.size)})`)
    .join("\n");

  return `${text}\n\n[附加文件 — 已保存到工作目录，请用 read 或 read_document 工具查看]\n${fileList}`;
}

function isUntitledTitle(title: string): boolean {
  return title === "新对话" || title === "新会话";
}

function truncate(str: string | undefined, max: number): string | undefined {
  if (!str) return undefined;
  return str.length <= max ? str : `${str.slice(0, max)}\n…[截断]`;
}

function blocksToAssistantParts(blocks: StreamBlock[]): AssistantPart[] {
  const parts: AssistantPart[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.content.trim()) {
      parts.push({ kind: "markdown", text: b.content });
    } else if (b.type === "thinking" && b.content.trim()) {
      parts.push({ kind: "thinking", text: b.content });
    } else if (b.type === "tool") {
      parts.push({
        kind: "tool",
        id: b.id,
        name: b.name,
        status: b.status === "running" ? "completed" : b.status,
        args: truncate(b.args, 1000),
        result: truncate(b.result, 2000),
        filePath: b.filePath,
        fileKind: b.fileKind,
      });
    } else if (b.type === "status") {
      parts.push({ kind: "status", text: b.text });
    }
  }
  return parts;
}

interface UseChatStreamOptions {
  session: ChatSession;
  pendingMessage: string | null;
  pendingFiles: AttachedFile[];
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
  transport: AgentTransport | null;
}

export function useChatStream({
  session,
  pendingMessage,
  pendingFiles,
  clearPending,
  onSessionUpdate,
  transport,
}: UseChatStreamOptions) {
  // ── Subscribe to per-session stream store ──────────
  const streamSnapshot = useSyncExternalStore(
    useCallback((onChange: () => void) => subscribe(session, onChange), [session]),
    useCallback(() => getSnapshot(session), [session]),
    useCallback(() => getSnapshot(session), [session]),
  );

  const { sessionState, streaming, streamingStartedAt, blocks, errorText, agentPhase, turnCount, contextUsage } = streamSnapshot;

  // ── View-only local state ──────────────────────────
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  // ── Sync incoming session prop into store ──────────
  useEffect(() => {
    syncSessionFromProps(session);
  }, [session]);

  // Bump titleRequestVersion when session changes
  useEffect(() => {
    const entry = getOrCreateEntry(session);
    entry.runtime.titleRequestVersion += 1;
  }, [session.id]);

  const visibleMessages = useMemo(
    () => sessionState.messages.filter((m) => m.role !== "system"),
    [sessionState.messages],
  );

  // ── Scroll helpers ─────────────────────────────────
  const isNearBottom = (container: HTMLDivElement) => {
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining <= 96;
  };

  const cancelScrollFrame = useCallback(() => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
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
    scheduleScrollToBottom();
  }, [visibleMessages, blocks, scheduleScrollToBottom]);

  useEffect(() => {
    return () => { cancelScrollFrame(); };
  }, [cancelScrollFrame]);

  // ── Persist session ────────────────────────────────
  const persistSession = useCallback(
    async (ctx: StreamSessionContext, messages: ChatMessage[], title?: string) => {
      if (ctx.anonymous) {
        updateSessionState(ctx.id, (prev) => ({
          ...prev,
          messages,
          ...(title ? { title } : {}),
        }));
        setDirty(ctx.id, false);
        return;
      }
      await sessionStore.setMessages(ctx.id, messages);
      if (title) {
        await sessionStore.updateMeta(ctx.id, { title });
      }
      syncDirtyToServer().catch(() => {});
      await onSessionUpdate();
      setDirty(ctx.id, false);
    },
    [onSessionUpdate],
  );

  // ── Finalize stream ────────────────────────────────
  const finalizeStream = useCallback(
    async (entry: SessionStreamEntry, ctx: StreamSessionContext) => {
      const parts = blocksToAssistantParts(entry.runtime.blocksBuffer);

      if (parts.length === 0) {
        patchSnapshot(ctx.id, { errorText: "模型未返回任何内容，请重试" });
        clearBlocks(ctx.id);
        return;
      }

      // Backward compat: also compute flat text for content field
      const assistantText = parts
        .filter((p): p is Extract<AssistantPart, { kind: "markdown" }> => p.kind === "markdown")
        .map((p) => p.text)
        .join("\n\n");

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText,
        parts,
      };
      const finalMessages = [...entry.runtime.streamBaseMessages, assistantMessage];

      setDirty(ctx.id, true);
      updateSessionState(ctx.id, (prev) => ({
        ...prev,
        messages: finalMessages,
      }));
      clearBlocks(ctx.id);

      const assistantCount = finalMessages.filter((m) => m.role === "assistant").length;
      const isUntitled = isUntitledTitle(ctx.title);

      const fallbackTitle =
        isUntitled && assistantCount === 1 ? generateTitle(assistantText) : undefined;

      await persistSession(ctx, finalMessages, fallbackTitle);

      // AI title generation (fire-and-forget)
      if (isUntitled && assistantCount === 1 && !ctx.anonymous && transport?.isReady) {
        const lastUserContent =
          entry.runtime.streamBaseMessages.filter((m) => m.role === "user").pop()?.content || "";
        const userMessage = typeof lastUserContent === "string" ? lastUserContent : "";
        const titleVersion = entry.runtime.titleRequestVersion;

        requestTitleGeneration(transport, userMessage, assistantText)
          .then(async (aiTitle) => {
            if (!aiTitle) return;
            if (entry.runtime.titleRequestVersion !== titleVersion) return;
            updateSessionState(ctx.id, (prev) =>
              prev.id === ctx.id ? { ...prev, title: aiTitle } : prev,
            );
            if (entry.runtime.titleRequestVersion !== titleVersion) return;
            await sessionStore.updateMeta(ctx.id, { title: aiTitle });
            syncDirtyToServer().catch(() => {});
            await onSessionUpdate();
          })
          .catch((err) => {
            console.warn("[title] AI title generation failed:", err);
          });
      }
    },
    [onSessionUpdate, persistSession, transport],
  );

  // ── Send message ───────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, files: AttachedFile[]) => {
      const entry = getOrCreateEntry(session);
      if (entry.runtime.sendLock) return;

      const sessionSnap = entry.snapshot.sessionState;
      const streamCtx: StreamSessionContext = {
        id: sessionSnap.id,
        anonymous: sessionSnap.anonymous,
        title: sessionSnap.title,
      };

      const fileRefs = files.length > 0
        ? files.map((f) => ({ name: f.name, size: f.size }))
        : undefined;
      const userMessage: ChatMessage = {
        role: "user",
        content: text,
        ...(fileRefs ? { files: fileRefs } : {}),
      };
      const nextMessages = [...sessionSnap.messages, userMessage];

      // Local-first: append user message without waiting
      if (!streamCtx.anonymous) {
        sessionStore.appendMessage(streamCtx.id, userMessage).catch(() => {});
      }

      setDirty(sessionSnap.id, true);
      updateSessionState(sessionSnap.id, (prev) => ({
        ...prev,
        messages: nextMessages,
      }));

      storeStartStreaming(sessionSnap, nextMessages);
      stickToBottomRef.current = true;

      // ── processStream: consumes the sidecar async generator ──
      const processStream = async (response: { stream: AsyncGenerator<AgentRpcEvent>; cancel: () => void }) => {
        entry.runtime.cancel = response.cancel;
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

        try {
          inactivityTimer = window.setTimeout(() => {
            if (!entry.runtime.aborted) {
              entry.runtime.aborted = true;
              response.cancel();
              patchSnapshot(streamCtx.id, { errorText: "响应超时，模型长时间未返回数据" });
            }
          }, 45_000);

          const resetInactivityTimer = () => {
            if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);
            inactivityTimer = window.setTimeout(() => {
              if (!entry.runtime.aborted) {
                entry.runtime.aborted = true;
                response.cancel();
                patchSnapshot(streamCtx.id, { errorText: "响应超时，模型长时间未返回数据" });
              }
            }, 45_000);
          };

          for await (const packet of response.stream) {
            if (entry.runtime.aborted) break;
            resetInactivityTimer();

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
              if (assistantEvent?.type === "thinking_start") {
                patchSnapshot(streamCtx.id, { agentPhase: "thinking" });
              } else if (assistantEvent?.type === "thinking_end") {
                patchSnapshot(streamCtx.id, { agentPhase: "thinking" });
              }
              if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
                const last = entry.runtime.blocksBuffer[entry.runtime.blocksBuffer.length - 1];
                if (last?.type === "text") {
                  last.content += assistantEvent.delta;
                } else {
                  entry.runtime.blocksBuffer.push({ type: "text", content: assistantEvent.delta });
                }
                scheduleBlocksPublish(streamCtx.id);
              } else if (assistantEvent?.type === "thinking_delta" && assistantEvent.delta) {
                const last = entry.runtime.blocksBuffer[entry.runtime.blocksBuffer.length - 1];
                if (last?.type === "thinking") {
                  last.content += assistantEvent.delta;
                } else {
                  entry.runtime.blocksBuffer.push({ type: "thinking", content: assistantEvent.delta });
                }
                scheduleBlocksPublish(streamCtx.id);
              } else if (assistantEvent?.type === "toolcall_start") {
                const partial = (assistantEvent as { partial?: { content?: Array<{ type: string; id?: string; name?: string }> }; contentIndex?: number }).partial;
                const idx = (assistantEvent as { contentIndex?: number }).contentIndex;
                const toolBlock = idx != null ? partial?.content?.[idx] : undefined;
                const toolName = toolBlock?.name || "tool";
                const toolId = toolBlock?.id || `tool-${Date.now()}`;
                entry.runtime.blocksBuffer.push({
                  type: "tool",
                  id: toolId,
                  name: toolName,
                  status: "running",
                });
                scheduleBlocksPublish(streamCtx.id);
              }
            }

            if (event.type === "tool_execution_start") {
              patchSnapshot(streamCtx.id, { agentPhase: "executing" });
              const execId = String(event.toolCallId || "");
              const existing = execId
                ? entry.runtime.blocksBuffer.find((b) => b.type === "tool" && b.id === execId)
                : undefined;
              if (existing && existing.type === "tool") {
                existing.args = event.args ? JSON.stringify(event.args, null, 2) : undefined;
              } else {
                const argsStr = event.args ? JSON.stringify(event.args, null, 2) : undefined;
                entry.runtime.blocksBuffer.push({
                  type: "tool",
                  id: String(event.toolCallId || `tool-${Date.now()}`),
                  name: String(event.toolName || "tool"),
                  status: "running",
                  args: argsStr,
                });
              }
              scheduleBlocksPublish(streamCtx.id);
            }

            if (event.type === "tool_execution_end") {
              const endId = String(event.toolCallId || "");
              for (let i = entry.runtime.blocksBuffer.length - 1; i >= 0; i -= 1) {
                const block = entry.runtime.blocksBuffer[i];
                if (
                  block.type === "tool" &&
                  (endId ? block.id === endId : block.name === String(event.toolName) && block.status === "running")
                ) {
                  block.status = event.isError ? "error" : "completed";
                  if (event.result !== undefined) {
                    const raw = typeof event.result === "string" ? event.result : JSON.stringify(event.result, null, 2);
                    block.result = raw.length > 4000 ? `${raw.slice(0, 4000)}\n…[截断]` : raw;
                  }
                  // Extract filePath for file card rendering
                  if (!event.isError) {
                    const toolName = block.name;
                    const ARTIFACT_EXTS = new Set([
                      "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp",
                      "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "csv",
                      "mp4", "mp3", "wav", "mov",
                      "html", "zip",
                    ]);
                    if (toolName === "generate_image") {
                      try {
                        const parsed = typeof event.result === "string" ? JSON.parse(event.result) : event.result;
                        const p = parsed?.details?.path || parsed?.path;
                        if (p) block.filePath = p;
                      } catch {
                        const raw = typeof event.result === "string" ? event.result : "";
                        const m = raw.match(/(?:Image saved|saved):\s*(.+?)\s*\(/i);
                        if (m) block.filePath = m[1];
                      }
                    } else if (toolName === "write" || toolName === "write_file") {
                      try {
                        const parsedArgs = block.args ? JSON.parse(block.args) : null;
                        if (parsedArgs?.path) {
                          const ext = parsedArgs.path.split(".").pop()?.toLowerCase() || "";
                          if (ARTIFACT_EXTS.has(ext)) block.filePath = parsedArgs.path;
                        }
                      } catch { /* ignore */ }
                    }
                    if (block.filePath) {
                      const ext = block.filePath.split(".").pop()?.toLowerCase() || "";
                      const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"];
                      const DOC_EXTS = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "csv"];
                      if (IMAGE_EXTS.includes(ext)) block.fileKind = "image";
                      else if (DOC_EXTS.includes(ext)) block.fileKind = "document";
                      else block.fileKind = "file";
                    }
                  }
                  break;
                }
              }
              scheduleBlocksPublish(streamCtx.id);
            }

            if (event.type === "auto_compaction_start") {
              entry.runtime.blocksBuffer.push({
                type: "status",
                text: `上下文压缩中 (${String(event.reason || "auto")})`,
              });
              patchSnapshot(streamCtx.id, { agentPhase: "compacting" });
              scheduleBlocksPublish(streamCtx.id);
            }

            if (event.type === "auto_compaction_end") {
              patchSnapshot(streamCtx.id, { agentPhase: "thinking" });
            }

            if (event.type === "auto_retry_start") {
              entry.runtime.blocksBuffer.push({
                type: "status",
                text: `模型重试 ${String(event.attempt || 1)}/${String(event.maxAttempts || 1)}`,
              });
              patchSnapshot(streamCtx.id, { agentPhase: "retrying" });
              scheduleBlocksPublish(streamCtx.id);
            }

            if (event.type === "auto_retry_end") {
              patchSnapshot(streamCtx.id, { agentPhase: "thinking" });
            }

            // ── Agent lifecycle events ──
            if (event.type === "agent_start") {
              entry.runtime.agentStartedAt = Date.now();
              patchSnapshot(streamCtx.id, { agentPhase: "thinking", turnCount: 0 });
            }

            if (event.type === "agent_end") {
              entry.runtime.agentStartedAt = null;
            }

            if (event.type === "turn_start") {
              const prev = getSnapshot(session);
              patchSnapshot(streamCtx.id, { agentPhase: "thinking", turnCount: prev.turnCount + 1 });
            }

            if (event.type === "context_usage") {
              const cu = event as { usedTokens?: number; maxTokens?: number };
              if (cu.usedTokens != null && cu.maxTokens != null) {
                patchSnapshot(streamCtx.id, {
                  contextUsage: { usedTokens: cu.usedTokens, maxTokens: cu.maxTokens },
                });
              }
            }
          }

          if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);

          if (!entry.runtime.aborted) {
            await finalizeStream(entry, streamCtx);
          } else if (!entry.runtime.stoppedByUser) {
            const hasPartialText = entry.runtime.blocksBuffer.some(
              (b) => b.type === "text" && b.content.trim(),
            );
            if (hasPartialText) {
              await finalizeStream(entry, streamCtx);
            }
          }
        } catch (error) {
          if (!entry.runtime.aborted) {
            const msg = error instanceof Error ? error.message : "请求失败";
            patchSnapshot(streamCtx.id, { errorText: msg });
            const errorMessages = [...entry.runtime.streamBaseMessages, {
              role: "assistant" as const,
              content: `⚠️ ${msg}`,
            }];
            setDirty(streamCtx.id, true);
            updateSessionState(streamCtx.id, (prev) => ({
              ...prev,
              messages: errorMessages,
            }));
            await persistSession(streamCtx, errorMessages).catch(() => {});
          }
        } finally {
          if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);
          finishStreaming(streamCtx.id);
          debouncedSyncMemory().catch(() => {});
        }
      };

      if (!transport?.isReady) {
        entry.runtime.sendLock = false;
        finishStreaming(sessionSnap.id);
        patchSnapshot(sessionSnap.id, { errorText: "本地 Agent 尚未就绪" });
        return;
      }

      const currentUser = getUser();
      const appSettings = getSettings();
      try {
        const response = await startAgentStream(transport, {
          session_id: sessionSnap.id,
          user_id: currentUser?.id || undefined,
          model: sessionSnap.model,
          message: buildPrompt(text, files),
          workspace: sessionSnap.workspacePath || undefined,
          restricted: false,
          thinking_level: appSettings.thinkingLevel || undefined,
          anonymous: sessionSnap.anonymous || undefined,
        });
        await processStream(response);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "请求失败";
        patchSnapshot(sessionSnap.id, { errorText: msg });
        finishStreaming(sessionSnap.id);
      }
    },
    [session, finalizeStream, persistSession, transport],
  );

  // ── Stop streaming ─────────────────────────────────
  const stopStreaming = useCallback(async () => {
    const entry = getEntryById(session.id);
    const ctx = entry?.runtime.activeStream;
    if (!entry || !ctx) return;

    entry.runtime.stoppedByUser = true;
    entry.runtime.aborted = true;
    entry.runtime.cancel?.();
    entry.runtime.cancel = null;

    if (transport?.isReady) {
      abortAgentSession(transport, ctx.id);
    }

    const parts = blocksToAssistantParts(entry.runtime.blocksBuffer);

    if (parts.length > 0) {
      const assistantText = parts
        .filter((p): p is Extract<AssistantPart, { kind: "markdown" }> => p.kind === "markdown")
        .map((p) => p.text)
        .join("\n\n");

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText,
        parts,
      };
      const finalMessages = [...entry.runtime.streamBaseMessages, assistantMessage];
      setDirty(ctx.id, true);
      updateSessionState(ctx.id, (prev) => ({
        ...prev,
        messages: finalMessages,
      }));
      await persistSession(ctx, finalMessages);
    }

    finishStreaming(ctx.id);
  }, [session.id, transport, persistSession]);

  // ── Auto-send pending message ──────────────────────
  useEffect(() => {
    if (!pendingMessage || streaming) return;
    const filesToSend = pendingFiles;
    clearPending();
    sendMessage(pendingMessage, filesToSend);
  }, [clearPending, pendingMessage, pendingFiles, sendMessage, streaming]);

  // ── Scroll handlers ────────────────────────────────
  const handleMessagesScroll = useCallback(() => {
    if (!messagesRef.current) return;
    const atBottom = isNearBottom(messagesRef.current);
    stickToBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // ── Workspace / model update ───────────────────────
  const updateWorkspacePath = useCallback((workspacePath: string) => {
    updateSessionState(session.id, (prev) => ({ ...prev, workspacePath }));
    sessionStore.updateMeta(session.id, { workspacePath }).catch(() => {});
    syncDirtyToServer().catch(() => {});
  }, [session.id]);

  const updateModel = useCallback((model: string) => {
    updateSessionState(session.id, (prev) => ({ ...prev, model }));
    sessionStore.updateMeta(session.id, { model }).catch(() => {});
    syncDirtyToServer().catch(() => {});
  }, [session.id]);

  return {
    sessionState,
    visibleMessages,
    streaming,
    streamingStartedAt,
    blocks,
    errorText,
    agentPhase,
    turnCount,
    contextUsage,
    messagesRef,
    isAtBottom,
    agentReady: transport?.isReady ?? false,
    scrollToBottom,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
  };
}
