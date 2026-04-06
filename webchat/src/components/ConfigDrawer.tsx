import { useState } from "react";
import { Users, ListTodo, Activity, Clock, Settings, X } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { DashboardStats } from "../lib/ops-types";
import TeamPanel from "./TeamPanel";
import TasksPanel from "./TasksPanel";
import OpsSidebar from "./OpsSidebar";
import CronPanel from "./CronPanel";

type OpsLens = "overview" | "timeline" | "board";

interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  activeSessionKey: string;
  onSwitchTeam: (key: string) => void;
  opsLens: OpsLens;
  onOpsLensChange: (lens: OpsLens) => void;
  ops: {
    agentSummaries: AgentSummary[];
    activities: TranslatedActivity[];
    selectedAgentId: string | null;
    selectedTaskId: string | null;
    dashboardStats: DashboardStats | null;
    selectAgent?: (id: string | null) => void;
    selectTask?: (id: string | null) => void;
    refresh?: () => void | Promise<void>;
  };
}

type TabKey = "team" | "tasks" | "ops" | "cron" | "settings";

const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: "team", label: "团队", icon: Users },
  { key: "tasks", label: "任务", icon: ListTodo },
  { key: "ops", label: "运营", icon: Activity },
  { key: "cron", label: "定时", icon: Clock },
  { key: "settings", label: "设置", icon: Settings },
];

export default function ConfigDrawer({
  open,
  onClose,
  activeSessionKey,
  onSwitchTeam,
  opsLens,
  onOpsLensChange,
  ops,
}: ConfigDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("team");

  if (!open) return null;

  return (
    <>
      <div className="config-drawer-overlay" onClick={onClose} />
      <aside className="config-drawer">
        <div className="config-drawer-head">
          <h2>
            <Settings size={18} />
            <span>配置</span>
          </h2>
          <button className="config-drawer-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="config-drawer-tabs">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`config-drawer-tab${activeTab === key ? " active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="config-drawer-body">
          {activeTab === "team" && (
            <TeamPanel
              activeSessionKey={activeSessionKey}
              onSwitchTeam={onSwitchTeam}
            />
          )}
          {activeTab === "tasks" && <TasksPanel />}
          {activeTab === "ops" && (
            <OpsSidebar
              open
              lens={opsLens}
              onLensChange={onOpsLensChange}
              ops={ops}
              onAgentClick={ops.selectAgent}
              onTaskClick={ops.selectTask}
            />
          )}
          {activeTab === "cron" && <CronPanel />}
          {activeTab === "settings" && (
            <div className="config-drawer-placeholder">
              <Settings size={32} strokeWidth={1.5} />
              <p>设置功能即将上线</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* Add to index.css:

.config-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 900;
}

.config-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 480px;
  max-width: 92vw;
  background: var(--bg-primary, #fff);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.18);
  z-index: 901;
  display: flex;
  flex-direction: column;
  animation: config-drawer-slide-in 0.22s ease-out;
}

@keyframes config-drawer-slide-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.config-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.config-drawer-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.config-drawer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
}

.config-drawer-close:hover {
  background: var(--bg-hover, #f3f4f6);
  color: var(--text-primary, #111);
}

.config-drawer-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.config-drawer-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.config-drawer-tab:hover {
  background: var(--bg-hover, #f3f4f6);
  color: var(--text-primary, #111);
}

.config-drawer-tab.active {
  background: var(--bg-active, #e0e7ff);
  color: var(--text-accent, #4f46e5);
  font-weight: 600;
}

.config-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.config-drawer-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 200px;
  color: var(--text-tertiary, #9ca3af);
}

.config-drawer-placeholder p {
  margin: 0;
  font-size: 14px;
}

*/
