import type { ChatSession } from "../types";
import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

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
  workspace_path?: string;
  model?: string;
}

function parseError(body: string, fallback: string) {
  try {
    const data = JSON.parse(body) as { error?: string; message?: string };
    return data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

async function apiFetch(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const response = await httpFetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });

  return { status: response.status, body: response.body };
}

function parseTime(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return Date.now();
}

function toSession(session: ServerSession): ChatSession {
  let messages: ChatSession["messages"] = [];
  try {
    if (typeof session.messages === "string") {
      messages = JSON.parse(session.messages);
    } else if (Array.isArray(session.messages)) {
      messages = session.messages as ChatSession["messages"];
    }
  } catch {
    messages = [];
  }

  return {
    id: session.id,
    title: session.title,
    messages,
    createdAt: parseTime(session.created_at),
    updatedAt: parseTime(session.updated_at),
    type: (session.type as ChatSession["type"]) || "chat",
    workspacePath: session.workspace_path || "",
    model: session.model || "",
  };
}

export async function createSession(options?: { workspacePath?: string; model?: string }) {
  const payload: Record<string, string> = {
    type: "chat",
    workspace_path: options?.workspacePath || "",
  };
  const model = options?.model?.trim();
  if (model) {
    payload.model = model;
  }

  const response = await apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (response.status !== 201) {
    throw new Error("创建会话失败");
  }

  const session = toSession(JSON.parse(response.body));
  const requestedModel = options?.model?.trim();

  if (requestedModel && session.model !== requestedModel) {
    session.model = requestedModel;
    try {
      await apiFetch(`/api/sessions/${session.id}`, {
        method: "PUT",
        body: JSON.stringify({ model: requestedModel }),
      });
    } catch {
      // Keep local model selection even when persistence fails.
    }
  }

  return session;
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  const response = await apiFetch(`/api/sessions/${id}`);
  if (response.status === 404) return undefined;
  if (response.status !== 200) {
    throw new Error(parseError(response.body, `获取会话失败 (${response.status})`));
  }
  const session = toSession(JSON.parse(response.body));
  return (session.type === "chat" || session.type === "cowork") ? session : undefined;
}

export async function listSessions(): Promise<ChatSession[]> {
  const response = await apiFetch("/api/sessions");
  if (response.status !== 200) {
    throw new Error(parseError(response.body, `获取会话列表失败 (${response.status})`));
  }

  const summaries: SessionSummary[] = JSON.parse(response.body) ?? [];
  return summaries
    .filter((summary) => !summary.type || summary.type === "chat" || summary.type === "cowork")
    .map((summary) => ({
      id: summary.id,
      title: summary.title,
      messages: [],
      createdAt: parseTime(summary.created_at),
      updatedAt: parseTime(summary.updated_at),
      type: (summary.type as ChatSession["type"]) || "chat",
      workspacePath: summary.workspace_path || "",
      model: summary.model || "",
    }));
}

export async function updateSession(id: string, data: Partial<ChatSession>) {
  const payload: Record<string, string> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.messages !== undefined) payload.messages = JSON.stringify(data.messages);
  if (data.model !== undefined) payload.model = data.model;
  if (data.workspacePath !== undefined) payload.workspace_path = data.workspacePath;

  const response = await apiFetch(`/api/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (response.status !== 200) {
    throw new Error(parseError(response.body, `更新会话失败 (${response.status})`));
  }
}

export async function deleteSession(id: string) {
  const response = await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (response.status !== 204) {
    throw new Error(parseError(response.body, `删除会话失败 (${response.status})`));
  }
}

export function generateTitle(firstAssistantMessage: string): string {
  const cleaned = firstAssistantMessage.replace(/\n/g, " ").trim();
  if (!cleaned) return "新会话";
  return cleaned.length <= 20 ? cleaned : `${cleaned.slice(0, 20)}...`;
}
