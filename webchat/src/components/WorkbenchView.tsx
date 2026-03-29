import { Activity, Menu, SlidersHorizontal } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import type { DashboardStats } from "../lib/jamoss";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { ChatMessage, StreamBlock } from "../types";
import ChatView from "./ChatView";
import Composer from "./Composer";
import OpsSidebar from "./OpsSidebar";
import TeamPresenceBar from "./TeamPresenceBar";
import ThreadListPanel from "./ThreadListPanel";

type View = "workbench" | "tasks" | "team" | "observe";
type OpsLens = "overview" | "timeline" | "board";
type ConnState = "disconnected" | "connecting" | "connected";

interface UIShellDomain {
  compact: boolean;
  sidebarOpen: boolean;
  opsPanelOpen: boolean;
  opsLens: OpsLens;
  setView?: (view: View) => void;
  setOpsLens: (lens: OpsLens) => void;
  toggleSidebar?: () => void;
  toggleOpsPanel?: () => void;
  toggleMobileDrawer?: () => void;
}

interface ThreadMeta {
  id: string;
  workspaceKey: string;
  title: string;
  updatedAt: number;
}

interface WorkspaceDomain {
  activeWorkspaceKey: string;
  activeThreadId: string | null;
  threads: ThreadMeta[];
  switchWorkspace: (key: string) => void;
  selectThread: (id: string) => void;
  createThread: () => void | Promise<void>;
  deleteThread: (id: string) => void | Promise<void>;
}

interface ConversationDomain {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  error: string | null;
  connState: ConnState;
  send: (text: string) => void | Promise<void>;
  abort: () => void;
}

interface OperationsDomain {
  agentSummaries: AgentSummary[];
  activities: TranslatedActivity[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  dashboardStats: DashboardStats | null;
  selectAgent?: (id: string | null) => void;
  selectTask?: (id: string | null) => void;
  refresh?: () => void | Promise<void>;
}

function getConnLabel(state: ConnState): string {
  if (state === "connected") return "协作在线";
  if (state === "connecting") return "协作连接中";
  return "连接中断";
}

export default function WorkbenchView({
  ui,
  workspace,
  conversation,
  ops,
}: {
  ui: UIShellDomain;
  workspace: WorkspaceDomain;
  conversation: ConversationDomain;
  ops: OperationsDomain;
}) {
  const openTasksView = () => ui.setView?.("tasks");
  const closeSidebar = () => {
    if (ui.compact && ui.sidebarOpen) {
      ui.toggleSidebar?.();
    }
  };
  const closeOpsPanel = () => {
    if (ui.compact && ui.opsPanelOpen) {
      ui.toggleOpsPanel?.();
    }
  };

  return (
    <div className="workbench-shell">
      {ui.compact && ui.sidebarOpen && <div className="workbench-drawer-backdrop" onClick={closeSidebar} />}
      {ui.compact && ui.opsPanelOpen && <div className="workbench-drawer-backdrop" onClick={closeOpsPanel} />}

      <div className="workbench">
        <ThreadListPanel
          workspaceKey={workspace.activeWorkspaceKey}
          threads={workspace.threads}
          activeThreadId={workspace.activeThreadId}
          onSelect={workspace.selectThread}
          onCreate={workspace.createThread}
          onDelete={workspace.deleteThread}
          onWorkspaceChange={workspace.switchWorkspace}
          open={ui.sidebarOpen}
          onClose={closeSidebar}
        />

        <section className="workbench-center">
          <header className="workbench-toolbar">
            <div className="workbench-toolbar-start">
              {ui.compact && (
                <button className="workbench-toolbar-btn workbench-nav-btn" onClick={() => ui.toggleMobileDrawer?.()} title="导航菜单">
                  <span className="workbench-nav-brand">J</span>
                </button>
              )}
              {ui.compact && (
                <button className="workbench-toolbar-btn" onClick={() => ui.toggleSidebar?.()} title="打开线程列表">
                  <Menu size={16} />
                </button>
              )}
              {!ui.compact && (
                <div className="workbench-toolbar-copy">
                  <strong>指挥台</strong>
                  <span>{workspace.activeWorkspaceKey}</span>
                </div>
              )}
            </div>

            <div className="workbench-toolbar-end">
              <div className={`workbench-status-pill workbench-status-pill--${conversation.connState}`}>
                <span className="workbench-status-dot" />
                {!ui.compact && <Activity size={14} />}
                <span>{getConnLabel(conversation.connState)}</span>
              </div>
              {ui.compact && (
                <button className="workbench-toolbar-btn" onClick={() => ui.toggleOpsPanel?.()} title="打开运营侧栏">
                  <SlidersHorizontal size={16} />
                </button>
              )}
            </div>
          </header>

          <TeamPresenceBar agents={ops.agentSummaries} />
          <ChatView
            messages={conversation.messages}
            blocks={conversation.blocks}
            streaming={conversation.streaming}
            error={conversation.error}
            activeWorkspaceKey={workspace.activeWorkspaceKey}
            agentSummaries={ops.agentSummaries}
          />
          <Composer
            disabled={conversation.connState !== "connected"}
            streaming={conversation.streaming}
            onSend={conversation.send}
            onAbort={conversation.abort}
            agents={ops.agentSummaries}
          />
        </section>

        <OpsSidebar
          open={!ui.compact || ui.opsPanelOpen}
          lens={ui.opsLens}
          onLensChange={ui.setOpsLens}
          ops={ops}
          onAgentClick={ops.selectAgent}
          onTaskClick={ops.selectTask}
          onOpenTasks={openTasksView}
          showClose={ui.compact}
          onClose={closeOpsPanel}
        />
      </div>
    </div>
  );
}
