import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import Sidebar from "./react/components/Sidebar";
import TopBar from "./react/components/TopBar";
import PreviewDrawer from "./react/components/PreviewDrawer";
import { useAgentBootstrap } from "./react/hooks/use-agent-bootstrap";
import { useResponsiveSidebar } from "./react/hooks/use-responsive-sidebar";
import { useSessionState } from "./react/hooks/use-session-state";
import {
  handleOAuthCallback,
  isAuthenticated,
  logout,
  subscribeAuth,
} from "./react/lib/auth";
type AppMode = "local" | "openclaw";

const RpcLogPanel = lazy(() => import("./react/components/RpcLogPanel"));
const SettingsModal = lazy(() => import("./react/components/SettingsModal"));
const OpenClawApp = lazy(() => import("./react/openclaw/OpenClawApp"));
const AgentationDevTools = import.meta.env.DEV
  ? lazy(() => import("./react/components/AgentationDevTools"))
  : null;

function LazyRpcLogPanel() {
  return (
    <Suspense fallback={null}>
      <RpcLogPanel />
    </Suspense>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<AppMode>("local");

  const { isMobileLike, isSidebarOpen, setIsSidebarOpen } = useResponsiveSidebar();
  const { agentStarting, agentError, retryAgent } = useAgentBootstrap(authenticated && mode === "local");
  const {
    sessions,
    currentSessionId,
    currentSession,
    pendingMessage,
    setPendingMessage,
    refreshSessions,
    selectSession,
    createNewSession,
    handleSessionCreated,
    deleteSessionById,
  } = useSessionState(authenticated);

  const [previewPath, setPreviewPath] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeAuth(() => {
        const nextAuthenticated = isAuthenticated();
        setAuthenticated(nextAuthenticated);
        if (!nextAuthenticated) {
          setMode("local");
        }
      }),
    [],
  );

  useEffect(() => {
    handleOAuthCallback().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.path) setPreviewPath(detail.path);
    };
    window.addEventListener("preview-file", handler);
    return () => window.removeEventListener("preview-file", handler);
  }, []);

  const title = useMemo(() => {
    if (!currentSession) return "新会话";
    return currentSession.title.replace(/[*_~`#]/g, "").trim() || "新会话";
  }, [currentSession]);

  if (!authenticated) {
    return <LoginPanel />;
  }

  if (mode === "openclaw") {
    return (
      <Suspense
        fallback={
          <div className="agent-loading">
            <LoaderCircle size={24} className="spinning" />
            <p>正在进入 OpenClaw...</p>
          </div>
        }
      >
        <OpenClawApp onBack={() => setMode("local")} />
      </Suspense>
    );
  }

  if (agentStarting) {
    return (
      <>
        <div className="agent-loading">
          <LoaderCircle size={24} className="spinning" />
          <p>正在启动 AI Agent</p>
        </div>
        <LazyRpcLogPanel />
      </>
    );
  }

  if (agentError) {
    return (
      <>
        <div className="agent-error">
          <p>
            <AlertTriangle size={16} />
            {agentError}
          </p>
          <button onClick={retryAgent}>重试</button>
          <button onClick={() => logout()}>退出登录</button>
        </div>
        <LazyRpcLogPanel />
      </>
    );
  }

  return (
    <div className="app-layout">
      {isSidebarOpen && isMobileLike && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭会话列表"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar
        open={isSidebarOpen}
        mobileLike={isMobileLike}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={(sessionId) => {
          selectSession(sessionId);
          if (isMobileLike) {
            setIsSidebarOpen(false);
          }
        }}
        onNew={() => {
          createNewSession();
          if (isMobileLike) {
            setIsSidebarOpen(false);
          }
        }}
        onClose={() => setIsSidebarOpen(false)}
        onDelete={deleteSessionById}
      />

      <div className="main-area">
        <TopBar
          title={title}
          sidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          onOpenSettings={() => setShowSettings(true)}
          onToggleOpenClaw={() => setMode("openclaw")}
        />

        {currentSession ? (
          <ChatView
            session={currentSession}
            pendingMessage={pendingMessage}
            clearPending={() => setPendingMessage(null)}
            onSessionUpdate={refreshSessions}
          />
        ) : (
          <NewSessionPanel
            onSessionCreated={handleSessionCreated}
          />
        )}
      </div>
      <PreviewDrawer
        filePath={previewPath}
        workspace={currentSession?.workspacePath}
        onClose={() => setPreviewPath(null)}
      />
      <LazyRpcLogPanel />
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {AgentationDevTools && (
        <Suspense fallback={null}>
          <AgentationDevTools />
        </Suspense>
      )}
    </div>
  );
}
