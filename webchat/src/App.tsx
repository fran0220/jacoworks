import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { FileArtifact } from "./types";
import { getPiVMToken, MAPBOX_TOKEN } from "./lib/config";
import ModeBar from "./components/ModeBar";
import ConfigDrawer from "./components/ConfigDrawer";
import SetupGate from "./components/SetupGate";
import WorkbenchView from "./components/WorkbenchView";
import useConversation from "./hooks/useConversation";
import useOperations from "./hooks/useOperations";
import useUIShell from "./hooks/useUIShell";
import useWorkspace from "./hooks/useWorkspace";

const DigitalCityPanel = lazy(() => import("./components/DigitalCityPanel"));

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
    if (ui.mode !== "workspace" && (previewArtifact || rightPane === "preview")) {
      closePreview();
    }
  }, [closePreview, previewArtifact, rightPane, ui.mode]);

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
      <ModeBar
        mode={ui.mode}
        onModeChange={ui.setMode}
        compact={ui.compact}
        connState={conversation.connState}
        onToggleConfig={ui.toggleConfigDrawer}
      />
      <div className="app-main">
        {ui.mode === "workspace" && (
          <WorkbenchView ui={workbenchUI} workspace={workbenchWorkspace} conversation={conversation} ops={ops} />
        )}
        {ui.mode === "city" && (
          <Suspense fallback={<div className="city-placeholder">加载数字之城…</div>}>
            {MAPBOX_TOKEN ? <DigitalCityPanel mapboxToken={MAPBOX_TOKEN} /> : <div>尚未配置 MAPBOX_TOKEN</div>}
          </Suspense>
        )}
      </div>
      <ConfigDrawer
        open={ui.configDrawerOpen}
        onClose={ui.closeConfigDrawer}
        activeSessionKey={workspace.activeWorkspaceKey}
        onSwitchTeam={workspace.switchWorkspace}
        opsLens={ui.opsLens}
        onOpsLensChange={ui.setOpsLens}
        ops={ops}
      />
    </div>
  );
}
