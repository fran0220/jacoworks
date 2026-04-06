import { Clock3, ListTodo, Radar, ServerCog, Workflow } from "lucide-react";
import CronPanel from "./CronPanel";

export default function TasksPanel() {
  return (
    <section className="tasks-panel">
      <div className="tasks-stage-card tasks-stage-card--hero">
        <div>
          <p className="thread-panel-eyebrow">Mission Control</p>
          <strong>任务中枢已经切到新版协作体系</strong>
          <span>
            任务编排、定时触发与 VM 执行能力统一归到这一套入口，不再保留旧 JaMOSS 过渡壳。
          </span>
        </div>
        <div className="tasks-stage-badges">
          <span><Workflow size={14} />Live orchestration</span>
          <span><Radar size={14} />Runtime linked</span>
          <span><Clock3 size={14} />Scheduled jobs</span>
        </div>
      </div>

      <div className="tasks-section">
        <div className="ops-section-title">
          <ListTodo size={16} />
          <span>任务编排</span>
        </div>
        <div className="tasks-grid">
          <article className="tasks-info-card">
            <strong>任务来源</strong>
            <p>所有执行任务都由当前团队、角色对话和 VM runtime 共同驱动。</p>
          </article>
          <article className="tasks-info-card">
            <strong>调度方式</strong>
            <p>即时消息触发实时编排，计划性动作通过 cron 进入执行队列。</p>
          </article>
          <article className="tasks-info-card">
            <strong>设计目标</strong>
            <p>让任务中心成为新版主链路的一部分，而不是留下一张“旧系统已移除”的提示牌。</p>
          </article>
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
