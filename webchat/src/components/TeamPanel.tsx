import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Code2,
  CheckCircle2,
  Edit3,
  Loader,
  PenTool,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { DEFAULT_SESSION_KEY } from "../lib/config";
import {
  createProfile,
  createTeamWorkspace,
  deleteProfile,
  fetchAgentPresets,
  fetchProfileDetail,
  fetchTeams,
  updateProfile,
  type AgentPreset,
  type AgentProfile,
  type ProfileDetail,
  type TeamsResponse,
  type TeamTemplate,
} from "../lib/teams";
import { matchesTemplateSessionKey } from "../lib/team-utils";

const PROFILE_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  code: Code2,
  search: Search,
  "pen-tool": PenTool,
  sparkles: Sparkles,
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  default: "通用单 Agent 模式，适合日常问答、快速执行和自由探索。",
  researcher: "偏研究与事实核验，适合检索、比对来源和形成结构化结论。",
  coder: "偏工程实现，关注正确性、边界条件、可维护性与验证步骤。",
  writer: "偏内容表达，擅长结构组织、语气适配和更自然的成稿输出。",
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
  const [form, setForm] = useState<ProfileDetail>({
    ...detail,
    files: { ...detail.files },
  });
  const [filesOpen, setFilesOpen] = useState(false);

  const activeFileKeys = useMemo(
    () => KNOWN_FILES.filter((f) => f.key in form.files).map((f) => f.key),
    [form.files],
  );

  const addableFiles = useMemo(
    () => KNOWN_FILES.filter((f) => !(f.key in form.files)),
    [form.files],
  );

  const setField = <K extends keyof ProfileDetail>(
    key: K,
    value: ProfileDetail[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

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
                    <label className="team-editor-label">
                      {meta?.label ?? key}
                    </label>
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
          {saving ? (
            <Loader size={14} className="spin-icon" />
          ) : (
            <Save size={14} />
          )}
          <span>{saving ? "保存中..." : "保存"}</span>
        </button>
        <button
          className="team-install-btn"
          onClick={onCancel}
          disabled={saving}
        >
          <X size={14} />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}

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
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [launchingTemplate, setLaunchingTemplate] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<ProfileDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setError(null);
    try {
      const [payload, agentPresets] = await Promise.all([
        fetchTeams(),
        fetchAgentPresets(),
      ]);
      setTeamsData(payload);
      setPresets(agentPresets);
    } catch {
      setError("获取列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const profiles: AgentProfile[] = useMemo(
    () => teamsData?.profiles ?? [],
    [teamsData],
  );
  const templates: TeamTemplate[] = useMemo(
    () => teamsData?.templates ?? [],
    [teamsData],
  );

  const handleLaunchTeam = useCallback(
    async (template: TeamTemplate) => {
      if (matchesTemplateSessionKey(template, activeSessionKey)) {
        onSwitchTeam(activeSessionKey);
        return;
      }

      setLaunchingTemplate(template.id);
      setError(null);
      try {
        const created = await createTeamWorkspace(template.id);
        onSwitchTeam(created.workspaceKey);
      } catch {
        setError("启动团队失败");
      } finally {
        setLaunchingTemplate(null);
      }
    },
    [activeSessionKey, onSwitchTeam],
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
        <button
          className="panel-refresh-btn"
          onClick={() => void loadTeams()}
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div className="panel-error">{error}</div>}

      <section className="team-section">
        <div className="team-section-header">
          <h4 className="team-section-title">🤖 Agent</h4>
          <button
            className="team-create-btn"
            onClick={handleCreate}
            title="新建 Agent"
          >
            <Plus size={13} />
            <span>新建 Agent</span>
          </button>
        </div>

        {showEditor && editorDetail && (
          <ProfileEditor
            detail={editorDetail}
            isCreate={creating}
            saving={saving}
            onSave={(detail) => void handleSave(detail)}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        )}

        <div className="team-card-grid">
          {presets.map((preset) => {
            const isActive = activeSessionKey === preset.workspaceKey;
            return (
              <article
                key={preset.id}
                className={`team-card${isActive ? " active" : ""}`}
              >
                <div className="team-card-head">
                  <ProfileIcon icon={preset.icon} />
                  <strong>{preset.label}</strong>
                  <TypeBadge type="agent" />
                  {isActive && (
                    <CheckCircle2 size={14} className="team-active-icon" />
                  )}
                </div>
                <p className="team-card-desc">
                  {PRESET_DESCRIPTIONS[preset.id] ||
                    "按线程隔离的专家预设，适合在不同角色间快速切换。"}
                </p>
                <div className="team-card-actions">
                  <button
                    className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                    onClick={() => onSwitchTeam(preset.workspaceKey)}
                  >
                    {isActive ? (
                      "继续对话"
                    ) : (
                      <>
                        <span>开始对话</span>
                        <ArrowRight size={13} />
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}

          {profiles.map((profile) => {
            const isActive = activeSessionKey === profile.sessionKey;
            const isDeleting = deleting === profile.name;
            return (
              <article
                key={profile.name}
                className={`team-card${isActive ? " active" : ""}`}
              >
                <div className="team-card-head">
                  <ProfileIcon icon={profile.icon} />
                  <strong>{profile.displayName}</strong>
                  <TypeBadge type="agent" />
                  {isActive && (
                    <CheckCircle2 size={14} className="team-active-icon" />
                  )}
                </div>
                <p className="team-card-desc">{profile.description}</p>
                <div className="team-card-actions">
                  <button
                    className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                    onClick={() => onSwitchTeam(profile.sessionKey)}
                  >
                    {isActive ? (
                      "继续对话"
                    ) : (
                      <>
                        <span>开始对话</span>
                        <ArrowRight size={13} />
                      </>
                    )}
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
                    {isDeleting ? (
                      <Loader size={13} className="spin-icon" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </div>
              </article>
            );
          })}

          {presets.length === 0 && profiles.length === 0 && (
            <article
              className={`team-card${activeSessionKey === DEFAULT_SESSION_KEY ? " active" : ""}`}
            >
              <div className="team-card-head">
                <Bot size={14} />
                <strong>默认助手</strong>
                <TypeBadge type="agent" />
                {activeSessionKey === DEFAULT_SESSION_KEY && (
                  <CheckCircle2 size={14} className="team-active-icon" />
                )}
              </div>
              <p className="team-card-desc">
                单 Agent 模式，适合日常问答和快速执行。
              </p>
              <div className="team-card-actions">
                <button
                  className={`team-action-btn${activeSessionKey === DEFAULT_SESSION_KEY ? " team-action-btn--active" : ""}`}
                  onClick={() => onSwitchTeam(DEFAULT_SESSION_KEY)}
                >
                  {activeSessionKey === DEFAULT_SESSION_KEY ? (
                    "继续对话"
                  ) : (
                    <>
                      <span>开始对话</span>
                      <ArrowRight size={13} />
                    </>
                  )}
                </button>
              </div>
            </article>
          )}
        </div>
      </section>

      <section className="team-section">
        <h4 className="team-section-title">👥 团队</h4>

        <div className="team-card-grid">
          {templates.map((template) => {
            const isActive = matchesTemplateSessionKey(
              template,
              activeSessionKey,
            );
            return (
              <article
                key={template.id}
                className={`team-card${isActive ? " active" : ""}`}
              >
                <div className="team-card-head">
                  <span aria-hidden="true">{template.icon || "👥"}</span>
                  <strong>{template.label}</strong>
                  <TypeBadge type="team" />
                  {isActive && (
                    <CheckCircle2 size={14} className="team-active-icon" />
                  )}
                </div>
                <p className="team-card-desc">
                  {template.description ||
                    "多 Agent 协作模板，适合把复杂任务拆分给不同角色并由 leader 汇总。"}
                </p>
                <div className="team-card-meta">
                  角色 {template.members.length} · 版本 {template.version}
                </div>
                <ul className="team-role-list">
                  {template.members.map((member) => (
                    <li key={`${template.id}-${member.name}`}>
                      <span>{member.name}</span>
                      <em>{member.role || member.mode || "member"}</em>
                    </li>
                  ))}
                </ul>
                <div className="team-card-actions">
                  <button
                    className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                    disabled={
                      Boolean(launchingTemplate) &&
                      launchingTemplate !== template.id
                    }
                    onClick={() => void handleLaunchTeam(template)}
                  >
                    {launchingTemplate === template.id ? (
                      <>
                        <Loader size={13} className="spin-icon" />
                        <span>启动中...</span>
                      </>
                    ) : isActive ? (
                      "继续协作"
                    ) : (
                      <>
                        <span>启动团队</span>
                        <ArrowRight size={13} />
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
