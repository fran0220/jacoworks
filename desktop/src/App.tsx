import { AlertTriangle, Bug, LoaderCircle } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import Sidebar from "./react/components/Sidebar";
import TopBar from "./react/components/TopBar";
import PreviewDrawer from "./react/components/PreviewDrawer";
import { useAgentBootstrap } from "./react/hooks/use-agent-bootstrap";
import { useOpenClawConnection } from "./react/hooks/use-openclaw-connection";
import { useUpdater } from "./react/hooks/use-updater";
import { useResponsiveSidebar } from "./react/hooks/use-responsive-sidebar";
import { useSessionState } from "./react/hooks/use-session-state";
import {
  handleOAuthCallback,
  isAuthenticated,
  logout,
  subscribeAuth,
} from "./react/lib/auth";
import { getSettings } from "./react/lib/config";

const RpcLogPanel = lazy(() => import("./react/components/RpcLogPanel"));
const SettingsModal = lazy(() => import("./react/components/SettingsModal"));
const OpenClawApp = lazy(() => import("./react/openclaw/OpenClawApp"));
const AgentationDevTools = import.meta.env.DEV
  ? lazy(() => import("./react/components/AgentationDevTools"))
  : null;

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [showSettings, setShowSettings] = useState(false);
  const [openclawOpen, setOpenclawOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(() => getSettings().debugLogEnabled);
  const [showRpcLog, setShowRpcLog] = useState(false);

  const { isMobileLike, isSidebarOpen, setIsSidebarOpen } = useResponsiveSidebar();
  const { agentStarting, agentError, retryAgent } = useAgentBootstrap(authenticated);
  const ocConnection = useOpenClawConnection();
  const updater = useUpdater();
  const {
    sessions,
    currentSessionId,
    currentSession,
    pendingMessage,
    setPendingMessage,
    pendingFiles,
    setPendingFiles,
    refreshSessions,
    selectSession,
    createNewSession,
    handleSessionCreated,
    deleteSessionById,
  } = useSessionState(authenticated);

  useEffect(
    () =>
      subscribeAuth(() => {
        const nextAuthenticated = isAuthenticated();
        setAuthenticated(nextAuthenticated);
        if (!nextAuthenticated) {
          setOpenclawOpen(false);
        }
      }),
    [],
  );

  // Sync drawer open state with connection hook for unread tracking
  useEffect(() => {
    ocConnection.setDrawerOpen(openclawOpen);
  }, [openclawOpen, ocConnection.setDrawerOpen]);

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

  if (agentStarting) {
    return (
      <div className="agent-loading">
        <LoaderCircle size={24} className="spinning" />
        <p>正在启动 AI Agent</p>
        <button className="agent-debug-btn" onClick={() => setShowRpcLog(v => !v)}>
          <Bug size={14} />
          调试日志
        </button>
        {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}
      </div>
    );
  }

  if (agentError) {
    return (
      <div className="agent-error">
        <p>
          <AlertTriangle size={16} />
          {agentError}
        </p>
        <button onClick={retryAgent}>重试</button>
        <button onClick={() => logout()}>退出登录</button>
        <button className="agent-debug-btn" onClick={() => setShowRpcLog(v => !v)}>
          <Bug size={14} />
          调试日志
        </button>
        {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}
      </div>
    );
  }

  return (
    <div className="app-layout">
      {updater.phase === "available" && updater.info && (
        <div className="update-banner">
          <span>新版本 {updater.info.version} 可用</span>
          <button onClick={updater.doInstall}>下载更新</button>
        </div>
      )}
      {updater.phase === "downloading" && (
        <div className="update-banner">
          <LoaderCircle size={14} className="spinning" />
          <span>正在下载更新…</span>
        </div>
      )}
      {updater.phase === "done" && (
        <div className="update-banner update-banner--done">
          <span>更新完成，请重启应用生效</span>
        </div>
      )}
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
          if (isMobileLike) setIsSidebarOpen(false);
        }}
        onNew={() => {
          createNewSession();
          if (isMobileLike) setIsSidebarOpen(false);
        }}
        onClose={() => setIsSidebarOpen(false)}
        onDelete={deleteSessionById}
      />

      <div className="main-area">
        <TopBar
          title={title}
          sidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
          onOpenSettings={() => setShowSettings(true)}
          ocPhase={ocConnection.phase}
          ocStatusText={ocConnection.statusText}
          ocUnreadCount={ocConnection.unreadCount}
          openclawOpen={openclawOpen}
          onOpenClawChat={() => {
            setOpenclawOpen(true);
            ocConnection.connect();
          }}
          onCloseOpenClaw={() => setOpenclawOpen(false)}
          debugEnabled={debugEnabled}
          showRpcLog={showRpcLog}
          onToggleRpcLog={() => setShowRpcLog(v => !v)}
        />

        <div className={`content-row${openclawOpen ? " oc-drawer-active" : ""}`}>
          <div className="content-main">
            {currentSession ? (
              <ChatView
                session={currentSession}
                pendingMessage={pendingMessage}
                pendingFiles={pendingFiles}
                clearPending={() => { setPendingMessage(null); setPendingFiles([]); }}
                onSessionUpdate={refreshSessions}
              />
            ) : (
              <NewSessionPanel
                onSessionCreated={handleSessionCreated}
                initialMessage={pendingMessage}
                onConsumeInitial={() => setPendingMessage(null)}
              />
            )}
          </div>

          <PreviewDrawer
            filePath={previewPath}
            workspace={currentSession?.workspacePath}
            onClose={() => setPreviewPath(null)}
          />

          <div className={`oc-drawer${openclawOpen ? " open" : ""}`}>
            <div className="oc-drawer-inner">
              {openclawOpen && (
                <Suspense
                  fallback={
                    <div className="oc-drawer-loading">
                      <LoaderCircle size={20} className="spinning" />
                      <span>正在加载 OpenClaw...</span>
                    </div>
                  }
                >
                  <OpenClawApp
                    phase={ocConnection.phase}
                    statusText={ocConnection.statusText}
                    containerName={ocConnection.containerName}
                    errorText={ocConnection.errorText}
                    sseRef={ocConnection.sseRef}
                    onRetry={ocConnection.retry}
                    setEventHandler={ocConnection.setEventHandler}
                    setResponseHandler={ocConnection.setResponseHandler}
                    onClose={() => setOpenclawOpen(false)}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </div>

      {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => {
              setShowSettings(false);
              const d = getSettings().debugLogEnabled;
              setDebugEnabled(d);
              if (!d) setShowRpcLog(false);
            }}
            onCreateSkill={() => {
              setShowSettings(false);
              const d = getSettings().debugLogEnabled;
              setDebugEnabled(d);
              if (!d) setShowRpcLog(false);
              createNewSession();
              setPendingMessage("/building-skills 我想创建一个技能：");
            }}
            onInstallSkill={(url) => {
              setShowSettings(false);
              const d = getSettings().debugLogEnabled;
              setDebugEnabled(d);
              if (!d) setShowRpcLog(false);
              createNewSession();
              setPendingMessage(`/building-skills 请从这个 GitHub 仓库安装技能：${url}`);
            }}
          />
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
