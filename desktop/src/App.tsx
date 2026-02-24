import { Agentation } from "agentation";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ChatView from "./react/components/ChatView";
import LoginPanel from "./react/components/LoginPanel";
import NewSessionPanel from "./react/components/NewSessionPanel";
import RpcLogPanel from "./react/components/RpcLogPanel";
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileLike, setIsMobileLike] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)").matches : false,
  );
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [agentBootNonce, setAgentBootNonce] = useState(0);
  const [agentStarting, setAgentStarting] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const isTauriEnv = isTauri();

  useEffect(() => subscribeAuth(() => setAuthenticated(isAuthenticated())), []);

  useEffect(() => {
    handleOAuthCallback().catch(() => {});
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileLike(event.matches);
    };

    setIsMobileLike(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarOpen]);

  async function refreshSessions() {
    if (!isAuthenticated()) return;
    const list = await listSessions();
    setSessions(list);
  }

  useEffect(() => {
    refreshSessions().catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    // RPC transport only works in the Tauri runtime.
    if (!isTauriEnv) {
      setAgentStarting(false);
      setAgentRunning(false);
      setAgentError("当前版本仅支持 Tauri 运行时（RPC sidecar）");
      return;
    }

    setAgentStarting(true);
    setAgentRunning(false);
    setAgentError(null);

    withTimeout(
      (async () => {
        let envVars: Record<string, string> = {};
        try {
          const config = await fetchAgentConfig();
          envVars = {
            LLM_PROXY_URL: config.llm_proxy_url,
            LLM_PROXY_KEY: config.llm_proxy_key,
          };
        } catch (error) {
          console.warn("[agent] fetchAgentConfig failed, fallback to vm-agent local env", error);
        }

        const agentDir = import.meta.env.VITE_AGENT_DIR || "../vm-agent";
        await invoke("start_agent", {
          agentDir,
          envVars,
        });
      })(),
      20000,
      "Agent 启动超时，请点击右下角 RPC 日志排查",
    )
      .then(() => {
        if (cancelled) return;
        setAgentRunning(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentRunning(false);
        setAgentError(err instanceof Error ? err.message : "Agent 启动失败");
      })
      .finally(() => {
        if (cancelled) return;
        setAgentStarting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, isTauriEnv, agentBootNonce]);

  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }

    // Skip fetch if we already have the correct session loaded
    // (e.g., from onSessionCreated setting it directly)
    if (currentSession?.id === currentSessionId) return;

    let cancelled = false;
    getSession(currentSessionId).then((session) => {
      if (!cancelled && session) setCurrentSession(session);
    }).catch(() => {});
    return () => { cancelled = true; };
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
      <>
        <div className="agent-loading">
          <LoaderCircle size={24} className="spinning" />
          <p>正在启动 AI Agent</p>
        </div>
        <RpcLogPanel />
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
          <button onClick={() => setAgentBootNonce((value) => value + 1)}>重试</button>
          <button onClick={() => logout()}>退出登录</button>
        </div>
        <RpcLogPanel />
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
          setCurrentSessionId(sessionId);
          if (isMobileLike) {
            setIsSidebarOpen(false);
          }
        }}
        onNew={() => {
          setCurrentSessionId(null);
          if (isMobileLike) {
            setIsSidebarOpen(false);
          }
        }}
        onClose={() => setIsSidebarOpen(false)}
        onDelete={async (sessionId) => {
          await deleteSession(sessionId);
          await refreshSessions();
          if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
          }
        }}
      />

      <div className="main-area">
        <TopBar
          title={title}
          sidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
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
            onSessionCreated={(session, firstMessage) => {
              setSessions((prev) => [session, ...prev]);
              setCurrentSession(session);
              setCurrentSessionId(session.id);
              setPendingMessage(firstMessage);
            }}
          />
        )}
      </div>
      <RpcLogPanel />
      <Agentation />
    </div>
  );
}
