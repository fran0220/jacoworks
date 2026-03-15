/**
 * Per-session stream state store.
 *
 * Stream state (parts, streaming flag, error, runtime refs) is keyed by
 * sessionId so that session switches don't lose or bleed live data.
 * `useChatStream` subscribes via `useSyncExternalStore`.
 */
import type { AssistantPart, ChatMessage, ChatSession } from "../types";

export type AgentPhase = "idle" | "thinking" | "executing" | "compacting" | "retrying";

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
}

// ─── Types ──────────────────────────────────────────────

export type StreamSessionContext = Pick<ChatSession, "id" | "anonymous" | "title">;

/** Reactive snapshot — the UI subscribes to this via useSyncExternalStore. */
export interface SessionStreamSnapshot {
  sessionState: ChatSession;
  streaming: boolean;
  streamingStartedAt: number | null;
  parts: AssistantPart[];
  errorText: string | null;
  agentPhase: AgentPhase;
  turnCount: number;
  contextUsage: ContextUsage | null;
}

/** Mutable runtime — only the stream loop and stop/send touch this. */
export interface SessionStreamRuntime {
  activeStream: StreamSessionContext | null;
  aborted: boolean;
  stoppedByUser: boolean;
  sendLock: boolean;
  cancel: (() => void) | null;

  partsBuffer: AssistantPart[];
  streamBaseMessages: ChatMessage[];
  dirty: boolean;

  partsRaf: number | null;
  titleRequestVersion: number;
  agentStartedAt: number | null;
}

export interface SessionStreamEntry {
  snapshot: SessionStreamSnapshot;
  runtime: SessionStreamRuntime;
  listeners: Set<() => void>;
}

// ─── Store ──────────────────────────────────────────────

const entries = new Map<string, SessionStreamEntry>();

function createEntry(session: ChatSession): SessionStreamEntry {
  return {
    snapshot: {
      sessionState: session,
      streaming: false,
      streamingStartedAt: null,
      parts: [],
      errorText: null,
      agentPhase: "idle",
      turnCount: 0,
      contextUsage: null,
    },
    runtime: {
      activeStream: null,
      aborted: false,
      stoppedByUser: false,
      sendLock: false,
      cancel: null,
      partsBuffer: [],
      streamBaseMessages: [],
      dirty: false,
      partsRaf: null,
      titleRequestVersion: 0,
      agentStartedAt: null,
    },
    listeners: new Set(),
  };
}

function emit(entry: SessionStreamEntry) {
  for (const fn of entry.listeners) fn();
}

// ─── Public API ─────────────────────────────────────────

export function getOrCreateEntry(session: ChatSession): SessionStreamEntry {
  let entry = entries.get(session.id);
  if (!entry) {
    entry = createEntry(session);
    entries.set(session.id, entry);
  }
  return entry;
}

export function getEntryById(sessionId: string): SessionStreamEntry | undefined {
  return entries.get(sessionId);
}

export function removeEntry(sessionId: string) {
  const entry = entries.get(sessionId);
  if (entry && entry.runtime.partsRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.partsRaf);
  }
  entries.delete(sessionId);
}

/** Subscribe for useSyncExternalStore. */
export function subscribe(session: ChatSession, listener: () => void): () => void {
  const entry = getOrCreateEntry(session);
  entry.listeners.add(listener);
  return () => { entry.listeners.delete(listener); };
}

/** Get snapshot for useSyncExternalStore. */
export function getSnapshot(session: ChatSession): SessionStreamSnapshot {
  return getOrCreateEntry(session).snapshot;
}

// ─── Prop sync ──────────────────────────────────────────

/** Sync incoming session prop into store. Skips while streaming or dirty. */
export function syncSessionFromProps(session: ChatSession) {
  const entry = getOrCreateEntry(session);
  if (entry.snapshot.streaming || entry.runtime.dirty) return;
  if (entry.snapshot.sessionState !== session) {
    entry.snapshot = { ...entry.snapshot, sessionState: session };
    emit(entry);
  }
}

// ─── Snapshot mutators ──────────────────────────────────

export function patchSnapshot(
  sessionId: string,
  patch: Partial<Omit<SessionStreamSnapshot, "sessionState">>,
) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.snapshot = { ...entry.snapshot, ...patch };
  emit(entry);
}

export function updateSessionState(
  sessionId: string,
  updater: (prev: ChatSession) => ChatSession,
) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const next = updater(entry.snapshot.sessionState);
  if (next !== entry.snapshot.sessionState) {
    entry.snapshot = { ...entry.snapshot, sessionState: next };
    emit(entry);
  }
}

export function setDirty(sessionId: string, dirty: boolean) {
  const entry = entries.get(sessionId);
  if (entry) entry.runtime.dirty = dirty;
}

// ─── Parts buffer ───────────────────────────────────────

function flushParts(entry: SessionStreamEntry) {
  entry.snapshot = { ...entry.snapshot, parts: [...entry.runtime.partsBuffer] };
  emit(entry);
}

export function schedulePartsPublish(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry || entry.runtime.partsRaf !== null) return;
  entry.runtime.partsRaf = window.requestAnimationFrame(() => {
    entry.runtime.partsRaf = null;
    flushParts(entry);
  });
}

export function clearParts(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.runtime.partsRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.partsRaf);
    entry.runtime.partsRaf = null;
  }
  entry.runtime.partsBuffer = [];
  entry.snapshot = { ...entry.snapshot, parts: [] };
  emit(entry);
}

// ─── Streaming lifecycle ────────────────────────────────

export function startStreaming(session: ChatSession, streamBaseMessages: ChatMessage[]) {
  const entry = getOrCreateEntry(session);
  entry.runtime.activeStream = {
    id: session.id,
    anonymous: !!session.anonymous,
    title: session.title,
  };
  entry.runtime.aborted = false;
  entry.runtime.stoppedByUser = false;
  entry.runtime.sendLock = true;
  entry.runtime.cancel = null;
  entry.runtime.partsBuffer = [];
  entry.runtime.streamBaseMessages = streamBaseMessages;

  entry.snapshot = {
    ...entry.snapshot,
    streaming: true,
    streamingStartedAt: Date.now(),
    parts: [],
    errorText: null,
    agentPhase: "idle",
    turnCount: 0,
    contextUsage: null,
  };
  emit(entry);

  window.dispatchEvent(
    new CustomEvent("session-streaming-change", {
      detail: { id: session.id, streaming: true },
    }),
  );
}

export function finishStreaming(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry) return;

  if (entry.runtime.partsRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.partsRaf);
    entry.runtime.partsRaf = null;
  }

  entry.runtime.cancel = null;
  entry.runtime.sendLock = false;
  entry.runtime.activeStream = null;
  entry.runtime.partsBuffer = [];

  entry.snapshot = {
    ...entry.snapshot,
    streaming: false,
    streamingStartedAt: null,
    parts: [],
    agentPhase: "idle",
    turnCount: 0,
  };
  entry.runtime.agentStartedAt = null;
  emit(entry);

  window.dispatchEvent(
    new CustomEvent("session-streaming-change", {
      detail: { id: sessionId, streaming: false },
    }),
  );
}
