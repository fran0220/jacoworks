import { useCallback, useState } from "react";
import { getPiVMToken } from "./lib/config";
import ModeBar from "./components/ModeBar";
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
      />
      <div className="app-main">
        {ui.mode === "agent" && (
          <AgentModeView
            compact={ui.compact}
            sidebarOpen={ui.sidebarOpen}
            toggleSidebar={ui.toggleSidebar}
            closeSidebar={ui.closeSidebar}
            workspace={workspace}
            conversation={conversation}
          />
        )}
        {ui.mode === "team" && (
          <TeamModeView workspace={workspace} conversation={conversation} />
        )}
        {ui.mode === "city" && <DigitalCityView />}
      </div>
    </div>
  );
}
