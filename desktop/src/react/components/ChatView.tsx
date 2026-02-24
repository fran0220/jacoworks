import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { abortNativeSession, startNativeStream } from "../lib/agent";
import { parseNativeSSE } from "../lib/agent-events";
import { abortStream } from "../lib/transport";
import { generateTitle, updateSession } from "../lib/sessions";
import type { AttachedFile, ChatMessage, ChatSession } from "../types";
import Composer from "./Composer";
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
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);

  const abortedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocalSession(session);
  }, [session]);

  const visibleMessages = useMemo(
    () => localSession.messages.filter((message) => message.role !== "system"),
    [localSession.messages],
  );

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [visibleMessages, streamingText, currentTool, statusText]);

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
    if (streaming) return;
    setErrorText(null);

    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...localSession.messages, userMessage];
    await persistSession(nextMessages);

    setStreaming(true);
    setStreamingText("");
    setCurrentTool(null);
    setStatusText(null);
    abortedRef.current = false;

    try {
      const response = await startNativeStream({
        session_id: localSession.id,
        model: localSession.model,
        message: buildPrompt(text, files),
        workspace: localSession.workspacePath || undefined,
        restricted: false,
      });

      if (response.status !== 200) {
        throw new Error(`请求失败 (${response.status})`);
      }

      setRequestId(response.requestId);
      let assistantText = "";

      for await (const packet of parseNativeSSE(response.body)) {
        if (abortedRef.current) break;

        if (packet.type === "done") break;

        if (packet.type !== "session_event" || !packet.event) continue;

        const event = packet.event;
        if (event.type === "message_update") {
          const assistantMessageEvent = event.assistantMessageEvent as {
            type?: string;
            delta?: string;
          };
          if (assistantMessageEvent?.type === "text_delta" && assistantMessageEvent.delta) {
            assistantText += assistantMessageEvent.delta;
            setStreamingText(assistantText);
            setCurrentTool(null);
            setStatusText(null);
          }
        }

        if (event.type === "tool_execution_start") {
          setCurrentTool(String(event.toolName || "tool"));
          setStatusText(null);
        }

        if (event.type === "auto_compaction_start") {
          setStatusText(`上下文压缩中 (${String(event.reason || "auto")})`);
        }

        if (event.type === "auto_retry_start") {
          setStatusText(
            `模型重试 ${String(event.attempt || 1)}/${String(event.maxAttempts || 1)}`,
          );
        }

        if (event.type === "tool_execution_end") {
          setCurrentTool(null);
        }
      }

      if (!abortedRef.current && assistantText.trim()) {
        // Clear streaming bubble before persisting to avoid flash of duplicate
        setStreamingText("");
        setStreaming(false);

        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: assistantText,
        };
        const finalMessages = [...nextMessages, assistantMessage];

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
    } catch (err) {
      if (!abortedRef.current) {
        setErrorText(err instanceof Error ? err.message : "请求失败");
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      setCurrentTool(null);
      setStatusText(null);
      setRequestId(null);
    }
  }

  const stopStreaming = async () => {
    abortedRef.current = true;
    if (requestId !== null) {
      await abortStream(requestId);
    }
    await abortNativeSession(localSession.id).catch(() => {});
    setStreaming(false);
    setStatusText("已停止生成");
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
      <div className="messages" ref={messagesRef}>
        {visibleMessages.length === 0 && !streaming && (
          <div className="empty-state">
            <p>发送消息开始对话</p>
          </div>
        )}

        {visibleMessages.map((message, index) => (
          <MessageBubble key={`${index}-${message.role}`} message={message} />
        ))}

        {streaming && streamingText && (
          <MessageBubble
            message={{ role: "assistant", content: streamingText }}
            streaming
          />
        )}
        {streaming && currentTool && <ToolStatus toolName={currentTool} />}
        {streaming && statusText && (
          <div className="status-hint">{statusText}</div>
        )}
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
