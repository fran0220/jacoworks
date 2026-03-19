import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

export interface FeedbackDraft {
  category?: string;
  title?: string;
  description?: string;
  images?: string[];
  draftKey?: string;
}

export interface FeedbackContext {
  app_version: string;
  os_info: string;
  log_tail: string[];
}

export interface ErrorCandidate {
  id: string;
  ts: number;
  kind: "tool" | "agent" | "sidecar";
  title: string;
  message: string;
  sessionId?: string;
  toolName?: string;
}

// ─── Error collection store ────────────────────────
const MAX_ERRORS = 20;
const DEDUP_WINDOW_MS = 10_000;
let _errors: ErrorCandidate[] = [];
let _listeners: Array<() => void> = [];

function dedupeKey(e: ErrorCandidate): string {
  return `${e.kind}|${e.toolName ?? ""}|${e.message.slice(0, 80)}`;
}

export function reportError(err: Omit<ErrorCandidate, "id" | "ts">) {
  const candidate: ErrorCandidate = {
    ...err,
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
  };

  const key = dedupeKey(candidate);
  const isDupe = _errors.some(
    (e) => dedupeKey(e) === key && candidate.ts - e.ts < DEDUP_WINDOW_MS,
  );
  if (isDupe) return;

  _errors = [..._errors.slice(-(MAX_ERRORS - 1)), candidate];
  _listeners.forEach((fn) => fn());
}

export function getLatestError(): ErrorCandidate | null {
  return _errors.length > 0 ? _errors[_errors.length - 1] : null;
}

export function clearErrors() {
  _errors = [];
  _listeners.forEach((fn) => fn());
}

export function subscribeErrors(fn: () => void): () => void {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((f) => f !== fn);
  };
}

// ─── Build prefill content ────────────────────────

export async function getFeedbackContext(tailLines = 50): Promise<FeedbackContext> {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) return { app_version: "dev", os_info: "unknown", log_tail: [] };
    return await invoke<FeedbackContext>("get_feedback_context", { tailLines });
  } catch {
    return { app_version: "unknown", os_info: "unknown", log_tail: [] };
  }
}

export function buildFeedbackTitle(err: ErrorCandidate): string {
  const prefix = err.kind === "tool" ? "Tool Error" : err.kind === "agent" ? "Agent Error" : "Sidecar Error";
  return `[${prefix}] ${err.title}`;
}

export function buildFeedbackDescription(err: ErrorCandidate, ctx: FeedbackContext): string {
  const lines = [
    "## 问题描述",
    "<请补充你做了什么、你期望看到什么>",
    "",
    "## 自动采集",
    `- 时间: ${new Date(err.ts).toLocaleString()}`,
    `- App 版本: ${ctx.app_version}`,
    `- OS: ${ctx.os_info}`,
    `- 错误来源: ${err.kind}`,
  ];
  if (err.toolName) lines.push(`- 工具: ${err.toolName}`);
  if (err.sessionId) lines.push(`- 会话: ${err.sessionId}`);

  lines.push("", "## 错误上下文", "```", err.message.slice(0, 1000), "```");

  if (ctx.log_tail.length > 0) {
    lines.push("", "## 最近日志", "```");
    // Sanitize sensitive info
    const sanitized = ctx.log_tail.map((line) =>
      line
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]")
        .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[REDACTED]"),
    );
    lines.push(...sanitized.slice(-30));
    lines.push("```");
  }

  return lines.join("\n");
}

export async function buildDraftForError(err: ErrorCandidate): Promise<FeedbackDraft> {
  const ctx = await getFeedbackContext(50);
  return {
    draftKey: `${err.id}:${Date.now()}`,
    category: "bug",
    title: buildFeedbackTitle(err),
    description: buildFeedbackDescription(err, ctx),
  };
}
