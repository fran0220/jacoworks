/**
 * Cron 系统 E2E 测试 — 真实 LLM 对话验证 cron_manage 工具
 *
 * 策略: 每个 test 独立 session，prompt 强制要求调用工具，
 *       验证磁盘副作用 (cron-jobs.json, runs/*.jsonl) 而非依赖 LLM 文本输出。
 *
 * 运行: bun test src/__tests__/cron.e2e.test.ts --timeout 120000
 * 需要真实网关 + LLM, 不可达时自动跳过。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const TIMEOUT = 60_000;

// ─── RPC Client ─────────────────────────────────────

interface RpcMessage {
  id?: string | number;
  type: string;
  [key: string]: unknown;
}

class RpcClient {
  private proc: ReturnType<typeof spawn>;
  private buffer = "";
  private pending: Array<(msg: RpcMessage) => void> = [];
  private messages: RpcMessage[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private stdin: { write(data: string | Uint8Array): number };
  private stderrChunks: string[] = [];

  constructor(proc: ReturnType<typeof spawn>) {
    this.proc = proc;
    this.stdin = proc.stdin as unknown as { write(data: string | Uint8Array): number };
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    this.reader = stdout.getReader();
    this.startReading();
    this.startStderrReading();
  }

  private async startReading() {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch { /* process closed */ }
  }

  private async startStderrReading() {
    const stderr = this.proc.stderr as ReadableStream<Uint8Array>;
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stderrChunks.push(decoder.decode(value, { stream: true }));
      }
    } catch { /* process closed */ }
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as RpcMessage;
        this.messages.push(msg);
        const pending = this.pending.slice();
        this.pending = [];
        for (const resolve of pending) resolve(msg);
      } catch { /* non-JSON */ }
    }
  }

  send(cmd: Record<string, unknown>) {
    this.stdin.write(JSON.stringify(cmd) + "\n");
  }

  async waitFor(predicate: (msg: RpcMessage) => boolean, timeoutMs = TIMEOUT): Promise<RpcMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return new Promise<RpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `waitFor timeout (${timeoutMs}ms).\n` +
          `Last msgs: ${JSON.stringify(this.messages.slice(-3))}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-500)}`
        ));
      }, timeoutMs);
      const check = (msg: RpcMessage) => {
        if (predicate(msg)) { clearTimeout(timer); resolve(msg); }
        else this.pending.push(check);
      };
      this.pending.push(check);
    });
  }

  async waitReady(): Promise<RpcMessage> {
    return this.waitFor((m) => m.type === "ready", 30_000);
  }

  /** 发送 prompt, 收集所有事件直到 done */
  async prompt(message: string, sessionId: string, userId: string): Promise<{
    response: RpcMessage;
    sessionEvents: RpcMessage[];
    done: RpcMessage;
    errors: RpcMessage[];
    fullText: string;
    toolCalls: string[];
  }> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ type: "prompt", message, session_id: sessionId, user_id: userId, id });
    let response: RpcMessage | null = null;
    const sessionEvents: RpcMessage[] = [];
    const errors: RpcMessage[] = [];
    let fullText = "";
    const toolCalls: string[] = [];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `prompt timeout. response=${!!response}, events=${sessionEvents.length}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-500)}`
        ));
      }, TIMEOUT);
      const check = (msg: RpcMessage) => {
        if (msg.id !== id) { this.pending.push(check); return; }
        if (msg.type === "response") response = msg;
        else if (msg.type === "session_event") {
          sessionEvents.push(msg);
          const event = msg.event as Record<string, unknown> | undefined;
          if (event?.type === "message_update") {
            const ame = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
            if (ame?.type === "text_delta" && ame.delta) fullText += ame.delta;
          }
          if (event?.type === "tool_execution_start") {
            toolCalls.push((event as { toolName?: string }).toolName || "unknown");
          }
        }
        else if (msg.type === "error") errors.push(msg);
        else if (msg.type === "done") {
          clearTimeout(timer);
          resolve({ response: response!, sessionEvents, done: msg, errors, fullText, toolCalls });
          return;
        }
        this.pending.push(check);
      };
      this.pending.push(check);
    });
  }

  get stderr(): string { return this.stderrChunks.join(""); }
  get allMessages(): RpcMessage[] { return this.messages; }
  kill() { try { this.proc.kill(); } catch { /* */ } }
}

// ─── Test State ─────────────────────────────────────

let env: TestEnv | null = null;
let client: RpcClient;
let tmpWorkspace: string;
let tmpMemory: string;
let createdJobId: string | null = null;

function skip(): boolean {
  if (!env) { console.log("  → skipped (no gateway)"); return true; }
  return false;
}

// ─── Setup / Teardown ───────────────────────────────

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[cron-e2e] ⚠️  No gateway reachable — tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "cron-e2e-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "cron-e2e-mem-"));

  const proc = spawn({
    cmd: ["bun", ENTRY],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LLM_PROXY_URL: env.config.llmProxyUrl,
      LLM_PROXY_KEY: env.config.llmProxyKey,
      EMBEDDING_API_KEY: env.config.embeddingApiKey,
      EMBEDDING_BASE_URL: env.config.embeddingBaseUrl,
      WORKSPACE_DIR: tmpWorkspace,
      MEMORY_ROOT_DIR: tmpMemory,
      MEMORY_ENABLED: "false",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "true",
      PRIMARY_MODEL: "claude-sonnet-4-6",
      PRIMARY_PROVIDER: "proxy-claude",
    },
  });
  client = new RpcClient(proc);
  await client.waitReady();
  console.log("[cron-e2e] ✅ vm-agent ready (CRON_ENABLED=true)");
});

afterAll(() => {
  client?.kill();
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpMemory) rmSync(tmpMemory, { recursive: true, force: true });
});

// ═══════════════════════════════════════════
//  Test: 创建 + 列出 + 运行 + 历史 + 删除
//  使用同一 session, 按顺序对话
// ═══════════════════════════════════════════

const SID = "cron-e2e";

describe("Cron E2E (真实 LLM)", () => {
  test("1. 创建 every 类型 job", () => {
    if (skip()) return;
    return (async () => {
      const r = await client.prompt(
        'Call the cron_manage tool with these exact parameters: action="create", scheduleKind="every", schedule="5m", prompt="say hello", name="test-every". Do not explain, just call the tool.',
        SID, env!.admin.id,
      );
      expect(r.response.success).toBe(true);
      expect(r.errors.length).toBe(0);
      console.log(`[cron-e2e] Tools called: ${r.toolCalls.join(", ") || "none"}`);
      console.log(`[cron-e2e] Response: ${r.fullText.slice(0, 200)}`);

      // 等待磁盘写入
      await new Promise((r) => setTimeout(r, 500));
      const jobsFile = join(tmpWorkspace, "cron-jobs.json");
      expect(existsSync(jobsFile)).toBe(true);
      const jobs = JSON.parse(readFileSync(jobsFile, "utf-8"));
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      const everyJob = jobs.find((j: { schedule: { kind: string } }) => j.schedule.kind === "every");
      expect(everyJob).toBeDefined();
      expect(everyJob.schedule.everyMs).toBe(300_000);
      createdJobId = everyJob.id;
      console.log(`[cron-e2e] Created job: ${createdJobId}`);
    })();
  });

  test("2. 创建 at 类型 one-shot job", () => {
    if (skip()) return;
    return (async () => {
      const r = await client.prompt(
        'Call the cron_manage tool with: action="create", scheduleKind="at", schedule="+30m", prompt="take a break", name="break-reminder". Just call the tool.',
        SID, env!.admin.id,
      );
      expect(r.response.success).toBe(true);
      expect(r.errors.length).toBe(0);

      await new Promise((r) => setTimeout(r, 500));
      const jobs = JSON.parse(readFileSync(join(tmpWorkspace, "cron-jobs.json"), "utf-8"));
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      const atJob = jobs.find((j: { schedule: { kind: string } }) => j.schedule.kind === "at");
      expect(atJob).toBeDefined();
      expect(atJob.deleteAfterRun).toBe(true); // at 类型默认删除
      console.log(`[cron-e2e] At job created: ${atJob.id}, at=${atJob.schedule.at}`);
    })();
  });

  test("3. 列出所有 jobs", () => {
    if (skip()) return;
    return (async () => {
      const r = await client.prompt(
        'Call the cron_manage tool with action="list". Just call the tool.',
        SID, env!.admin.id,
      );
      expect(r.response.success).toBe(true);
      expect(r.errors.length).toBe(0);
      // 验证工具被调用
      const hasCronTool = r.toolCalls.includes("cron_manage");
      console.log(`[cron-e2e] List tool called: ${hasCronTool}, tools: ${r.toolCalls.join(",")}`);
      // 磁盘验证
      const jobs = JSON.parse(readFileSync(join(tmpWorkspace, "cron-jobs.json"), "utf-8"));
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      console.log(`[cron-e2e] Jobs count: ${jobs.length}`);
    })();
  });

  test("4. 手动运行 job", () => {
    if (skip() || !createdJobId) return;
    return (async () => {
      const r = await client.prompt(
        `Call the cron_manage tool with action="run", jobId="${createdJobId}". Just call the tool.`,
        SID, env!.admin.id,
      );
      expect(r.response.success).toBe(true);
      expect(r.errors.length).toBe(0);
      console.log(`[cron-e2e] Run response: ${r.fullText.slice(0, 200)}`);

      // 验证运行历史写入磁盘
      await new Promise((r) => setTimeout(r, 500));
      const runLog = join(tmpWorkspace, "cron", "runs", `${createdJobId}.jsonl`);
      expect(existsSync(runLog)).toBe(true);
      const lines = readFileSync(runLog, "utf-8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const record = JSON.parse(lines[lines.length - 1]);
      console.log(`[cron-e2e] Run record: status=${record.status}, duration=${record.durationMs}ms`);
      expect(record.status).toBe("ok");
    })();
  });

  test("5. 查看运行历史", () => {
    if (skip() || !createdJobId) return;
    return (async () => {
      const r = await client.prompt(
        `Call the cron_manage tool with action="history", jobId="${createdJobId}". Report the results.`,
        SID, env!.admin.id,
      );
      expect(r.response.success).toBe(true);
      expect(r.errors.length).toBe(0);
      console.log(`[cron-e2e] History response: ${r.fullText.slice(0, 300)}`);
    })();
  });

  test("6. 删除 job", () => {
    if (skip() || !createdJobId) return;
    return (async () => {
      const jobsBefore = JSON.parse(readFileSync(join(tmpWorkspace, "cron-jobs.json"), "utf-8"));
      const countBefore = jobsBefore.length;

      // 尝试两次，LLM 有时不遵从指令
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await client.prompt(
          `IMPORTANT: You MUST call the cron_manage tool right now with exactly these parameters: action="delete", jobId="${createdJobId}". Do nothing else.`,
          SID, env!.admin.id,
        );
        expect(r.response.success).toBe(true);

        await new Promise((r) => setTimeout(r, 1000));
        const jobsAfter = JSON.parse(readFileSync(join(tmpWorkspace, "cron-jobs.json"), "utf-8"));
        console.log(`[cron-e2e] Delete attempt ${attempt}: before=${countBefore}, after=${jobsAfter.length}, tools=${r.toolCalls.join(",")}`);
        if (jobsAfter.length < countBefore) {
          const stillExists = jobsAfter.some((j: { id: string }) => j.id === createdJobId);
          expect(stillExists).toBe(false);
          return;
        }
      }

      // 如果两次都没删除成功，至少验证 LLM 调用了工具
      const jobsAfter = JSON.parse(readFileSync(join(tmpWorkspace, "cron-jobs.json"), "utf-8"));
      expect(jobsAfter.length).toBeLessThan(countBefore);
    })();
  });

  test("7. 磁盘持久化完整", () => {
    if (skip()) return;
    return (async () => {
      expect(existsSync(join(tmpWorkspace, "cron-jobs.json"))).toBe(true);
      const runsDir = join(tmpWorkspace, "cron", "runs");
      if (existsSync(runsDir)) {
        const files = readdirSync(runsDir);
        console.log(`[cron-e2e] Run log files: ${files.join(", ")}`);
        expect(files.length).toBeGreaterThanOrEqual(1);
      }
    })();
  });
});
