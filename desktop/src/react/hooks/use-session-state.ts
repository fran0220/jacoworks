import { useCallback, useEffect, useState } from "react";
import { isAuthenticated } from "../lib/auth";
import { deleteSession, getSession, listSessions } from "../lib/sessions";
import type { AttachedFile, ChatSession } from "../types";

export function useSessionState(authenticated: boolean) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([]);

  const refreshSessions = useCallback(async () => {
    if (!isAuthenticated()) return;
    const list = await listSessions();
    setSessions(list);
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
    refreshSessions().catch(() => {});
  }, [authenticated, refreshSessions]);

  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      return;
    }

    // Skip fetch if we already have the correct session loaded.
    if (currentSession?.id === currentSessionId) return;

    let cancelled = false;
    getSession(currentSessionId)
      .then((session) => {
        if (!cancelled && session) {
          setCurrentSession(session);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, currentSession?.id]);

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

  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId);
      await refreshSessions();
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
    },
    [currentSessionId, refreshSessions],
  );

  return {
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
  };
}
