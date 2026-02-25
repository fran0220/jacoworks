import { AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OcSession } from "../types";
import OcComposer from "./OcComposer";
import OcMessageBubble from "./OcMessageBubble";

export default function OcChatView({
  session,
  isStreaming,
  errorText,
  onSend,
  onAbort,
}: {
  session: OcSession | null;
  isStreaming: boolean;
  errorText: string | null;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messages = session?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length, lastMessage?.content, isStreaming]);

  return (
    <div className="oc-chat-view">
      <div className="oc-messages" ref={messagesRef}>
        {messages.length === 0 && <p className="oc-empty-state">发送第一条消息开始 OpenClaw 对话</p>}

        {messages.map((message) => (
          <OcMessageBubble
            key={message.id}
            message={message}
            streaming={isStreaming && message.status === "streaming"}
          />
        ))}

        {errorText && (
          <div className="oc-inline-error">
            <AlertCircle size={14} />
            <span>{errorText}</span>
          </div>
        )}
      </div>

      <OcComposer isStreaming={isStreaming} onSend={onSend} onAbort={onAbort} />
    </div>
  );
}
