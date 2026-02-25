import type { OcMessage } from "../types";
import OcMarkdown from "./OcMarkdown";

export default function OcMessageBubble({
  message,
  streaming,
}: {
  message: OcMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`oc-row ${isUser ? "user" : "assistant"}`}>
      <div className={`oc-bubble ${isUser ? "user" : "assistant"}`}>
        {isUser ? <p className="oc-user-text">{message.content}</p> : <OcMarkdown content={message.content} />}
        {streaming && !isUser && <span className="oc-cursor">▋</span>}
      </div>
    </div>
  );
}
