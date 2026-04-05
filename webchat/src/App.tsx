import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { FileArtifact } from "./types";
import { getPiVMToken } from "./lib/config";
import NavRail from "./components/NavRail";
import SetupGate from "./components/SetupGate";
import TasksView from "./components/TasksView";
import TeamStudioView from "./components/TeamStudioView";
import WorkbenchView from "./components/WorkbenchView";
import useConversation from "./hooks/useConversation";
import useOperations from "./hooks/useOperations";
import useUIShell from "./hooks/useUIShell";
import useWorkspace from "./hooks/useWorkspace";

const ObserveView = lazy(() => import("./components/ObserveView"));

export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getPiVMToken() || null);
  const [rightPane, setRightPane] = useState<"ops" | "preview">("ops");
  const [previewArtifact, setPreviewArtifact] = useState<FileArtifact | null>(null);
  const ui = useUIShell();
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);
  const ops = useOperations(workspace.activeWorkspaceKey);

  const handleGateReady = useCallback((token: string) => {
    window.__PI_TOKEN__ = token;
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
    if (ui.view !== "workbench" && (previewArtifact || rightPane === "preview")) {
      closePreview();
    }
  }, [closePreview, previewArtifact, rightPane, ui.view]);

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

  const workbenchWorkspace = useMemo(
    () => ({
      activeWorkspaceKey: workspace.activeWorkspaceKey,
      activeThreadId: workspace.activeThreadId,
      threads: workspace.threads,
      switchWorkspace: workspace.switchWorkspace,
      selectThread: workspace.selectThread,
      createThread: async () => {
        await workspace.createThread();
      },
      deleteThread: workspace.deleteThread,
    }),
    [
      workspace.activeThreadId,
      workspace.activeWorkspaceKey,
      workspace.createThread,
      workspace.deleteThread,
      workspace.selectThread,
      workspace.switchWorkspace,
      workspace.threads,
    ],
  );

  if (!ocToken) {
    return <SetupGate onReady={handleGateReady} />;
  }

  return (
    <div className="app-layout">
      <NavRail
        view={ui.view}
        onViewChange={ui.setView}
        compact={ui.compact}
        connState={conversation.connState}
        mobileDrawerOpen={ui.mobileDrawerOpen}
        onToggleMobileDrawer={ui.toggleMobileDrawer}
        onCloseMobileDrawer={ui.closeMobileDrawer}
      />
      <div className="app-main">
        {ui.view === "workbench" && (
          <WorkbenchView ui={workbenchUI} workspace={workbenchWorkspace} conversation={conversation} ops={ops} />
        )}
        {ui.view === "tasks" && <TasksView />}
        {ui.view === "team" && (
          <TeamStudioView activeSessionKey={workspace.activeWorkspaceKey} onSwitchTeam={workspace.switchWorkspace} />
        )}
        {ui.view === "observe" && (
          <Suspense fallback={<div className="observe-placeholder">加载观测站…</div>}>
            <ObserveView
              observatoryEventRef={conversation.observatoryEventRef}
              activeTeamSessionKey={workspace.activeWorkspaceKey}
              onTeamChange={workspace.switchWorkspace}
              onSend={conversation.send}
              onAbort={conversation.abort}
              streaming={conversation.streaming}
              connState={conversation.connState}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
