import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatSession, ChatMessage, StreamBlock } from "./types";
import { WSClient, type WSFrame } from "./lib/ws-client";
import { parseFrame, applyEvent, type ParsedEvent } from "./lib/event-parser";
import { extractText, streamBlocksToContent, toContentItems } from "./lib/message-extract";
import { listSessions, createSession, getSession, updateSession, deleteSession, generateTitle } from "./lib/sessions";
import {
  fetchInstalledTeams,
  getCachedTeams,
  getStoredTeamSessionKey,
  setStoredTeamSessionKey,
} from "./lib/teams";
import { posthog } from "./lib/posthog";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Composer from "./components/Composer";
import ContainerPanel from "./components/ContainerPanel";
import CronPanel from "./components/CronPanel";
import TeamSelector from "./components/TeamSelector";

export type ActiveTab = "chat" | "container" | "cron";

function isContentEvent(event: ParsedEvent): boolean {
  return (
    event.kind === "text_delta" ||
    event.kind === "chat_delta" ||
    event.kind === "thinking_start" ||
    event.kind === "thinking_delta" ||
    event.kind === "tool_start" ||
    event.kind === "tool_update"
  );
}

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [teams, setTeams] = useState(() => getCachedTeams());
  const [activeTeamSessionKey, setActiveTeamSessionKey] = useState(() => getStoredTeamSessionKey(getCachedTeams()));
  const [teamLoading, setTeamLoading] = useState(() => getCachedTeams().length <= 1);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connState, setConnState] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [connMsg, setConnMsg] = useState("正在连接...");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");

  const blocksRef = useRef<StreamBlock[]>([]);
  const streamTextRef = useRef("");
  const streamingRef = useRef(false);
  const activeSessionRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const activeTeamSessionKeyRef = useRef(activeTeamSessionKey);
  const renderTimer = useRef<number | null>(null);
  const wsRef = useRef<WSClient | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeTeamSessionKeyRef.current = activeTeamSessionKey;
    setStoredTeamSessionKey(activeTeamSessionKey);
    wsRef.current?.setSessionKey(activeTeamSessionKey);
  }, [activeTeamSessionKey]);

  useEffect(
    () => () => {
      if (renderTimer.current !== null) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
    },
    [],
  );

  const scheduleRender = useCallback((delayMs = 50) => {
    if (renderTimer.current !== null) return;
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      setBlocks([...blocksRef.current]);
    }, delayMs);
  }, []);

  const finishStream = useCallback((finalMessage?: unknown) => {
    if (!streamingRef.current) return;
    streamingRef.current = false;

    const streamedBlocks = [...blocksRef.current];
    const fallbackText = streamedBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("");

    const finalContent = toContentItems(asContentSource(finalMessage));
    const content = finalContent.length > 0 ? finalContent : streamBlocksToContent(streamedBlocks);
    const hasAnyOutput = content.length > 0 || streamedBlocks.length > 0 || fallbackText.trim().length > 0;

    if (hasAnyOutput) {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: content.length > 0 ? content : fallbackText,
        blocks: streamedBlocks.length > 0 ? streamedBlocks : undefined,
        timestamp: Date.now(),
      };
      const updated = [...messagesRef.current, assistantMsg];
      const assistantText = extractText(assistantMsg.content) || fallbackText;

      setMessages(updated);
      messagesRef.current = updated;
      posthog.capture("chat_response_received", { length: assistantText.length });

      const sid = activeSessionRef.current;
      if (sid) {
        updateSession(sid, { messages: updated }).catch(() => {});
        if (assistantText && updated.filter((m) => m.role === "assistant").length === 1) {
          const title = generateTitle(assistantText);
          updateSession(sid, { title }).catch(() => {});
          setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, title } : s)));
        }
      }
    }

    streamTextRef.current = "";
    blocksRef.current = [];
    setBlocks([]);
    setStreaming(false);
  }, []);

  useEffect(() => {
    const ws = new WSClient({
      sessionKey: activeTeamSessionKeyRef.current,
      onStateChange(state, msg) {
        setConnState(state);
        setConnMsg(msg);
      },
      onFrame(frame: WSFrame) {
        let parsed = parseFrame(frame);

        if (parsed.kind === "proxy_ready") {
          setConnState("connected");
          setConnMsg("已连接");
          return;
        }

        if (parsed.kind === "error") {
          setError(parsed.error || "未知错误");
          posthog.capture("chat_error", { error: parsed.error });
          finishStream();
          return;
        }

        if (parsed.kind === "chat_delta") {
          const next = parsed.text || "";
          const prev = streamTextRef.current;
          if (!next) return;

          if (prev && next.startsWith(prev)) {
            const delta = next.slice(prev.length);
            streamTextRef.current = next;
            if (!delta) return;
            parsed = { kind: "text_delta", text: delta };
          } else if (!prev) {
            streamTextRef.current = next;
            parsed = { kind: "text_delta", text: next };
          } else {
            // Non-monotonic cumulative delta. Keep current UI and wait for final.
            return;
          }
        }

        if (parsed.kind === "done") {
          finishStream(parsed.message);
          return;
        }

        if (!streamingRef.current && isContentEvent(parsed)) {
          streamingRef.current = true;
          streamTextRef.current = "";
          blocksRef.current = [];
          setStreaming(true);
          setError(null);
        }

        const applied = applyEvent(blocksRef.current, parsed);
        if (applied.changed) {
          scheduleRender(applied.renderDelayMs);
        }
      },
    });

    wsRef.current = ws;
    ws.connect();
    return () => ws.dispose();
  }, [scheduleRender, finishStream]);

  useEffect(() => {
    let cancelled = false;
    setTeamLoading(true);

    fetchInstalledTeams()
      .then((nextTeams) => {
        if (cancelled) return;
        setTeams(nextTeams);
        setTeamLoading(false);

        setActiveTeamSessionKey((prev) => {
          if (nextTeams.some((team) => team.sessionKey === prev)) {
            return prev;
          }
          return getStoredTeamSessionKey(nextTeams);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setTeamLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
      posthog.capture("chat_session_created");
    } catch {
      // ignore
    }
  }, []);

  const handleSelectSession = useCallback(
    async (id: string) => {
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
    },
    [streaming],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
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
    },
    [activeSessionId],
  );

  const handleSend = useCallback(async (text: string) => {
    if (!wsRef.current?.isConnected) return;

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

    const userMsg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);
    messagesRef.current = updated;
    setError(null);

    updateSession(sid, { messages: updated }).catch(() => {});

    wsRef.current.send("prompt", text);
    posthog.capture("chat_message_sent", {
      session_id: sid,
      session_key: activeTeamSessionKeyRef.current,
    });
  }, []);

  const handleAbort = useCallback(() => {
    wsRef.current?.sendAbort();
    finishStream();
  }, [finishStream]);

  const handleTeamChange = useCallback(
    (sessionKey: string) => {
      if (sessionKey === activeTeamSessionKeyRef.current) return;

      if (streamingRef.current) {
        wsRef.current?.sendAbort();
        finishStream();
      }

      setActiveTeamSessionKey(sessionKey);
      setActiveSessionId(null);
      activeSessionRef.current = null;
      setMessages([]);
      messagesRef.current = [];
      setBlocks([]);
      blocksRef.current = [];
      streamTextRef.current = "";
      setStreaming(false);
      setError(null);
      setSidebarOpen(false);
    },
    [finishStream],
  );

  return (
    <div className="app-layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        activeId={activeSessionId}
        activeTab={activeTab}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onTabChange={setActiveTab}
        teamSelector={
          <TeamSelector
            teams={teams}
            activeSessionKey={activeTeamSessionKey}
            loading={teamLoading}
            onChange={handleTeamChange}
          />
        }
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
            <Composer disabled={connState !== "connected"} streaming={streaming} onSend={handleSend} onAbort={handleAbort} />
          </>
        )}
        {activeTab === "container" && <ContainerPanel />}
        {activeTab === "cron" && <CronPanel />}
      </div>
    </div>
  );
}

function asContentSource(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const rec = message as Record<string, unknown>;
  if (Array.isArray(rec.content)) return rec.content;
  if (typeof rec.text === "string") return [{ type: "text", text: rec.text }];
  return message;
}
