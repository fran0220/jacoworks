import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import { DEFAULT_MODEL, MODEL_OPTIONS, getSettings } from "../lib/config";
import { folderName, selectFolder } from "../lib/cowork";
import { addRecentFolder, getRecentFolders } from "../lib/recentFolders";
import { createSession } from "../lib/sessions";
import { useSkills } from "../lib/skills";
import type { AttachedFile, ChatSession } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const binaryDocExts = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return imageExts.has(ext);
}

function isBinaryDocFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return binaryDocExts.has(ext);
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
  const [workspacePath, setWorkspacePath] = useState(() => getSettings().defaultWorkspace);
  const [loading, setLoading] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const skills = useSkills();
  const grouped = useMemo(() => {
    const map = new Map<string, typeof skills>();
    for (const s of skills) {
      const g = s.group || "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [skills]);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>(getRecentFolders);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Close menus on outside click
  useEffect(() => {
    if (!plusMenuOpen && !folderMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuOpen && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
      if (folderMenuOpen && folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [plusMenuOpen, folderMenuOpen]);

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    try {
      const session = await createSession({ model, workspacePath: workspacePath || undefined });
      onSessionCreated(session, task.trim() || "(附件)", files);
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

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setPlusMenuOpen(false);
  };

  const handleFileChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const selected = event.target.files;
    if (!selected) return;

    const list = Array.from(selected);
    const rejected = list.filter((f) => f.size > MAX_FILE_SIZE);
    const accepted = list.filter((f) => f.size <= MAX_FILE_SIZE);

    for (const f of rejected) {
      addWarning(`${f.name} 超过 10 MB 限制`);
    }

    if (accepted.length === 0) {
      event.target.value = "";
      return;
    }

    setReadingCount((c) => c + accepted.length);

    const incoming: AttachedFile[] = [];
    for (const file of accepted) {
      try {
        if (isImageFile(file)) {
          incoming.push({
            name: file.name,
            type: "image",
            data: await readAsDataURL(file),
            size: file.size,
          });
        } else if (isBinaryDocFile(file)) {
          incoming.push({
            name: file.name,
            type: "binary",
            data: "",
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
      } catch {
        addWarning(`${file.name} 读取失败`);
      }
    }

    setReadingCount((c) => c - accepted.length);
    setFiles((prev) => [...prev, ...incoming]);
    event.target.value = "";
  };

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

  return (
    <div className="new-session">
      <div className="ns-header">
        <h1>开始新的任务</h1>
      </div>

      <div className="ns-input-card">
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
            {files.map((file, index) =>
              file.type === "image" ? (
                <div className="attach-thumb" key={`${file.name}-${index}`}>
                  <img src={file.data} alt={file.name} className="attach-thumb-img" />
                  <button
                    className="attach-thumb-remove"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X size={12} />
                  </button>
                  <div className="attach-thumb-name" title={file.name}>{file.name}</div>
                </div>
              ) : (
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
              ),
            )}

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
                accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.toml,.html,.css,.go,.rs,.sh,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <button
                className="ns-btn-plus"
                disabled={loading}
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
                  <div className="ns-menu-item-hover">
                    <div className="ns-menu-item ns-menu-item-sub">
                      <Sparkles size={18} />
                      <span>功能</span>
                      <ChevronDown size={14} className="ns-sub-arrow" />
                    </div>
                    <div className="ns-skills-submenu">
                      <div className="ns-skills-submenu-content">
                        {Array.from(grouped.entries()).map(([group, items]) =>
                          group ? (
                            <div key={group} className="ns-group-hover">
                              <div className="ns-group-trigger">
                                <span>{group}</span>
                                <ChevronDown size={14} className="ns-sub-arrow" />
                              </div>
                              <div className="ns-group-skills">
                                <div className="ns-group-skills-content">
                                  {items.map((skill) => (
                                    <button
                                      key={skill.id}
                                      className="ns-skill-item"
                                      onClick={() => handleSkillInsert(skill.id)}
                                    >
                                      <span className="ns-skill-name">/{skill.id}</span>
                                      <span className="ns-skill-desc">{skill.description}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            items.map((skill) => (
                              <button
                                key={skill.id}
                                className="ns-skill-item"
                                onClick={() => handleSkillInsert(skill.id)}
                              >
                                <span className="ns-skill-name">/{skill.id}</span>
                                <span className="ns-skill-desc">{skill.description}</span>
                              </button>
                            ))
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="ns-toolbar-right">
            <div className="ns-model-picker">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={loading}
                className="model-select ns-model-select"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
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
