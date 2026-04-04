import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ChatMessage } from "../types";
import { DEFAULT_OPENCLAW_SESSION_KEY } from "../lib/config";
import { createSession, deleteSession, getSession, listSessions, updateSession } from "../lib/sessions";
import { posthog } from "../lib/posthog";

const ACTIVE_WORKSPACE_STORAGE_KEY = "jacoworks.webchat.active-team.v1";
const THREAD_WORKSPACE_STORAGE_KEY = "jacoworks.webchat.thread-workspaces.v1";

export interface ThreadMeta {
  id: string;
  workspaceKey: string;
  title: string;
  updatedAt: number;
}

interface WorkspaceState {
  activeWorkspaceKey: string;
  activeThreadId: string | null;
  threads: ThreadMeta[];
  threadMessages: Record<string, ChatMessage[]>;
  loading: boolean;
}

type WorkspaceAction =
  | { type: "hydrate_threads"; threads: ThreadMeta[] }
  | { type: "set_loading"; loading: boolean }
  | { type: "set_workspace"; workspaceKey: string }
  | { type: "set_active_thread"; threadId: string | null }
  | { type: "upsert_thread"; thread: ThreadMeta }
  | { type: "remove_thread"; threadId: string }
  | { type: "cache_messages"; threadId: string; messages: ChatMessage[] };

function sortThreads(threads: ThreadMeta[]): ThreadMeta[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

function readStoredWorkspaceKey(): string {
  try {
    const value = (window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || "").trim();
    return value || DEFAULT_OPENCLAW_SESSION_KEY;
  } catch {
    return DEFAULT_OPENCLAW_SESSION_KEY;
  }
}

function persistWorkspaceKey(workspaceKey: string): void {
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceKey);
  } catch {
    // ignore storage failures
  }
}

function readThreadWorkspaceMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(THREAD_WORKSPACE_STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([id, workspaceKey]) => typeof id === "string" && typeof workspaceKey === "string" && workspaceKey.trim().length > 0,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function persistThreadWorkspaceMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(THREAD_WORKSPACE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

function createInitialState(): WorkspaceState {
  return {
    activeWorkspaceKey: readStoredWorkspaceKey(),
    activeThreadId: null,
    threads: [],
    threadMessages: {},
    loading: true,
  };
}

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "hydrate_threads":
      return {
        ...state,
        threads: sortThreads(action.threads),
        loading: false,
      };
    case "set_loading":
      return { ...state, loading: action.loading };
    case "set_workspace":
      return {
        ...state,
        activeWorkspaceKey: action.workspaceKey,
        activeThreadId: null,
      };
    case "set_active_thread":
      return { ...state, activeThreadId: action.threadId };
    case "upsert_thread": {
      const next = state.threads.filter((thread) => thread.id !== action.thread.id);
      next.unshift(action.thread);
      return { ...state, threads: sortThreads(next) };
    }
    case "remove_thread": {
      const { [action.threadId]: _removed, ...threadMessages } = state.threadMessages;
      return {
        ...state,
        activeThreadId: state.activeThreadId === action.threadId ? null : state.activeThreadId,
        threads: state.threads.filter((thread) => thread.id !== action.threadId),
        threadMessages,
      };
    }
    case "cache_messages":
      return {
        ...state,
        threadMessages: {
          ...state.threadMessages,
          [action.threadId]: action.messages,
        },
      };
    default:
      return state;
  }
}

/** Derive the OpenClaw session key for a given thread.
 *  Default workspace threads get per-thread keys so each thread has independent context.
 *  Team workspace threads share the team session key. */
export function deriveOcSessionKey(workspaceKey: string, threadId: string | null): string {
  if (!threadId) return workspaceKey;
  // Team keys (e.g. "agent:leader:main") are shared — don't split per thread
  if (workspaceKey !== DEFAULT_OPENCLAW_SESSION_KEY) return workspaceKey;
  return `agent:default:t-${threadId}`;
}

export interface UseWorkspaceResult {
  activeWorkspaceKey: string;
  /** The OpenClaw session key for the current thread (per-thread isolation). */
  ocSessionKey: string;
  activeThreadId: string | null;
  threads: ThreadMeta[];
  loading: boolean;
  switchWorkspace: (workspaceKey: string) => void;
  selectThread: (threadId: string) => void;
  setActiveThreadId: (threadId: string | null) => void;
  createThread: (options?: { capture?: boolean }) => Promise<string | null>;
  ensureActiveThread: () => Promise<string | null>;
  deleteThread: (threadId: string) => Promise<void>;
  loadThreadMessages: (threadId: string) => Promise<ChatMessage[]>;
  saveThreadMessages: (threadId: string, messages: ChatMessage[]) => Promise<void>;
  renameThread: (threadId: string, title: string) => Promise<void>;
}

export default function useWorkspace(): UseWorkspaceResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const stateRef = useRef(state);
  const workspaceMapRef = useRef<Record<string, string>>(readThreadWorkspaceMap());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    persistWorkspaceKey(state.activeWorkspaceKey);
  }, [state.activeWorkspaceKey]);

  const rememberThreadWorkspace = useCallback((threadId: string, workspaceKey: string) => {
    workspaceMapRef.current = {
      ...workspaceMapRef.current,
      [threadId]: workspaceKey,
    };
    persistThreadWorkspaceMap(workspaceMapRef.current);
  }, []);

  const forgetThreadWorkspace = useCallback((threadId: string) => {
    const next = { ...workspaceMapRef.current };
    delete next[threadId];
    workspaceMapRef.current = next;
    persistThreadWorkspaceMap(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "set_loading", loading: true });

    listSessions()
      .then((sessions) => {
        if (cancelled) return;

        const threads = sessions.map((session) => {
          const workspaceKey = workspaceMapRef.current[session.id] || stateRef.current.activeWorkspaceKey;
          if (!workspaceMapRef.current[session.id]) {
            rememberThreadWorkspace(session.id, workspaceKey);
          }

          return {
            id: session.id,
            workspaceKey,
            title: session.title,
            updatedAt: session.updatedAt,
          } satisfies ThreadMeta;
        });

        dispatch({ type: "hydrate_threads", threads });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "hydrate_threads", threads: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rememberThreadWorkspace]);

  const switchWorkspace = useCallback((workspaceKey: string) => {
    const normalized = workspaceKey.trim() || DEFAULT_OPENCLAW_SESSION_KEY;
    if (normalized === stateRef.current.activeWorkspaceKey) return;
    dispatch({ type: "set_workspace", workspaceKey: normalized });
  }, []);

  const selectThread = useCallback((threadId: string) => {
    const thread = stateRef.current.threads.find((item) => item.id === threadId);
    if (!thread || thread.workspaceKey !== stateRef.current.activeWorkspaceKey) return;
    dispatch({ type: "set_active_thread", threadId });
  }, []);

  const setActiveThreadId = useCallback((threadId: string | null) => {
    dispatch({ type: "set_active_thread", threadId });
  }, []);

  const createThread = useCallback(
    async (options?: { capture?: boolean }): Promise<string | null> => {
      try {
        const capture = options?.capture !== false;
        const session = await createSession();
        const workspaceKey = stateRef.current.activeWorkspaceKey;
        const thread: ThreadMeta = {
          id: session.id,
          workspaceKey,
          title: session.title,
          updatedAt: Date.now(),
        };

        rememberThreadWorkspace(session.id, workspaceKey);
        dispatch({ type: "upsert_thread", thread });
        dispatch({ type: "cache_messages", threadId: session.id, messages: [] });
        dispatch({ type: "set_active_thread", threadId: session.id });

        if (capture) {
          posthog.capture("chat_session_created", { workspace_key: workspaceKey });
        }

        return session.id;
      } catch {
        return null;
      }
    },
    [rememberThreadWorkspace],
  );

  const ensureActiveThread = useCallback(async (): Promise<string | null> => {
    const { activeThreadId, activeWorkspaceKey, threads } = stateRef.current;
    const activeThread = activeThreadId ? threads.find((thread) => thread.id === activeThreadId) : null;
    if (activeThread && activeThread.workspaceKey === activeWorkspaceKey) {
      return activeThread.id;
    }
    return createThread({ capture: false });
  }, [createThread]);

  const loadThreadMessages = useCallback(async (threadId: string): Promise<ChatMessage[]> => {
    const cached = stateRef.current.threadMessages[threadId];
    if (cached) return cached;

    try {
      const session = await getSession(threadId);
      const messages = session?.messages || [];
      dispatch({ type: "cache_messages", threadId, messages });
      return messages;
    } catch {
      dispatch({ type: "cache_messages", threadId, messages: [] });
      return [];
    }
  }, []);

  const saveThreadMessages = useCallback(async (threadId: string, messages: ChatMessage[]) => {
    const current = stateRef.current.threads.find((thread) => thread.id === threadId);
    dispatch({ type: "cache_messages", threadId, messages });
    dispatch({
      type: "upsert_thread",
      thread: {
        id: threadId,
        workspaceKey: current?.workspaceKey || stateRef.current.activeWorkspaceKey,
        title: current?.title || "新会话",
        updatedAt: Date.now(),
      },
    });

    try {
      await updateSession(threadId, { messages });
    } catch {
      // ignore persistence failures
    }
  }, []);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    const current = stateRef.current.threads.find((thread) => thread.id === threadId);
    if (!current) return;

    const trimmedTitle = title.trim() || current.title;
    dispatch({
      type: "upsert_thread",
      thread: {
        ...current,
        title: trimmedTitle,
        updatedAt: Date.now(),
      },
    });

    try {
      await updateSession(threadId, { title: trimmedTitle });
    } catch {
      // ignore persistence failures
    }
  }, []);

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteSession(threadId);
      } catch {
        // ignore delete failures so local UI can still recover
      }

      forgetThreadWorkspace(threadId);
      dispatch({ type: "remove_thread", threadId });
    },
    [forgetThreadWorkspace],
  );

  const threads = useMemo(
    () => state.threads.filter((thread) => thread.workspaceKey === state.activeWorkspaceKey),
    [state.activeWorkspaceKey, state.threads],
  );

  const ocSessionKey = useMemo(
    () => deriveOcSessionKey(state.activeWorkspaceKey, state.activeThreadId),
    [state.activeWorkspaceKey, state.activeThreadId],
  );

  return useMemo(
    () => ({
      activeWorkspaceKey: state.activeWorkspaceKey,
      ocSessionKey,
      activeThreadId: state.activeThreadId,
      threads,
      loading: state.loading,
      switchWorkspace,
      selectThread,
      setActiveThreadId,
      createThread,
      ensureActiveThread,
      deleteThread,
      loadThreadMessages,
      saveThreadMessages,
      renameThread,
    }),
    [
      createThread,
      deleteThread,
      ensureActiveThread,
      loadThreadMessages,
      renameThread,
      selectThread,
      setActiveThreadId,
      state.activeThreadId,
      state.activeWorkspaceKey,
      state.loading,
      ocSessionKey,
      switchWorkspace,
      threads,
      saveThreadMessages,
    ],
  );
}
