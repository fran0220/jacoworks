import { AlertCircle } from "lucide-react";
import { useChatStream } from "../hooks/use-chat-stream";
import type { AttachedFile, ChatSession } from "../types";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import StreamingCursor from "./StreamingCursor";
import StreamingMarkdown from "./StreamingMarkdown";
import ToolStatus from "./ToolStatus";

function shortName(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filepath;
}

function toolArgsSummary(name: string, args?: string): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args);
    if (name === "read" || name === "edit" || name === "write") return shortName(parsed.path || "");
    if (name === "bash") return parsed.command ? `$ ${parsed.command}`.slice(0, 60) : "";
    if (name === "web_search" || name === "memory_search") return parsed.query || "";
    if (name === "web_fetch") return parsed.url ? new URL(parsed.url).hostname : "";
    if (name === "grep") return parsed.pattern || "";
    if (name === "find") return shortName(parsed.glob || parsed.pattern || "");
    if (name === "ls") return shortName(parsed.path || "");
    return "";
  } catch { return ""; }
}

export default function ChatView({
  session,
  pendingMessage,
  pendingFiles,
  clearPending,
  onSessionUpdate,
}: {
  session: ChatSession;
  pendingMessage: string | null;
  pendingFiles: AttachedFile[];
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
}) {
  const {
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
  } = useChatStream({
    session,
    pendingMessage,
    pendingFiles,
    clearPending,
    onSessionUpdate,
  });

  return (
    <div className="chat-view">
      <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {visibleMessages.length === 0 && !streaming && (
          <div className="empty-state">
            <p>发送消息开始对话</p>
          </div>
        )}

        {visibleMessages.map((message, index) => (
          <MessageBubble key={`${index}-${message.role}`} message={message} workspacePath={localSession.workspacePath} />
        ))}

        {streaming && blocks.length === 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              <div className="typing-indicator">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}

        {streaming && blocks.length > 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              {blocks.map((block, i) => {
                if (block.type === "text") {
                  return (
                    <StreamingMarkdown key={`stream-text-${i}`} content={block.content} workspacePath={localSession.workspacePath} />
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
          </div>
        )}
      </div>

      <Composer
        isStreaming={streaming}
        workspacePath={localSession.workspacePath}
        model={localSession.model}
        onWorkspaceChange={updateWorkspacePath}
        onModelChange={updateModel}
        onSend={sendMessage}
        onStop={stopStreaming}
      />
    </div>
  );
}
