import { useCallback, useState } from "react";
import { getPiVMToken } from "./lib/config";
import NavRail from "./components/NavRail";
import SetupGate from "./components/SetupGate";
import AgentModeView from "./components/AgentModeView";
import TeamModeView from "./components/TeamModeView";
import DigitalCityView from "./components/DigitalCityView";
import useConversation from "./hooks/useConversation";
import useUIShell from "./hooks/useUIShell";
import useWorkspace from "./hooks/useWorkspace";

export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getPiVMToken() || null);
  const ui = useUIShell();
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);

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
        {ui.view === "agent" && (
          <AgentModeView
            compact={ui.compact}
            sidebarOpen={ui.sidebarOpen}
            toggleSidebar={ui.toggleSidebar}
            closeSidebar={ui.closeSidebar}
            workspace={workspace}
            conversation={conversation}
          />
        )}
        {ui.view === "team" && (
          <TeamModeView
            workspace={workspace}
            conversation={conversation}
          />
        )}
        {ui.view === "city" && <DigitalCityView />}
      </div>
    </div>
  );
}
