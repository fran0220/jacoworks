import { ArrowRight, Bot, Plus, Sparkles, Users, Wifi, WifiOff } from "lucide-react";

interface AgentCard {
  sessionKey: string;
  name: string;
  displayName: string;
  icon: string;
}

interface TeamCard {
  sessionKey: string;
  name: string;
  displayName: string;
  agentCount: number;
}

interface DashboardViewProps {
  agents: AgentCard[];
  teams: TeamCard[];
  connState: "disconnected" | "connecting" | "connected";
  onSelectChannel: (sessionKey: string) => void;
  onCreateAgent: () => void;
  onCreateTeam: () => void;
}

const ICON_MAP: Record<string, typeof Bot> = {
  bot: Bot,
  sparkles: Sparkles,
};

function getConnLabel(state: string): string {
  if (state === "connected") return "已连接";
  if (state === "connecting") return "连接中";
  return "未连接";
}

export default function DashboardView({
  agents,
  teams,
  connState,
  onSelectChannel,
  onCreateAgent,
  onCreateTeam,
}: DashboardViewProps) {
  return (
    <div className="db-shell">
      <header className="db-status-bar">
        <div className={`db-conn-pill db-conn-pill--${connState}`}>
          {connState === "connected" ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{getConnLabel(connState)}</span>
        </div>
        <div className="db-stats">
          <span className="db-stat">
            <Bot size={14} />
            <span>{agents.length} 助手</span>
          </span>
          <span className="db-stat">
            <Users size={14} />
            <span>{teams.length} 团队</span>
          </span>
        </div>
      </header>

      <section className="db-section">
        <h3 className="db-section-title">助手</h3>
        {agents.length === 0 && (
          <p className="db-empty">还没有助手，创建一个开始吧。</p>
        )}
        <div className="db-grid">
          {agents.map((agent) => {
            const Icon = ICON_MAP[agent.icon] ?? Bot;
            return (
              <article
                key={agent.sessionKey}
                className="db-card"
                onClick={() => onSelectChannel(agent.sessionKey)}
              >
                <div className="db-card-icon">
                  <Icon size={20} />
                </div>
                <div className="db-card-body">
                  <strong className="db-card-name">{agent.displayName}</strong>
                  <span className="db-card-id">{agent.name}</span>
                </div>
                <span className="db-card-enter">
                  进入对话 <ArrowRight size={14} />
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="db-section">
        <h3 className="db-section-title">团队</h3>
        {teams.length === 0 && (
          <p className="db-empty">还没有团队，安装一个模板开始协作。</p>
        )}
        <div className="db-grid">
          {teams.map((team) => (
            <article
              key={team.sessionKey}
              className="db-card"
              onClick={() => onSelectChannel(team.sessionKey)}
            >
              <div className="db-card-icon db-card-icon--team">
                <Users size={20} />
              </div>
              <div className="db-card-body">
                <strong className="db-card-name">{team.displayName}</strong>
                <span className="db-card-id">{team.agentCount} 位成员</span>
              </div>
              <span className="db-card-enter">
                进入对话 <ArrowRight size={14} />
              </span>
            </article>
          ))}
        </div>
      </section>

      <footer className="db-footer">
        <button className="db-create-btn" onClick={onCreateAgent}>
          <Plus size={14} />
          <span>创建助手</span>
        </button>
        <button className="db-create-btn db-create-btn--team" onClick={onCreateTeam}>
          <Plus size={14} />
          <span>创建团队</span>
        </button>
      </footer>
    </div>
  );
}
