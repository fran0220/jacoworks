import { AlertTriangle, Bug, LoaderCircle } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import Sidebar from "./react/components/Sidebar";
import TopBar from "./react/components/TopBar";
import PreviewDrawer from "./react/components/PreviewDrawer";
import TaskPanel from "./react/components/TaskPanel";
import { useAgentBootstrap } from "./react/hooks/use-agent-bootstrap";
import { useCoworkConnection } from "./react/hooks/use-cowork-connection";
import { useCronResults } from "./react/hooks/use-cron-results";
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
import { syncMemory } from "./react/lib/memory-sync";

const RpcLogPanel = lazy(() => import("./react/components/RpcLogPanel"));
const SettingsModal = lazy(() => import("./react/components/SettingsModal"));
const AgentationDevTools = import.meta.env.DEV
  ? lazy(() => import("./react/components/AgentationDevTools"))
  : null;

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [showSettings, setShowSettings] = useState(false);
  const [coworkOpen, setCoworkOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(() => getSettings().debugLogEnabled);
  const [showRpcLog, setShowRpcLog] = useState(false);
  const [streamingSessions, setStreamingSessions] = useState<Set<string>>(() => new Set());
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(() => new Set());

  const { isMobileLike, isSidebarOpen, setIsSidebarOpen } = useResponsiveSidebar();
  const { agentStarting, agentError, retryAgent } = useAgentBootstrap(authenticated);

  // One-time memory sync on app ready (after auth + agent bootstrap)
  const memorySyncDoneRef = useRef(false);
  useEffect(() => {
    if (!authenticated || agentStarting || agentError || memorySyncDoneRef.current) return;
    memorySyncDoneRef.current = true;
    if (getSettings().memorySyncEnabled) {
      syncMemory().catch(() => {});
    }
  }, [authenticated, agentStarting, agentError]);
  const ocConnection = useCoworkConnection();
  const cronResults = useCronResults();
  const updater = useUpdater();
  const {
    sessions,
    currentSessionId,
    currentSession,
    sessionError,
    pendingMessage,
    setPendingMessage,
    pendingFiles,
    setPendingFiles,
    refreshSessions,
    selectSession,
    createNewSession,
    handleSessionCreated,
    ensureCoworkSession,
    deleteSessionById,
  } = useSessionState(authenticated);

  const [authExpiredHint, setAuthExpiredHint] = useState(false);

  useEffect(
    () =>
      subscribeAuth(() => {
        const next = isAuthenticated();
        setAuthenticated(next);
        if (!next) setCoworkOpen(false);
      }),
    [],
  );

  useEffect(() => {
    const handler = () => setAuthExpiredHint(true);
    window.addEventListener("auth-expired", handler);
    return () => window.removeEventListener("auth-expired", handler);
  }, []);

  // Auto-connect when user selects a cowork session from Sidebar
  useEffect(() => {
    if (currentSession?.type === "cowork") {
      ocConnection.connect();
    }
  }, [currentSession?.id, currentSession?.type, ocConnection.connect]);

  // Auto-open panel when cloud becomes ready
  useEffect(() => {
    if (ocConnection.phase === "ready") {
      setCoworkOpen(true);
    }
  }, [ocConnection.phase]);

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

  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, streaming: isStreaming } = (e as CustomEvent).detail;
      if (isStreaming) {
        setStreamingSessions((prev) => new Set(prev).add(id));
      } else {
        setStreamingSessions((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (id !== currentSessionIdRef.current) {
          setUnreadSessions((prev) => new Set(prev).add(id));
        }
      }
    };
    window.addEventListener("session-streaming-change", handler);
    return () => window.removeEventListener("session-streaming-change", handler);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
    setUnreadSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, [selectSession]);

  const title = useMemo(() => {
    if (!currentSession) return "新会话";
    return currentSession.title.replace(/[*_~`#]/g, "").trim() || "新会话";
  }, [currentSession]);

  if (!authenticated) {
    return <LoginPanel authExpiredHint={authExpiredHint} onClearHint={() => setAuthExpiredHint(false)} />;
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
        streamingSessions={streamingSessions}
        unreadSessions={unreadSessions}
        onSelect={(sessionId) => {
          handleSelectSession(sessionId);
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
          coworkOpen={coworkOpen}
          onToggleCloud={() => {
            if (ocConnection.phase === "idle" || ocConnection.phase === "error") {
              ocConnection.connect();
            } else if (ocConnection.phase === "ready") {
              setCoworkOpen((v) => !v);
            }
          }}
          debugEnabled={debugEnabled}
          showRpcLog={showRpcLog}
          onToggleRpcLog={() => setShowRpcLog(v => !v)}
        />

        <div className={`content-row${coworkOpen ? " oc-drawer-active" : ""}`}>
          <div className="content-main">
            {sessionError && (
              <div className="session-error-banner">
                <AlertTriangle size={14} />
                <span>{sessionError}</span>
                <button onClick={() => refreshSessions()}>重试</button>
              </div>
            )}
            {currentSession ? (
              <ChatView
                session={currentSession}
                pendingMessage={pendingMessage}
                pendingFiles={pendingFiles}
                clearPending={() => { setPendingMessage(null); setPendingFiles([]); }}
                onSessionUpdate={refreshSessions}
                cloudWsRef={ocConnection.wsRef}
                cloudReady={ocConnection.phase === "ready"}
                setCloudMessageHandler={ocConnection.setMessageHandler}
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

          <div className={`oc-drawer${coworkOpen ? " open" : ""}`}>
            <div className="oc-drawer-inner">
              {coworkOpen && ocConnection.phase === "ready" && (
                <TaskPanel
                  results={cronResults.results}
                  onClearResults={cronResults.clearResults}
                  onNewCoworkSession={ensureCoworkSession}
                  onCreateCronTask={async (prompt) => {
                    await ensureCoworkSession();
                    setPendingMessage(prompt);
                  }}
                  onClose={() => setCoworkOpen(false)}
                />
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
