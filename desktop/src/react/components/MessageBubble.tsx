import { Suspense, lazy } from "react";
import type { ChatMessage, MessageContent } from "../types";

const Markdown = lazy(() => import("./Markdown"));

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

export default function MessageBubble({
  message,
  streaming = false,
  workspacePath,
}: {
  message: ChatMessage;
  streaming?: boolean;
  workspacePath?: string;
}) {
  const isUser = message.role === "user";
  const text = extractText(message.content);
  const images = extractImages(message.content);

  return (
    <div className={`bubble-row ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        {isUser ? (
          <>
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
          <>
            <Suspense fallback={<pre className="assistant-plain-text">{text}</pre>}>
              <Markdown content={text} workspacePath={workspacePath} />
            </Suspense>
            {streaming && <span className="cursor">▋</span>}
          </>
        )}
      </div>
    </div>
  );
}
