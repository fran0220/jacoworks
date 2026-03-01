import {
  Brain,
  Bug,
  Cpu,
  Download,
  FolderOpen,
  FolderSearch,
  HardDrive,
  Info,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { selectFolder } from "../lib/cowork";
import { getSettings, updateSettings, MODEL_OPTIONS, THINKING_LEVELS, type AppSettings } from "../lib/config";
import { useSkills, setSkills, type SkillDefinition } from "../lib/skills";

type Tab = "general" | "model" | "memory" | "skills";

interface MemoryStats {
  path: string;
  file_count: number;
  total_bytes: number;
}

export interface SettingsModalProps {
  onClose: () => void;
  /** 关闭设置并跳转新会话，自动填入引导消息 */
  onCreateSkill?: () => void;
  /** 关闭设置并跳转新会话，发送 GitHub 安装指令 */
  onInstallSkill?: (url: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TABS: { key: Tab; label: string; icon: typeof Settings }[] = [
  { key: "general", label: "通用", icon: Settings },
  { key: "model", label: "模型", icon: Cpu },
  { key: "memory", label: "记忆", icon: Brain },
  { key: "skills", label: "技能", icon: Sparkles },
];

// ─── Tab: General ───────────────────────────────────────

function GeneralTab() {
  const [settings, setSettings] = useState(getSettings);
  const [version, setVersion] = useState("0.1.0");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "latest" | "available" | "error"
  >("idle");

  useEffect(() => {
    if (isTauri()) {
      getVersion().then(setVersion).catch(() => {});
    }
  }, []);

  const handleSelectWorkspace = async () => {
    const selected = await selectFolder();
    if (selected) {
      const updated = { ...settings, defaultWorkspace: selected };
      updateSettings(updated);
      setSettings(updated);
    }
  };

  const handleClearWorkspace = () => {
    const updated = { ...settings, defaultWorkspace: "" };
    updateSettings(updated);
    setSettings(updated);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking");
    try {
      const update = await check();
      if (update) {
        setUpdateStatus("available");
      } else {
        setUpdateStatus("latest");
      }
    } catch {
      setUpdateStatus("error");
    }
  };

  const handleOpenReleases = async () => {
    if (isTauri()) {
      await openUrl("https://jaco.jingao.club/download");
    }
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">工作区</div>
        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <FolderOpen size={16} />
              <div>
                <div className="settings-item-label">默认工作目录</div>
                <div className="settings-item-desc">
                  新会话自动使用此目录作为工作区
                </div>
              </div>
            </div>
            <button className="settings-btn-outline" onClick={handleSelectWorkspace}>
              选择文件夹
            </button>
          </div>
          {settings.defaultWorkspace && (
            <div className="settings-workspace-path">
              <FolderOpen size={13} />
              <span title={settings.defaultWorkspace}>
                {settings.defaultWorkspace}
              </span>
              <button className="settings-btn-clear" onClick={handleClearWorkspace}>
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">关于</div>
        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <Info size={16} />
              <div>
                <div className="settings-item-label">JAcoworks</div>
                <div className="settings-item-desc">v{version}</div>
              </div>
            </div>
            <button
              className="settings-btn-outline"
              onClick={handleCheckUpdate}
              disabled={updateStatus === "checking"}
            >
              <RefreshCw
                size={13}
                className={updateStatus === "checking" ? "spinning" : ""}
              />
              检查更新
            </button>
          </div>
          {updateStatus === "latest" && (
            <div className="settings-hint success">✓ 当前已是最新版本</div>
          )}
          {updateStatus === "available" && (
            <div className="settings-hint success">发现新版本，已打开下载页面</div>
          )}
          {updateStatus === "error" && (
            <div className="settings-hint">
              无法自动检查 ·{" "}
              <button className="settings-link" onClick={handleOpenReleases}>
                前往下载页面
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Tab: Model ─────────────────────────────────────────

function ModelTab() {
  const [settings, setSettings] = useState(getSettings);
  const [restartHint, setRestartHint] = useState(false);

  const handleChange = (patch: Partial<AppSettings>) => {
    const updated = { ...settings, ...patch };
    updateSettings(updated);
    setSettings(updated);
    setRestartHint(true);
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">模型配置</div>

        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <Cpu size={16} />
              <div>
                <div className="settings-item-label">默认模型</div>
                <div className="settings-item-desc">
                  新会话使用的默认 AI 模型
                </div>
              </div>
            </div>
            <select
              className="settings-select"
              value={settings.defaultModel}
              onChange={(e) => handleChange({ defaultModel: e.target.value })}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <Brain size={16} />
              <div>
                <div className="settings-item-label">思考等级</div>
                <div className="settings-item-desc">
                  控制模型的深度推理程度，等级越高回复越慢但质量更好
                </div>
              </div>
            </div>
            <select
              className="settings-select"
              value={settings.thinkingLevel}
              onChange={(e) => handleChange({ thinkingLevel: e.target.value })}
            >
              {THINKING_LEVELS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {restartHint && (
          <div className="settings-hint">新会话生效</div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">调试</div>

        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <Bug size={16} />
              <div>
                <div className="settings-item-label">调试日志</div>
                <div className="settings-item-desc">
                  在界面底部显示 Agent RPC 通信日志
                </div>
              </div>
            </div>
            <button
              className={`toggle ${settings.debugLogEnabled ? "on" : ""}`}
              onClick={() => handleChange({ debugLogEnabled: !settings.debugLogEnabled })}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Tab: Memory ────────────────────────────────────────

function MemoryTab() {
  const [settings, setSettings] = useState(getSettings);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  useEffect(() => {
    if (isTauri()) {
      invoke<MemoryStats>("get_memory_stats")
        .then(setMemoryStats)
        .catch(() => {});
    }
  }, []);

  const toggleMemory = () => {
    const next = !settings.memoryEnabled;
    const updated = { ...settings, memoryEnabled: next };
    updateSettings(updated);
    setSettings(updated);
    setRestartHint(true);
  };

  const handleClearMemory = async () => {
    if (!window.confirm("确认清除所有记忆数据？此操作不可恢复。")) return;
    setClearing(true);
    try {
      await invoke("clear_memory");
      const stats = await invoke<MemoryStats>("get_memory_stats");
      setMemoryStats(stats);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">记忆系统</div>

      <div className="settings-item">
        <div className="settings-item-main">
          <div className="settings-item-info">
            <HardDrive size={16} />
            <div>
              <div className="settings-item-label">启用记忆</div>
              <div className="settings-item-desc">
                自动记录对话摘要，为 Agent 提供上下文记忆
              </div>
            </div>
          </div>
          <button
            className={`toggle ${settings.memoryEnabled ? "on" : ""}`}
            onClick={toggleMemory}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
        {restartHint && (
          <div className="settings-hint">重启 Agent 后生效</div>
        )}
      </div>

      {memoryStats && (
        <div className="settings-item">
          <div className="settings-item-main">
            <div className="settings-item-info">
              <Package size={16} />
              <div>
                <div className="settings-item-label">存储用量</div>
                <div className="settings-item-desc">
                  {memoryStats.file_count} 个文件 · {formatBytes(memoryStats.total_bytes)}
                </div>
              </div>
            </div>
          </div>
          <div className="settings-memory-meta">
            <span className="settings-meta-path" title={memoryStats.path}>
              {memoryStats.path}
            </span>
          </div>
        </div>
      )}

      <div className="settings-item">
        <button
          className="settings-btn-danger"
          onClick={handleClearMemory}
          disabled={clearing}
          style={{ marginLeft: 0 }}
        >
          <Trash2 size={13} />
          {clearing ? "清除中..." : "清除所有记忆"}
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Skills ────────────────────────────────────────

function UserSkillCard({
  skill,
  onDelete,
  onReveal,
}: {
  skill: SkillDefinition;
  onDelete: (id: string) => void;
  onReveal: (id: string) => void;
}) {
  return (
    <div className="settings-skill-card">
      <div className="settings-skill-header">
        <div className="settings-skill-title">
          <span className="settings-skill-name">{skill.name}</span>
          <span className="settings-skill-badge user">
            <Pencil size={10} /> 自建
          </span>
        </div>
        <div className="settings-skill-actions">
          <button
            className="settings-skill-action"
            onClick={() => onReveal(skill.id)}
            title="在文件管理器中打开"
          >
            <FolderSearch size={14} />
          </button>
          <button
            className="settings-skill-action danger"
            onClick={() => onDelete(skill.id)}
            title="删除技能"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="settings-skill-desc">{skill.description}</div>
      {skill.group && (
        <span className="settings-skill-group">{skill.group}</span>
      )}
    </div>
  );
}

function BuiltinSkillCard({ skill }: { skill: SkillDefinition }) {
  return (
    <div className="settings-skill-card builtin">
      <div className="settings-skill-header">
        <div className="settings-skill-title">
          <span className="settings-skill-name">{skill.name}</span>
          <span className="settings-skill-badge builtin">
            <Lock size={10} /> 内置
          </span>
        </div>
      </div>
      <div className="settings-skill-desc">{skill.description}</div>
      {skill.group && (
        <span className="settings-skill-group">{skill.group}</span>
      )}
    </div>
  );
}

function SkillsTab({
  onCreateSkill,
  onInstallSkill,
}: {
  onCreateSkill?: () => void;
  onInstallSkill?: (url: string) => void;
}) {
  const skills = useSkills();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");

  const { builtin, user } = useMemo(() => {
    const b: SkillDefinition[] = [];
    const u: SkillDefinition[] = [];
    for (const s of skills) {
      if (s.source === "user") u.push(s);
      else b.push(s);
    }
    return { builtin: b, user: u };
  }, [skills]);

  const handleDelete = useCallback(async (id: string) => {
    const skill = skills.find((s) => s.id === id);
    if (!skill) return;
    if (!window.confirm(`确认删除技能「${skill.name}」？此操作不可恢复。`)) return;

    setDeleting(id);
    try {
      await invoke("delete_user_skill", { skillId: id });
      // Remove from local cache immediately
      setSkills(skills.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Failed to delete skill:", err);
    } finally {
      setDeleting(null);
    }
  }, [skills]);

  const handleReveal = useCallback(async (id: string) => {
    try {
      await invoke("reveal_user_skill", { skillId: id });
    } catch (err) {
      console.error("Failed to reveal skill:", err);
    }
  }, []);

  return (
    <>
      {/* User skills */}
      <div className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-title">
            自建技能
            <span className="settings-section-count">{user.length}</span>
          </div>
          {onCreateSkill && (
            <button className="settings-btn-outline" onClick={onCreateSkill}>
              <Plus size={13} />
              新建
            </button>
          )}
        </div>

        {onInstallSkill && (
          <div className="settings-skill-install">
            <input
              type="text"
              className="settings-skill-install-input"
              placeholder="粘贴 GitHub 链接安装技能…"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && githubUrl.trim()) {
                  onInstallSkill(githubUrl.trim());
                  setGithubUrl("");
                }
              }}
            />
            <button
              className="settings-btn-outline"
              disabled={!githubUrl.trim()}
              onClick={() => {
                if (githubUrl.trim()) {
                  onInstallSkill(githubUrl.trim());
                  setGithubUrl("");
                }
              }}
            >
              <Download size={13} />
              安装
            </button>
          </div>
        )}

        {user.length === 0 ? (
          <div className="settings-skill-empty">
            <Sparkles size={24} />
            <div>暂无自建技能</div>
            <div className="settings-skill-empty-hint">
              点击「新建」或粘贴 GitHub 链接安装技能
            </div>
          </div>
        ) : (
          <div className="settings-skill-list">
            {user.map((s) => (
              <UserSkillCard
                key={s.id}
                skill={s}
                onDelete={deleting ? () => {} : handleDelete}
                onReveal={handleReveal}
              />
            ))}
          </div>
        )}
      </div>

      {/* Built-in skills */}
      <div className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-title">
            内置技能
            <span className="settings-section-count">{builtin.length}</span>
          </div>
        </div>

        {builtin.length === 0 ? (
          <div className="settings-skill-empty">
            <Package size={24} />
            <div>暂无内置技能</div>
          </div>
        ) : (
          <div className="settings-skill-list">
            {builtin.map((s) => (
              <BuiltinSkillCard key={s.id} skill={s} />
            ))}
          </div>
        )}
      </div>

      <div className="settings-skill-footer">
        修改技能后需新建会话以加载更新
      </div>
    </>
  );
}

// ─── Main Modal ─────────────────────────────────────────

export default function SettingsModal({ onClose, onCreateSkill, onInstallSkill }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`settings-nav-item ${tab === key ? "active" : ""}`}
                onClick={() => setTab(key)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === "general" && <GeneralTab />}
            {tab === "model" && <ModelTab />}
            {tab === "memory" && <MemoryTab />}
            {tab === "skills" && <SkillsTab onCreateSkill={onCreateSkill} onInstallSkill={onInstallSkill} />}
          </div>
        </div>
      </div>
    </div>
  );
}
