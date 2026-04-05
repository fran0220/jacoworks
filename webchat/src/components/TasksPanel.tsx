import { ListTodo, ServerCog } from "lucide-react";
import CronPanel from "./CronPanel";

export default function TasksPanel() {
  return (
    <section className="tasks-panel">
      <div className="tasks-section">
        <div className="ops-section-title">
          <ListTodo size={16} />
          <span>任务中心（VM）</span>
        </div>
        <div className="ops-empty-card">
          Legacy JaMOSS 已移除。当前任务能力由 VM 侧服务提供，定时任务已可用，其余任务编排接口正在接入。
        </div>
      </div>

      <div className="tasks-section">
        <div className="ops-section-title">
          <ServerCog size={16} />
          <span>定时任务</span>
        </div>
        <CronPanel />
      </div>
    </section>
  );
}

