import { useRef, useEffect, useCallback } from "react";
import type { AgentSummary } from "../lib/feed";
import type { ChatMessage, FileArtifact, StreamBlock } from "../types";
import StreamingCursor from "./StreamingCursor";
import ThinkingBlock from "./ThinkingBlock";
import ToolStatus from "./ToolStatus";
import Markdown from "./Markdown";
import FileCard from "./FileCard";
import VirtualMessageList from "./VirtualMessageList";

function StreamingActivity({ blocks }: { blocks: StreamBlock[] }) {
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return null;

  // Show activity indicator when:
  // 1. A tool is currently running
  // 2. Last block is a completed tool (waiting for next LLM response)
  const hasRunningTool = blocks.some(
    (b) => b.type === "tool" && b.status === "running",
  );
  const lastIsCompletedTool =
    lastBlock.type === "tool" && lastBlock.status !== "running";

  // If last block is streaming text, cursor is already shown by StreamingCursor
  if (lastBlock.type === "text") return null;
  // If a tool is actively running, ToolStatus already shows a spinner
  if (hasRunningTool) return null;

  // After tool completes, show "thinking" indicator while waiting for next LLM turn
  if (lastIsCompletedTool) {
    return (
      <div className="streaming-activity">
        <span className="spinner" />
        <span className="streaming-activity-label">正在处理…</span>
      </div>
    );
  }

  return null;
}

function Welcome({ agentCount }: { agentCount: number }) {
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
      <h3>The stage is ready</h3>
      <p>
        {agentCount > 0
          ? `${agentCount} collaborators are standing by. Send a prompt or @mention a role to bring the stage to life.`
          : "Send a prompt or @mention a role to begin a new collaborative run."}
      </p>
    </div>
  );
}

function renderBlock(
  block: StreamBlock,
  idx: number,
  all: StreamBlock[],
  streaming: boolean,
  onPreview: (artifact: FileArtifact) => void,
) {
  if (block.type === "text") {
    return (
      <div className="bubble-row" key={`block-text-${idx}`}>
        <div className="assistant-bubble">
          <Markdown content={block.content} />
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
      <div className="tool-block-stack" key={`block-tool-${idx}`}>
        <ToolStatus toolName={block.name} status={block.status} args={block.args} output={block.output} />
        {block.artifact && <FileCard artifact={block.artifact} onPreview={onPreview} />}
      </div>
    );
  }

  return null;
}

export default function ChatView({
  messages,
  blocks,
  streaming,
  error,
  activeWorkspaceKey,
  agentSummaries = [],
  onPreview,
}: {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  error: string | null;
  activeWorkspaceKey: string;
  agentSummaries?: AgentSummary[];
  onPreview: (artifact: FileArtifact) => void;
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
      {isEmpty && <Welcome agentCount={agentSummaries.length} />}

      {!isEmpty && (
        <VirtualMessageList
          messages={messages}
          activeWorkspaceKey={activeWorkspaceKey}
          agentSummaries={agentSummaries}
          onPreview={onPreview}
          scrollRef={scrollRef}
        />
      )}

      {streaming && blocks.length === 0 && (
        <div className="assistant-message-group">
          <div className="bubble-row">
            <div className="assistant-bubble thinking-indicator">
              <span className="thinking-dots"><span>·</span><span>·</span><span>·</span></span>
            </div>
          </div>
        </div>
      )}
      {streaming && blocks.length > 0 && (
        <>
          {blocks.map((block, i) => renderBlock(block, i, blocks, true, onPreview))}
          <StreamingActivity blocks={blocks} />
        </>
      )}

      {error && <div className="error-msg">错误: {error}</div>}
    </div>
  );
}
