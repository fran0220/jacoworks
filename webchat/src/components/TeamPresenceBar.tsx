import { Lock } from "lucide-react";
import type { AgentSummary } from "../lib/feed";

const ROLE_LABELS: Record<string, string> = {
  planner: "规划",
  executor: "执行",
  reviewer: "审查",
  patrol: "巡查",
  "crew-planner": "规划",
  "crew-worker": "执行",
  "crew-reviewer": "审查",
};

type PresenceState = "working" | "thinking" | "idle" | "stuck";

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
  if (agent.presence_state === "stuck") {
    return "stuck";
  }

  if (agent.presence_state === "active") {
    return "working";
  }

  if (agent.presence_state === "idle") {
    return "idle";
  }

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
  if (state === "stuck") return "卡住";
  return "空闲";
}

function formatReservationHint(agent: AgentSummary): string | null {
  const reservedPaths = agent.reserved_paths ?? [];
  if (reservedPaths.length === 0) return null;
  const first = reservedPaths[0]?.split("/").filter(Boolean).pop() ?? reservedPaths[0] ?? "文件工位";
  return reservedPaths.length > 1 ? `${first} +${reservedPaths.length - 1}` : first;
}

export default function TeamPresenceBar({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="presence-bar" aria-label="团队在线状态">
      {agents.length === 0 && <div className="presence-empty">团队尚未就绪</div>}
      {agents.map((agent) => {
        const state = getPresenceState(agent);
        const reservationHint = formatReservationHint(agent);
        return (
          <div key={agent.id} className="presence-chip">
            <span className={`presence-dot presence-dot--${state}`} />
            <span className="presence-name">{agent.name}</span>
            <span className="presence-role">{ROLE_LABELS[agent.role] ?? agent.role}</span>
            <span className="presence-status">{getPresenceText(state)}</span>
            {reservationHint && (
              <span
                className="presence-reserve"
                title={(agent.reserved_paths ?? []).join("\n")}
              >
                <Lock size={12} />
                <span>{reservationHint}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
