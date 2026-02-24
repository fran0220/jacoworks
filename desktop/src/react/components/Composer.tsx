import { FileText, FolderOpen, Image, Plus, SendHorizontal, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import { MODEL_OPTIONS } from "../lib/config";
import { folderName, selectFolder } from "../lib/cowork";
import type { AttachedFile } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return imageExts.has(ext);
}

function readAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Composer({
  isStreaming,
  workspacePath,
  model,
  onWorkspaceChange,
  onModelChange,
  onSend,
  onStop,
}: {
  isStreaming: boolean;
  workspacePath: string;
  model: string;
  onWorkspaceChange: (workspacePath: string) => void;
  onModelChange: (model: string) => void;
  onSend: (text: string, files: AttachedFile[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sendDisabled = isStreaming || (!text.trim() && files.length === 0);

  const onSendClick = () => {
    if (sendDisabled) return;
    onSend(text.trim() || "(附件)", files);
    setText("");
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const onInput = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
  };

  const onFileChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const selected = event.target.files;
    if (!selected) return;

    const incoming: AttachedFile[] = [];
    for (const file of Array.from(selected)) {
      if (file.size > MAX_FILE_SIZE) continue;
      if (isImageFile(file)) {
        incoming.push({
          name: file.name,
          type: "image",
          data: await readAsDataURL(file),
          size: file.size,
        });
      } else {
        incoming.push({
          name: file.name,
          type: "text",
          data: await readAsText(file),
          size: file.size,
        });
      }
    }

    setFiles((prev) => [...prev, ...incoming]);
    event.target.value = "";
  };

  const chooseWorkspace = async () => {
    const selected = await selectFolder();
    if (selected) onWorkspaceChange(selected);
  };

  return (
    <div className="composer-card">
      {workspacePath && (
        <div className="composer-workspace">
          <div className="workspace-chip" title={workspacePath}>
            <FolderOpen size={14} />
            <span className="workspace-name">{folderName(workspacePath)}</span>
            <button
              className="workspace-clear"
              disabled={isStreaming}
              onClick={() => onWorkspaceChange("")}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="composer-attachments">
          {files.map((file, index) => (
            <div className="attachment-chip" key={`${file.name}-${index}`}>
              {file.type === "image" ? <Image size={14} /> : <FileText size={14} />}
              <span className="attachment-name" title={file.name}>
                {file.name}
              </span>
              <span className="attachment-size">{formatSize(file.size)}</span>
              <button
                className="attachment-remove"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onInput={onInput}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSendClick();
          }
        }}
        disabled={isStreaming}
        placeholder="回复..."
      />

      <div className="composer-toolbar">
        <div className="composer-toolbar-left">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.toml,.html,.css,.go,.rs,.sh"
            onChange={onFileChange}
            style={{ display: "none" }}
          />
          <button
            className="composer-btn-icon"
            disabled={isStreaming}
            onClick={() => fileInputRef.current?.click()}
            title="添加附件"
          >
            <Plus size={16} />
          </button>
          <button
            className="composer-btn-icon"
            disabled={isStreaming}
            onClick={chooseWorkspace}
            title={workspacePath ? "切换目录" : "选择目录"}
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <div className="composer-toolbar-right">
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isStreaming}
            className="model-select"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {isStreaming ? (
            <button className="btn-stop" onClick={onStop}>
              <Square size={16} />
            </button>
          ) : (
            <button className="btn-send" disabled={sendDisabled} onClick={onSendClick}>
              <SendHorizontal size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
