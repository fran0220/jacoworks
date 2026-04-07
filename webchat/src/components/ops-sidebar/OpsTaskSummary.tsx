import { type DashboardStats } from "../../lib/ops-types";
import { type CrewTask } from "../../lib/feed";

interface OpsTaskSummaryProps {
  stats: DashboardStats | null;
  tasks: CrewTask[];
}

export default function OpsTaskSummary({ stats, tasks }: OpsTaskSummaryProps) {
  return (
    <div className="ops-section-stack">
      <h3 className="ops-section-title">任务概况</h3>
      {stats && (
        <div className="ops-metrics-grid ops-metrics-grid--compact">
          <div className="ops-metric-card">
            <span>总任务</span>
            <strong>{stats.totalTasks}</strong>
          </div>
          <div className="ops-metric-card">
            <span>进行中</span>
            <strong>{stats.activeTasks}</strong>
          </div>
        </div>
      )}

      <div className="ops-task-list">
        <h4 className="ops-section-title">最近任务</h4>
        {tasks.slice(0, 5).map((task) => (
          <div key={task.id} className="ops-task-item">
            <div className="ops-task-item-head">
              <strong>{task.name}</strong>
              <span className={`ops-task-status--${task.status.replace("-", "_")}`}>
                {task.status}
              </span>
            </div>
            <div className="ops-task-item-meta">
              <span>{task.assignee}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
