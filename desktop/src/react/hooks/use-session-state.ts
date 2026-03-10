import { useCallback, useEffect, useState } from "react";
import { isAuthenticated } from "../lib/auth";
import { createSession, deleteSession, getSession, listSessions } from "../lib/sessions";
import type { AttachedFile, ChatSession } from "../types";

const SESSION_REFRESH_INTERVAL_MS = 5000; // 5 seconds

export function useSessionState(authenticated: boolean) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    if (!isAuthenticated()) return;
    try {
      const list = await listSessions();
      setSessions(list);
      setSessionError(null);
    } catch (err) {
      console.warn("[sessions] refresh failed:", err);
      setSessionError("会话列表加载失败");
    }
  }, []);

  useEffect(() => {
    if (authenticated) return;
    setSessions([]);
    setCurrentSessionId(null);
    setCurrentSession(null);
    setPendingMessage(null);
    setPendingFiles([]);
  }, [authenticated]);

  useEffect(() => {
    refreshSessions();
  }, [authenticated, refreshSessions]);

  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }

    // Anonymous sessions are local-only, resolve from the sessions list
    const anon = sessions.find((s) => s.id === currentSessionId && s.anonymous);
    if (anon) {
      setCurrentSession(anon);
      return;
    }

    // Always fetch from DB (single source of truth)
    // This ensures we get the latest messages even if switching back to a running session
    let cancelled = false;
    getSession(currentSessionId)
      .then((session) => {
        if (!cancelled && session) {
          setCurrentSession(session);
          setSessionError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[sessions] load failed:", err);
          setSessionError("会话加载失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, sessions]);

  // Periodic refresh of current session (DB as single source of truth)
  // This ensures we see updates from other devices or background processes
  useEffect(() => {
    if (!currentSessionId || !currentSession || currentSession.anonymous) return;

    const interval = setInterval(async () => {
      try {
        const updated = await getSession(currentSessionId);
        if (updated) {
          setCurrentSession(updated);
        }
      } catch (err) {
        console.warn("[sessions] periodic refresh failed:", err);
      }
    }, SESSION_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [currentSessionId, currentSession?.anonymous]);

  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const createNewSession = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const handleSessionCreated = useCallback((session: ChatSession, firstMessage: string, files: AttachedFile[] = []) => {
    setSessions((prev) => [session, ...prev]);
    setCurrentSession(session);
    setCurrentSessionId(session.id);
    setPendingMessage(firstMessage);
    setPendingFiles(files);
  }, []);

  const ensureCoworkSession = useCallback(async () => {
    const session = await createSession({ type: "cowork" });
    setSessions((prev) => [session, ...prev]);
    setCurrentSession(session);
    setCurrentSessionId(session.id);
  }, []);

  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      const isAnon = sessions.find((s) => s.id === sessionId)?.anonymous;
      if (isAnon) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      } else {
        await deleteSession(sessionId);
        await refreshSessions();
      }
      setCurrentSessionId((prev) => (prev === sessionId ? null : prev));
    },
    [refreshSessions, sessions],
  );

  return {
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
  };
}
