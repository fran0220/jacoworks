import { Activity, Menu, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSummary } from "../lib/feed";
import type { DashboardStats } from "../lib/ops-types";
import type { TranslatedActivity } from "../lib/feed-translate";
import {
  getStoredWorkspaceSpritePackId,
  getWorkspaceAgentId,
  resolveSpritePackIdForWorkspace,
  subscribeSpritePackChanges,
} from "../lib/sprite-packs";
import { fetchProfileDetail } from "../lib/teams";
import type { ChatMessage, FileArtifact, StreamBlock } from "../types";
import useAgentExpression from "../hooks/useAgentExpression";
import ChatView from "./ChatView";
import Composer from "./Composer";
import OpsSidebar from "./OpsSidebar";
import SpriteAvatarPanel from "./SpriteAvatarPanel";
import TeamPresenceBar from "./TeamPresenceBar";
import ThreadListPanel from "./ThreadListPanel";
import WebPreviewPane from "./WebPreviewPane";

type View = "workbench" | "tasks" | "team" | "observe";
type OpsLens = "overview" | "timeline" | "board";
type ConnState = "disconnected" | "connecting" | "connected";

interface UIShellDomain {
  compact: boolean;
  sidebarOpen: boolean;
  opsPanelOpen: boolean;
  opsLens: OpsLens;
  rightPane: "ops" | "preview";
  previewArtifact: FileArtifact | null;
  setView?: (view: View) => void;
  setOpsLens: (lens: OpsLens) => void;
  openPreview: (artifact: FileArtifact) => void;
  closePreview: () => void;
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

const BUILTIN_AGENT_IDS = new Set(["default", "researcher", "coder", "writer"]);

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
  const [spritePackId, setSpritePackId] = useState(() =>
    resolveSpritePackIdForWorkspace(workspace.activeWorkspaceKey),
  );
  const agentExpression = useAgentExpression({
    streaming: conversation.streaming,
    blocks: conversation.blocks,
    error: conversation.error,
  });
  const showPreviewModal = ui.compact && ui.rightPane === "preview" && Boolean(ui.previewArtifact);
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

  useEffect(() => {
    const syncSpritePack = () => {
      setSpritePackId(resolveSpritePackIdForWorkspace(workspace.activeWorkspaceKey));
    };

    syncSpritePack();
    const unsubscribe = subscribeSpritePackChanges(syncSpritePack);
    const agentId = getWorkspaceAgentId(workspace.activeWorkspaceKey);
    const needsProfileLookup =
      Boolean(agentId) &&
      !BUILTIN_AGENT_IDS.has(agentId ?? "") &&
      !getStoredWorkspaceSpritePackId(workspace.activeWorkspaceKey);

    if (needsProfileLookup && agentId) {
      void fetchProfileDetail(agentId).catch(() => undefined);
    }

    return unsubscribe;
  }, [workspace.activeWorkspaceKey]);

  return (
    <div className="workbench-shell">
      {ui.compact && ui.sidebarOpen && <div className="workbench-drawer-backdrop" onClick={closeSidebar} />}
      {ui.compact && ui.opsPanelOpen && ui.rightPane === "ops" && <div className="workbench-drawer-backdrop" onClick={closeOpsPanel} />}
      {showPreviewModal && <div className="preview-modal-overlay" onClick={ui.closePreview} />}

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
                <button
                  className="workbench-toolbar-btn"
                  onClick={() => {
                    if (ui.rightPane === "preview") {
                      ui.closePreview();
                      return;
                    }
                    ui.toggleOpsPanel?.();
                  }}
                  title={ui.rightPane === "preview" ? "关闭预览" : "打开运营侧栏"}
                >
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
            onPreview={ui.openPreview}
          />
          <Composer
            disabled={conversation.connState !== "connected"}
            streaming={conversation.streaming}
            onSend={conversation.send}
            onAbort={conversation.abort}
            agents={ops.agentSummaries}
            avatarSlot={<SpriteAvatarPanel spritePackId={spritePackId} expression={agentExpression} />}
          />
        </section>

        {!ui.compact ? (
          <div className={`workbench-side-stack workbench-side-stack--${ui.rightPane}`}>
            <div className={`workbench-side-panel workbench-side-panel--ops${ui.rightPane === "ops" ? " is-active" : ""}`}>
              <OpsSidebar
                open
                lens={ui.opsLens}
                onLensChange={ui.setOpsLens}
                ops={ops}
                onAgentClick={ops.selectAgent}
                onTaskClick={ops.selectTask}
                onOpenTasks={openTasksView}
              />
            </div>
            <div className={`workbench-side-panel workbench-side-panel--preview${ui.rightPane === "preview" ? " is-active" : ""}`}>
              <aside className="workbench-ops web-preview-shell open">
                <WebPreviewPane artifact={ui.previewArtifact} onClose={ui.closePreview} />
              </aside>
            </div>
          </div>
        ) : (
          <OpsSidebar
            open={ui.opsPanelOpen && ui.rightPane === "ops"}
            lens={ui.opsLens}
            onLensChange={ui.setOpsLens}
            ops={ops}
            onAgentClick={ops.selectAgent}
            onTaskClick={ops.selectTask}
            onOpenTasks={openTasksView}
            showClose={ui.compact}
            onClose={closeOpsPanel}
          />
        )}
      </div>

      {showPreviewModal && (
        <div className="preview-modal">
          <div className="workbench-ops web-preview-shell web-preview-shell--modal open">
            <WebPreviewPane artifact={ui.previewArtifact} onClose={ui.closePreview} />
          </div>
        </div>
      )}
    </div>
  );
}
