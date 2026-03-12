import { useState, useEffect } from "react";
import { AlertCircle, ChevronDown, RotateCcw } from "lucide-react";
import { useChatStream } from "../hooks/use-chat-stream";
import type { AttachedFile, ChatSession } from "../types";
import { toolArgsSummary } from "../lib/tool-utils";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import StreamingCursor from "./StreamingCursor";
import StreamingMarkdown from "./StreamingMarkdown";
import ToolStatus from "./ToolStatus";

function ToolElapsed() {
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (elapsed < 3) return null;
  return <span className="process-strip-elapsed">{elapsed}s</span>;
}

export default function ChatView({
  session,
  pendingMessage,
  pendingFiles,
  clearPending,
  onSessionUpdate,
  cloudWsRef,
  cloudReady,
  setCloudMessageHandler,
}: {
  session: ChatSession;
  pendingMessage: string | null;
  pendingFiles: AttachedFile[];
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
  cloudWsRef?: React.MutableRefObject<import("../lib/cloud-agent-ws").CloudAgentWS | null>;
  cloudReady?: boolean;
  setCloudMessageHandler?: (handler: ((packet: import("../lib/agent").AgentRpcEvent) => void) | null) => void;
}) {
  const {
    sessionState,
    visibleMessages,
    streaming,
    streamingStartedAt,
    blocks,
    errorText,
    messagesRef,
    isAtBottom,
    scrollToBottom,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
    cloudReady: isCloudReady,
  } = useChatStream({
    session,
    pendingMessage,
    pendingFiles,
    clearPending,
    onSessionUpdate,
    cloudWsRef,
    cloudReady,
    setCloudMessageHandler,
  });

  const lastUserMessage = visibleMessages.filter(m => m.role === "user").pop();

  return (
    <div className={`chat-view${session.anonymous ? " anonymous" : ""}`}>
      <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {visibleMessages.length === 0 && !streaming && (
          <div className="empty-state">
            <p>发送消息开始对话</p>
          </div>
        )}

        {visibleMessages.map((message, index) => (
          <MessageBubble key={`${index}-${message.role}`} message={message} workspacePath={sessionState.workspacePath} />
        ))}

        {streaming && blocks.length === 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              <StreamingCursor />
            </div>
          </div>
        )}

        {streaming && blocks.length > 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              {blocks.map((block, i) => {
                if (block.type === "text") {
                  return (
                    <StreamingMarkdown key={`stream-text-${i}`} content={block.content} workspacePath={sessionState.workspacePath} />
                  );
                }
                if (block.type === "thinking") {
                  const done = blocks.slice(i + 1).some(b => b.type !== "thinking");
                  return (
                    <div key={`thinking-${i}`} className={`process-strip is-thinking ${done ? "is-done" : "is-active"}`}>
                      <div className="process-strip-inner">
                        <div className="process-strip-row">
                          <span className="process-strip-dot" />
                          <span className="process-strip-hint">{done ? "思考完成" : "思考中"}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (block.type === "tool") {
                  const isRunning = block.status === "running";
                  const summary = toolArgsSummary(block.name, block.args);
                  return (
                    <div key={block.id} className={`process-strip ${isRunning ? "is-active" : "is-done"}`}>
                      <div className="process-strip-inner">
                        <div className="process-strip-row">
                          <ToolStatus toolName={block.name} status={block.status} />
                          {summary && <span className="process-strip-hint">{summary}</span>}
                          {isRunning && <ToolElapsed />}
                        </div>
                      </div>
                    </div>
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
              <StreamingCursor />
            </div>
          </div>
        )}
        {errorText && (
          <div className="error-inline">
            <AlertCircle size={14} />
            <span>{errorText}</span>
            {lastUserMessage && !streaming && (
              <button
                className="error-retry-btn"
                onClick={() => {
                  const text = typeof lastUserMessage.content === "string"
                    ? lastUserMessage.content
                    : lastUserMessage.content.filter(p => p.type === "text").map(p => p.text || "").join("\n");
                  sendMessage(text, []);
                }}
              >
                <RotateCcw size={12} />
                重试
              </button>
            )}
          </div>
        )}
      </div>

      {!isAtBottom && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} title="回到底部">
          <ChevronDown size={16} />
        </button>
      )}

      <Composer
        isStreaming={streaming}
        streamingStartedAt={streamingStartedAt}
        workspacePath={sessionState.workspacePath}
        model={sessionState.model}
        disabled={!isCloudReady}
        isAnonymous={!!session.anonymous}
        onWorkspaceChange={updateWorkspacePath}
        onModelChange={updateModel}
        onSend={sendMessage}
        onStop={stopStreaming}
      />
    </div>
  );
}
