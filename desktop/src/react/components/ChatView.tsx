import { AlertCircle } from "lucide-react";
import { useChatStream } from "../hooks/use-chat-stream";
import type { ChatSession } from "../types";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import StreamingMarkdown from "./StreamingMarkdown";
import ToolStatus from "./ToolStatus";

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
  const {
    localSession,
    visibleMessages,
    streaming,
    blocks,
    errorText,
    lastStreamingTextIndex,
    messagesRef,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
  } = useChatStream({
    session,
    pendingMessage,
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

        {streaming && blocks.length > 0 && blocks.map((block, i) => {
          if (block.type === "text") {
            const isLastText = i === lastStreamingTextIndex;
            return (
              <div key={`stream-text-${i}`} className="bubble-row assistant">
                <div className="bubble assistant-bubble">
                  <StreamingMarkdown content={block.content} workspacePath={localSession.workspacePath} />
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
        onWorkspaceChange={updateWorkspacePath}
        onModelChange={updateModel}
        onSend={sendMessage}
        onStop={stopStreaming}
      />
    </div>
  );
}
