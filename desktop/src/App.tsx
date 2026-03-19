import { AlertTriangle, Bug, LoaderCircle, MessageCircleWarning } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import Sidebar from "./react/components/Sidebar";
import TopBar from "./react/components/TopBar";
import PreviewDrawer from "./react/components/PreviewDrawer";
import TaskPanel from "./react/components/TaskPanel";
import { useAgentBootstrap } from "./react/hooks/use-agent-bootstrap";
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
import type { FeedbackDraft } from "./react/lib/feedback";
import { getLatestError, subscribeErrors, buildDraftForError } from "./react/lib/feedback";
import { syncMemory } from "./react/lib/memory-sync";

const RpcLogPanel = lazy(() => import("./react/components/RpcLogPanel"));
const SettingsModal = lazy(() => import("./react/components/SettingsModal"));
const AgentationDevTools = import.meta.env.DEV
  ? lazy(() => import("./react/components/AgentationDevTools"))
  : null;

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [showSettings, setShowSettings] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(() => getSettings().debugLogEnabled);
  const [showRpcLog, setShowRpcLog] = useState(false);
  const [feedbackPrefill, setFeedbackPrefill] = useState<FeedbackDraft | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "model" | "memory" | "skills" | "feedback">("general");
  const [latestError, setLatestError] = useState(getLatestError);
  const [streamingSessions, setStreamingSessions] = useState<Set<string>>(() => new Set());
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(() => new Set());

  const { isMobileLike, isSidebarOpen, setIsSidebarOpen } = useResponsiveSidebar();
  const { bootstrapDone, bootstrapError, retryBootstrap, transport } = useAgentBootstrap(authenticated);

  // One-time memory sync on app ready (after auth + local agent ready)
  const memorySyncDoneRef = useRef(false);
  useEffect(() => {
    if (!authenticated) {
      memorySyncDoneRef.current = false;
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !bootstrapDone || memorySyncDoneRef.current) return;
    memorySyncDoneRef.current = true;
    if (getSettings().memorySyncEnabled) {
      syncMemory().catch(() => {});
    }
  }, [authenticated, bootstrapDone]);

  useEffect(() => subscribeErrors(() => setLatestError(getLatestError())), []);

  const openFeedbackForError = useCallback(async () => {
    const err = latestError;
    if (!err) return;
    const draft = await buildDraftForError(err);
    setFeedbackPrefill(draft);
    setSettingsInitialTab("feedback");
    setShowSettings(true);
  }, [latestError]);

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
    deleteSessionById,
  } = useSessionState(authenticated);

  const [authExpiredHint, setAuthExpiredHint] = useState(false);

  useEffect(
    () =>
      subscribeAuth(() => {
        const next = isAuthenticated();
        setAuthenticated(next);
        if (!next) setTaskPanelOpen(false);
      }),
    [],
  );

  useEffect(() => {
    const handler = () => setAuthExpiredHint(true);
    window.addEventListener("auth-expired", handler);
    return () => window.removeEventListener("auth-expired", handler);
  }, []);

  // Cloud container connection is no longer used — local sidecar handles all conversations.

  useEffect(() => {
    handleOAuthCallback().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.path) {
        setPreviewPath((prev) => prev === detail.path ? null : detail.path);
        setTaskPanelOpen(false);
      }
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

  if (!bootstrapDone && !bootstrapError) {
    return (
      <div className="agent-loading">
        <LoaderCircle size={24} className="spinning" />
        <p>正在初始化本地 Agent</p>
        <button className="agent-debug-btn" onClick={() => setShowRpcLog(v => !v)}>
          <Bug size={14} />
          调试日志
        </button>
        {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="agent-error">
        <p>
          <AlertTriangle size={16} />
          {bootstrapError}
        </p>
        <button onClick={retryBootstrap}>重试</button>
        <button onClick={() => logout()}>退出登录</button>
        <button className="agent-debug-btn" onClick={() => setShowRpcLog(v => !v)}>
          <Bug size={14} />
          调试日志
        </button>
        {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}
      </div>
    );
  }

  const showTaskPanel = taskPanelOpen;

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
          onOpenSettings={() => {
            setSettingsInitialTab("general");
            setFeedbackPrefill(null);
            setShowSettings(true);
          }}
          taskPanelOpen={showTaskPanel}
          onToggleTaskPanel={() => {
            setTaskPanelOpen((v) => {
              if (!v) setPreviewPath(null);
              return !v;
            });
          }}
          debugEnabled={debugEnabled}
          showRpcLog={showRpcLog}
          onToggleRpcLog={() => setShowRpcLog(v => !v)}
          updatePhase={updater.phase}
          updateVersion={updater.info?.version ?? null}
          onInstallUpdate={updater.doInstall}
        />

        <div className={`content-row${showTaskPanel ? " oc-drawer-active" : ""}${previewPath ? " preview-active" : ""}`}>
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
                key={currentSession.id}
                session={currentSession}
                pendingMessage={pendingMessage}
                pendingFiles={pendingFiles}
                clearPending={() => { setPendingMessage(null); setPendingFiles([]); }}
                onSessionUpdate={refreshSessions}
                transport={transport}
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

          <div className={`oc-drawer${showTaskPanel ? " open" : ""}`}>
            <div className="oc-drawer-inner">
              {showTaskPanel && (
                <TaskPanel
                  results={[]}
                  onClearResults={() => {}}
                  onCreateCronTask={async (prompt) => {
                    createNewSession();
                    setPendingMessage(prompt);
                  }}
                  onClose={() => setTaskPanelOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showRpcLog && <Suspense fallback={null}><RpcLogPanel onClose={() => setShowRpcLog(false)} /></Suspense>}

      {latestError && Date.now() - latestError.ts < 300_000 && (
        <button
          className="floating-feedback-btn"
          onClick={openFeedbackForError}
          title={latestError.title}
        >
          <MessageCircleWarning size={16} />
          反馈问题
        </button>
      )}

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => {
              setShowSettings(false);
              setFeedbackPrefill(null);
              setSettingsInitialTab("general");
              const d = getSettings().debugLogEnabled;
              setDebugEnabled(d);
              if (!d) setShowRpcLog(false);
            }}
            initialTab={settingsInitialTab}
            feedbackPrefill={feedbackPrefill}
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
