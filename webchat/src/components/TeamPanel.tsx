import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Edit3,
  Loader,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { DEFAULT_OPENCLAW_SESSION_KEY } from "../lib/config";
import {
  fetchTeams,
  installTeam,
  fetchProfileDetail,
  createProfile,
  updateProfile,
  deleteProfile,
  type AgentProfile,
  type ProfileDetail,
  type TeamsResponse,
  type TeamTemplate,
} from "../lib/teams";
import { getTemplateSessionKey } from "../lib/team-utils";

/* ── constants ──────────────────────────────────────────────── */

const PROFILE_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  sparkles: Sparkles,
  "pen-tool": Sparkles,
};

const ICON_OPTIONS = [
  { value: "bot", label: "🤖 Bot" },
  { value: "sparkles", label: "✨ Sparkles" },
  { value: "pen-tool", label: "✏️ Pen Tool" },
];

const KNOWN_FILES = [
  { key: "SOUL.md", label: "性格 (SOUL)" },
  { key: "IDENTITY.md", label: "身份 (IDENTITY)" },
  { key: "USER.md", label: "用户 (USER)" },
  { key: "AGENTS.md", label: "工作指引 (AGENTS)" },
  { key: "TOOLS.md", label: "工具 (TOOLS)" },
  { key: "HEARTBEAT.md", label: "心跳 (HEARTBEAT)" },
  { key: "MEMORY.md", label: "记忆 (MEMORY)" },
];

function blankDetail(): ProfileDetail {
  return {
    type: "agent",
    name: "",
    displayName: "",
    description: "",
    icon: "bot",
    model: "proxy/gpt-5.4",
    skills: [],
    workspace: "",
    files: {},
  };
}

/* ── small components ───────────────────────────────────────── */

function ProfileIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Icon = PROFILE_ICONS[icon] || Bot;
  return <Icon size={size} />;
}

function TypeBadge({ type }: { type: "agent" | "team" }) {
  return (
    <span className={`team-type-badge team-type-badge--${type}`}>
      {type === "agent" ? "agent" : "team"}
    </span>
  );
}

/* ── profile editor ─────────────────────────────────────────── */

function ProfileEditor({
  detail,
  isCreate,
  saving,
  onSave,
  onCancel,
}: {
  detail: ProfileDetail;
  isCreate: boolean;
  saving: boolean;
  onSave: (d: ProfileDetail) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProfileDetail>({ ...detail, files: { ...detail.files } });
  const [filesOpen, setFilesOpen] = useState(false);

  const activeFileKeys = useMemo(
    () => KNOWN_FILES.filter((f) => f.key in form.files).map((f) => f.key),
    [form.files],
  );

  const addableFiles = useMemo(
    () => KNOWN_FILES.filter((f) => !(f.key in form.files)),
    [form.files],
  );

  const setField = <K extends keyof ProfileDetail>(key: K, value: ProfileDetail[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setFile = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, files: { ...prev.files, [key]: value } }));

  const removeFile = (key: string) =>
    setForm((prev) => {
      const next = { ...prev.files };
      delete next[key];
      return { ...prev, files: next };
    });

  const addFile = (key: string) => {
    setFile(key, "");
    setFilesOpen(true);
  };

  return (
    <div className="team-editor">
      <div className="team-editor-field">
        <label className="team-editor-label">name</label>
        <input
          className="team-editor-input"
          value={form.name}
          disabled={!isCreate}
          placeholder="英文标识 (如 writer)"
          onChange={(e) => setField("name", e.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">displayName</label>
        <input
          className="team-editor-input"
          value={form.displayName}
          placeholder="显示名称"
          onChange={(e) => setField("displayName", e.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">description</label>
        <input
          className="team-editor-input"
          value={form.description}
          placeholder="简短描述"
          onChange={(e) => setField("description", e.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">icon</label>
        <select
          className="team-editor-input"
          value={form.icon}
          onChange={(e) => setField("icon", e.target.value)}
        >
          {ICON_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">model</label>
        <input
          className="team-editor-input"
          value={form.model}
          placeholder="proxy/gpt-5.4"
          onChange={(e) => setField("model", e.target.value)}
        />
      </div>

      {/* ── personality files ── */}
      <div className="team-editor-files">
        <button
          className="team-editor-files-toggle"
          onClick={() => setFilesOpen((v) => !v)}
          type="button"
        >
          {filesOpen ? "▾" : "▸"} 人设文件 ({activeFileKeys.length})
        </button>

        {filesOpen && (
          <>
            {activeFileKeys.map((key) => {
              const meta = KNOWN_FILES.find((f) => f.key === key);
              return (
                <div key={key} className="team-editor-field">
                  <div className="team-editor-file-header">
                    <label className="team-editor-label">{meta?.label ?? key}</label>
                    <button
                      className="team-editor-file-remove"
                      onClick={() => removeFile(key)}
                      title="移除"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <textarea
                    className="team-editor-textarea"
                    rows={5}
                    value={form.files[key] ?? ""}
                    onChange={(e) => setFile(key, e.target.value)}
                  />
                </div>
              );
            })}

            {addableFiles.length > 0 && (
              <div className="team-editor-field">
                <select
                  className="team-editor-input"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addFile(e.target.value);
                  }}
                >
                  <option value="">＋ 添加文件...</option>
                  {addableFiles.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      <div className="team-editor-actions">
        <button
          className="team-action-btn"
          disabled={saving || !form.name.trim()}
          onClick={() => onSave(form)}
        >
          {saving ? <Loader size={14} className="spin-icon" /> : <Save size={14} />}
          <span>{saving ? "保存中..." : "保存"}</span>
        </button>
        <button className="team-install-btn" onClick={onCancel} disabled={saving}>
          <X size={14} />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}

/* ── main panel ─────────────────────────────────────────────── */

export default function TeamPanel({
  activeSessionKey,
  onSwitchTeam,
}: {
  activeSessionKey: string;
  onSwitchTeam: (sessionKey: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const [installingTemplate, setInstallingTemplate] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProfileDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setError(null);
    try {
      const payload = await fetchTeams();
      setTeamsData(payload);
    } catch {
      setError("获取列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const profiles: AgentProfile[] = useMemo(() => teamsData?.profiles ?? [], [teamsData]);

  const installedTemplate: TeamTemplate | null = useMemo(() => {
    if (!teamsData?.installed) return null;
    return teamsData.available.find((item) => item.name === teamsData.installed) ?? null;
  }, [teamsData]);

  const installableTemplates: TeamTemplate[] = useMemo(() => {
    if (!teamsData) return [];
    return teamsData.available.filter((item) => item.name !== teamsData.installed);
  }, [teamsData]);

  const installedSessionKey = installedTemplate
    ? getTemplateSessionKey(installedTemplate, teamsData?.activeSessionKey || DEFAULT_OPENCLAW_SESSION_KEY)
    : null;

  /* ── handlers ── */

  const handleInstall = useCallback(
    async (templateName: string) => {
      setInstallingTemplate(templateName);
      setError(null);
      try {
        await installTeam(templateName);
        await loadTeams();
      } catch {
        setError("安装团队失败");
      } finally {
        setInstallingTemplate(null);
      }
    },
    [loadTeams],
  );

  const handleCreate = () => {
    setEditing(null);
    setCreating(true);
  };

  const handleEdit = async (name: string) => {
    setError(null);
    try {
      const detail = await fetchProfileDetail(name);
      setCreating(false);
      setEditing(detail);
    } catch {
      setError("加载配置失败");
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确定删除 Agent「${name}」？此操作不可恢复。`)) return;
    setDeleting(name);
    setError(null);
    try {
      await deleteProfile(name);
      await loadTeams();
    } catch {
      setError("删除失败");
    } finally {
      setDeleting(null);
    }
  };

  const handleSave = async (detail: ProfileDetail) => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        await createProfile(detail);
      } else {
        await updateProfile(detail.name, detail);
      }
      setCreating(false);
      setEditing(null);
      await loadTeams();
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setCreating(false);
    setEditing(null);
  };

  /* ── render ── */

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  const editorDetail = creating ? blankDetail() : editing;
  const showEditor = creating || editing !== null;

  return (
    <div className="panel-container">
      <div className="panel-header">
        <Users size={16} />
        <h3>Agent &amp; 团队</h3>
        <button className="panel-refresh-btn" onClick={() => void loadTeams()} title="刷新">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ═══ Agent Section ═══ */}
      <section className="team-section">
        <div className="team-section-header">
          <h4 className="team-section-title">🤖 Agent</h4>
          <button className="team-create-btn" onClick={handleCreate} title="新建 Agent">
            <Plus size={13} />
            <span>新建 Agent</span>
          </button>
        </div>

        {showEditor && editorDetail && (
          <ProfileEditor
            detail={editorDetail}
            isCreate={creating}
            saving={saving}
            onSave={(d) => void handleSave(d)}
            onCancel={handleCancelEdit}
          />
        )}

        <div className="team-card-grid">
          {profiles.map((profile) => {
            const isActive = activeSessionKey === profile.sessionKey;
            const isDeleting = deleting === profile.name;
            return (
              <article key={profile.name} className={`team-card${isActive ? " active" : ""}`}>
                <div className="team-card-head">
                  <ProfileIcon icon={profile.icon} />
                  <strong>{profile.displayName}</strong>
                  <TypeBadge type="agent" />
                  {isActive && <CheckCircle2 size={14} className="team-active-icon" />}
                </div>
                <p className="team-card-desc">{profile.description}</p>
                <div className="team-card-actions">
                  <button
                    className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                    onClick={() => onSwitchTeam(profile.sessionKey)}
                  >
                    {isActive ? "继续对话" : <><span>开始对话</span><ArrowRight size={13} /></>}
                  </button>
                  <button
                    className="team-secondary-btn"
                    onClick={() => void handleEdit(profile.name)}
                    title="编辑"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    className="team-secondary-btn team-secondary-btn--danger"
                    onClick={() => void handleDelete(profile.name)}
                    disabled={isDeleting}
                    title="删除"
                  >
                    {isDeleting ? <Loader size={13} className="spin-icon" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </article>
            );
          })}

          {/* Fallback default agent (shown when no profiles) */}
          {profiles.length === 0 && (
            <article className={`team-card${activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY ? " active" : ""}`}>
              <div className="team-card-head">
                <Bot size={14} />
                <strong>默认助手</strong>
                <TypeBadge type="agent" />
                {activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY && (
                  <CheckCircle2 size={14} className="team-active-icon" />
                )}
              </div>
              <p className="team-card-desc">单 Agent 模式，适合日常问答和快速执行。</p>
              <div className="team-card-actions">
                <button
                  className={`team-action-btn${activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY ? " team-action-btn--active" : ""}`}
                  onClick={() => onSwitchTeam(DEFAULT_OPENCLAW_SESSION_KEY)}
                >
                  {activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY ? "继续对话" : <><span>开始对话</span><ArrowRight size={13} /></>}
                </button>
              </div>
            </article>
          )}
        </div>
      </section>

      {/* ═══ Team Section ═══ */}
      <section className="team-section">
        <h4 className="team-section-title">👥 团队</h4>

        <div className="team-card-grid">
          {/* Installed template */}
          {installedTemplate && installedSessionKey && (
            <article className={`team-card${activeSessionKey === installedSessionKey ? " active" : ""}`}>
              <div className="team-card-head">
                <Users size={14} />
                <strong>{installedTemplate.displayName}</strong>
                <TypeBadge type="team" />
                {activeSessionKey === installedSessionKey && (
                  <CheckCircle2 size={14} className="team-active-icon" />
                )}
              </div>
              <p className="team-card-desc">
                {installedTemplate.description || "已安装协作团队，包含多个角色协同完成复杂任务。"}
              </p>
              <div className="team-card-meta">
                角色 {installedTemplate.agents.length} · 版本 {installedTemplate.version}
              </div>
              <ul className="team-role-list">
                {installedTemplate.agents.map((agent) => (
                  <li key={agent.id}>
                    <span>{agent.name}</span>
                    <em>{agent.role}</em>
                  </li>
                ))}
              </ul>
              <div className="team-card-actions">
                <button
                  className={`team-action-btn${activeSessionKey === installedSessionKey ? " team-action-btn--active" : ""}`}
                  onClick={() => onSwitchTeam(installedSessionKey)}
                >
                  {activeSessionKey === installedSessionKey ? "继续对话" : <><span>开始对话</span><ArrowRight size={13} /></>}
                </button>
              </div>
            </article>
          )}

          {/* Installable templates */}
          {installableTemplates.map((template) => (
            <article key={template.name} className="team-card team-card-installable">
              <div className="team-card-head">
                <strong>{template.displayName}</strong>
                <TypeBadge type="team" />
                <span className="team-version">v{template.version}</span>
              </div>
              <p className="team-card-desc">
                {template.description || "安装后可在对话中切换到该团队 leader。"}
              </p>
              <div className="team-card-meta">角色 {template.agents.length}</div>
              <div className="team-card-actions">
                <button
                  className="team-install-btn"
                  disabled={Boolean(installingTemplate)}
                  onClick={() => void handleInstall(template.name)}
                >
                  {installingTemplate === template.name ? "安装中..." : "安装"}
                </button>
              </div>
            </article>
          ))}

          {!installedTemplate && installableTemplates.length === 0 && (
            <p className="team-card-desc">暂无可用团队模板</p>
          )}
        </div>
      </section>

      <div className="team-panel-tip">💡 也可以在对话中说 "帮我创建一个研究团队" 自定义创建</div>

      {error && <div className="panel-error">{error}</div>}
    </div>
  );
}
