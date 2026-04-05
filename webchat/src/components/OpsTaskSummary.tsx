import { ArrowRight, BarChart3, Target, Trophy, Users } from "lucide-react";
import type { DashboardStats } from "../lib/ops-types";

export default function OpsTaskSummary({
  dashboardStats,
  onViewAll,
}: {
  dashboardStats?: DashboardStats | null;
  selectedTaskId?: string | null;
  onSelectTask?: (id: string | null) => void;
  onViewAll?: () => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const stats = dashboardStats ?? {
    totalTasks: 0,
    activeTasks: 0,
    totalAgents: 0,
    topScore: 0,
  };

  return (
    <div className="ops-section-stack">
      <section className="ops-section-card">
        <div className="ops-section-title">
          <BarChart3 size={14} />
          <span>任务摘要</span>
        </div>
        <div className="ops-metrics-grid ops-metrics-grid--compact">
          <div className="ops-metric-card">
            <span>总任务</span>
            <strong>{stats.totalTasks}</strong>
            <small>
              <Target size={12} />
              VM 任务池
            </small>
          </div>
          <div className="ops-metric-card">
            <span>活跃任务</span>
            <strong>{stats.activeTasks}</strong>
            <small>
              <Users size={12} />
              当前推进
            </small>
          </div>
          <div className="ops-metric-card">
            <span>参与 Agent</span>
            <strong>{stats.totalAgents}</strong>
            <small>
              <Users size={12} />
              团队协同
            </small>
          </div>
          <div className="ops-metric-card">
            <span>最高积分</span>
            <strong>{stats.topScore}</strong>
            <small>
              <Trophy size={12} />
              运行峰值
            </small>
          </div>
        </div>
      </section>

      <section className="ops-section-card ops-section-card--flush">
        <div className="ops-section-title ops-section-title--spread">
          <span className="ops-title-inline">
            <Target size={14} />
            <span>任务中心</span>
          </span>
          <button className="ops-link-btn" onClick={onViewAll}>
            打开任务页
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="ops-empty-card">Legacy JaMOSS 已移除，VM 任务服务接入中。</div>
      </section>
    </div>
  );
}

