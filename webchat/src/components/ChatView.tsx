import { useRef, useEffect, useCallback } from "react";
import type { ChatMessage, StreamBlock } from "../types";
import StreamingMarkdown from "./StreamingMarkdown";
import StreamingCursor from "./StreamingCursor";
import ThinkingBlock from "./ThinkingBlock";
import ToolStatus from "./ToolStatus";
import Markdown from "./Markdown";

function Welcome() {
  return (
    <div className="welcome">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
      <h3>JAcoworks AI 助手</h3>
      <p>输入消息开始对话</p>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="bubble-row user">
      <div className="user-bubble">{content}</div>
    </div>
  );
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="bubble-row">
      <div className="assistant-bubble">
        <Markdown content={content} />
      </div>
    </div>
  );
}

export default function ChatView({
  messages,
  blocks,
  streaming,
  error,
}: {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  error: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, blocks, streaming, scrollToBottom]);

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="messages-area" ref={scrollRef}>
      {isEmpty && <Welcome />}

      {messages.map((msg, i) =>
        msg.role === "user" ? (
          <UserMessage key={i} content={typeof msg.content === "string" ? msg.content : ""} />
        ) : msg.role === "assistant" ? (
          <AssistantMessage key={i} content={typeof msg.content === "string" ? msg.content : ""} />
        ) : null,
      )}

      {streaming && blocks.map((block, i) => {
        if (block.type === "text") {
          return (
            <div className="bubble-row" key={`stream-text-${i}`}>
              <div className="assistant-bubble">
                <StreamingMarkdown content={block.content} />
                {i === blocks.length - 1 && <StreamingCursor />}
              </div>
            </div>
          );
        }
        if (block.type === "thinking") {
          return <ThinkingBlock key={`stream-think-${i}`} content={block.content} streaming />;
        }
        if (block.type === "tool") {
          return <ToolStatus key={`stream-tool-${i}`} toolName={block.name} status={block.status} />;
        }
        return null;
      })}

      {error && <div className="error-msg">错误: {error}</div>}
    </div>
  );
}
