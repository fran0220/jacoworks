import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Menu, Settings, Sparkles, Bot } from "lucide-react";
import useWorkspace from "../hooks/useWorkspace";
import useConversation from "../hooks/useConversation";
import useOperations from "../hooks/useOperations";
import type { FileArtifact } from "../types";
import ChatView from "./ChatView";
import Composer from "./Composer";
import ThreadListPanel from "./ThreadListPanel";
import SettingsDrawer from "./SettingsDrawer";
import WebPreviewPane from "./WebPreviewPane";
import type { LeaderAssistantHandle } from "../observatory/hud/LeaderAssistant";

const LeaderAssistant = lazy(() => import("../observatory/hud/LeaderAssistant"));

interface AgentViewProps {
  sessionKey: string;
  profileName: string;
  displayName: string;
  icon?: string;
  ocToken: string;
}

const ICON_MAP: Record<string, typeof Bot> = {
  bot: Bot,
  sparkles: Sparkles,
};

function getConnClass(state: string): string {
  if (state === "connected") return "av-conn--connected";
  if (state === "connecting") return "av-conn--connecting";
  return "av-conn--disconnected";
}

export default function AgentView({ sessionKey, profileName, displayName, icon, ocToken }: AgentViewProps) {
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);
  const ops = useOperations(sessionKey);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<FileArtifact | null>(null);
  const leaderRef = useRef<LeaderAssistantHandle>(null);

  // Wire conversation WS events to the 3D avatar
  useEffect(() => {
    conversation.observatoryEventRef.current = (event) => {
      const ref = leaderRef.current;
      if (!ref) return;
      switch (event.kind) {
        case "thinking_start": ref.onThinkingStart(); break;
        case "thinking_delta": ref.onThinkingDelta(event.text || ""); break;
        case "text_delta": ref.onTextDelta(event.text || ""); break;
        case "tool_start": ref.onToolStart(event.toolName || "tool"); break;
        case "tool_end": ref.onToolEnd(event.toolName || "tool"); break;
        case "done": ref.onDone(); break;
      }
    };
    return () => { conversation.observatoryEventRef.current = null; };
  }, [conversation.observatoryEventRef]);

  useEffect(() => {
    workspace.switchWorkspace(sessionKey);
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    setCompact(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const handlePreview = useCallback((artifact: FileArtifact) => setPreviewArtifact(artifact), []);
  const closePreview = useCallback(() => setPreviewArtifact(null), []);

  const IconComponent = ICON_MAP[icon ?? ""] ?? Bot;

  const showPreviewModal = compact && previewArtifact !== null;

  return (
    <div className="av-shell">
      {compact && sidebarOpen && <div className="av-backdrop" onClick={closeSidebar} />}
      {showPreviewModal && <div className="av-backdrop" onClick={closePreview} />}

      <div className="av-layout">
        <div className={`av-sidebar${sidebarOpen ? " av-sidebar--open" : ""}`}>
          <ThreadListPanel
            workspaceKey={sessionKey}
            threads={workspace.threads}
            activeThreadId={workspace.activeThreadId}
            onSelect={workspace.selectThread}
            onCreate={() => void workspace.createThread()}
            onDelete={workspace.deleteThread}
            onWorkspaceChange={workspace.switchWorkspace}
            open={sidebarOpen}
            onClose={closeSidebar}
          />
        </div>

        <section className="av-center">
          <header className="av-toolbar">
            <div className="av-toolbar-start">
              <button className="av-toolbar-btn" onClick={toggleSidebar} title="线程列表">
                <Menu size={16} />
              </button>
              <IconComponent size={16} className="av-agent-icon" />
              <strong className="av-agent-name">{displayName}</strong>
            </div>
            <div className="av-toolbar-end">
              <div className={`av-conn-pill ${getConnClass(conversation.connState)}`}>
                <span className="av-conn-dot" />
                <span>{conversation.connState === "connected" ? "在线" : conversation.connState === "connecting" ? "连接中" : "离线"}</span>
              </div>
              <button className="av-toolbar-btn" onClick={() => setSettingsOpen(true)} title="设置">
                <Settings size={16} />
              </button>
            </div>
          </header>

          <ChatView
            messages={conversation.messages}
            blocks={conversation.blocks}
            streaming={conversation.streaming}
            error={conversation.error}
            activeWorkspaceKey={sessionKey}
            agentSummaries={ops.agentSummaries}
            onPreview={handlePreview}
          />
          <Composer
            disabled={conversation.connState !== "connected"}
            streaming={conversation.streaming}
            onSend={conversation.send}
            onAbort={conversation.abort}
            agents={ops.agentSummaries}
          />
          <Suspense fallback={null}>
            <LeaderAssistant
              ref={leaderRef}
              leaderName={displayName}
              leaderRole={profileName || "default"}
              leaderScore={0}
              currentTask={null}
              onSend={conversation.send}
              onAbort={conversation.abort}
              streaming={conversation.streaming}
              connState={conversation.connState}
            />
          </Suspense>
        </section>

        {!compact && previewArtifact && (
          <aside className="av-preview">
            <WebPreviewPane artifact={previewArtifact} onClose={closePreview} />
          </aside>
        )}
      </div>

      {showPreviewModal && (
        <div className="av-preview-modal">
          <WebPreviewPane artifact={previewArtifact} onClose={closePreview} />
        </div>
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profileName={profileName}
      />
    </div>
  );
}
