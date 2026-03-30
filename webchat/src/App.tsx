import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileArtifact, View } from "./types";
import { getOpenClawToken } from "./lib/config";
import NavRail from "./components/NavRail";
import SetupGate from "./components/SetupGate";
import ObserveView from "./components/ObserveView";
import TasksView from "./components/TasksView";
import TeamStudioView from "./components/TeamStudioView";
import WorkbenchView from "./components/WorkbenchView";
import useConversation from "./hooks/useConversation";
import useOperations from "./hooks/useOperations";
import useUIShell from "./hooks/useUIShell";
import useWorkspace from "./hooks/useWorkspace";

export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getOpenClawToken() || null);
  const [rightPane, setRightPane] = useState<"ops" | "preview">("ops");
  const [previewArtifact, setPreviewArtifact] = useState<FileArtifact | null>(null);
  const ui = useUIShell();
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);
  const operations = useOperations(workspace.activeWorkspaceKey);
  const workbenchWorkspace = useMemo(
    () => ({
      ...workspace,
      createThread: async () => {
        await workspace.createThread();
      },
    }),
    [workspace],
  );

  const handleGateReady = useCallback((token: string) => {
    window.__OPENCLAW_TOKEN__ = token;
    setOcToken(token);
  }, []);

  const openPreview = useCallback((artifact: FileArtifact) => {
    setPreviewArtifact(artifact);
    setRightPane("preview");
  }, []);

  const closePreview = useCallback(() => {
    setPreviewArtifact(null);
    setRightPane("ops");
  }, []);

  useEffect(() => {
    if (ui.view !== "workbench" && previewArtifact) {
      closePreview();
    }
  }, [closePreview, previewArtifact, ui.view]);

  const workbenchUI = useMemo(
    () => ({
      ...ui,
      rightPane,
      previewArtifact,
      openPreview,
      closePreview,
    }),
    [closePreview, openPreview, previewArtifact, rightPane, ui],
  );

  if (!ocToken || conversation.connState !== "connected") {
    return <SetupGate onReady={handleGateReady} wsState={ocToken ? conversation.connState : undefined} />;
  }

  return (
    <div className="app-layout">
      <NavRail
        view={ui.view}
        compact={ui.compact}
        connState={conversation.connState}
        onViewChange={(nextView: View) => {
          closePreview();
          ui.setView(nextView);
          ui.closeSidebar();
        }}
        mobileDrawerOpen={ui.mobileDrawerOpen}
        onCloseMobileDrawer={ui.closeMobileDrawer}
      />
      <div className="app-main">
        {ui.view === "workbench" && (
          <WorkbenchView ui={workbenchUI} workspace={workbenchWorkspace} conversation={conversation} ops={operations} />
        )}
        {ui.view === "tasks" && <TasksView />}
        {ui.view === "team" && (
          <TeamStudioView
            activeSessionKey={workspace.activeWorkspaceKey}
            onSwitchTeam={(sessionKey: string) => {
              closePreview();
              workspace.switchWorkspace(sessionKey);
              ui.setView("workbench");
            }}
          />
        )}
        {ui.view === "observe" && (
          <ObserveView
            observatoryEventRef={conversation.observatoryEventRef}
            activeTeamSessionKey={workspace.activeWorkspaceKey}
            onTeamChange={workspace.switchWorkspace}
            onSend={conversation.send}
            onAbort={conversation.abort}
            streaming={conversation.streaming}
            connState={conversation.connState}
          />
        )}
      </div>
      {ui.compact && ui.view !== "workbench" && (
        <button className="mobile-fab-nav" onClick={ui.toggleMobileDrawer} title="导航菜单">
          <span>J</span>
        </button>
      )}
    </div>
  );
}
