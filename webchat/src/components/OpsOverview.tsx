import { AlertTriangle, Sparkles, Target, Trophy, Users } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import type { DashboardStats } from "../lib/ops-types";

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
};

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

function getAgentState(agent: AgentSummary): "working" | "thinking" | "idle" {
  const latest = latestActionTime(agent);
  if (agent.current_sub_task && agent.recent_actions.length > 0) return "working";
  if (latest !== null && Date.now() - latest <= 30_000) return "thinking";
  return "idle";
}

function getRiskItems(agents: AgentSummary[], dashboardStats: DashboardStats | null): string[] {
  const items: string[] = [];
  const workingAgents = agents.filter((agent) => getAgentState(agent) === "working");
  const reviewerCount = agents.filter((agent) => agent.role === "reviewer").length;

  if (agents.length === 0) {
    items.push("团队还没有活跃 Agent，无法形成协作闭环。");
  }
  if (dashboardStats && dashboardStats.activeTasks > 0 && workingAgents.length === 0) {
    items.push("当前存在活跃任务，但没有 Agent 处于执行态，可能需要重新分配。");
  }
  if (agents.length > 0 && reviewerCount === 0) {
    items.push("当前团队缺少审查角色，任务完成后可能缺少质量兜底。");
  }

  return items.slice(0, 3).map((item) => item.trim());
}

export default function OpsOverview({
  agentSummaries,
  dashboardStats,
  selectedAgentId,
  onAgentClick,
}: {
  agentSummaries: AgentSummary[];
  dashboardStats: DashboardStats | null;
  selectedAgentId?: string | null;
  onAgentClick?: (id: string | null) => void;
}) {
  const riskItems = getRiskItems(agentSummaries, dashboardStats);

  return (
    <div className="ops-section-stack">
      <section className="ops-section-card">
        <div className="ops-section-title">
          <Sparkles size={14} />
          <span>团队概览</span>
        </div>
        <div className="ops-metrics-grid">
          <div className="ops-metric-card">
            <span>在线 Agent</span>
            <strong>{dashboardStats?.totalAgents ?? agentSummaries.length}</strong>
            <small>协作角色数</small>
          </div>
          <div className="ops-metric-card">
            <span>活跃任务</span>
            <strong>{dashboardStats?.activeTasks ?? 0}</strong>
            <small>当前推进中</small>
          </div>
          <div className="ops-metric-card">
            <span>最高积分</span>
            <strong>{dashboardStats?.topScore ?? 0}</strong>
            <small>团队峰值</small>
          </div>
        </div>
      </section>

      <section className="ops-section-card">
        <div className="ops-section-title">
          <Users size={14} />
          <span>Agent 状态</span>
        </div>
        <div className="ops-agent-list">
          {agentSummaries.map((agent) => {
            const state = getAgentState(agent);
            const active = selectedAgentId === agent.id;
            return (
              <button
                key={agent.id}
                className={`ops-agent-card${active ? " active" : ""}`}
                onClick={() => onAgentClick?.(active ? null : agent.id)}
              >
                <div className="ops-agent-card-head">
                  <span className={`ops-agent-role ops-agent-role--${agent.role}`}>{ROLE_LABELS[agent.role] ?? agent.role}</span>
                  <span className={`ops-agent-state ops-agent-state--${state}`}>
                    {state === "working" ? "工作中" : state === "thinking" ? "思考中" : "空闲"}
                  </span>
                </div>
                <strong>{agent.name}</strong>
                <p>{agent.current_sub_task ? `当前: ${agent.current_sub_task.name}` : "当前: 暂无任务"}</p>
                <div className="ops-agent-card-meta">
                  <span>
                    <Trophy size={12} />
                    {agent.total_score} pt
                  </span>
                  <span>
                    <Target size={12} />
                    {agent.today_request_count} 请求
                  </span>
                </div>
              </button>
            );
          })}
          {agentSummaries.length === 0 && <div className="ops-empty-card">暂无 Agent 状态数据</div>}
        </div>
      </section>

      <section className="ops-section-card">
        <div className="ops-section-title">
          <AlertTriangle size={14} />
          <span>运营风险</span>
        </div>
        <div className="ops-risk-list">
          {riskItems.length === 0 && <div className="ops-risk-item ops-risk-item--ok">当前未发现明显协作风险。</div>}
          {riskItems.map((item) => (
            <div key={item} className="ops-risk-item">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
