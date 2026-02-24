import { ArrowRight, ChevronDown, FolderOpen, Paperclip, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "../lib/config";
import { folderName, selectFolder } from "../lib/cowork";
import { createSession } from "../lib/sessions";
import type { ChatSession } from "../types";

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

export default function NewSessionPanel({
  onSessionCreated,
}: {
  onSessionCreated: (session: ChatSession, firstMessage: string) => void;
}) {
  const [task, setTask] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillsSubOpen, setSkillsSubOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>(getRecentFolders);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = task.trim().length > 0 && !loading;

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

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    try {
      const session = await createSession({ model, workspacePath: workspacePath || undefined });
      onSessionCreated(session, task.trim());
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

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setPlusMenuOpen(false);
    setSkillsSubOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name).join(", ");
    setTask((prev) => prev + (prev ? "\n" : "") + `[附件: ${names}]`);
    e.target.value = "";
  };

  const handleSkillInsert = (skillId: string) => {
    const insertion = `/${skillId} `;
    setTask((prev) => prev + insertion);
    setPlusMenuOpen(false);
    setSkillsSubOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="new-session">
      <div className="ns-header">
        <h1>开始新的任务</h1>
      </div>

      <div className="ns-input-card">
        <textarea
          ref={textareaRef}
          rows={3}
          disabled={loading}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
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
              <button
                className="ns-btn-plus"
                disabled={loading}
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.toml,.html,.css,.go,.rs,.sh,.pdf,.doc,.docx,.xls,.xlsx"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
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
