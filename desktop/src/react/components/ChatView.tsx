import { AlertCircle, ChevronDown, RotateCcw } from "lucide-react";
import { useChatStream } from "../hooks/use-chat-stream";
import type { AgentTransport } from "../lib/agent-transport";
import type { AttachedFile, ChatSession } from "../types";
import AgentStatusBar from "./AgentStatusBar";
import AssistantContent from "./AssistantContent";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import StreamingCursor from "./StreamingCursor";

export default function ChatView({
  session,
  pendingMessage,
  pendingFiles,
  clearPending,
  onSessionUpdate,
  transport,
}: {
  session: ChatSession;
  pendingMessage: string | null;
  pendingFiles: AttachedFile[];
  clearPending: () => void;
  onSessionUpdate: () => Promise<void>;
  transport: AgentTransport | null;
}) {
  const {
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
    scrollToBottom,
    sendMessage,
    stopStreaming,
    handleMessagesScroll,
    updateWorkspacePath,
    updateModel,
    agentReady: isAgentReady,
  } = useChatStream({
    session,
    pendingMessage,
    pendingFiles,
    clearPending,
    onSessionUpdate,
    transport,
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
              <AssistantContent parts={[]} blocks={blocks} streaming workspacePath={sessionState.workspacePath} />
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
        disabled={!isAgentReady}
        isAnonymous={!!session.anonymous}
        onWorkspaceChange={updateWorkspacePath}
        onModelChange={updateModel}
        onSend={sendMessage}
        onStop={stopStreaming}
      />

      <AgentStatusBar
        streaming={streaming}
        streamingStartedAt={streamingStartedAt}
        agentPhase={agentPhase}
        turnCount={turnCount}
        contextUsage={contextUsage}
      />
    </div>
  );
}
