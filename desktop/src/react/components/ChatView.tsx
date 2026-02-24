import { AlertCircle, Check, X as XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { abortNativeSession, startNativeStream } from "../lib/agent";
import { getUser } from "../lib/auth";
import { generateTitle, updateSession } from "../lib/sessions";
import type { AttachedFile, ChatMessage, ChatSession, StreamBlock } from "../types";
import Composer from "./Composer";
import Markdown from "./Markdown";
import MessageBubble from "./MessageBubble";
import ToolStatus from "./ToolStatus";

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

export default function ChatView({
  session,
  pendingMessage,
  clearPending,
  onSessionUpdate,
}: {
  session: ChatSession;
  pendingMessage: string | null;
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
}) {
  const [localSession, setLocalSession] = useState(session);
  const [streaming, setStreaming] = useState(false);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  const abortedRef = useRef(false);
  const sendLockRef = useRef(false);
  const blocksRef = useRef<StreamBlock[]>([]);
  const streamBaseRef = useRef<ChatMessage[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const blocksRenderRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  const isNearBottom = (container: HTMLDivElement) => {
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining <= 96;
  };

  const cancelRenderFrame = () => {
    if (blocksRenderRafRef.current !== null) {
      window.cancelAnimationFrame(blocksRenderRafRef.current);
      blocksRenderRafRef.current = null;
    }
  };

  const cancelScrollFrame = () => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  };

  const scheduleBlocksRender = () => {
    if (blocksRenderRafRef.current !== null) return;
    blocksRenderRafRef.current = window.requestAnimationFrame(() => {
      blocksRenderRafRef.current = null;
      setBlocks([...blocksRef.current]);
    });
  };

  const scheduleScrollToBottom = () => {
    if (!stickToBottomRef.current || scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!messagesRef.current) return;
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  };

  useEffect(() => {
    setLocalSession(session);
  }, [session]);

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
  }, [visibleMessages, blocks]);

  useEffect(() => {
    return () => {
      cancelRenderFrame();
      cancelScrollFrame();
    };
  }, []);

  useEffect(() => {
    if (!pendingMessage || streaming) return;
    clearPending();
    sendMessage(pendingMessage, []);
  }, [pendingMessage, streaming]);

  async function persistSession(messages: ChatMessage[], title?: string) {
    setLocalSession((prev) => ({ ...prev, messages, ...(title ? { title } : {}) }));
    await updateSession(localSession.id, {
      messages,
      ...(title ? { title } : {}),
    });
    await onSessionUpdate();
  }

  async function sendMessage(text: string, files: AttachedFile[]) {
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    setErrorText(null);

    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...localSession.messages, userMessage];
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
        session_id: localSession.id,
        user_id: currentUser?.id || undefined,
        model: localSession.model,
        message: buildPrompt(text, files),
        workspace: localSession.workspacePath || undefined,
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

        const event = packet.event;

        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent as {
            type?: string;
            delta?: string;
          };
          if (ame?.type === "text_delta" && ame.delta) {
            const last = blocksRef.current[blocksRef.current.length - 1];
            if (last?.type === "text") {
              last.content += ame.delta;
            } else {
              blocksRef.current.push({ type: "text", content: ame.delta });
            }
            scheduleBlocksRender();
          } else if (ame?.type === "thinking_delta" && ame.delta) {
            const last = blocksRef.current[blocksRef.current.length - 1];
            if (last?.type === "thinking") {
              last.content += ame.delta;
            } else {
              blocksRef.current.push({ type: "thinking", content: ame.delta });
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
          for (let i = blocksRef.current.length - 1; i >= 0; i--) {
            const b = blocksRef.current[i];
            if (
              b.type === "tool" &&
              b.name === String(event.toolName) &&
              b.status === "running"
            ) {
              b.status = (event.isError as boolean) ? "error" : "completed";
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
    } catch (err) {
      if (!abortedRef.current) {
        setErrorText(err instanceof Error ? err.message : "请求失败");
      }
    } finally {
      sendLockRef.current = false;
      setStreaming(false);
      cancelRenderFrame();
      setBlocks([]);
      blocksRef.current = [];
    }
  }

  async function finalizeStream() {
    const assistantText = blocksRef.current
      .filter((b): b is Extract<StreamBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.content)
      .join("\n\n");

    if (!assistantText.trim()) return;

    setBlocks([]);
    setStreaming(false);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantText,
    };
    const finalMessages = [...streamBaseRef.current, assistantMessage];

    const assistantCount = finalMessages.filter(
      (message) => message.role === "assistant",
    ).length;
    const isUntitled =
      localSession.title === "新对话" || localSession.title === "新会话";
    const title =
      isUntitled && assistantCount === 1
        ? generateTitle(assistantText)
        : undefined;

    await persistSession(finalMessages, title);
  }

  const stopStreaming = async () => {
    abortedRef.current = true;
    await abortNativeSession(localSession.id).catch(() => {});

    const assistantText = blocksRef.current
      .filter((b): b is Extract<StreamBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.content)
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
  };

  const handleMessagesScroll = () => {
    if (!messagesRef.current) return;
    stickToBottomRef.current = isNearBottom(messagesRef.current);
  };

  const handleWorkspaceChange = (workspacePath: string) => {
    setLocalSession((prev) => ({ ...prev, workspacePath }));
    updateSession(localSession.id, { workspacePath }).catch(() => {});
  };

  const handleModelChange = (model: string) => {
    setLocalSession((prev) => ({ ...prev, model }));
    updateSession(localSession.id, { model }).catch(() => {});
  };

  return (
    <div className="chat-view">
      <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {visibleMessages.length === 0 && !streaming && (
          <div className="empty-state">
            <p>发送消息开始对话</p>
          </div>
        )}

        {visibleMessages.map((message, index) => (
          <MessageBubble key={`${index}-${message.role}`} message={message} />
        ))}

        {streaming && blocks.length > 0 && blocks.map((block, i) => {
          if (block.type === "text") {
            const isLastText = i === lastStreamingTextIndex;
            return (
              <div key={`stream-text-${i}`} className="bubble-row assistant">
                <div className="bubble assistant-bubble">
                  <Markdown content={block.content} />
                  {isLastText && <span className="cursor">▋</span>}
                </div>
              </div>
            );
          }
          if (block.type === "thinking") {
            return (
              <div key={`thinking-${i}`} className="thinking-block">
                <span className="thinking-label">思考中</span>
                <span className="thinking-text">{block.content}</span>
              </div>
            );
          }
          if (block.type === "tool") {
            return (
              <ToolStatus
                key={block.id}
                toolName={block.name}
                status={block.status}
              />
            );
          }
          if (block.type === "status") {
            return (
              <div key={`status-${i}`} className="status-hint">
                {block.text}
              </div>
            );
          }
          return null;
        })}
        {errorText && (
          <div className="error-inline">
            <AlertCircle size={14} />
            <span>{errorText}</span>
          </div>
        )}
      </div>

      <Composer
        isStreaming={streaming}
        workspacePath={localSession.workspacePath}
        model={localSession.model}
        onWorkspaceChange={handleWorkspaceChange}
        onModelChange={handleModelChange}
        onSend={sendMessage}
        onStop={stopStreaming}
      />
    </div>
  );
}
