import {
  AlertCircle,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Plus,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import { useClickOutside } from "../hooks/use-click-outside";
import { MODEL_OPTIONS } from "../lib/config";
import CustomSelect from "./CustomSelect";
import SkillMenu from "./SkillMenu";
import { folderName, selectFolder } from "../lib/cowork";
import { importFiles, formatSize, type ImportedFile } from "../lib/file-utils";
import { addRecentFolder, getRecentFolders } from "../lib/recentFolders";
import type { AttachedFile } from "../types";

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (elapsed < 5) return null;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return <span className="streaming-elapsed">{min > 0 ? `${min}m${sec}s` : `${sec}s`}</span>;
}

export default function Composer({
  isStreaming,
  streamingStartedAt,
  workspacePath,
  model,
  disabled,
  onWorkspaceChange,
  onModelChange,
  onSend,
  onStop,
}: {
  isStreaming: boolean;
  streamingStartedAt?: number | null;
  workspacePath: string;
  model: string;
  disabled?: boolean;
  onWorkspaceChange: (workspacePath: string) => void;
  onModelChange: (model: string) => void;
  onSend: (text: string, files: AttachedFile[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>(getRecentFolders);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);

  const sendDisabled = disabled || isStreaming || (!text.trim() && files.length === 0);

  useClickOutside(plusMenuRef, () => setPlusMenuOpen(false), plusMenuOpen);
  useClickOutside(folderMenuRef, () => setFolderMenuOpen(false), folderMenuOpen);

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

  const addWarning = useCallback((msg: string) => {
    setWarnings((prev) => [...prev, msg]);
    setTimeout(() => setWarnings((prev) => prev.slice(1)), 3000);
  }, []);

  const onFileChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const selected = event.target.files;
    if (!selected || selected.length === 0) {
      event.target.value = "";
      return;
    }

    setReadingCount(selected.length);
    const { imported, warnings: newWarnings } = await importFiles(selected, workspacePath);
    setReadingCount(0);

    for (const msg of newWarnings) addWarning(msg);
    setFiles((prev) => [...prev, ...imported.map((f) => ({ name: f.name, path: f.path, size: f.size }))]);
    event.target.value = "";
  };

  const handlePickFolder = (path: string) => {
    onWorkspaceChange(path);
    addRecentFolder(path);
    setRecentFolders(getRecentFolders());
    setFolderMenuOpen(false);
  };

  const handleChooseDifferentFolder = async () => {
    const selected = await selectFolder();
    if (selected) handlePickFolder(selected);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setPlusMenuOpen(false);
  };

  const handleSkillInsert = (skillId: string) => {
    setText((prev) =>
      prev.endsWith("/") ? `${prev.slice(0, -1)}/${skillId} ` : `${prev}/${skillId} `,
    );
    setPlusMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleTextChange = (val: string) => {
    setText(val);
    if (val === "/" || val.endsWith("\n/") || val.endsWith(" /")) {
      setPlusMenuOpen(true);
    }
  };

  const hasAttachments = files.length > 0 || readingCount > 0;

  return (
    <div className="composer-card">
      {/* Warnings toast */}
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

      {/* Attachment area */}
      {hasAttachments && (
        <div className="composer-attachments">
          {files.map((file, index) => (
            <div className="attach-file" key={`${file.name}-${index}`}>
              <FileText size={16} className="attach-file-icon" />
              <div className="attach-file-info">
                <span className="attach-file-name" title={file.name}>{file.name}</span>
                <span className="attach-file-size">{formatSize(file.size)}</span>
              </div>
              <button
                className="attach-file-remove"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* Loading shimmer placeholders */}
          {readingCount > 0 &&
            Array.from({ length: readingCount }).map((_, i) => (
              <div className="attach-shimmer" key={`shimmer-${i}`}>
                <Loader2 size={16} className="attach-shimmer-spin" />
              </div>
            ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onInput={onInput}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) {
            return;
          }

          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSendClick();
          }
        }}
        disabled={disabled || isStreaming}
        placeholder={disabled ? "等待云端连接..." : "回复..."}
      />

      <div className="composer-toolbar">
        <div className="composer-toolbar-left">
          <div className="ns-folder-wrapper" ref={folderMenuRef}>
            <button
              className="ns-btn-folder"
              onClick={() => setFolderMenuOpen((v) => !v)}
              disabled={isStreaming}
              title={workspacePath || "选择工作目录"}
            >
              <FolderOpen size={14} />
              <span className="ns-folder-label">
                {workspacePath ? folderName(workspacePath) : "文件夹"}
              </span>
              <ChevronDown size={12} />
            </button>

            {folderMenuOpen && (
              <div className="ns-folder-menu">
                {recentFolders.length > 0 && (
                  <>
                    <div className="ns-folder-menu-label">最近</div>
                    {recentFolders.map((path) => (
                      <button
                        key={path}
                        className="ns-folder-item"
                        onClick={() => handlePickFolder(path)}
                      >
                        <FolderOpen size={16} />
                        <div className="ns-folder-item-text">
                          <span className="ns-folder-item-name">{folderName(path)}</span>
                          <span className="ns-folder-item-path">{path}</span>
                        </div>
                      </button>
                    ))}
                    <div className="ns-folder-menu-divider" />
                  </>
                )}
                <button className="ns-folder-item" onClick={handleChooseDifferentFolder}>
                  <Plus size={16} />
                  <div className="ns-folder-item-text">
                    <span className="ns-folder-item-name">选择其他文件夹</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          <div className="ns-plus-wrapper" ref={plusMenuRef}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              onChange={onFileChange}
              style={{ display: "none" }}
            />
            <button
              className="ns-btn-plus"
              disabled={isStreaming}
              onClick={() => setPlusMenuOpen((v) => !v)}
              title="添加附件或技能"
            >
              <span className="ns-plus-icon">+</span>
            </button>

            {plusMenuOpen && (
              <div className="ns-plus-menu">
                <button className="ns-menu-item" onClick={handleFileSelect}>
                  <Paperclip size={18} />
                  <span>附加文件或图片</span>
                </button>
                <SkillMenu onSelect={handleSkillInsert} />
              </div>
            )}
          </div>
        </div>

        <div className="composer-toolbar-right">
          <CustomSelect
            options={MODEL_OPTIONS}
            value={model}
            onChange={onModelChange}
            disabled={isStreaming}
            position="above"
          />
          {isStreaming ? (
            <>
              {streamingStartedAt && <ElapsedTime startedAt={streamingStartedAt} />}
              <button className="btn-stop" onClick={onStop}>
                <Square size={16} />
              </button>
            </>
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
