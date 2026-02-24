import { Agentation } from "agentation";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import Sidebar from "./react/components/Sidebar";
import TopBar from "./react/components/TopBar";
import {
  fetchAgentConfig,
  handleOAuthCallback,
  isAuthenticated,
  logout,
  subscribeAuth,
} from "./react/lib/auth";
import { deleteSession, getSession, listSessions } from "./react/lib/sessions";
import type { ChatSession } from "./react/types";

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [agentStarting, setAgentStarting] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const isTauriEnv = typeof window !== "undefined" && "__TAURI__" in window;

  useEffect(() => subscribeAuth(() => setAuthenticated(isAuthenticated())), []);

  useEffect(() => {
    handleOAuthCallback().catch(() => {});
  }, []);

  async function refreshSessions() {
    if (!isAuthenticated()) return;
    const list = await listSessions();
    setSessions(list);
  }

  useEffect(() => {
    refreshSessions().catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || agentRunning) return;

    // Browser dev mode expects vm-agent to run separately; no sidecar boot needed.
    if (!isTauriEnv) {
      setAgentRunning(true);
      setAgentStarting(false);
      setAgentError(null);
      return;
    }

    if (agentStarting) return;

    setAgentStarting(true);
    setAgentError(null);
    fetchAgentConfig()
      .then(async (config) => {
        const { invoke } = await import("@tauri-apps/api/core");
        const agentDir = import.meta.env.VITE_AGENT_DIR || "../../vm-agent";
        await invoke("start_agent", {
          agentDir,
          envVars: {
            LLM_PROXY_URL: config.llm_proxy_url,
            LLM_PROXY_KEY: config.llm_proxy_key,
          },
        });
        setAgentRunning(true);
      })
      .catch((err) => {
        setAgentError(err instanceof Error ? err.message : "Agent 启动失败");
      })
      .finally(() => setAgentStarting(false));
  }, [authenticated, agentRunning, agentStarting, isTauriEnv]);

  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }

    getSession(currentSessionId).then((session) => {
      if (session) setCurrentSession(session);
    }).catch(() => {});
  }, [currentSessionId]);

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
        <button onClick={() => setAgentRunning(false)}>重试</button>
        <button onClick={() => logout()}>退出登录</button>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={(sessionId) => setCurrentSessionId(sessionId)}
        onNew={() => setCurrentSessionId(null)}
        onDelete={async (sessionId) => {
          await deleteSession(sessionId);
          await refreshSessions();
          if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
          }
        }}
      />

      <div className="main-area">
        <TopBar title={title} />

        {currentSession ? (
          <ChatView
            session={currentSession}
            pendingMessage={pendingMessage}
            clearPending={() => setPendingMessage(null)}
            onSessionUpdate={refreshSessions}
          />
        ) : (
          <NewSessionPanel
            onSessionCreated={(session, firstMessage) => {
              setSessions((prev) => [session, ...prev]);
              setCurrentSessionId(session.id);
              setPendingMessage(firstMessage);
            }}
          />
        )}
      </div>
      <Agentation />
    </div>
  );
}
