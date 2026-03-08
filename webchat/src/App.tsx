import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatSession, ChatMessage, StreamBlock } from "./types";
import { WSClient, type ConnectionState, type WSFrame } from "./lib/ws-client";
import { parseFrame, applyEvent } from "./lib/event-parser";
import { listSessions, createSession, getSession, updateSession, deleteSession, generateTitle } from "./lib/sessions";
import { posthog } from "./lib/posthog";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Composer from "./components/Composer";
import ContainerPanel from "./components/ContainerPanel";
import CronPanel from "./components/CronPanel";

export type ActiveTab = "chat" | "container" | "cron";

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [connMsg, setConnMsg] = useState("正在连接...");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");

  const blocksRef = useRef<StreamBlock[]>([]);
  const streamingRef = useRef(false);
  const activeSessionRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const renderTimer = useRef<number | null>(null);

  // Keep refs in sync
  useEffect(() => { activeSessionRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const scheduleRender = useCallback(() => {
    if (renderTimer.current !== null) return;
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      setBlocks([...blocksRef.current]);
    }, 50);
  }, []);

  const finishStream = useCallback(() => {
    if (!streamingRef.current) return;
    streamingRef.current = false;

    // Collect streamed text into assistant message
    const textParts = blocksRef.current.filter((b) => b.type === "text").map((b) => b.content);
    const fullText = textParts.join("");
    if (fullText) {
      const assistantMsg: ChatMessage = { role: "assistant", content: fullText, blocks: [...blocksRef.current] };
      const updated = [...messagesRef.current, assistantMsg];
      setMessages(updated);
      messagesRef.current = updated;
      posthog.capture('chat_response_received', { length: fullText.length });

      // Persist to gateway
      const sid = activeSessionRef.current;
      if (sid) {
        updateSession(sid, { messages: updated }).catch(() => {});
        // Auto-generate title from first assistant message
        if (updated.filter((m) => m.role === "assistant").length === 1) {
          const title = generateTitle(fullText);
          updateSession(sid, { title }).catch(() => {});
          setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, title } : s));
        }
      }
    }

    blocksRef.current = [];
    setBlocks([]);
    setStreaming(false);
  }, []);

  // WebSocket client
  const wsRef = useRef<WSClient | null>(null);

  useEffect(() => {
    const ws = new WSClient({
      onStateChange(state, msg) {
        setConnState(state);
        setConnMsg(msg);
      },
      onFrame(frame: WSFrame) {
        const parsed = parseFrame(frame);

        if (parsed.kind === "proxy_ready") {
          setConnState("connected");
          setConnMsg("已连接");
          return;
        }
        if (parsed.kind === "proxy_error") {
          setConnState("connecting");
          setConnMsg(parsed.error || "代理错误");
          return;
        }

        if (parsed.kind === "error") {
          setError(parsed.error || "未知错误");
          posthog.capture('chat_error', { error: parsed.error });
          finishStream();
          return;
        }

        if (parsed.kind === "done") {
          finishStream();
          return;
        }

        // Start streaming on first content event
        if (!streamingRef.current && (parsed.kind === "text_delta" || parsed.kind === "thinking_start" || parsed.kind === "tool_start")) {
          streamingRef.current = true;
          blocksRef.current = [];
          setStreaming(true);
          setError(null);
        }

        if (applyEvent(blocksRef.current, parsed)) {
          scheduleRender();
        }
      },
    });
    wsRef.current = ws;
    ws.connect();
    return () => ws.dispose();
  }, [scheduleRender, finishStream]);

  // Load sessions on mount
  useEffect(() => {
    listSessions()
      .then((list) => {
        setSessions(list.sort((a, b) => b.updatedAt - a.updatedAt));
      })
      .catch(() => {});
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      setBlocks([]);
      setError(null);
      setSidebarOpen(false);
      posthog.capture('chat_session_created');
    } catch {
      // ignore
    }
  }, []);

  const handleSelectSession = useCallback(async (id: string) => {
    if (streaming) return;
    setActiveSessionId(id);
    setSidebarOpen(false);
    setBlocks([]);
    setError(null);
    try {
      const session = await getSession(id);
      setMessages(session?.messages || []);
    } catch {
      setMessages([]);
    }
  }, [streaming]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {
      // ignore
    }
  }, [activeSessionId]);

  const handleSend = useCallback(async (text: string) => {
    if (!wsRef.current?.isConnected) return;

    // Ensure we have an active session
    let sid = activeSessionRef.current;
    if (!sid) {
      try {
        const session = await createSession();
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        sid = session.id;
      } catch {
        return;
      }
    }

    // Add user message
    const userMsg: ChatMessage = { role: "user", content: text };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);
    messagesRef.current = updated;
    setError(null);

    // Persist user message
    updateSession(sid, { messages: updated }).catch(() => {});

    // Send via WS with session_id to avoid shared in-flight lock
    wsRef.current.send("prompt", text, { session_id: sid });
    posthog.capture('chat_message_sent', { session_id: sid });
  }, []);

  const handleAbort = useCallback(() => {
    wsRef.current?.sendAbort();
    finishStream();
  }, [finishStream]);

  return (
    <div className="app-layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        activeTab={activeTab}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onTabChange={setActiveTab}
      />
      <div className="chat-main">
        <div className="status-bar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: "0.25rem" }}>
            ☰
          </button>
          <span className={`status-dot ${connState}`} />
          <span>{connMsg}</span>
        </div>
        {activeTab === "chat" && (
          <>
            <ChatView messages={messages} blocks={blocks} streaming={streaming} error={error} />
            <Composer
              disabled={connState !== "connected"}
              streaming={streaming}
              onSend={handleSend}
              onAbort={handleAbort}
            />
          </>
        )}
        {activeTab === "container" && <ContainerPanel />}
        {activeTab === "cron" && <CronPanel />}
      </div>
    </div>
  );
}
