import type { AgentSummary } from "../lib/feed";

const ROLE_LABELS: Record<string, string> = {
  planner: "规划",
  executor: "执行",
  reviewer: "审查",
  patrol: "巡查",
};

type PresenceState = "working" | "thinking" | "idle";

function latestActionTime(agent: AgentSummary): number | null {
  let latest: number | null = null;

  for (const action of agent.recent_actions) {
    if (!action.timestamp) continue;
    const value = new Date(action.timestamp).getTime();
    if (Number.isNaN(value)) continue;
    if (latest === null || value > latest) {
      latest = value;
    }
  }

  return latest;
}

function getPresenceState(agent: AgentSummary): PresenceState {
  const latest = latestActionTime(agent);

  if (agent.current_sub_task && agent.recent_actions.length > 0) {
    return "working";
  }

  if (latest !== null && Date.now() - latest <= 30_000) {
    return "thinking";
  }

  return "idle";
}

function getPresenceText(state: PresenceState): string {
  if (state === "working") return "工作中";
  if (state === "thinking") return "思考中";
  return "空闲";
}

export default function TeamPresenceBar({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="presence-bar" aria-label="团队在线状态">
      {agents.length === 0 && <div className="presence-empty">团队尚未就绪</div>}
      {agents.map((agent) => {
        const state = getPresenceState(agent);
        return (
          <div key={agent.id} className="presence-chip">
            <span className={`presence-dot presence-dot--${state}`} />
            <span className="presence-name">{agent.name}</span>
            <span className="presence-role">{ROLE_LABELS[agent.role] ?? agent.role}</span>
            <span className="presence-status">{getPresenceText(state)}</span>
          </div>
        );
      })}
    </div>
  );
}
