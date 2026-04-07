import { type AgentSummary } from "../lib/feed";

interface TeamPresenceBarProps {
  agents: AgentSummary[];
}

export default function TeamPresenceBar({ agents }: TeamPresenceBarProps) {
  return (
    <div className="presence-bar">
      {agents.map((agent) => (
        <div key={agent.id} className="presence-chip">
          <span className={`presence-dot presence-dot--${getStatusClass(agent)}`} />
          <span className="presence-name">{agent.name}</span>
          <span className="presence-status">{getStatusText(agent)}</span>
        </div>
      ))}
    </div>
  );
}

function getStatusClass(agent: AgentSummary): string {
  const latestTs = agent.recent_actions[0]?.timestamp;
  const recent = isRecent(latestTs);
  if (agent.current_sub_task && recent) return "working";
  if (recent) return "thinking";
  return "idle";
}

function getStatusText(agent: AgentSummary): string {
  const latestTs = agent.recent_actions[0]?.timestamp;
  const recent = isRecent(latestTs);
  if (agent.current_sub_task && recent) return "工作中";
  if (recent) return "思考中";
  return "空闲";
}

function isRecent(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() < 30000;
}
