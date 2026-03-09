import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader, RefreshCw, Users } from "lucide-react";
import { DEFAULT_OPENCLAW_SESSION_KEY } from "../lib/config";
import { fetchTeams, installTeam, type TeamTemplate, type TeamsResponse } from "../lib/teams";

function toSessionKey(leaderId: string): string {
  return `agent:${leaderId}:main`;
}

function getLeader(template: TeamTemplate): { id: string; name: string; role: string } | null {
  const leader =
    template.agents.find((agent) => agent.isLeader) ??
    template.agents.find((agent) => agent.id.trim().length > 0);

  if (!leader) return null;
  return { id: leader.id, name: leader.name, role: leader.role };
}

function getTemplateSessionKey(template: TeamTemplate, fallback = DEFAULT_OPENCLAW_SESSION_KEY): string {
  const leader = getLeader(template);
  return leader ? toSessionKey(leader.id) : fallback;
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
  const [installingTemplate, setInstallingTemplate] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);

  const loadTeams = useCallback(async () => {
    setError(null);
    try {
      const payload = await fetchTeams();
      setTeamsData(payload);
    } catch {
      setError("获取团队列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const installedTemplate = useMemo(() => {
    if (!teamsData?.installed) return null;
    return teamsData.available.find((item) => item.name === teamsData.installed) ?? null;
  }, [teamsData]);

  const installableTemplates = useMemo(() => {
    if (!teamsData) return [];
    return teamsData.available.filter((item) => item.name !== teamsData.installed);
  }, [teamsData]);

  const installedSessionKey = installedTemplate
    ? getTemplateSessionKey(installedTemplate, teamsData?.activeSessionKey || DEFAULT_OPENCLAW_SESSION_KEY)
    : null;

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

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载团队信息...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-container">
      <div className="panel-header">
        <Users size={16} />
        <h3>协作团队</h3>
        <button className="panel-refresh-btn" onClick={() => void loadTeams()} title="刷新团队列表">
          <RefreshCw size={14} />
        </button>
      </div>

      <section className="team-section">
        <h4 className="team-section-title">当前对话目标</h4>
        <div className="team-card-grid">
          <article className={`team-card${activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY ? " active" : ""}`}>
            <div className="team-card-head">
              <strong>默认助手</strong>
              {activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY && <CheckCircle2 size={14} className="team-active-icon" />}
            </div>
            <p className="team-card-desc">单 Agent 模式，适合日常问答和快速执行。</p>
            <div className="team-card-meta">角色 1 · 模型 OpenClaw Runtime</div>
            <button className="team-action-btn" onClick={() => onSwitchTeam(DEFAULT_OPENCLAW_SESSION_KEY)}>
              {activeSessionKey === DEFAULT_OPENCLAW_SESSION_KEY ? "当前对话中" : "对话"}
            </button>
          </article>

          {installedTemplate && installedSessionKey && (
            <article className={`team-card${activeSessionKey === installedSessionKey ? " active" : ""}`}>
              <div className="team-card-head">
                <strong>{installedTemplate.displayName}</strong>
                {activeSessionKey === installedSessionKey && <CheckCircle2 size={14} className="team-active-icon" />}
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
              <button className="team-action-btn" onClick={() => onSwitchTeam(installedSessionKey)}>
                {activeSessionKey === installedSessionKey ? "当前对话中" : "对话"}
              </button>
            </article>
          )}
        </div>
      </section>

      <section className="team-section">
        <h4 className="team-section-title">可安装模板</h4>
        {installableTemplates.length === 0 ? (
          <div className="panel-empty team-panel-empty">
            <Users size={24} />
            <span>当前没有可安装的新模板</span>
          </div>
        ) : (
          <div className="team-card-grid">
            {installableTemplates.map((template) => (
              <article key={template.name} className="team-card team-card-installable">
                <div className="team-card-head">
                  <strong>{template.displayName}</strong>
                  <span className="team-version">v{template.version}</span>
                </div>
                <p className="team-card-desc">{template.description || "安装后可在对话中切换到该团队 leader。"}</p>
                <div className="team-card-meta">角色 {template.agents.length} · 模型 OpenClaw Runtime</div>
                <button
                  className="team-install-btn"
                  disabled={Boolean(installingTemplate)}
                  onClick={() => void handleInstall(template.name)}
                >
                  {installingTemplate === template.name ? "安装中..." : "安装"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="team-panel-tip">💡 也可以在对话中说 "帮我创建一个研究团队" 自定义创建</div>

      {error && <div className="panel-error">{error}</div>}
    </div>
  );
}
