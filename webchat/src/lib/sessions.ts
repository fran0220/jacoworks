import type { ChatSession } from "../types";
import { GATEWAY_URL, AUTH_TOKEN } from "./config";

interface SessionSummary {
  id: string;
  title: string;
  message_count: number;
  created_at: string | number;
  updated_at: string | number;
  type?: string;
  model?: string;
  workspace_path?: string;
}

interface ServerSession {
  id: string;
  title: string;
  messages: string | unknown[];
  created_at: string | number;
  updated_at: string | number;
  type?: string;
  model?: string;
  workspace_path?: string;
}

async function apiFetch(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  return { status: res.status, body: await res.text() };
}

function parseTime(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return Date.now();
}

function toSession(s: ServerSession): ChatSession {
  let messages: ChatSession["messages"] = [];
  try {
    if (typeof s.messages === "string") messages = JSON.parse(s.messages);
    else if (Array.isArray(s.messages)) messages = s.messages as ChatSession["messages"];
  } catch { messages = []; }
  return {
    id: s.id,
    title: s.title,
    messages,
    createdAt: parseTime(s.created_at),
    updatedAt: parseTime(s.updated_at),
    type: (s.type as ChatSession["type"]) || "chat",
    model: s.model || "",
    workspacePath: s.workspace_path || "",
  };
}

export async function createSession(workspacePath?: string): Promise<ChatSession> {
  const res = await apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ type: "chat", workspace_path: workspacePath || "" }),
  });
  if (res.status !== 201) throw new Error("创建会话失败");
  return toSession(JSON.parse(res.body));
}

export async function listSessions(): Promise<ChatSession[]> {
  const res = await apiFetch("/api/sessions");
  if (res.status !== 200) throw new Error("获取会话列表失败");
  const summaries: SessionSummary[] = JSON.parse(res.body) ?? [];
  return summaries
    .filter((s) => !s.type || s.type === "chat")
    .map((s) => ({
      id: s.id,
      title: s.title,
      messages: [],
      createdAt: parseTime(s.created_at),
      updatedAt: parseTime(s.updated_at),
      type: "chat" as const,
      model: s.model || "",
      workspacePath: s.workspace_path || "",
    }));
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  const res = await apiFetch(`/api/sessions/${id}`);
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw new Error("获取会话失败");
  return toSession(JSON.parse(res.body));
}

export async function updateSession(id: string, data: Partial<{ title: string; messages: unknown[] }>) {
  const payload: Record<string, unknown> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.messages !== undefined) payload.messages = JSON.stringify(data.messages);
  await apiFetch(`/api/sessions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export async function deleteSession(id: string) {
  await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export function generateTitle(text: string): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (!cleaned) return "新会话";
  return cleaned.length <= 20 ? cleaned : `${cleaned.slice(0, 20)}...`;
}
