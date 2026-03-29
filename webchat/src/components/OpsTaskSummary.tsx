import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BarChart3, Loader, RefreshCw, Target, Trophy, Users } from "lucide-react";
import { fetchDashboardStats, fetchTasks, type DashboardStats, type TaskItem } from "../lib/jamoss";

function formatTaskStatus(value: string): string {
  return (
    {
      planning: "规划中",
      active: "进行中",
      in_progress: "推进中",
      completed: "已完成",
      archived: "已归档",
      cancelled: "已取消",
    }[value] ?? value
  );
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "未更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未更新";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function OpsTaskSummary({
  dashboardStats,
  selectedTaskId,
  onSelectTask,
  onViewAll,
  onRefresh,
}: {
  dashboardStats?: DashboardStats | null;
  selectedTaskId?: string | null;
  onSelectTask?: (id: string | null) => void;
  onViewAll?: () => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const [internalStats, setInternalStats] = useState<DashboardStats | null>(dashboardStats ?? null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, taskPage] = await Promise.all([
        dashboardStats ? Promise.resolve(dashboardStats) : fetchDashboardStats(),
        fetchTasks({ page: 1, page_size: 5, sort_by: "updated_at", sort_order: "desc" }),
      ]);
      setInternalStats(stats);
      setTasks(taskPage.items);
      setError(null);
    } catch {
      setError("任务摘要加载失败");
    } finally {
      setLoading(false);
    }
  }, [dashboardStats]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (dashboardStats) {
      setInternalStats(dashboardStats);
    }
  }, [dashboardStats]);

  const stats = dashboardStats ?? internalStats;

  return (
    <div className="ops-section-stack">
      <section className="ops-section-card">
        <div className="ops-section-title ops-section-title--spread">
          <span className="ops-title-inline">
            <BarChart3 size={14} />
            <span>任务摘要</span>
          </span>
          <button
            className="ops-inline-action"
            onClick={() => {
              void onRefresh?.();
              void loadSummary();
            }}
            title="刷新任务摘要"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="ops-metrics-grid ops-metrics-grid--compact">
          <div className="ops-metric-card">
            <span>总任务</span>
            <strong>{stats?.totalTasks ?? 0}</strong>
            <small>
              <Target size={12} />
              工作池规模
            </small>
          </div>
          <div className="ops-metric-card">
            <span>活跃任务</span>
            <strong>{stats?.activeTasks ?? 0}</strong>
            <small>
              <Users size={12} />
              正在推进
            </small>
          </div>
          <div className="ops-metric-card">
            <span>参与 Agent</span>
            <strong>{stats?.totalAgents ?? 0}</strong>
            <small>
              <Users size={12} />
              团队协同
            </small>
          </div>
          <div className="ops-metric-card">
            <span>最高积分</span>
            <strong>{stats?.topScore ?? 0}</strong>
            <small>
              <Trophy size={12} />
              当前峰值
            </small>
          </div>
        </div>
      </section>

      <section className="ops-section-card ops-section-card--flush">
        <div className="ops-section-title ops-section-title--spread">
          <span className="ops-title-inline">
            <Target size={14} />
            <span>最近任务</span>
          </span>
          <button className="ops-link-btn" onClick={onViewAll}>
            查看全部
            <ArrowRight size={14} />
          </button>
        </div>

        {loading && (
          <div className="ops-inline-loading">
            <Loader size={15} className="spin-icon" />
            <span>加载任务中…</span>
          </div>
        )}

        {!loading && tasks.length === 0 && <div className="ops-empty-card">暂无任务记录</div>}

        {tasks.length > 0 && (
          <div className="ops-task-list">
            {tasks.map((task) => (
              <button
                key={task.id}
                className={`ops-task-item${selectedTaskId === task.id ? " active" : ""}`}
                onClick={() => onSelectTask?.(selectedTaskId === task.id ? null : task.id)}
              >
                <div className="ops-task-item-head">
                  <strong>{task.name}</strong>
                  <span className={`ops-task-status ops-task-status--${task.status}`}>{formatTaskStatus(task.status)}</span>
                </div>
                <p>{task.description || "暂无任务描述"}</p>
                <div className="ops-task-item-meta">
                  <span>{task.done_count}/{task.sub_task_count} 已完成</span>
                  <span>{formatUpdatedAt(task.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {error && <div className="thread-panel-error">{error}</div>}
      </section>
    </div>
  );
}
