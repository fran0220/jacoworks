import {
  ChevronDown,
  FileText,
  FolderOpen,
  Image,
  Paperclip,
  Plus,
  SendHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import { MODEL_OPTIONS } from "../lib/config";
import { folderName, selectFolder } from "../lib/cowork";
import type { AttachedFile } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

const SKILLS = [
  { id: "data-analysis", name: "数据分析", description: "数据清洗、可视化与统计分析" },
  { id: "document-processing", name: "文档处理", description: "文档格式转换与内容提取" },
  { id: "marketing", name: "营销助手", description: "营销文案与策略生成" },
  { id: "finance", name: "财务分析", description: "财务报表分析与建议" },
  { id: "legal", name: "法律助手", description: "法律文书审查与建议" },
];

const RECENT_FOLDERS_KEY = "jacoworks_recent_folders";
const MAX_RECENT = 6;

function getRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentFolder(path: string) {
  const recent = getRecentFolders().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

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
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillsSubOpen, setSkillsSubOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>(getRecentFolders);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);

  const sendDisabled = isStreaming || (!text.trim() && files.length === 0);

  // Close menus on outside click
  useEffect(() => {
    if (!plusMenuOpen && !folderMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuOpen && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
        setSkillsSubOpen(false);
      }
      if (folderMenuOpen && folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [plusMenuOpen, folderMenuOpen]);

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
    setSkillsSubOpen(false);
  };

  const handleSkillInsert = (skillId: string) => {
    setText((prev) => prev + `/${skillId} `);
    setPlusMenuOpen(false);
    setSkillsSubOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="composer-card">
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
              accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.toml,.html,.css,.go,.rs,.sh,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={onFileChange}
              style={{ display: "none" }}
            />
            <button
              className="ns-btn-plus"
              disabled={isStreaming}
              onClick={() => {
                setPlusMenuOpen((v) => !v);
                setSkillsSubOpen(false);
              }}
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
                <button
                  className={`ns-menu-item ns-menu-item-sub ${skillsSubOpen ? "active" : ""}`}
                  onClick={() => setSkillsSubOpen((v) => !v)}
                >
                  <Sparkles size={18} />
                  <span>功能</span>
                  <ChevronDown size={14} className="ns-sub-arrow" />
                </button>

                {skillsSubOpen && (
                  <div className="ns-skills-submenu">
                    {SKILLS.map((skill) => (
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
                )}
              </div>
            )}
          </div>
        </div>

        <div className="composer-toolbar-right">
          <div className="ns-model-picker">
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={isStreaming}
              className="model-select ns-model-select"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
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
