import { type UseOperationsResult } from "../../hooks/useOperations";

type OpsLens = "overview" | "timeline" | "board";
import OpsOverview from "./OpsOverview";
import OpsTimeline from "./OpsTimeline";
import OpsTaskSummary from "./OpsTaskSummary";

interface OpsSidebarProps {
  lens: OpsLens;
  onLensChange: (lens: OpsLens) => void;
  ops: UseOperationsResult;
  onAgentClick: (id: string) => void;
}

export default function OpsSidebar({ lens, onLensChange, ops, onAgentClick }: OpsSidebarProps) {
  return (
    <div className="workbench-ops">
      <div className="ops-segmented">
        <button
          className={`ops-segmented-btn${lens === "overview" ? " active" : ""}`}
          onClick={() => onLensChange("overview")}
        >
          概览
        </button>
        <button
          className={`ops-segmented-btn${lens === "timeline" ? " active" : ""}`}
          onClick={() => onLensChange("timeline")}
        >
          动态
        </button>
        <button
          className={`ops-segmented-btn${lens === "board" ? " active" : ""}`}
          onClick={() => onLensChange("board")}
        >
          任务
        </button>
      </div>

      <div className="ops-sidebar-body">
        {lens === "overview" && (
          <OpsOverview agents={ops.agentSummaries} onAgentClick={onAgentClick} />
        )}
        {lens === "timeline" && <OpsTimeline activities={ops.activities} />}
        {lens === "board" && (
          <OpsTaskSummary stats={ops.dashboardStats} tasks={ops.crewTasks} />
        )}
      </div>
    </div>
  );
}
