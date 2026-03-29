import { Activity, LayoutDashboard, ListTodo, X } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { DashboardStats } from "../lib/jamoss";
import OpsOverview from "./OpsOverview";
import OpsTaskSummary from "./OpsTaskSummary";
import OpsTimeline from "./OpsTimeline";

type OpsLens = "overview" | "timeline" | "board";

interface OperationsDomain {
  agentSummaries: AgentSummary[];
  activities: TranslatedActivity[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  dashboardStats: DashboardStats | null;
  refresh?: () => void | Promise<void>;
}

const LENSES: { key: OpsLens; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "timeline", label: "动态" },
  { key: "board", label: "任务" },
];

export default function OpsSidebar({
  open,
  lens,
  onLensChange,
  ops,
  onAgentClick,
  onTaskClick,
  onOpenTasks,
  showClose,
  onClose,
}: {
  open?: boolean;
  lens: OpsLens;
  onLensChange: (lens: OpsLens) => void;
  ops: OperationsDomain;
  onAgentClick?: (id: string | null) => void;
  onTaskClick?: (id: string | null) => void;
  onOpenTasks?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}) {
  return (
    <aside className={`workbench-ops${open ? " open" : ""}`}>
      <div className="ops-sidebar-head">
        <div>
          <p className="thread-panel-eyebrow">Operations</p>
          <strong>运营侧栏</strong>
        </div>
        {showClose && onClose && (
          <button className="thread-panel-action" onClick={onClose} title="关闭运营面板">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="ops-segmented">
        {LENSES.map((item) => (
          <button
            key={item.key}
            className={`ops-segmented-btn${lens === item.key ? " active" : ""}`}
            onClick={() => onLensChange(item.key)}
          >
            {item.key === "overview" ? <LayoutDashboard size={14} /> : item.key === "timeline" ? <Activity size={14} /> : <ListTodo size={14} />}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="ops-sidebar-body">
        {lens === "overview" && (
          <OpsOverview
            agentSummaries={ops.agentSummaries}
            dashboardStats={ops.dashboardStats}
            selectedAgentId={ops.selectedAgentId}
            onAgentClick={onAgentClick}
          />
        )}
        {lens === "timeline" && (
          <OpsTimeline
            activities={ops.activities}
            selectedAgentId={ops.selectedAgentId}
            onSelectAgent={onAgentClick}
            onRefresh={ops.refresh}
          />
        )}
        {lens === "board" && (
          <OpsTaskSummary
            dashboardStats={ops.dashboardStats}
            selectedTaskId={ops.selectedTaskId}
            onSelectTask={onTaskClick}
            onViewAll={onOpenTasks}
            onRefresh={ops.refresh}
          />
        )}
      </div>
    </aside>
  );
}
