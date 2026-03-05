/**
 * cron.ts 单元测试
 *
 * 覆盖: 三种调度类型 (cron/at/every)、session 模式 (main/isolated)、
 *       deleteAfterRun、运行历史、指数退避、向后兼容迁移
 *
 * 运行: bun test src/services/__tests__/cron.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCronService, type CronJob, type CronService } from "../cron.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper: mock prompt functions ──────────────────

function mockPromptFn() {
  const calls: string[] = [];
  const fn = async (prompt: string) => {
    calls.push(prompt);
    return `result for: ${prompt.slice(0, 50)}`;
  };
  return { fn, calls };
}

function mockIsolatedPromptFn() {
  const calls: Array<{ prompt: string; sessionId: string }> = [];
  const fn = async (prompt: string, sessionId: string) => {
    calls.push({ prompt, sessionId });
    return `isolated result for: ${prompt.slice(0, 50)}`;
  };
  return { fn, calls };
}

// ─── Schedule Types ─────────────────────────────────

describe("addJob — schedule types", () => {
  test("cron expression", () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      prompt: "weekday morning check",
    });

    expect(job.id).toBeTruthy();
    expect(job.schedule.kind).toBe("cron");
    expect(job.schedule.expr).toBe("0 9 * * 1-5");
    expect(job.sessionTarget).toBe("main");
    expect(job.deleteAfterRun).toBe(false);
    expect(job.runCount).toBe(0);
  });

  test("at (one-shot)", () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const job = svc.addJob({
      schedule: { kind: "at", at: futureDate },
      prompt: "remind me",
    });

    expect(job.schedule.kind).toBe("at");
    expect(job.schedule.at).toBe(futureDate);
    expect(job.deleteAfterRun).toBe(true); // default for at
  });

  test("every (interval)", () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "every", everyMs: 300_000 },
      prompt: "check every 5 minutes",
    });

    expect(job.schedule.kind).toBe("every");
    expect(job.schedule.everyMs).toBe(300_000);
    expect(job.deleteAfterRun).toBe(false);
  });
});

// ─── Session Targets ────────────────────────────────

describe("session targets", () => {
  test("main uses promptFn", async () => {
    const { fn, calls } = mockPromptFn();
    const isolated = mockIsolatedPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn, isolated.fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "main task",
      sessionTarget: "main",
    });

    const result = await svc.runJob(job.id);
    expect(result.status).toBe("ok");
    expect(calls).toContain("main task");
    expect(isolated.calls.length).toBe(0);
  });

  test("isolated uses isolatedPromptFn with prefix", async () => {
    const { fn, calls } = mockPromptFn();
    const isolated = mockIsolatedPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn, isolated.fn);

    const job = svc.addJob({
      name: "Daily summary",
      schedule: { kind: "cron", expr: "0 7 * * *" },
      prompt: "summarize updates",
      sessionTarget: "isolated",
    });

    const result = await svc.runJob(job.id);
    expect(result.status).toBe("ok");
    expect(calls.length).toBe(0);
    expect(isolated.calls.length).toBe(1);
    expect(isolated.calls[0].prompt).toContain(`[cron:${job.id} Daily summary]`);
    expect(isolated.calls[0].prompt).toContain("summarize updates");
    expect(isolated.calls[0].sessionId).toBe(`cron-${job.id}`);
  });

  test("isolated falls back to promptFn when no isolatedPromptFn", async () => {
    const { fn, calls } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "isolated without fn",
      sessionTarget: "isolated",
    });

    const result = await svc.runJob(job.id);
    expect(result.status).toBe("ok");
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("[cron:");
  });
});

// ─── deleteAfterRun ─────────────────────────────────

describe("deleteAfterRun", () => {
  test("at jobs auto-delete on success", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "at", at: new Date(Date.now() - 1000).toISOString() },
      prompt: "one-shot",
    });

    expect(svc.listJobs().length).toBe(1);
    await svc.runJob(job.id);
    expect(svc.listJobs().length).toBe(0);
  });

  test("cron jobs NOT auto-deleted by default", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "recurring",
    });

    await svc.runJob(job.id);
    expect(svc.listJobs().length).toBe(1);
  });

  test("deleteAfterRun can be overridden", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "at", at: new Date(Date.now() - 1000).toISOString() },
      prompt: "keep this",
      deleteAfterRun: false,
    });

    await svc.runJob(job.id);
    expect(svc.listJobs().length).toBe(1);
  });
});

// ─── Run History ────────────────────────────────────

describe("run history", () => {
  test("records execution history", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "log me",
    });

    await svc.runJob(job.id);
    await svc.runJob(job.id);

    const history = await svc.getRunHistory(job.id);
    expect(history.length).toBe(2);
    expect(history[0].status).toBe("ok");
    expect(history[0].jobId).toBe(job.id);
    expect(history[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("records errors in history", async () => {
    const failFn = async () => { throw new Error("LLM down"); };
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, failFn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "will fail",
    });

    const result = await svc.runJob(job.id);
    expect(result.status).toBe("error");
    expect(result.error).toBe("LLM down");

    const history = await svc.getRunHistory(job.id);
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("error");
    expect(history[0].error).toBe("LLM down");
  });

  test("history persists to JSONL file", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "persist",
    });

    await svc.runJob(job.id);

    const logFile = join(tmpDir, "cron", "runs", `${job.id}.jsonl`);
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.status).toBe("ok");
    expect(record.jobId).toBe(job.id);
  });
});

// ─── Exponential Backoff ────────────────────────────

describe("exponential backoff", () => {
  test("tracks consecutive errors", async () => {
    const failFn = async () => { throw new Error("fail"); };
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, failFn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "failing",
    });

    await svc.runJob(job.id);
    const jobs = svc.listJobs();
    expect(jobs[0].consecutiveErrors).toBe(1);

    await svc.runJob(job.id);
    expect(svc.listJobs()[0].consecutiveErrors).toBe(2);
  });

  test("resets errors on success", async () => {
    let shouldFail = true;
    const fn = async (prompt: string) => {
      if (shouldFail) throw new Error("fail");
      return "ok";
    };
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "retry",
    });

    await svc.runJob(job.id);
    expect(svc.listJobs()[0].consecutiveErrors).toBe(1);

    shouldFail = false;
    await svc.runJob(job.id);
    expect(svc.listJobs()[0].consecutiveErrors).toBe(0);
  });
});

// ─── CRUD ───────────────────────────────────────────

describe("CRUD", () => {
  test("addJob + listJobs", () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    svc.addJob({ schedule: { kind: "cron", expr: "0 9 * * *" }, prompt: "morning" });
    svc.addJob({ schedule: { kind: "cron", expr: "0 18 * * *" }, prompt: "evening" });

    expect(svc.listJobs().length).toBe(2);
  });

  test("removeJob", () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({ schedule: { kind: "cron", expr: "* * * * *" }, prompt: "temp" });
    expect(svc.removeJob(job.id)).toBe(true);
    expect(svc.listJobs().length).toBe(0);
    expect(svc.removeJob("nonexistent")).toBe(false);
  });

  test("runJob on nonexistent job returns error", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const result = await svc.runJob("nope");
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });
});

// ─── Persistence & Migration ────────────────────────

describe("persistence", () => {
  test("jobs persist to disk", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    svc.addJob({ schedule: { kind: "cron", expr: "0 9 * * *" }, prompt: "morning" });

    // Wait for async save to flush
    await new Promise((r) => setTimeout(r, 50));

    const filePath = join(tmpDir, "cron-jobs.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.length).toBe(1);
    expect(data[0].schedule.kind).toBe("cron");
  });

  test("migrates legacy string-schedule jobs", async () => {
    // Write old-format jobs
    const legacyJobs = [
      {
        id: "legacy1",
        schedule: "0 9 * * *",
        prompt: "old morning check",
        enabled: true,
        createdAt: Date.now(),
      },
    ];
    writeFileSync(join(tmpDir, "cron-jobs.json"), JSON.stringify(legacyJobs));

    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);
    // Force load by listing
    svc.start();
    svc.stop();

    // Wait for async load
    await new Promise((r) => setTimeout(r, 100));

    const jobs = svc.listJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe("legacy1");
    expect(jobs[0].schedule.kind).toBe("cron");
    expect(jobs[0].schedule.expr).toBe("0 9 * * *");
    expect(jobs[0].sessionTarget).toBe("main");
    expect(jobs[0].deleteAfterRun).toBe(false);
    expect(jobs[0].runCount).toBe(0);
  });
});

// ─── runCount ───────────────────────────────────────

describe("runCount tracking", () => {
  test("increments on each run", async () => {
    const { fn } = mockPromptFn();
    const svc = createCronService({ agentHomeDir: tmpDir, mode: "server" }, fn);

    const job = svc.addJob({
      schedule: { kind: "cron", expr: "* * * * *" },
      prompt: "count me",
    });

    await svc.runJob(job.id);
    await svc.runJob(job.id);
    await svc.runJob(job.id);

    expect(svc.listJobs()[0].runCount).toBe(3);
  });
});
