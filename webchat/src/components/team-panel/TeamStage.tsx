import {
  ArrowRight,
  CheckCircle2,
  Loader,
  Map,
  Users,
} from "lucide-react";
import type { TeamTemplate } from "../../lib/teams";

interface TeamStageProps {
  templates: TeamTemplate[];
  activeTemplate: TeamTemplate | null;
  spotlightTemplate: TeamTemplate | null;
  managementOpen: boolean;
  launchingTemplate: string | null;
  onToggleManagement: () => void;
  onOpenVillage: (template: TeamTemplate) => void;
  onSelectSpotlight: (template: TeamTemplate) => void;
  onLaunchTeam: (template: TeamTemplate) => void;
}

export default function TeamStage({
  templates,
  activeTemplate,
  spotlightTemplate,
  managementOpen,
  launchingTemplate,
  onToggleManagement,
  onOpenVillage,
  onSelectSpotlight,
  onLaunchTeam,
}: TeamStageProps) {
  return (
    <div className="team-stage-shell">
      <section className="team-stage-hero">
        <div className="team-stage-copy">
          <span className="team-stage-kicker">Team Village</span>
          <h4>先看活的小镇，再决定进入哪支队伍</h4>
          <p>
            {spotlightTemplate
              ? `当前精选「${spotlightTemplate.label}」，先看协作舞台和队伍气质，再决定进入实时协作还是下沉到管理面板调整角色。`
              : "team 入口默认展示协作模板和小镇舞台，管理能力下沉到次级面板。"}
          </p>
        </div>
        <div className="team-stage-actions">
          {spotlightTemplate && (
            <button
              className="team-action-btn"
              type="button"
              onClick={() => onOpenVillage(spotlightTemplate)}
            >
              <Map size={13} />
              <span>打开小镇</span>
            </button>
          )}
          <button
            className={`team-install-btn${managementOpen ? " team-install-btn--active" : ""}`}
            type="button"
            onClick={onToggleManagement}
          >
            <Users size={13} />
            <span>{managementOpen ? "收起管理面板" : "打开管理面板"}</span>
          </button>
        </div>
      </section>

      {spotlightTemplate && (
        <section className="team-spotlight-card">
          <div className="team-spotlight-head">
            <div>
              <span className="team-spotlight-icon" aria-hidden="true">
                {spotlightTemplate.icon || "🏘️"}
              </span>
              <div className="team-spotlight-title">
                <strong>{spotlightTemplate.label}</strong>
                <span>
                  角色 {spotlightTemplate.members.length} · 版本{" "}
                  {spotlightTemplate.version}
                </span>
              </div>
            </div>
            {activeTemplate?.id === spotlightTemplate.id && (
              <span className="team-live-pill">
                <CheckCircle2 size={14} />
                <span>当前正在协作</span>
              </span>
            )}
          </div>
          <p className="team-spotlight-desc">
            {spotlightTemplate.description ||
              "多 Agent 协作模板，适合把复杂任务拆分给不同角色并由 leader 汇总。"}
          </p>
          <ul className="team-spotlight-members">
            {spotlightTemplate.members.map((member) => (
              <li key={`${spotlightTemplate.id}-${member.name}`}>
                <span>{member.name}</span>
                <em>{member.role || member.mode || "member"}</em>
              </li>
            ))}
          </ul>
          <div className="team-spotlight-actions">
            <button
              className={`team-action-btn${activeTemplate?.id === spotlightTemplate.id ? " team-action-btn--active" : ""}`}
              disabled={
                Boolean(launchingTemplate) &&
                launchingTemplate !== spotlightTemplate.id
              }
              onClick={() => onLaunchTeam(spotlightTemplate)}
            >
              {launchingTemplate === spotlightTemplate.id ? (
                <>
                  <Loader size={13} className="spin-icon" />
                  <span>启动中...</span>
                </>
              ) : activeTemplate?.id === spotlightTemplate.id ? (
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
              onClick={() => onOpenVillage(spotlightTemplate)}
            >
              <Map size={13} />
              <span>进入小镇</span>
            </button>
          </div>
        </section>
      )}

      {templates.length > 1 && (
        <section className="team-template-strip">
          {templates.map((template) => {
            const isActive = template.id === spotlightTemplate?.id;
            return (
              <button
                key={template.id}
                type="button"
                className={`team-template-pill${isActive ? " active" : ""}`}
                onClick={() => onSelectSpotlight(template)}
              >
                <span>{template.icon || "🏘️"}</span>
                <strong>{template.label}</strong>
                <em>{template.members.length} 角色</em>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
