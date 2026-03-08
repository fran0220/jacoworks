import { useRef, useEffect, useCallback } from "react";
import type { ChatMessage, StreamBlock } from "../types";
import { contentToBlocks, extractText } from "../lib/message-extract";
import StreamingMarkdown from "./StreamingMarkdown";
import StreamingCursor from "./StreamingCursor";
import ThinkingBlock from "./ThinkingBlock";
import ToolStatus from "./ToolStatus";
import Markdown from "./Markdown";

function Welcome() {
  return (
    <div className="welcome">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
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

function renderBlock(block: StreamBlock, idx: number, all: StreamBlock[], streaming: boolean) {
  if (block.type === "text") {
    return (
      <div className="bubble-row" key={`block-text-${idx}`}>
        <div className="assistant-bubble">
          {streaming ? <StreamingMarkdown content={block.content} /> : <Markdown content={block.content} />}
          {streaming && idx === all.length - 1 && <StreamingCursor />}
        </div>
      </div>
    );
  }

  if (block.type === "thinking") {
    return <ThinkingBlock key={`block-think-${idx}`} content={block.content} streaming={streaming} />;
  }

  if (block.type === "tool") {
    return (
      <ToolStatus
        key={`block-tool-${idx}`}
        toolName={block.name}
        status={block.status}
        args={block.args}
        output={block.output}
      />
    );
  }

  return null;
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

      {messages.map((msg, i) => {
        if (msg.role === "user") {
          return <UserMessage key={i} content={extractText(msg.content)} />;
        }

        if (msg.role === "assistant") {
          const msgBlocks = msg.blocks?.length ? msg.blocks : contentToBlocks(msg.content);
          if (msgBlocks.length > 0) {
            return <div key={i}>{msgBlocks.map((block, idx) => renderBlock(block, idx, msgBlocks, false))}</div>;
          }

          const content = extractText(msg.content);
          if (!content) return null;
          return (
            <div className="bubble-row" key={i}>
              <div className="assistant-bubble">
                <Markdown content={content} />
              </div>
            </div>
          );
        }

        return null;
      })}

      {streaming && blocks.map((block, i) => renderBlock(block, i, blocks, true))}

      {error && <div className="error-msg">错误: {error}</div>}
    </div>
  );
}
