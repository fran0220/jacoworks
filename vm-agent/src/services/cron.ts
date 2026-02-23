import { readFile, writeFile, mkdir } from "node:fs/promises";
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

// ─── Types ──────────────────────────────────────────

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun?: number;
  createdAt: number;
}

export interface CronConfig {
  workspaceDir: string;
}

export interface CronService {
  start(): void;
  stop(): void;
  addJob(schedule: string, prompt: string): CronJob;
  removeJob(id: string): boolean;
  listJobs(): CronJob[];
  getExtensionFactory(): ExtensionFactory;
}

// ─── Persistence ────────────────────────────────────

function jobsPath(workspaceDir: string): string {
  return join(workspaceDir, "cron-jobs.json");
}

async function loadJobs(workspaceDir: string): Promise<CronJob[]> {
  try {
    const data = await readFile(jobsPath(workspaceDir), "utf-8");
    return JSON.parse(data) as CronJob[];
  } catch {
    return [];
  }
}

async function saveJobs(workspaceDir: string, jobs: CronJob[]): Promise<void> {
  const filePath = jobsPath(workspaceDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(jobs, null, 2), "utf-8");
}

// ─── Service ────────────────────────────────────────

export function createCronService(
  config: CronConfig,
  promptFn: (prompt: string) => Promise<string>,
): CronService {
  let jobs: CronJob[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let initialized = false;
  let ticking = false;

  async function ensureLoaded() {
    if (!initialized) {
      jobs = await loadJobs(config.workspaceDir);
      initialized = true;
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
    await ensureLoaded();
    const now = new Date();

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!cronMatches(job.schedule, now)) continue;

      job.lastRun = Date.now();
      console.log(`⏰ Cron job [${job.id}] triggered: ${job.prompt.slice(0, 80)}`);

      try {
        const result = await promptFn(job.prompt);
        console.log(`⏰ Cron job [${job.id}] completed: ${result.slice(0, 200)}`);
      } catch (err) {
        console.error(`⏰ Cron job [${job.id}] error:`, err instanceof Error ? err.message : err);
      }
    }

    await saveJobs(config.workspaceDir, jobs);
    } finally {
      ticking = false;
    }
  }

  // ─── Tool Schema ────────────────────────────────

  const CronManageParams = Type.Object({
    action: StringEnum(["create", "list", "delete"] as const, { description: 'Action: "create" | "list" | "delete"' }),
    schedule: Type.Optional(Type.String({ description: 'Cron expression, e.g. "0 9 * * 1-5"' })),
    prompt: Type.Optional(Type.String({ description: "Prompt to send to the agent when triggered" })),
    jobId: Type.Optional(Type.String({ description: "Job ID (for delete)" })),
  });

  type CronManageInput = Static<typeof CronManageParams>;

  const cronManageTool: ToolDefinition<typeof CronManageParams> = {
    name: "cron_manage",
    label: "Cron Manager",
    description: "Create, list, or delete scheduled cron jobs. Jobs automatically send prompts to the agent on schedule.",
    parameters: CronManageParams,
    async execute(_toolCallId, params: CronManageInput) {
      await ensureLoaded();

      switch (params.action) {
        case "create": {
          if (!params.schedule || !params.prompt) {
            return {
              content: [{ type: "text" as const, text: 'Error: "schedule" and "prompt" are required for create' }],
              details: {},
              isError: true,
            };
          }
          const job = service.addJob(params.schedule, params.prompt);
          return {
            content: [{ type: "text" as const, text: `Created cron job ${job.id}\nSchedule: ${job.schedule}\nPrompt: ${job.prompt}` }],
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
            .map((j) => `- [${j.id}] ${j.enabled ? "✅" : "⏸️"} \`${j.schedule}\` → ${j.prompt.slice(0, 60)}${j.lastRun ? ` (last: ${new Date(j.lastRun).toISOString()})` : ""}`)
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

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }],
            details: {},
            isError: true,
          };
      }
    },
  };

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

    addJob(schedule: string, prompt: string): CronJob {
      const job: CronJob = {
        id: randomUUID().slice(0, 8),
        schedule,
        prompt,
        enabled: true,
        createdAt: Date.now(),
      };
      jobs.push(job);
      saveJobs(config.workspaceDir, jobs);
      return job;
    },

    removeJob(id: string): boolean {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx === -1) return false;
      jobs.splice(idx, 1);
      saveJobs(config.workspaceDir, jobs);
      return true;
    },

    listJobs(): CronJob[] {
      return [...jobs];
    },

    getExtensionFactory(): ExtensionFactory {
      return (pi) => {
        pi.registerTool(cronManageTool);
      };
    },
  };

  return service;
}
