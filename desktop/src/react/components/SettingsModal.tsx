import {
  Brain,
  Bug,
  Cloud,
  Cpu,
  Download,
  FolderOpen,
  FolderSearch,
  HardDrive,
  ImagePlus,
  Info,
  Lock,
  MessageSquarePlus,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { selectFolder } from "../lib/cowork";
import { getSettings, updateSettings, GATEWAY_URL, MODEL_OPTIONS, THINKING_LEVELS, type AppSettings } from "../lib/config";
import { getToken } from "../lib/auth";
import { httpFetch } from "../lib/transport";
import { useSkills, setSkills, type SkillDefinition } from "../lib/skills";
import ConfirmDialog from "./ConfirmDialog";
import CustomSelect from "./CustomSelect";

type Tab = "general" | "model" | "memory" | "skills" | "feedback";

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
  { key: "feedback", label: "反馈", icon: MessageSquarePlus },
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
            <CustomSelect
              options={MODEL_OPTIONS}
              value={settings.defaultModel}
              onChange={(v) => handleChange({ defaultModel: v })}
            />
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
            <CustomSelect
              options={THINKING_LEVELS}
              value={settings.thinkingLevel}
              onChange={(v) => handleChange({ thinkingLevel: v })}
            />
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
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

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

  const toggleMemorySync = () => {
    const updated = { ...settings, memorySyncEnabled: !settings.memorySyncEnabled };
    updateSettings(updated);
    setSettings(updated);
  };

  const handleClearMemory = async () => {
    setConfirmAction({
      title: "清除记忆",
      message: "确认清除所有记忆数据？此操作不可恢复。",
      action: async () => {
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
      },
    });
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

      <div className="settings-item">
        <div className="settings-item-main">
          <div className="settings-item-info">
            <Cloud size={16} />
            <div>
              <div className="settings-item-label">记忆云端同步</div>
              <div className="settings-item-desc">
                开启后本地记忆将与云端同步，多设备共享上下文
              </div>
            </div>
          </div>
          <button
            className={`toggle ${settings.memorySyncEnabled ? "on" : ""}`}
            onClick={toggleMemorySync}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
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

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel="确认"
          danger
          onConfirm={() => {
            confirmAction.action();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
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

// ─── Tab: Feedback ──────────────────────────────────────

function FeedbackTab() {
  const [category, setCategory] = useState("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ number: number; url: string } | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressImage = useCallback((file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1920;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        const base64 = dataUrl.split(",")[1];
        const sizeBytes = Math.round((base64.length * 3) / 4);
        if (sizeBytes > 2 * 1024 * 1024) {
          reject(new Error("图片压缩后仍超过 2MB"));
          return;
        }
        resolve(base64);
      };
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = URL.createObjectURL(file instanceof File ? file : file);
    });
  }, []);

  const addImage = useCallback(async (file: File | Blob) => {
    if (images.length >= 3) return;
    try {
      const base64 = await compressImage(file);
      setImages((prev) => [...prev, base64]);
      setError("");
    } catch (e: any) {
      setError(e.message || "图片处理失败");
    }
  }, [images.length, compressImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) addImage(blob);
        break;
      }
    }
  }, [addImage]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImage(file);
    e.target.value = "";
  }, [addImage]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      setError("请填写标题和描述");
      return;
    }
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      let version = "unknown";
      try {
        version = await getVersion();
      } catch {}

      const tok = getToken();
      const resp = await httpFetch(`${GATEWAY_URL}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({
          category,
          title: title.trim(),
          description: description.trim(),
          images,
          version,
        }),
      });

      if (resp.status !== 200) {
        const data = JSON.parse(resp.body);
        throw new Error(data.error || "提交失败");
      }

      const data = JSON.parse(resp.body);
      setResult({ number: data.issue_number, url: data.issue_url });
      setTitle("");
      setDescription("");
      setImages([]);
      setCategory("bug");
    } catch (e: any) {
      setError(e.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const CATEGORIES = [
    { value: "bug", label: "Bug 报告" },
    { value: "feature", label: "功能建议" },
    { value: "question", label: "使用问题" },
    { value: "other", label: "其他" },
  ];

  return (
    <div className="settings-section" onPaste={handlePaste}>
      <div className="settings-section-title">提交反馈</div>

      <div className="settings-feedback-form">
        <CustomSelect
          options={CATEGORIES}
          value={category}
          onChange={setCategory}
        />

        <input
          type="text"
          className="settings-feedback-input"
          placeholder="简要描述问题或建议"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <textarea
          className="settings-feedback-textarea"
          placeholder="详细描述...（支持 Markdown）"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="settings-feedback-images-section">
          {images.length > 0 && (
            <div className="settings-feedback-images">
              {images.map((img, i) => (
                <div key={i} className="settings-feedback-thumb">
                  <img src={`data:image/jpeg;base64,${img}`} alt={`截图 ${i + 1}`} />
                  <button className="settings-feedback-thumb-delete" onClick={() => removeImage(i)}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length < 3 && (
            <button
              className="settings-btn-outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={13} />
              添加截图
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          {images.length === 0 && (
            <span className="settings-feedback-paste-hint">可直接粘贴剪贴板截图</span>
          )}
        </div>

        {error && <div className="settings-hint" style={{ paddingLeft: 0, color: "var(--danger)" }}>{error}</div>}
        {result && (
          <div className="settings-hint success" style={{ paddingLeft: 0 }}>
            ✓ 反馈已提交 {result.number > 0 ? `(#${result.number})` : ""}
          </div>
        )}

        <div className="settings-feedback-footer">
          <span className="settings-feedback-footer-hint">反馈将同步到 GitHub Issues，自动附带版本号</span>
          <button
            className="settings-feedback-submit"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !description.trim()}
          >
            {submitting ? "提交中..." : "提交反馈"}
          </button>
        </div>
      </div>
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
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

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
    setConfirmAction({
      title: "删除技能",
      message: `确认删除技能「${skill.name}」？此操作不可恢复。`,
      action: async () => {
        setDeleting(id);
        try {
          await invoke("delete_user_skill", { skillId: id });
          setSkills(skills.filter((s) => s.id !== id));
        } catch (err) {
          console.error("Failed to delete skill:", err);
        } finally {
          setDeleting(null);
        }
      },
    });
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

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel="确认"
          danger
          onConfirm={() => {
            confirmAction.action();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
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
            {tab === "feedback" && <FeedbackTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
