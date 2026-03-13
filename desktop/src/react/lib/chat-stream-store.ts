/**
 * Per-session stream state store.
 *
 * Stream state (blocks, streaming flag, error, runtime refs) is keyed by
 * sessionId so that session switches don't lose or bleed live data.
 * `useChatStream` subscribes via `useSyncExternalStore`.
 */
import type { ChatMessage, ChatSession, StreamBlock } from "../types";

// ─── Types ──────────────────────────────────────────────

export type StreamSessionContext = Pick<ChatSession, "id" | "anonymous" | "title">;

/** Reactive snapshot — the UI subscribes to this via useSyncExternalStore. */
export interface SessionStreamSnapshot {
  sessionState: ChatSession;
  streaming: boolean;
  streamingStartedAt: number | null;
  blocks: StreamBlock[];
  errorText: string | null;
}

/** Mutable runtime — only the stream loop and stop/send touch this. */
export interface SessionStreamRuntime {
  activeStream: StreamSessionContext | null;
  aborted: boolean;
  stoppedByUser: boolean;
  sendLock: boolean;
  cancel: (() => void) | null;

  blocksBuffer: StreamBlock[];
  streamBaseMessages: ChatMessage[];
  dirty: boolean;

  blocksRaf: number | null;
  titleRequestVersion: number;
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
      blocks: [],
      errorText: null,
    },
    runtime: {
      activeStream: null,
      aborted: false,
      stoppedByUser: false,
      sendLock: false,
      cancel: null,
      blocksBuffer: [],
      streamBaseMessages: [],
      dirty: false,
      blocksRaf: null,
      titleRequestVersion: 0,
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
  if (entry && entry.runtime.blocksRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.blocksRaf);
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

// ─── Block buffer ───────────────────────────────────────

function flushBlocks(entry: SessionStreamEntry) {
  entry.snapshot = { ...entry.snapshot, blocks: [...entry.runtime.blocksBuffer] };
  emit(entry);
}

export function scheduleBlocksPublish(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry || entry.runtime.blocksRaf !== null) return;
  entry.runtime.blocksRaf = window.requestAnimationFrame(() => {
    entry.runtime.blocksRaf = null;
    flushBlocks(entry);
  });
}

export function clearBlocks(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.runtime.blocksRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.blocksRaf);
    entry.runtime.blocksRaf = null;
  }
  entry.runtime.blocksBuffer = [];
  entry.snapshot = { ...entry.snapshot, blocks: [] };
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
  entry.runtime.blocksBuffer = [];
  entry.runtime.streamBaseMessages = streamBaseMessages;

  entry.snapshot = {
    ...entry.snapshot,
    streaming: true,
    streamingStartedAt: Date.now(),
    blocks: [],
    errorText: null,
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

  if (entry.runtime.blocksRaf !== null) {
    window.cancelAnimationFrame(entry.runtime.blocksRaf);
    entry.runtime.blocksRaf = null;
  }

  entry.runtime.cancel = null;
  entry.runtime.sendLock = false;
  entry.runtime.activeStream = null;
  entry.runtime.blocksBuffer = [];

  entry.snapshot = {
    ...entry.snapshot,
    streaming: false,
    streamingStartedAt: null,
    blocks: [],
  };
  emit(entry);

  window.dispatchEvent(
    new CustomEvent("session-streaming-change", {
      detail: { id: sessionId, streaming: false },
    }),
  );
}
