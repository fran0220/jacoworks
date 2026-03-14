import { FileText } from "lucide-react";
import { memo } from "react";
import { formatSize } from "../lib/file-utils";
import type { AssistantPart, ChatMessage, FileRef, MessageContent, StreamBlock } from "../types";
import AssistantContent from "./AssistantContent";
import Markdown from "./Markdown";

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

function legacyToParts(content: string, blocks?: StreamBlock[]): AssistantPart[] {
  const parts: AssistantPart[] = [];
  if (blocks) {
    for (const b of blocks) {
      if (b.type === "thinking" && b.content.trim()) {
        parts.push({ kind: "thinking", text: b.content });
      } else if (b.type === "tool") {
        parts.push({
          kind: "tool",
          id: b.id,
          name: b.name,
          status: b.status === "running" ? "completed" : b.status,
          args: b.args,
          result: b.result,
          filePath: b.filePath,
          fileKind: b.fileKind,
        });
      }
    }
  }
  if (content.trim()) {
    parts.push({ kind: "markdown", text: content });
  }
  return parts;
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
  const blocks = message.blocks || [];

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
            parts={message.parts || legacyToParts(text, blocks)}
            workspacePath={workspacePath}
          />
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
