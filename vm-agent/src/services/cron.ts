import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";

// ─── Cron Expression Parser ─────────────────────────

function matchField(field: string, value: number, max: number): boolean {
  if (field === "*") return true;

  // */N — every N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // N-M — range
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    if (isNaN(lo) || isNaN(hi)) return false;
    return value >= lo && value <= hi;
  }

  // Comma-separated values
  if (field.includes(",")) {
    return field.split(",").some((v) => parseInt(v, 10) === value);
  }

  // Exact number
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    matchField(minute, date.getMinutes(), 59) &&
    matchField(hour, date.getHours(), 23) &&
    matchField(dayOfMonth, date.getDate(), 31) &&
    matchField(month, date.getMonth() + 1, 12) &&
    matchField(dayOfWeek, date.getDay(), 6)
  );
}

// ─── Interval / Relative Time Parsers ───────────────

const INTERVAL_RE = /^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i;

function parseIntervalMs(str: string): number | null {
  const m = INTERVAL_RE.exec(str.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case "s": case "sec": return n * 1_000;
    case "m": case "min": return n * 60_000;
    case "h": case "hr":  return n * 3_600_000;
    case "d": case "day": return n * 86_400_000;
    default: return null;
  }
}

function parseRelativeTime(str: string): Date | null {
  if (!str.startsWith("+")) return null;
  const ms = parseIntervalMs(str.slice(1));
  if (ms == null) return null;
  return new Date(Date.now() + ms);
}

// ─── Types ──────────────────────────────────────────

export interface CronJob {
  id: string;
  name?: string;
  schedule: {
    kind: "cron" | "at" | "every";
    expr?: string;
    at?: string;
    everyMs?: number;
  };
  sessionTarget: "main" | "isolated";
  prompt: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  lastRun?: number;
  runCount: number;
  consecutiveErrors: number;
  delivery?: {
    mode: "announce" | "none";
  };
  createdAt: number;
}

export interface CronConfig {
  agentHomeDir: string;
  mode: "sidecar" | "server";
  gatewayUrl?: string;
  gatewayToken?: string;
}

export interface AddJobParams {
  name?: string;
  schedule: CronJob["schedule"];
  sessionTarget?: "main" | "isolated";
  prompt: string;
  deleteAfterRun?: boolean;
  delivery?: {
    mode: "announce" | "none";
  };
}

export interface CronRunResult {
  status: "ok" | "error";
  durationMs: number;
  resultPreview?: string;
  error?: string;
}

export interface CronRunRecord {
  timestamp: number;
  jobId: string;
  status: "ok" | "error";
  durationMs: number;
  resultPreview?: string;
  error?: string;
}

export interface CronResultEvent {
  jobId: string;
  jobName?: string;
  status: "ok" | "error";
  durationMs: number;
  resultPreview?: string;
  error?: string;
  timestamp: number;
}

export interface CronService {
  start(): void;
  stop(): void;
  addJob(params: AddJobParams): CronJob;
  removeJob(id: string): boolean;
  listJobs(): CronJob[];
  runJob(id: string): Promise<CronRunResult>;
  getRunHistory(id: string, limit?: number): Promise<CronRunRecord[]>;
  getExtensionFactory(): ExtensionFactory;
}

// ─── Backoff ────────────────────────────────────────

const BACKOFF_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

function shouldSkipDueToBackoff(job: CronJob): boolean {
  if (job.consecutiveErrors === 0) return false;
  const delayIdx = Math.min(job.consecutiveErrors - 1, BACKOFF_DELAYS_MS.length - 1);
  const delay = BACKOFF_DELAYS_MS[delayIdx];
  if (!job.lastRun) return false;
  return Date.now() - job.lastRun < delay;
}

// ─── Persistence ────────────────────────────────────

function jobsPath(agentHomeDir: string): string {
  return join(agentHomeDir, "cron-jobs.json");
}

function runsDir(agentHomeDir: string): string {
  return join(agentHomeDir, "cron", "runs");
}

function runLogPath(agentHomeDir: string, jobId: string): string {
  return join(runsDir(agentHomeDir), `${jobId}.jsonl`);
}

interface LegacyCronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun?: number;
  createdAt: number;
}

function migrateJob(raw: CronJob | LegacyCronJob): CronJob {
  if (typeof raw.schedule === "string") {
    const legacy = raw as LegacyCronJob;
    return {
      id: legacy.id,
      schedule: { kind: "cron", expr: legacy.schedule },
      sessionTarget: "main",
      prompt: legacy.prompt,
      enabled: legacy.enabled,
      deleteAfterRun: false,
      lastRun: legacy.lastRun,
      runCount: 0,
      consecutiveErrors: 0,
      createdAt: legacy.createdAt,
    };
  }
  const job = raw as CronJob;
  return {
    ...job,
    sessionTarget: job.sessionTarget ?? "main",
    deleteAfterRun: job.deleteAfterRun ?? false,
    runCount: job.runCount ?? 0,
    consecutiveErrors: job.consecutiveErrors ?? 0,
    delivery: job.delivery,
  };
}

async function loadJobs(agentHomeDir: string): Promise<CronJob[]> {
  try {
    const data = await readFile(jobsPath(agentHomeDir), "utf-8");
    const raw = JSON.parse(data) as (CronJob | LegacyCronJob)[];
    return raw.map(migrateJob);
  } catch {
    return [];
  }
}

async function saveJobs(agentHomeDir: string, jobs: CronJob[]): Promise<void> {
  const filePath = jobsPath(agentHomeDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(jobs, null, 2), "utf-8");
}

const MAX_RUN_LINES = 100;

async function appendRunRecord(agentHomeDir: string, record: CronRunRecord): Promise<void> {
  const dir = runsDir(agentHomeDir);
  await mkdir(dir, { recursive: true });
  const logFile = runLogPath(agentHomeDir, record.jobId);
  const line = JSON.stringify(record) + "\n";
  await appendFile(logFile, line, "utf-8");
  await pruneRunLog(logFile);
}

async function pruneRunLog(filePath: string): Promise<void> {
  try {
    const data = await readFile(filePath, "utf-8");
    const lines = data.trimEnd().split("\n");
    if (lines.length > MAX_RUN_LINES) {
      const trimmed = lines.slice(lines.length - MAX_RUN_LINES).join("\n") + "\n";
      await writeFile(filePath, trimmed, "utf-8");
    }
  } catch {
    // ignore
  }
}

async function readRunHistory(agentHomeDir: string, jobId: string, limit: number): Promise<CronRunRecord[]> {
  try {
    const data = await readFile(runLogPath(agentHomeDir, jobId), "utf-8");
    const lines = data.trimEnd().split("\n").filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as CronRunRecord);
    return records.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ─── Gateway Proxy (sidecar mode) ───────────────────

interface GatewayJobResponse {
  id: string;
  name?: string | null;
  schedule_kind: string;
  schedule_expr: string;
  prompt: string;
  session_target: string;
  enabled: boolean;
  delete_after_run: boolean;
  delivery_mode?: string | null;
  last_run?: string | null;
  run_count: number;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError?: boolean;
};

async function proxyToGateway(
  config: CronConfig,
  params: { action: string; name?: string; scheduleKind?: string; schedule?: string; prompt?: string; sessionTarget?: string; deleteAfterRun?: boolean; deliveryMode?: string; jobId?: string; limit?: number },
): Promise<ToolResult> {
  const { gatewayUrl, gatewayToken } = config;
  if (!gatewayUrl || !gatewayToken) {
    return {
      content: [{ type: "text" as const, text: "Error: gateway URL or token not configured for sidecar cron proxy" }],
      details: {},
      isError: true,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${gatewayToken}`,
  };

  try {
    switch (params.action) {
      case "create": {
        if (!params.scheduleKind || !params.schedule || !params.prompt) {
          return {
            content: [{ type: "text" as const, text: 'Error: "scheduleKind", "schedule", and "prompt" are required for create' }],
            details: {},
            isError: true,
          };
        }
        const body = {
          schedule_kind: params.scheduleKind,
          schedule_expr: params.schedule,
          prompt: params.prompt,
          name: params.name,
          session_target: params.sessionTarget ?? "isolated",
          delete_after_run: params.deleteAfterRun ?? (params.scheduleKind === "at"),
          delivery_mode: params.deliveryMode ?? "none",
        };
        const res = await fetch(`${gatewayUrl}/api/cron/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error: gateway returned ${res.status}: ${errText}` }], details: {}, isError: true };
        }
        const job = (await res.json()) as GatewayJobResponse;
        return {
          content: [{ type: "text" as const, text: `Created job ${job.id}${job.name ? ` (${job.name})` : ""}\nSchedule: ${job.schedule_kind} \`${job.schedule_expr}\`\nTarget: ${job.session_target}\nDelete after run: ${job.delete_after_run}\nPrompt: ${job.prompt}` }],
          details: { job },
        };
      }

      case "list": {
        const res = await fetch(`${gatewayUrl}/api/cron/jobs`, { method: "GET", headers });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error: gateway returned ${res.status}: ${errText}` }], details: {}, isError: true };
        }
        const jobs = (await res.json()) as GatewayJobResponse[];
        if (!jobs || jobs.length === 0) {
          return { content: [{ type: "text" as const, text: "No cron jobs configured." }], details: { jobs: [] } };
        }
        const text = jobs
          .map((j) => {
            const last = j.last_run ? ` (last: ${j.last_run})` : "";
            const errs = j.consecutive_errors > 0 ? ` ⚠️${j.consecutive_errors}err` : "";
            const mode = j.session_target === "isolated" ? " 🔒isolated" : "";
            return `- [${j.id}]${j.name ? ` ${j.name}` : ""} ${j.enabled ? "✅" : "⏸️"} ${j.schedule_kind} \`${j.schedule_expr}\`${mode}${errs} → ${j.prompt.slice(0, 60)}${last}`;
          })
          .join("\n");
        return { content: [{ type: "text" as const, text }], details: { jobs } };
      }

      case "delete": {
        if (!params.jobId) {
          return { content: [{ type: "text" as const, text: 'Error: "jobId" is required for delete' }], details: {}, isError: true };
        }
        const res = await fetch(`${gatewayUrl}/api/cron/jobs/${params.jobId}`, { method: "DELETE", headers });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error: gateway returned ${res.status}: ${errText}` }], details: {}, isError: true };
        }
        return { content: [{ type: "text" as const, text: `Deleted job ${params.jobId}` }], details: { removed: true } };
      }

      case "run": {
        if (!params.jobId) {
          return { content: [{ type: "text" as const, text: 'Error: "jobId" is required for run' }], details: {}, isError: true };
        }
        const res = await fetch(`${gatewayUrl}/api/cron/jobs/${params.jobId}/run`, { method: "POST", headers });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error: gateway returned ${res.status}: ${errText}` }], details: {}, isError: true };
        }
        const result = (await res.json()) as { status: string; message: string };
        return { content: [{ type: "text" as const, text: `Job ${params.jobId}: ${result.message}` }], details: { result } };
      }

      case "history": {
        if (!params.jobId) {
          return { content: [{ type: "text" as const, text: 'Error: "jobId" is required for history' }], details: {}, isError: true };
        }
        const limit = params.limit ?? 10;
        const res = await fetch(`${gatewayUrl}/api/cron/jobs/${params.jobId}/history?limit=${limit}`, { method: "GET", headers });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error: gateway returned ${res.status}: ${errText}` }], details: {}, isError: true };
        }
        const result = (await res.json()) as { status: string; message: string };
        return { content: [{ type: "text" as const, text: result.message }], details: { result } };
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }], details: {}, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: gateway proxy failed: ${msg}` }], details: {}, isError: true };
  }
}

// ─── Service ────────────────────────────────────────

export function createCronService(
  config: CronConfig,
  promptFn: (prompt: string) => Promise<string>,
  isolatedPromptFn?: (prompt: string, sessionId: string) => Promise<string>,
  onResult?: (event: CronResultEvent) => void,
): CronService {
  let jobs: CronJob[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let initialized = false;
  let ticking = false;

  async function ensureLoaded() {
    if (!initialized) {
      jobs = await loadJobs(config.agentHomeDir);
      initialized = true;
    }
  }

  function jobShouldRun(job: CronJob, now: Date): boolean {
    if (!job.enabled) return false;
    if (shouldSkipDueToBackoff(job)) return false;

    switch (job.schedule.kind) {
      case "cron":
        return !!job.schedule.expr && cronMatches(job.schedule.expr, now);
      case "at":
        if (!job.schedule.at) return false;
        return !job.lastRun && new Date(job.schedule.at).getTime() <= now.getTime();
      case "every":
        if (!job.schedule.everyMs) return false;
        return !job.lastRun || (now.getTime() - job.lastRun >= job.schedule.everyMs);
      default:
        return false;
    }
  }

  async function executeJob(job: CronJob): Promise<CronRunResult> {
    const start = Date.now();
    try {
      let result: string;
      if (job.sessionTarget === "isolated") {
        const prefix = `[cron:${job.id} ${job.name || "unnamed"}] `;
        const fullPrompt = prefix + job.prompt;
        if (isolatedPromptFn) {
          result = await isolatedPromptFn(fullPrompt, `cron-${job.id}`);
        } else {
          result = await promptFn(fullPrompt);
        }
      } else {
        result = await promptFn(job.prompt);
      }
      const durationMs = Date.now() - start;
      job.lastRun = Date.now();
      job.runCount++;
      job.consecutiveErrors = 0;
      return {
        status: "ok",
        durationMs,
        resultPreview: result.slice(0, 200),
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      job.lastRun = Date.now();
      job.runCount++;
      job.consecutiveErrors++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        status: "error",
        durationMs,
        error: errorMsg,
      };
    }
  }

  async function announceToGateway(event: CronResultEvent) {
    const gatewayUrl = process.env.GATEWAY_URL || process.env.LLM_PROXY_URL?.replace(/:8317$/, ":8847");
    const token = process.env.GATEWAY_TOKEN || process.env.AUTH_TOKEN;
    if (!gatewayUrl || !token) return;

    try {
      const response = await fetch(`${gatewayUrl}/api/cron/announce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        console.error(`⏰ Cron announce HTTP ${response.status}`);
      }
    } catch (err) {
      console.error("⏰ Cron announce network error:", err);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await ensureLoaded();
      const now = new Date();
      const toDelete: string[] = [];

      for (const job of jobs) {
        if (!jobShouldRun(job, now)) continue;

        console.log(`⏰ Cron job [${job.id}${job.name ? ` ${job.name}` : ""}] triggered: ${job.prompt.slice(0, 80)}`);

        const result = await executeJob(job);

        if (result.status === "ok") {
          console.log(`⏰ Cron job [${job.id}] completed (${result.durationMs}ms): ${(result.resultPreview || "").slice(0, 200)}`);
        } else {
          console.error(`⏰ Cron job [${job.id}] error (${result.durationMs}ms): ${result.error}`);
        }

        const record: CronRunRecord = {
          timestamp: Date.now(),
          jobId: job.id,
          status: result.status,
          durationMs: result.durationMs,
          resultPreview: result.resultPreview,
          error: result.error,
        };
        await appendRunRecord(config.agentHomeDir, record);
        onResult?.({
          jobId: job.id,
          jobName: job.name,
          status: result.status,
          durationMs: result.durationMs,
          resultPreview: result.resultPreview,
          error: result.error,
          timestamp: record.timestamp,
        });

        // Announce to gateway (feishu delivery) if delivery mode is announce
        if (job.delivery?.mode === "announce") {
          announceToGateway({
            jobId: job.id,
            jobName: job.name,
            status: result.status,
            durationMs: result.durationMs,
            resultPreview: result.resultPreview,
            error: result.error,
            timestamp: record.timestamp,
          }).catch((err) => {
            console.error(`⏰ Cron announce failed [${job.id}]:`, err);
          });
        }

        if (job.deleteAfterRun && result.status === "ok") {
          toDelete.push(job.id);
        }
      }

      for (const id of toDelete) {
        const idx = jobs.findIndex((j) => j.id === id);
        if (idx !== -1) {
          console.log(`⏰ Cron job [${id}] auto-deleted after successful run`);
          jobs.splice(idx, 1);
        }
      }

      await saveJobs(config.agentHomeDir, jobs);
    } finally {
      ticking = false;
    }
  }

  // ─── Tool Schema ────────────────────────────────

  const CronManageParams = Type.Object({
    action: StringEnum(["create", "list", "delete", "run", "history"] as const, { description: 'Action: "create" | "list" | "delete" | "run" | "history"' }),
    name: Type.Optional(Type.String({ description: "Human-readable job name" })),
    scheduleKind: Type.Optional(StringEnum(["cron", "at", "every"] as const, { description: "Schedule type" })),
    schedule: Type.Optional(Type.String({ description: 'Cron expr (e.g. "0 9 * * 1-5"), ISO timestamp, relative ("+20m"), or interval ("5m", "1h")' })),
    prompt: Type.Optional(Type.String({ description: "Prompt to send to the agent when triggered" })),
    sessionTarget: Type.Optional(StringEnum(["main", "isolated"] as const, { description: "Session mode" })),
    deleteAfterRun: Type.Optional(Type.Boolean({ description: "Auto-delete after execution (default true for at, false for others)" })),
    deliveryMode: Type.Optional(StringEnum(["announce", "none"] as const, { description: "Delivery mode: announce (push to feishu) or none (silent)" })),
    jobId: Type.Optional(Type.String({ description: "Job ID" })),
    limit: Type.Optional(Type.Number({ description: "Number of history entries (default 10)" })),
  });

  type CronManageInput = Static<typeof CronManageParams>;

  function parseScheduleFromTool(kind: "cron" | "at" | "every", raw: string): CronJob["schedule"] | string {
    switch (kind) {
      case "cron":
        return { kind: "cron", expr: raw };
      case "at": {
        if (raw.startsWith("+")) {
          const resolved = parseRelativeTime(raw);
          if (!resolved) return `Invalid relative time: ${raw}`;
          return { kind: "at", at: resolved.toISOString() };
        }
        const d = new Date(raw);
        if (isNaN(d.getTime())) return `Invalid ISO 8601 timestamp: ${raw}`;
        return { kind: "at", at: d.toISOString() };
      }
      case "every": {
        const ms = parseIntervalMs(raw);
        if (ms == null) return `Invalid interval: ${raw}`;
        return { kind: "every", everyMs: ms };
      }
      default:
        return `Unknown schedule kind: ${kind}`;
    }
  }

  const cronManageTool: ToolDefinition<typeof CronManageParams> = {
    name: "cron_manage",
    label: "Cron Manager",
    description: "Create, list, delete, manually run, or view history of scheduled jobs. Supports cron expressions, one-shot timestamps, and fixed intervals.",
    parameters: CronManageParams,
    async execute(_toolCallId, params: CronManageInput) {
      // Sidecar mode: proxy all calls to Gateway API
      if (config.mode === "sidecar" && config.gatewayUrl) {
        return proxyToGateway(config, params);
      }

      await ensureLoaded();

      switch (params.action) {
        case "create": {
          if (!params.scheduleKind || !params.schedule || !params.prompt) {
            return {
              content: [{ type: "text" as const, text: 'Error: "scheduleKind", "schedule", and "prompt" are required for create' }],
              details: {},
              isError: true,
            };
          }
          const parsed = parseScheduleFromTool(params.scheduleKind, params.schedule);
          if (typeof parsed === "string") {
            return {
              content: [{ type: "text" as const, text: `Error: ${parsed}` }],
              details: {},
              isError: true,
            };
          }
          const deleteDefault = parsed.kind === "at" ? true : false;
          const job = service.addJob({
            name: params.name,
            schedule: parsed,
            sessionTarget: params.sessionTarget ?? "main",
            prompt: params.prompt,
            deleteAfterRun: params.deleteAfterRun ?? deleteDefault,
            delivery: params.deliveryMode ? { mode: params.deliveryMode } : undefined,
          });
          const scheduleDesc = describeSchedule(job.schedule);
          return {
            content: [{ type: "text" as const, text: `Created job ${job.id}${job.name ? ` (${job.name})` : ""}\nSchedule: ${scheduleDesc}\nTarget: ${job.sessionTarget}\nDelete after run: ${job.deleteAfterRun}\nPrompt: ${job.prompt}` }],
            details: { job },
          };
        }

        case "list": {
          const list = service.listJobs();
          if (list.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No cron jobs configured." }],
              details: { jobs: [] },
            };
          }
          const text = list
            .map((j) => {
              const sched = describeSchedule(j.schedule);
              const mode = j.sessionTarget === "isolated" ? " 🔒isolated" : "";
              const last = j.lastRun ? ` (last: ${new Date(j.lastRun).toISOString()})` : "";
              const errs = j.consecutiveErrors > 0 ? ` ⚠️${j.consecutiveErrors}err` : "";
              return `- [${j.id}]${j.name ? ` ${j.name}` : ""} ${j.enabled ? "✅" : "⏸️"} ${sched}${mode}${errs} → ${j.prompt.slice(0, 60)}${last}`;
            })
            .join("\n");
          return {
            content: [{ type: "text" as const, text }],
            details: { jobs: list },
          };
        }

        case "delete": {
          if (!params.jobId) {
            return {
              content: [{ type: "text" as const, text: 'Error: "jobId" is required for delete' }],
              details: {},
              isError: true,
            };
          }
          const removed = service.removeJob(params.jobId);
          return {
            content: [{ type: "text" as const, text: removed ? `Deleted job ${params.jobId}` : `Job ${params.jobId} not found` }],
            details: { removed },
          };
        }

        case "run": {
          if (!params.jobId) {
            return {
              content: [{ type: "text" as const, text: 'Error: "jobId" is required for run' }],
              details: {},
              isError: true,
            };
          }
          const result = await service.runJob(params.jobId);
          const statusIcon = result.status === "ok" ? "✅" : "❌";
          return {
            content: [{ type: "text" as const, text: `${statusIcon} Job ${params.jobId} ${result.status} (${result.durationMs}ms)${result.error ? `\nError: ${result.error}` : ""}${result.resultPreview ? `\nResult: ${result.resultPreview}` : ""}` }],
            details: { result },
          };
        }

        case "history": {
          if (!params.jobId) {
            return {
              content: [{ type: "text" as const, text: 'Error: "jobId" is required for history' }],
              details: {},
              isError: true,
            };
          }
          const limit = params.limit ?? 10;
          const records = await service.getRunHistory(params.jobId, limit);
          if (records.length === 0) {
            return {
              content: [{ type: "text" as const, text: `No run history for job ${params.jobId}` }],
              details: { records: [] },
            };
          }
          const text = records
            .map((r) => {
              const icon = r.status === "ok" ? "✅" : "❌";
              const ts = new Date(r.timestamp).toISOString();
              return `${icon} ${ts} ${r.durationMs}ms${r.error ? ` err: ${r.error.slice(0, 80)}` : ""}`;
            })
            .join("\n");
          return {
            content: [{ type: "text" as const, text: `Run history for ${params.jobId} (last ${records.length}):\n${text}` }],
            details: { records },
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }],
            details: {},
            isError: true,
          };
      }
    },
  };

  function describeSchedule(s: CronJob["schedule"]): string {
    switch (s.kind) {
      case "cron": return `cron \`${s.expr}\``;
      case "at": return `at ${s.at}`;
      case "every": return `every ${s.everyMs}ms`;
      default: return "unknown";
    }
  }

  // ─── Service Object ─────────────────────────────

  const service: CronService = {
    start() {
      if (timer) return;
      timer = setInterval(tick, 60_000);
      ensureLoaded().then(() => {
        console.log(`⏰ Cron service started (${jobs.length} jobs loaded)`);
      });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log("⏰ Cron service stopped");
      }
    },

    addJob(params: AddJobParams): CronJob {
      const deleteDefault = params.schedule.kind === "at" ? true : false;
      const job: CronJob = {
        id: randomUUID().slice(0, 8),
        name: params.name,
        schedule: params.schedule,
        sessionTarget: params.sessionTarget ?? "main",
        prompt: params.prompt,
        enabled: true,
        deleteAfterRun: params.deleteAfterRun ?? deleteDefault,
        runCount: 0,
        consecutiveErrors: 0,
        delivery: params.delivery,
        createdAt: Date.now(),
      };
      jobs.push(job);
      initialized = true;
      saveJobs(config.agentHomeDir, jobs).catch(() => {});
      return job;
    },

    removeJob(id: string): boolean {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx === -1) return false;
      jobs.splice(idx, 1);
      initialized = true;
      saveJobs(config.agentHomeDir, jobs).catch(() => {});
      return true;
    },

    listJobs(): CronJob[] {
      return [...jobs];
    },

    async runJob(id: string): Promise<CronRunResult> {
      await ensureLoaded();
      const job = jobs.find((j) => j.id === id);
      if (!job) {
        return { status: "error", durationMs: 0, error: `Job ${id} not found` };
      }
      const result = await executeJob(job);
      const record: CronRunRecord = {
        timestamp: Date.now(),
        jobId: job.id,
        status: result.status,
        durationMs: result.durationMs,
        resultPreview: result.resultPreview,
        error: result.error,
      };
      await appendRunRecord(config.agentHomeDir, record).catch(() => {});
      onResult?.({
        jobId: job.id,
        jobName: job.name,
        status: result.status,
        durationMs: result.durationMs,
        resultPreview: result.resultPreview,
        error: result.error,
        timestamp: record.timestamp,
      });
      // Announce to gateway (feishu delivery) if delivery mode is announce
      if (job.delivery?.mode === "announce") {
        announceToGateway({
          jobId: job.id,
          jobName: job.name,
          status: result.status,
          durationMs: result.durationMs,
          resultPreview: result.resultPreview,
          error: result.error,
          timestamp: record.timestamp,
        }).catch((err) => {
          console.error(`⏰ Cron announce failed [${job.id}]:`, err);
        });
      }
      if (job.deleteAfterRun && result.status === "ok") {
        const idx = jobs.findIndex((j) => j.id === id);
        if (idx !== -1) jobs.splice(idx, 1);
      }
      await saveJobs(config.agentHomeDir, jobs).catch(() => {});
      return result;
    },

    async getRunHistory(id: string, limit = 10): Promise<CronRunRecord[]> {
      return readRunHistory(config.agentHomeDir, id, limit);
    },

    getExtensionFactory(): ExtensionFactory {
      return (pi) => {
        pi.registerTool(cronManageTool);
      };
    },
  };

  return service;
}
