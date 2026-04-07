import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Edit3,
  Loader,
  Map,
  Plus,
  Trash2,
} from "lucide-react";
import { DEFAULT_SESSION_KEY } from "../../lib/config";
import type {
  AgentPreset,
  AgentProfile,
  ProfileDetail,
  TeamTemplate,
} from "../../lib/teams";
import { matchesTemplateSessionKey } from "../../lib/team-utils";
import ProfileEditor from "./ProfileEditor";
import { PRESET_DESCRIPTIONS } from "./constants";
import { ProfileIcon, TypeBadge } from "./ProfileMeta";

interface TeamManagementPanelProps {
  managementOpen: boolean;
  showEditor: boolean;
  editorDetail: ProfileDetail | null;
  creating: boolean;
  saving: boolean;
  deleting: string | null;
  presets: AgentPreset[];
  profiles: AgentProfile[];
  templates: TeamTemplate[];
  activeSessionKey: string;
  launchingTemplate: string | null;
  onManagementToggle: (nextOpen: boolean) => void;
  onCreate: () => void;
  onSave: (detail: ProfileDetail) => void;
  onCancelEdit: () => void;
  onSwitchTeam: (sessionKey: string) => void;
  onEditProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onLaunchTeam: (template: TeamTemplate) => void;
  onOpenVillage: (template: TeamTemplate) => void;
}

export default function TeamManagementPanel({
  managementOpen,
  showEditor,
  editorDetail,
  creating,
  saving,
  deleting,
  presets,
  profiles,
  templates,
  activeSessionKey,
  launchingTemplate,
  onManagementToggle,
  onCreate,
  onSave,
  onCancelEdit,
  onSwitchTeam,
  onEditProfile,
  onDeleteProfile,
  onLaunchTeam,
  onOpenVillage,
}: TeamManagementPanelProps) {
  return (
    <details
      className={`team-management-shell${managementOpen ? " is-open" : ""}`}
      open={managementOpen}
      onToggle={(event) => {
        onManagementToggle((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="team-management-summary">
        <div>
          <span className="team-management-kicker">Studio Control</span>
          <strong>Agent / Team 管理面板</strong>
        </div>
        <span>{managementOpen ? "收起" : "展开"}</span>
      </summary>

      <div className="team-management-body">
        <section className="team-section">
          <div className="team-section-header">
            <h4 className="team-section-title">🤖 Agent</h4>
            <button
              className="team-create-btn"
              onClick={onCreate}
              title="新建 Agent"
              type="button"
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
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          )}

          <div className="team-card-grid">
            {presets.map((preset) => {
              const isActive = activeSessionKey === preset.workspaceKey;
              return (
                <article key={preset.id} className={`team-card${isActive ? " active" : ""}`}>
                  <div className="team-card-head">
                    <ProfileIcon icon={preset.icon} />
                    <strong>{preset.label}</strong>
                    <TypeBadge type="agent" />
                    {isActive && <CheckCircle2 size={14} className="team-active-icon" />}
                  </div>
                  <p className="team-card-desc">
                    {PRESET_DESCRIPTIONS[preset.id] ||
                      "按线程隔离的专家预设，适合在不同角色间快速切换。"}
                  </p>
                  <div className="team-card-actions">
                    <button
                      className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                      onClick={() => onSwitchTeam(preset.workspaceKey)}
                      type="button"
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
                    {isActive && <CheckCircle2 size={14} className="team-active-icon" />}
                  </div>
                  <p className="team-card-desc">{profile.description}</p>
                  <div className="team-card-actions">
                    <button
                      className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                      onClick={() => onSwitchTeam(profile.sessionKey)}
                      type="button"
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
                      onClick={() => onEditProfile(profile.name)}
                      title="编辑"
                      type="button"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      className="team-secondary-btn team-secondary-btn--danger"
                      onClick={() => onDeleteProfile(profile.name)}
                      disabled={isDeleting}
                      title="删除"
                      type="button"
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
                <p className="team-card-desc">单 Agent 模式，适合日常问答和快速执行。</p>
                <div className="team-card-actions">
                  <button
                    className={`team-action-btn${activeSessionKey === DEFAULT_SESSION_KEY ? " team-action-btn--active" : ""}`}
                    onClick={() => onSwitchTeam(DEFAULT_SESSION_KEY)}
                    type="button"
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
          <h4 className="team-section-title">👥 团队模板库</h4>
          <div className="team-card-grid">
            {templates.map((template) => {
              const isActive = matchesTemplateSessionKey(template, activeSessionKey);
              return (
                <article key={template.id} className={`team-card${isActive ? " active" : ""}`}>
                  <div className="team-card-head">
                    <span aria-hidden="true">{template.icon || "👥"}</span>
                    <strong>{template.label}</strong>
                    <TypeBadge type="team" />
                    {isActive && <CheckCircle2 size={14} className="team-active-icon" />}
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
                  <div className="team-card-actions team-card-actions--team">
                    <button
                      className={`team-action-btn${isActive ? " team-action-btn--active" : ""}`}
                      disabled={
                        Boolean(launchingTemplate) && launchingTemplate !== template.id
                      }
                      onClick={() => onLaunchTeam(template)}
                      type="button"
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
                    <button
                      className="team-mini-btn"
                      type="button"
                      onClick={() => onOpenVillage(template)}
                    >
                      <Map size={13} />
                      <span>进入小镇</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </details>
  );
}
