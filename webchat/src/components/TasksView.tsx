import { ListTodo } from "lucide-react";
import { type OperationsState } from "../hooks/useOperations";
import { type CrewTask } from "../lib/feed";
import CrewProgressBar from "./CrewProgressBar";

interface TasksViewProps {
  ops: OperationsState;
}

export default function TasksView({ ops }: TasksViewProps) {
  const { crewTasks, dashboardStats, loading, error } = ops;

  if (loading && crewTasks.length === 0) {
    return (
      <div className="tasks-view-loading">
        <p>正在加载任务数据...</p>
      </div>
    );
  }

  return (
    <div className="tasks-view view-shell">
      <div className="tasks-panel" style={{ flex: 1, padding: "1.5rem", overflowY: "auto" }}>
        <header className="tasks-header" style={{ marginBottom: "1.5rem" }}>
          <div className="tasks-view-title" style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <ListTodo size={24} color="var(--accent)" />
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>任务看板</h1>
          </div>

          {dashboardStats && (
            <div className="tasks-stats-grid">
              <div className="tasks-stat-card">
                <div className="tasks-stat-head">
                  <span>总任务</span>
                </div>
                <strong>{dashboardStats.totalTasks}</strong>
              </div>
              <div className="tasks-stat-card">
                <div className="tasks-stat-head">
                  <span>进行中</span>
                </div>
                <strong>{dashboardStats.activeTasks}</strong>
              </div>
              <div className="tasks-stat-card">
                <div className="tasks-stat-head">
                  <span>协作 Agent</span>
                </div>
                <strong>{dashboardStats.totalAgents}</strong>
              </div>
              <div className="tasks-stat-card">
                <div className="tasks-stat-head">
                  <span>最高积分</span>
                </div>
                <strong>{dashboardStats.topScore}</strong>
              </div>
            </div>
          )}
        </header>

        <main className="tasks-content" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {error && <div className="panel-error">{error}</div>}

          <section className="tasks-section">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>任务进度</h2>
            <CrewProgressBar tasks={crewTasks} />
          </section>

          <section className="tasks-section">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>任务列表</h2>
            {crewTasks.length === 0 ? (
              <div className="tasks-empty">
                <p>当前暂无活跃任务</p>
              </div>
            ) : (
              <div className="tasks-list" style={{ border: "none", maxHeight: "none" }}>
                {crewTasks.map((task: CrewTask) => (
                  <div key={task.id} className="task-item">
                    <div className="task-item-head">
                      <strong>{task.name}</strong>
                      <span className={`status-badge status-badge--${task.status.replace("-", "_")}`}>
                        {task.status}
                      </span>
                    </div>
                    <div className="task-item-meta">
                      <span>执行人: {task.assignee || "未分配"}</span>
                      {task.wave !== undefined && <span>Wave {task.wave}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
