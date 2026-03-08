/**
 * Handoff E2E 测试 — 验证会话交接功能
 *
 * 流程:
 *   1. spawn vm-agent，注入真实 LLM 配置
 *   2. 在旧 session 中发一条 prompt 建立上下文
 *   3. 调用 handoff 获取摘要 + new_session_id
 *   4. 在新 session 中发送摘要作为首条消息，验证上下文延续
 *
 * 运行: bun test src/__tests__/handoff.e2e.test.ts --timeout 120000
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const TIMEOUT = 60_000;

// ─── RPC Client (minimal copy from rpc.test.ts) ────

interface RpcMessage {
  id?: string | number;
  type: string;
  success?: boolean;
  data?: Record<string, unknown>;
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
    return this.waitFor((m) => m.type === "ready", 20_000);
  }

  async request(cmd: Record<string, unknown>): Promise<RpcMessage> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });
    return this.waitFor((m) => m.id === id && m.type === "response");
  }

  async collectSessionEvents(cmd: Record<string, unknown>): Promise<{
    response: RpcMessage;
    done: RpcMessage;
  }> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });
    let response: RpcMessage | null = null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `collectSessionEvents timeout. response=${!!response}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-500)}`
        ));
      }, TIMEOUT);
      const check = (msg: RpcMessage) => {
        if (msg.id !== id) { this.pending.push(check); return; }
        if (msg.type === "response") response = msg;
        else if (msg.type === "done") {
          clearTimeout(timer);
          resolve({ response: response!, done: msg });
          return;
        }
        this.pending.push(check);
      };
      this.pending.push(check);
    });
  }

  get stderr(): string { return this.stderrChunks.join(""); }
  kill() { try { this.proc.kill(); } catch { /* */ } }
}

// ─── Test State ─────────────────────────────────────

let env: TestEnv | null = null;
let client: RpcClient;
let tmpWorkspace: string;
let tmpMemory: string;

function skip(): boolean {
  if (!env) { console.log("  → skipped (no gateway)"); return true; }
  return false;
}

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[test] ⚠️  No gateway reachable — handoff tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "e2e-handoff-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "e2e-handoff-mem-"));

  const proc = spawn({
    cmd: ["bun", ENTRY],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LLM_PROXY_URL: env.config.llmProxyUrl,
      LLM_PROXY_KEY: env.config.llmProxyKey,
      WORKSPACE_DIR: tmpWorkspace,
      MEMORY_ROOT_DIR: tmpMemory,
      MEMORY_ENABLED: "false",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "false",
      PRIMARY_MODEL: "claude-sonnet-4-6",
      PRIMARY_PROVIDER: "proxy-claude",
    },
  });
  client = new RpcClient(proc);
  await client.waitReady();
  console.log("[test] ✅ vm-agent ready for handoff tests");
});

afterAll(() => {
  client?.kill();
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpMemory) rmSync(tmpMemory, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────

const SESSION_ID = "handoff-test-session";
const USER_ID = "test-user-handoff";

describe("Handoff", () => {
  test("handoff without existing session fails", async () => {
    if (skip()) return;
    const resp = await client.request({
      type: "handoff",
      session_id: "nonexistent-session",
    });
    expect(resp.success).toBe(false);
    const data = resp.data as Record<string, unknown>;
    expect(data.error).toContain("session not found");
  });

  test("handoff without session_id fails", async () => {
    if (skip()) return;
    const resp = await client.request({ type: "handoff" });
    expect(resp.success).toBe(false);
    const data = resp.data as Record<string, unknown>;
    expect(data.error).toContain("session_id required");
  });

  test("establish source session with context", async () => {
    if (skip()) return;
    const result = await client.collectSessionEvents({
      type: "prompt",
      message: "Remember this: the secret code is ALPHA-7742. Reply with 'Acknowledged'.",
      session_id: SESSION_ID,
      user_id: USER_ID,
    });
    expect(result.response.success).toBe(true);
  }, TIMEOUT);

  test("handoff generates summary with new_session_id", async () => {
    if (skip()) return;
    const resp = await client.request({
      type: "handoff",
      session_id: SESSION_ID,
      goal: "Continue the previous work",
    });
    expect(resp.success).toBe(true);

    const data = resp.data as Record<string, unknown>;
    expect(typeof data.new_session_id).toBe("string");
    expect((data.new_session_id as string).length).toBeGreaterThan(0);
    expect(typeof data.summary).toBe("string");
    expect((data.summary as string).length).toBeGreaterThan(10);
    expect(data.workspace).toBe(tmpWorkspace);
    expect(typeof data.model).toBe("string");
    expect(data.restricted).toBe(false);

    console.log(`[test] handoff summary (${(data.summary as string).length} chars):`, (data.summary as string).slice(0, 200));
  }, TIMEOUT);

  test("new session works with handoff context as first message", async () => {
    if (skip()) return;

    // First, do a handoff to get the summary
    const handoffResp = await client.request({
      type: "handoff",
      session_id: SESSION_ID,
      goal: "Recall the secret code from the previous session",
    });
    expect(handoffResp.success).toBe(true);
    const handoffData = handoffResp.data as Record<string, unknown>;
    const newSessionId = handoffData.new_session_id as string;
    const summary = handoffData.summary as string;

    // Send the summary as the first message in the new session
    const result = await client.collectSessionEvents({
      type: "prompt",
      message: `[延续上一会话]\n${summary}\n\n目标: What was the secret code mentioned?`,
      session_id: newSessionId,
      user_id: USER_ID,
    });
    expect(result.response.success).toBe(true);
  }, TIMEOUT);

  test("source session still exists after handoff", async () => {
    if (skip()) return;
    const resp = await client.request({ type: "list_sessions" });
    expect(resp.success).toBe(true);
    const data = resp.data as { sessions: string[] };
    const hasSource = data.sessions.some((s) => s.includes(SESSION_ID));
    expect(hasSource).toBe(true);
  });
});
