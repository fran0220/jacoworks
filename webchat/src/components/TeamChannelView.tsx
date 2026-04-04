import { useCallback, useEffect, useState } from "react";
import { Menu, Settings, SlidersHorizontal } from "lucide-react";
import useWorkspace from "../hooks/useWorkspace";
import useConversation from "../hooks/useConversation";
import useOperations from "../hooks/useOperations";
import type { FileArtifact } from "../types";
import type { OpsLens } from "../types";
import ChatView from "./ChatView";
import Composer from "./Composer";
import OpsSidebar from "./OpsSidebar";
import TeamPresenceBar from "./TeamPresenceBar";
import ThreadListPanel from "./ThreadListPanel";
import SettingsDrawer from "./SettingsDrawer";
import WebPreviewPane from "./WebPreviewPane";

interface TeamChannelViewProps {
  sessionKey: string;
  templateName: string;
  displayName: string;
  ocToken: string;
}

function getConnClass(state: string): string {
  if (state === "connected") return "tcv-conn--connected";
  if (state === "connecting") return "tcv-conn--connecting";
  return "tcv-conn--disconnected";
}

export default function TeamChannelView({ sessionKey, templateName, displayName, ocToken }: TeamChannelViewProps) {
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace);
  const ops = useOperations(sessionKey);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opsPanelOpen, setOpsPanelOpen] = useState(false);
  const [opsLens, setOpsLens] = useState<OpsLens>("overview");
  const [compact, setCompact] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<FileArtifact | null>(null);

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
  const toggleOpsPanel = useCallback(() => setOpsPanelOpen((v) => !v), []);
  const closeOpsPanel = useCallback(() => setOpsPanelOpen(false), []);

  const handlePreview = useCallback((artifact: FileArtifact) => setPreviewArtifact(artifact), []);
  const closePreview = useCallback(() => setPreviewArtifact(null), []);

  const showPreviewModal = compact && previewArtifact !== null;

  return (
    <div className="tcv-shell">
      {compact && sidebarOpen && <div className="tcv-backdrop" onClick={closeSidebar} />}
      {compact && opsPanelOpen && <div className="tcv-backdrop" onClick={closeOpsPanel} />}
      {showPreviewModal && <div className="tcv-backdrop" onClick={closePreview} />}

      <div className="tcv-layout">
        <div className={`tcv-sidebar${sidebarOpen ? " tcv-sidebar--open" : ""}`}>
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

        <section className="tcv-center">
          <header className="tcv-toolbar">
            <div className="tcv-toolbar-start">
              <button className="tcv-toolbar-btn" onClick={toggleSidebar} title="线程列表">
                <Menu size={16} />
              </button>
              <strong className="tcv-team-name">{displayName}</strong>
            </div>
            <div className="tcv-toolbar-end">
              <div className={`tcv-conn-pill ${getConnClass(conversation.connState)}`}>
                <span className="tcv-conn-dot" />
                <span>{conversation.connState === "connected" ? "协作在线" : conversation.connState === "connecting" ? "连接中" : "离线"}</span>
              </div>
              {compact && (
                <button className="tcv-toolbar-btn" onClick={toggleOpsPanel} title="运营面板">
                  <SlidersHorizontal size={16} />
                </button>
              )}
              <button className="tcv-toolbar-btn" onClick={() => setSettingsOpen(true)} title="设置">
                <Settings size={16} />
              </button>
            </div>
          </header>

          <TeamPresenceBar agents={ops.agentSummaries} />
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
        </section>

        {!compact && (
          <div className="tcv-ops-side">
            <OpsSidebar
              open
              lens={opsLens}
              onLensChange={setOpsLens}
              ops={ops}
              onAgentClick={ops.selectAgent}
              onTaskClick={ops.selectTask}
            />
          </div>
        )}

        {compact && (
          <OpsSidebar
            open={opsPanelOpen}
            lens={opsLens}
            onLensChange={setOpsLens}
            ops={ops}
            onAgentClick={ops.selectAgent}
            onTaskClick={ops.selectTask}
            showClose
            onClose={closeOpsPanel}
          />
        )}

        {!compact && previewArtifact && (
          <aside className="tcv-preview">
            <WebPreviewPane artifact={previewArtifact} onClose={closePreview} />
          </aside>
        )}
      </div>

      {showPreviewModal && (
        <div className="tcv-preview-modal">
          <WebPreviewPane artifact={previewArtifact} onClose={closePreview} />
        </div>
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profileName={templateName}
      />
    </div>
  );
}
