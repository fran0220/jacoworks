import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useClickOutside } from "../hooks/use-click-outside";
import { DEFAULT_MODEL, MODEL_OPTIONS, getSettings } from "../lib/config";
import CustomSelect from "./CustomSelect";
import SkillMenu from "./SkillMenu";
import { folderName, selectFolder } from "../lib/cowork";
import { importFilesByPaths, importFilesNative, formatSize } from "../lib/file-utils";
import { addRecentFolder, getRecentFolders } from "../lib/recentFolders";
import { createSession } from "../lib/sessions";
import type { AttachedFile, ChatSession } from "../types";

export default function NewSessionPanel({
  onSessionCreated,
  initialMessage,
  onConsumeInitial,
}: {
  onSessionCreated: (session: ChatSession, firstMessage: string, files: AttachedFile[]) => void;
  initialMessage?: string | null;
  onConsumeInitial?: () => void;
}) {
  const [task, setTask] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [model, setModel] = useState(() => getSettings().defaultModel || DEFAULT_MODEL);
  const [workspacePath, setWorkspacePath] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>(getRecentFolders);
  const cardRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill from initialMessage (e.g. "新建技能" or "GitHub 安装")
  useEffect(() => {
    if (initialMessage) {
      setTask(initialMessage);
      onConsumeInitial?.();
      // Focus and place cursor at end
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;
        }
      });
    }
  }, [initialMessage, onConsumeInitial]);

  const canSend = (task.trim().length > 0 || files.length > 0) && !loading;

  useClickOutside(plusMenuRef, () => setPlusMenuOpen(false), plusMenuOpen);
  useClickOutside(folderMenuRef, () => setFolderMenuOpen(false), folderMenuOpen);

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const syncRoot = getSettings().defaultWorkspace;

      let session;
      if (anonymous) {
        session = {
          id: `anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: "匿名对话",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          type: "cowork",
          workspacePath: workspacePath || "",
          model,
          anonymous: true,
        } satisfies import("../types").ChatSession;
      } else {
        session = await createSession({ type: "cowork", model, workspacePath: workspacePath || undefined });
      }

      // 如果用户没有手动选择文件夹，自动派生 session 同步子目录
      if (!workspacePath && syncRoot) {
        const syncDir: string = await invoke("ensure_session_sync_dir", {
          syncRoot,
          sessionId: session.id,
        });
        session = { ...session, workspacePath: syncDir };
      }

      onSessionCreated(session, task.trim() || "(附件)", files);
    } catch (err) {
      addWarning(err instanceof Error ? err.message : "创建会话失败");
    } finally {
      setLoading(false);
    }
  };

  const handlePickFolder = (path: string) => {
    setWorkspacePath(path);
    addRecentFolder(path);
    setRecentFolders(getRecentFolders());
    setFolderMenuOpen(false);
  };

  const handleChooseDifferentFolder = async () => {
    const selected = await selectFolder();
    if (selected) {
      handlePickFolder(selected);
    }
  };

  const addWarning = useCallback((msg: string) => {
    setWarnings((prev) => [...prev, msg]);
    setTimeout(() => setWarnings((prev) => prev.slice(1)), 3000);
  }, []);

  const handleFileSelect = async () => {
    setPlusMenuOpen(false);

    setReadingCount(1);
    const { imported, warnings: newWarnings } = await importFilesNative(workspacePath);
    setReadingCount(0);

    for (const msg of newWarnings) addWarning(msg);
    setFiles((prev) => [...prev, ...imported.map((f) => ({ name: f.name, path: f.path, size: f.size }))]);
  };

  const handleDrop = useCallback(async (paths: string[]) => {
    setReadingCount((count) => count + 1);
    const { imported, warnings: newWarnings } = await importFilesByPaths(paths, workspacePath);
    setReadingCount((count) => count - 1);

    for (const msg of newWarnings) addWarning(msg);
    setFiles((prev) => [...prev, ...imported.map((f) => ({ name: f.name, path: f.path, size: f.size }))]);
  }, [workspacePath, addWarning]);

  const handleSkillInsert = (skillId: string) => {
    setTask((prev) =>
      prev.endsWith("/") ? `${prev.slice(0, -1)}/${skillId} ` : `${prev}/${skillId} `,
    );
    setPlusMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleTaskChange = (val: string) => {
    setTask(val);
    if (val === "/" || val.endsWith("\n/") || val.endsWith(" /")) {
      setPlusMenuOpen(true);
    }
  };

  const hasAttachments = files.length > 0 || readingCount > 0;
  const isDragging = useDragDrop(cardRef, handleDrop, !loading);

  return (
    <div className="new-session">
      <div className="ns-header">
        <h1>开始新的任务</h1>
      </div>

      <div ref={cardRef} className={`ns-input-card${anonymous ? " anonymous" : ""}`}>
        {isDragging && (
          <div className="ns-drop-overlay">
            <Paperclip size={24} />
            <span>拖放文件到此处</span>
          </div>
        )}

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
          rows={3}
          disabled={loading}
          value={task}
          onChange={(e) => handleTaskChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) {
              return;
            }

            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入 / 调用技能"
        />

        <div className="ns-toolbar">
          <div className="ns-toolbar-left">
            <div className="ns-folder-wrapper" ref={folderMenuRef}>
              <button
                className="ns-btn-folder"
                onClick={() => setFolderMenuOpen((v) => !v)}
                disabled={loading}
                data-tip="选择要挂载到容器的本地文件夹"
              >
                <FolderOpen size={14} />
                {workspacePath && (
                  <>
                    <span className="ns-folder-label">
                      {folderName(workspacePath)}
                    </span>
                    <ChevronDown size={12} />
                  </>
                )}
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

            <button
              className="ns-btn-icon"
              disabled={loading}
              onClick={handleFileSelect}
              data-tip="上传文件或图片"
            >
              <Paperclip size={14} />
            </button>

            <div className="ns-skills-wrapper" ref={plusMenuRef}>
              <button
                className="ns-btn-icon"
                disabled={loading}
                onClick={() => setPlusMenuOpen((v) => !v)}
                data-tip="调用技能"
              >
                <Sparkles size={14} />
              </button>

              {plusMenuOpen && (
                <div className="ns-plus-menu">
                  <SkillMenu onSelect={handleSkillInsert} />
                </div>
              )}
            </div>
          </div>

          <div className="ns-toolbar-right">
            <CustomSelect
              options={MODEL_OPTIONS}
              value={model}
              onChange={setModel}
              disabled={loading}
              position="above"
            />
            <button
              className={`ns-btn-privacy${anonymous ? " active" : ""}`}
              onClick={() => setAnonymous((v) => !v)}
              disabled={loading}
              data-tip={anonymous ? "隐私模式已开启 — 对话不保存" : "开启隐私模式"}
            >
              <ShieldCheck size={14} />
            </button>
            <button className="btn-go" disabled={!canSend} onClick={handleSend}>
              开始
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
