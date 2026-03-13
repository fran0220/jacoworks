import { useCallback, useEffect, useState } from "react";
import { isAuthenticated } from "../lib/auth";
import { sessionStore } from "../lib/session-store";
import { createSession, deleteSession, listSessions } from "../lib/sessions";
import type { AttachedFile, ChatSession } from "../types";

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
      const localList = await sessionStore.listSessions();
      setSessions(localList);
      setSessionError(null);
    } catch (err) {
      console.warn("[sessions] local refresh failed:", err);
      try {
        const remoteList = await listSessions();
        setSessions(remoteList);
        setSessionError(null);
      } catch (remoteErr) {
        console.warn("[sessions] remote refresh failed:", remoteErr);
        setSessionError("会话列表加载失败");
      }
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

  // One-time server reconciliation after login
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const remoteSessions = await listSessions();
        if (cancelled) return;
        const localIds = new Set((await sessionStore.listSessions()).map(s => s.id));
        for (const rs of remoteSessions) {
          if (!localIds.has(rs.id)) {
            await sessionStore.createSession(rs).catch(() => {});
          }
        }
        const updated = await sessionStore.listSessions();
        if (!cancelled) setSessions(updated);
      } catch {
        // Non-critical — local data still works
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }

    const anon = sessions.find((s) => s.id === currentSessionId && s.anonymous);
    if (anon) {
      setCurrentSession(anon);
      return;
    }

    // Clear stale session immediately so ChatView won't briefly show old data
    setCurrentSession((prev) => (prev?.id === currentSessionId ? prev : null));

    let cancelled = false;
    sessionStore.getSession(currentSessionId)
      .then((session) => {
        if (!cancelled && session) {
          setCurrentSession(session);
          setSessionError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[sessions] local load failed:", err);
          setSessionError("会话加载失败");
        }
      });

    return () => { cancelled = true; };
  }, [currentSessionId, sessions]);

  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const createNewSession = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const handleSessionCreated = useCallback(async (session: ChatSession, firstMessage: string, files: AttachedFile[] = []) => {
    await sessionStore.createSession(session).catch(() => {});
    setSessions((prev) => [session, ...prev]);
    setCurrentSession(session);
    setCurrentSessionId(session.id);
    setPendingMessage(firstMessage);
    setPendingFiles(files);
  }, []);

  const ensureCoworkSession = useCallback(async () => {
    const session = await createSession({ type: "cowork" });
    await sessionStore.createSession(session).catch(() => {});
    setSessions((prev) => [session, ...prev]);
    setCurrentSession(session);
    setCurrentSessionId(session.id);
  }, []);

  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      const isAnon = sessions.find((s) => s.id === sessionId)?.anonymous;
      if (isAnon) {
        await sessionStore.deleteSession(sessionId).catch(() => {});
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      } else {
        await sessionStore.deleteSession(sessionId).catch(() => {});
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        deleteSession(sessionId).catch((err) =>
          console.warn("[sessions] remote delete failed:", err),
        );
      }
      setCurrentSessionId((prev) => (prev === sessionId ? null : prev));
    },
    [sessions],
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
