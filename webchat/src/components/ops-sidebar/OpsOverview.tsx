import { type AgentSummary } from "../../lib/feed";

interface OpsOverviewProps {
  agents: AgentSummary[];
  onAgentClick: (id: string) => void;
}

export default function OpsOverview({ agents, onAgentClick }: OpsOverviewProps) {
  return (
    <div className="ops-section-stack">
      <h3 className="ops-section-title">Agent 状态</h3>
      <div className="ops-agent-list">
        {agents.map((agent) => (
          <button
            key={agent.id}
            className="ops-agent-card"
            onClick={() => onAgentClick(agent.id)}
          >
            <div className="ops-agent-card-head">
              <strong className="agent-name">{agent.name}</strong>
              <span className={`ops-agent-state--${agent.current_sub_task ? "working" : "idle"}`}>
                {agent.current_sub_task ? "工作中" : "空闲"}
              </span>
            </div>
            {agent.current_sub_task && (
              <p className="agent-current-task">{agent.current_sub_task.name}</p>
            )}
            <div className="ops-agent-card-meta">
              <span>积分: {agent.total_score}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
