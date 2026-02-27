import { AlertCircle, FileText, Loader2, Paperclip, SendHorizontal, Square, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import type { OcAttachment } from "../types";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (OpenClaw limit)
const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return imageExts.has(ext);
}

function readAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PendingFile {
  name: string;
  mimeType: string;
  base64: string; // raw base64, no data: prefix
  previewUrl: string; // data URL for thumbnail
  size: number;
}

export default function OcComposer({
  disabled,
  isStreaming,
  onSend,
  onAbort,
}: {
  disabled?: boolean;
  isStreaming: boolean;
  onSend: (text: string, attachments?: OcAttachment[]) => void;
  onAbort: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSend = !disabled && !isStreaming && (text.trim().length > 0 || files.length > 0);

  const addWarning = useCallback((msg: string) => {
    setWarnings((prev) => [...prev, msg]);
    setTimeout(() => setWarnings((prev) => prev.slice(1)), 3000);
  }, []);

  const send = () => {
    if (!canSend) return;
    const attachments: OcAttachment[] = files.map((f) => ({
      type: "image",
      mimeType: f.mimeType,
      fileName: f.name,
      content: f.base64,
    }));
    onSend(text.trim(), attachments.length > 0 ? attachments : undefined);
    setText("");
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const onFileChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const selected = event.target.files;
    if (!selected) return;

    const list = Array.from(selected);
    const rejected: File[] = [];
    const accepted: File[] = [];

    for (const f of list) {
      if (!isImageFile(f)) {
        addWarning(`${f.name} 不是支持的图片格式`);
      } else if (f.size > MAX_FILE_SIZE) {
        addWarning(`${f.name} 超过 5 MB 限制`);
      } else {
        accepted.push(f);
      }
    }

    if (accepted.length === 0) {
      event.target.value = "";
      return;
    }

    setReadingCount((c) => c + accepted.length);

    const incoming: PendingFile[] = [];
    for (const file of accepted) {
      try {
        const [buffer, dataUrl] = await Promise.all([readAsArrayBuffer(file), readAsDataURL(file)]);
        incoming.push({
          name: file.name,
          mimeType: file.type || "image/png",
          base64: arrayBufferToBase64(buffer),
          previewUrl: dataUrl,
          size: file.size,
        });
      } catch {
        addWarning(`${file.name} 读取失败`);
      }
    }

    setReadingCount((c) => c - accepted.length);
    setFiles((prev) => [...prev, ...incoming]);
    event.target.value = "";
  };

  const hasAttachments = files.length > 0 || readingCount > 0;

  return (
    <div className="oc-composer">
      {warnings.length > 0 && (
        <div className="composer-warnings">
          {warnings.map((msg, i) => (
            <div className="composer-warning" key={`${msg}-${i}`}>
              <AlertCircle size={14} />
              <span>{msg}</span>
            </div>
          ))}
        </div>
      )}

      {hasAttachments && (
        <div className="composer-attachments">
          {files.map((file, index) => (
            <div className="attach-thumb" key={`${file.name}-${index}`}>
              <img src={file.previewUrl} alt={file.name} className="attach-thumb-img" />
              <button
                className="attach-thumb-remove"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
              >
                <X size={12} />
              </button>
              <div className="attach-thumb-name" title={`${file.name} (${formatSize(file.size)})`}>
                {file.name}
              </div>
            </div>
          ))}
          {readingCount > 0 &&
            Array.from({ length: readingCount }).map((_, i) => (
              <div className="attach-shimmer" key={`shimmer-${i}`}>
                <Loader2 size={16} className="attach-shimmer-spin" />
              </div>
            ))}
        </div>
      )}

      <div className="oc-input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="oc-attach-btn"
          disabled={disabled || isStreaming}
          onClick={() => fileInputRef.current?.click()}
          title="附加图片"
        >
          <Paperclip size={16} />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled || isStreaming}
          className="oc-input"
          placeholder="向 OpenClaw 发送消息..."
          onInput={(event) => {
            const target = event.currentTarget;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>

      <div className="oc-actions">
        {isStreaming ? (
          <button type="button" className="oc-action-btn danger" onClick={onAbort}>
            <Square size={14} />
            停止
          </button>
        ) : (
          <button type="button" className="oc-action-btn primary" onClick={send} disabled={!canSend}>
            <SendHorizontal size={14} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
