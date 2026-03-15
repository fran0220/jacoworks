import { ChevronDown } from "lucide-react";
import { useCallback } from "react";
import { useChatStream } from "../hooks/use-chat-stream";
import type { AgentTransport } from "../lib/agent-transport";
import { MODEL_OPTIONS } from "../lib/config";
import type { AttachedFile, ChatSession } from "../types";
import AgentStatusBar from "./AgentStatusBar";
import AssistantContent from "./AssistantContent";
import Composer from "./Composer";
import ErrorBubble from "./ErrorBubble";
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
    parts,
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

  const handleRetry = useCallback(() => {
    if (!lastUserMessage || streaming) return;
    const text = typeof lastUserMessage.content === "string"
      ? lastUserMessage.content
      : lastUserMessage.content.filter(p => p.type === "text").map(p => p.text || "").join("\n");
    sendMessage(text, []);
  }, [lastUserMessage, streaming, sendMessage]);

  const handleSwitchModel = useCallback(() => {
    const currentModel = sessionState.model;
    const currentIdx = MODEL_OPTIONS.findIndex(m => m.value === currentModel);
    const next = MODEL_OPTIONS[(currentIdx + 1) % MODEL_OPTIONS.length];
    updateModel(next.value);
  }, [sessionState.model, updateModel]);

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

        {streaming && parts.length === 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              <StreamingCursor />
            </div>
          </div>
        )}

        {streaming && parts.length > 0 && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble">
              <AssistantContent parts={parts} streaming workspacePath={sessionState.workspacePath} />
              <StreamingCursor />
            </div>
          </div>
        )}
        {errorText && !streaming && (
          <ErrorBubble
            message={errorText}
            onRetry={lastUserMessage ? handleRetry : undefined}
            onSwitchModel={handleSwitchModel}
          />
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
