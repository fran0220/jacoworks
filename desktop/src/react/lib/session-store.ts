import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatSession, MessageContent } from "../types";
import { updateSession } from "./sessions";

interface SessionRow {
  id: string;
  title: string;
  type: string;
  model: string;
  workspace_path: string;
  anonymous: boolean;
  created_at: number;
  updated_at: number;
  message_count: number;
  sync_status: string;
}

interface MessageRow {
  seq: number;
  role: string;
  content: string;
  blocks_json: string | null;
  files_json: string | null;
  created_at: number;
}

interface FullSessionRow extends Omit<SessionRow, "message_count"> {
  messages: MessageRow[];
}

export interface DirtySessionExport {
  id: string;
  title: string;
  type: string;
  model: string;
  workspace_path: string;
  messages_json: string;
}

function rowToMessage(row: MessageRow): ChatMessage {
  let content: string | MessageContent[];
  try {
    const parsed = JSON.parse(row.content);
    content = Array.isArray(parsed) ? parsed : row.content;
  } catch {
    content = row.content;
  }

  const msg: ChatMessage = {
    role: row.role as ChatMessage["role"],
    content,
  };

  if (row.blocks_json) {
    try {
      msg.blocks = JSON.parse(row.blocks_json);
    } catch { /* ignore malformed */ }
  }
  if (row.files_json) {
    try {
      msg.files = JSON.parse(row.files_json);
    } catch { /* ignore malformed */ }
  }

  return msg;
}

function messageToArgs(msg: ChatMessage) {
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  const blocksJson = msg.blocks ? JSON.stringify(msg.blocks) : null;
  const filesJson = msg.files ? JSON.stringify(msg.files) : null;
  return { content, blocksJson, filesJson };
}

function rowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    messages: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    type: (row.type === "chat" ? "chat" : "cowork") as ChatSession["type"],
    workspacePath: row.workspace_path,
    model: row.model,
    anonymous: row.anonymous || undefined,
  };
}

export const sessionStore = {
  async listSessions(): Promise<ChatSession[]> {
    const rows: SessionRow[] = await invoke("db_list_sessions");
    return rows.map(rowToSession);
  },

  async getSession(id: string): Promise<ChatSession | null> {
    const row: FullSessionRow | null = await invoke("db_get_session", { sessionId: id });
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      messages: row.messages.map(rowToMessage),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      type: (row.type === "chat" ? "chat" : "cowork") as ChatSession["type"],
      workspacePath: row.workspace_path,
      model: row.model,
      anonymous: row.anonymous || undefined,
    };
  },

  async createSession(session: ChatSession): Promise<void> {
    await invoke("db_create_session", {
      id: session.id,
      title: session.title,
      sessionType: session.type,
      model: session.model,
      workspacePath: session.workspacePath,
      anonymous: session.anonymous ?? false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  },

  async appendMessage(sessionId: string, message: ChatMessage): Promise<number> {
    const { content, blocksJson, filesJson } = messageToArgs(message);
    return invoke("db_append_message", {
      sessionId,
      role: message.role,
      content,
      blocksJson,
      filesJson,
    });
  },

  async setMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    await invoke("db_set_messages", {
      sessionId,
      messagesJson: JSON.stringify(messages),
    });
  },

  async updateMeta(
    sessionId: string,
    data: { title?: string; model?: string; workspacePath?: string },
  ): Promise<void> {
    await invoke("db_update_session_meta", {
      sessionId,
      title: data.title ?? null,
      model: data.model ?? null,
      workspacePath: data.workspacePath ?? null,
    });
  },

  async deleteSession(sessionId: string): Promise<void> {
    await invoke("db_delete_session", { sessionId });
  },

  async getDirtySessions(): Promise<DirtySessionExport[]> {
    return invoke("db_get_dirty_sessions");
  },

  async markSynced(sessionId: string): Promise<void> {
    await invoke("db_mark_synced", { sessionId });
  },

  async markSyncing(sessionId: string): Promise<void> {
    await invoke("db_mark_syncing", { sessionId });
  },
};

let syncInFlight = false;

export async function syncDirtyToServer(): Promise<void> {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const dirty = await sessionStore.getDirtySessions();
    for (const s of dirty) {
      try {
        await updateSession(s.id, {
          title: s.title,
          messages: JSON.parse(s.messages_json),
          model: s.model,
          workspacePath: s.workspace_path,
        });
        await sessionStore.markSynced(s.id);
      } catch (err) {
        console.warn(`[sync] failed for session ${s.id}:`, err);
      }
    }
  } finally {
    syncInFlight = false;
  }
}
