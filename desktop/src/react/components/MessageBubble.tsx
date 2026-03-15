import { FileText } from "lucide-react";
import { memo } from "react";
import { formatSize } from "../lib/file-utils";
import type { AssistantPart, ChatMessage, FileRef, MessageContent } from "../types";
import AssistantContent from "./AssistantContent";
import ErrorBubble from "./ErrorBubble";

function extractText(content: string | MessageContent[]) {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("\n");
}

function extractImages(content: string | MessageContent[]) {
  if (typeof content === "string") return [];
  return content
    .filter((part) => part.type === "image_url" && part.image_url?.url)
    .map((part) => part.image_url!.url);
}

function FileIcon() {
  return <FileText size={14} />;
}

function FileBadges({ files }: { files: FileRef[] }) {
  if (files.length === 0) return null;
  return (
    <div className="msg-files">
      {files.map((file, i) => (
        <div className="msg-file-badge" key={`${file.name}-${i}`}>
          <FileIcon />
          <span className="msg-file-name" title={file.name}>{file.name}</span>
          <span className="msg-file-size">{formatSize(file.size)}</span>
        </div>
      ))}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  workspacePath,
}: {
  message: ChatMessage;
  workspacePath?: string;
}) {
  const isUser = message.role === "user";
  const text = extractText(message.content);
  const images = extractImages(message.content);
  const files = message.files || [];

  // Detect persisted error messages (parts with error:... status or ⚠️ prefix)
  const errorPart = message.parts?.find((p): p is Extract<AssistantPart, { kind: "status" }> =>
    p.kind === "status" && p.text.startsWith("error:"),
  );
  const isError = !isUser && (errorPart || (typeof message.content === "string" && message.content.startsWith("⚠️ ")));

  if (isError) {
    const errorMsg = errorPart
      ? errorPart.text.slice("error:".length)
      : text.replace(/^⚠️\s*/, "");
    return <ErrorBubble message={errorMsg} />;
  }

  return (
    <div className={`bubble-row ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        {isUser ? (
          <>
            <FileBadges files={files} />
            {images.length > 0 && (
              <div className="attached-images">
                {images.map((url) => (
                  <img key={url} src={url} alt="附件图片" className="attached-img" loading="lazy" />
                ))}
              </div>
            )}
            <p className="user-text">{text}</p>
          </>
        ) : (
          <AssistantContent
            parts={message.parts || []}
            workspacePath={workspacePath}
          />
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
