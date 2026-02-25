import { getToken } from "../../lib/auth";
import { GATEWAY_URL } from "../../lib/config";
import { httpFetch } from "../../lib/transport";
import type { OcMessage, OcRole, OcSession } from "../types";

interface SessionSummary {
  id: string;
  title: string;
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

const DEFAULT_TITLE = "新会话";
const DEFAULT_SESSION_KEY = "main";

function parseTime(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return Date.now();
}

function readMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const asRecord = part as Record<string, unknown>;
      return typeof asRecord.text === "string" ? asRecord.text : "";
    })
    .join("\n")
    .trim();
}

function normalizeRole(value: unknown): OcRole {
  if (value === "system" || value === "assistant" || value === "user") {
    return value;
  }
  return "assistant";
}

function normalizeMessage(raw: unknown, index: number): OcMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : `oc-msg-${index}-${Date.now()}`;
  const content = readMessageText(record.content);
  const createdAt = parseTime(record.createdAt as string | number | undefined);

  return {
    id,
    role: normalizeRole(record.role),
    content,
    createdAt,
    status: "final",
  };
}

function normalizeMessages(messages: string | unknown[]): OcMessage[] {
  const list = typeof messages === "string" ? (JSON.parse(messages) as unknown[]) : messages;
  if (!Array.isArray(list)) return [];

  return list
    .map((item, index) => normalizeMessage(item, index))
    .filter((message): message is OcMessage => Boolean(message));
}

function toOcSession(session: ServerSession): OcSession {
  let messages: OcMessage[] = [];
  try {
    messages = normalizeMessages(session.messages);
  } catch {
    messages = [];
  }

  return {
    id: session.id,
    title: session.title || DEFAULT_TITLE,
    messages,
    createdAt: parseTime(session.created_at),
    updatedAt: parseTime(session.updated_at),
    type: "openclaw",
    model: session.model || "",
    workspacePath: session.workspace_path || "",
    sessionKey: DEFAULT_SESSION_KEY,
  };
}

async function apiFetch(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const token = getToken();
  if (!token) {
    throw new Error("未登录，请重新登录");
  }
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

export async function createOcSession(options?: { title?: string; model?: string; sessionKey?: string }) {
  const response = await apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      type: "openclaw",
      title: options?.title || DEFAULT_TITLE,
      model: options?.model || "",
      workspace_path: "",
    }),
  });

  if (response.status !== 201) {
    throw new Error("创建 OpenClaw 会话失败");
  }

  const session = toOcSession(JSON.parse(response.body) as ServerSession);
  session.sessionKey = options?.sessionKey || DEFAULT_SESSION_KEY;
  return session;
}

export async function getOcSession(id: string): Promise<OcSession | undefined> {
  const response = await apiFetch(`/api/sessions/${id}`);
  if (response.status === 404 || response.status !== 200) return undefined;

  const raw = JSON.parse(response.body) as ServerSession;
  if (raw.type !== "openclaw") return undefined;
  return toOcSession(raw);
}

export async function listOcSessions(): Promise<OcSession[]> {
  const response = await apiFetch("/api/sessions");
  if (response.status !== 200) return [];

  const summaries: SessionSummary[] = JSON.parse(response.body) ?? [];
  return summaries
    .filter((summary) => summary.type === "openclaw")
    .map((summary) => ({
      id: summary.id,
      title: summary.title,
      messages: [],
      createdAt: parseTime(summary.created_at),
      updatedAt: parseTime(summary.updated_at),
      type: "openclaw",
      model: summary.model || "",
      workspacePath: summary.workspace_path || "",
      sessionKey: DEFAULT_SESSION_KEY,
    }));
}

export async function updateOcSession(id: string, data: Partial<OcSession>) {
  const payload: Record<string, string> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.messages !== undefined) payload.messages = JSON.stringify(data.messages);
  if (data.model !== undefined) payload.model = data.model;
  if (data.workspacePath !== undefined) payload.workspace_path = data.workspacePath;

  await apiFetch(`/api/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteOcSession(id: string) {
  await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export function generateOcTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.replace(/\n/g, " ").replace(/[*_~`#]/g, "").trim();
  if (!cleaned) return DEFAULT_TITLE;
  return cleaned.length <= 20 ? cleaned : `${cleaned.slice(0, 20)}...`;
}
