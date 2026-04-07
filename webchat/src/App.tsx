import { useCallback, useState } from "react";
import { getPiVMToken } from "./lib/config";
import NavRail from "./components/NavRail";
import SetupGate from "./components/SetupGate";
import WorkbenchView from "./components/WorkbenchView";
import TasksView from "./components/TasksView";
import TeamStudioView from "./components/TeamStudioView";
import ObserveView from "./components/ObserveView";
import useConversation from "./hooks/useConversation";
import useUIShell from "./hooks/useUIShell";
import useWorkspace from "./hooks/useWorkspace";
import useOperations from "./hooks/useOperations";

export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getPiVMToken() || null);
  const ui = useUIShell();
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);
  const ops = useOperations(workspace.activeWorkspaceKey);

  const handleGateReady = useCallback((token: string) => {
    window.__PI_TOKEN__ = token;
    setOcToken(token);
  }, []);

  if (!ocToken || conversation.connState !== "connected") {
    return (
      <SetupGate
        onReady={handleGateReady}
        wsState={conversation.connState}
      />
    );
  }

  return (
    <div className="app-layout">
      <NavRail
        mode={ui.view}
        onModeChange={ui.setView}
        compact={ui.compact}
        connState={conversation.connState}
      />
      <div className="app-main">
        {ui.view === "workbench" && (
          <WorkbenchView
            ui={ui}
            workspace={workspace}
            conversation={conversation}
            ops={ops}
          />
        )}
        {ui.view === "tasks" && <TasksView ops={ops} />}
        {ui.view === "team" && (
          <TeamStudioView
            activeSessionKey={workspace.activeWorkspaceKey}
            onSwitchTeam={(key) => {
              workspace.switchWorkspace(key);
              ui.setView("workbench");
            }}
          />
        )}
        {ui.view === "observe" && (
          <ObserveView
            observatoryEventRef={conversation.observatoryEventRef as any}
            activeTeamSessionKey={workspace.activeWorkspaceKey}
            onTeamChange={workspace.switchWorkspace}
            onSend={conversation.send}
            onAbort={conversation.abort}
            streaming={conversation.streaming}
            connState={conversation.connState}
          />
        )}
      </div>
    </div>
  );
}
