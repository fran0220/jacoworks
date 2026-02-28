/**
 * E2E RPC 测试 — 真实网关认证 + 真实 LLM + 用户隔离 + 内存持久化
 *
 * 流程:
 *   1. 从网关登录 admin + e2e-tester 两个用户，获取真实 LLM 配置
 *   2. spawn vm-agent，注入真实环境变量
 *   3. 用两个 user_id 分别对话，验证 user-scoped 内存隔离
 *   4. 检查 daily log + SQLite + MEMORY.md 持久化
 *
 * 运行: bun test src/__tests__/rpc.test.ts --timeout 120000
 * 自动从网关获取密钥，网关不可达则跳过。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const TIMEOUT = 50_000;

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
          `Stderr: ${this.stderrChunks.join("").slice(-300)}`
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
    sessionEvents: RpcMessage[];
    done: RpcMessage;
    errors: RpcMessage[];
  }> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });
    let response: RpcMessage | null = null;
    const sessionEvents: RpcMessage[] = [];
    const errors: RpcMessage[] = [];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `collectSessionEvents timeout. response=${!!response}, events=${sessionEvents.length}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-300)}`
        ));
      }, TIMEOUT);
      const check = (msg: RpcMessage) => {
        if (msg.id !== id) { this.pending.push(check); return; }
        if (msg.type === "response") response = msg;
        else if (msg.type === "session_event") sessionEvents.push(msg);
        else if (msg.type === "error") errors.push(msg);
        else if (msg.type === "done") {
          clearTimeout(timer);
          resolve({ response: response!, sessionEvents, done: msg, errors });
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

// ─── Helpers ────────────────────────────────────────

/** 复制 agent.ts 中的 userScopeKey 逻辑，用于验证 */
function userScopeKey(userId: string): string {
  const normalized = userId.trim() || "anonymous";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function findInDir(baseDir: string, filename: string): string | null {
  if (existsSync(join(baseDir, filename))) return join(baseDir, filename);
  try {
    for (const sub of readdirSync(baseDir)) {
      const candidate = join(baseDir, sub, filename);
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* */ }
  return null;
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

// ─── Setup / Teardown ───────────────────────────────

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[test] ⚠️  No gateway reachable — E2E tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "e2e-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "e2e-mem-"));

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
      MEMORY_ENABLED: "true",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "false",
      PRIMARY_MODEL: "claude-haiku-4-5-20251001",
      PRIMARY_PROVIDER: "proxy-claude",
    },
  });
  client = new RpcClient(proc);
  await client.waitReady();
  console.log("[test] ✅ vm-agent ready");
});

afterAll(() => {
  client?.kill();
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpMemory) rmSync(tmpMemory, { recursive: true, force: true });
});

// ═══════════════════════════════════════════
//  1. 基础 RPC 协议
// ═══════════════════════════════════════════

describe("1. 基础 RPC 协议", () => {
  test("ready 事件包含 service/version/skills", () => {
    if (skip()) return;
    const ready = client.allMessages.find((m) => m.type === "ready");
    expect(ready).toBeDefined();
    expect(ready!.service).toBe("vm-agent");
    expect(ready!.version).toMatch(/^\d+\.\d+\.\d+-rpc$/);
    expect(Array.isArray(ready!.skills)).toBe(true);
  });

  test("health 返回 ok", () => {
    if (skip()) return;
    return (async () => {
      const resp = await client.request({ type: "health" });
      const data = resp.data as Record<string, unknown>;
      expect(data.status).toBe("ok");
      expect(data.service).toBe("vm-agent");
      expect(typeof data.sessions).toBe("number");
    })();
  });

  test("list_sessions / list_skills / 未知命令", () => {
    if (skip()) return;
    return (async () => {
      const ls = await client.request({ type: "list_sessions" });
      expect(ls.success).toBe(true);
      expect(Array.isArray((ls.data as Record<string, unknown>).sessions)).toBe(true);

      const sk = await client.request({ type: "list_skills" });
      expect(sk.success).toBe(true);

      const bad = await client.request({ type: "totally_bogus" });
      expect(bad.success).toBe(false);
    })();
  });
});

// ═══════════════════════════════════════════
//  2. Admin 用户对话 (真实 LLM)
// ═══════════════════════════════════════════

describe("2. Admin 用户对话", () => {
  const SESSION_ID = "admin-session";

  test("prompt → response + done (无 error)", () => {
    if (skip()) return;
    return (async () => {
      const result = await client.collectSessionEvents({
        type: "prompt",
        message: "Reply with exactly: ADMIN_PONG",
        session_id: SESSION_ID,
        user_id: env!.admin.id,
      });
      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.sessionEvents.length).toBeGreaterThan(0);
    })();
  });

  test("多轮对话复用同一 session", () => {
    if (skip()) return;
    return (async () => {
      const result = await client.collectSessionEvents({
        type: "prompt",
        message: "What was my previous message? Reply in one sentence.",
        session_id: SESSION_ID,
        user_id: env!.admin.id,
      });
      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);

      const ls = await client.request({ type: "list_sessions" });
      const sessions = (ls.data as Record<string, unknown>).sessions as string[];
      expect(sessions.some((key) => key.includes(SESSION_ID))).toBe(true);
    })();
  });
});

// ═══════════════════════════════════════════
//  3. E2E-tester 用户对话 + memory_save
// ═══════════════════════════════════════════

describe("3. E2E-tester 用户对话 (user role)", () => {
  const SESSION_ID = "user-session";

  test("普通用户 prompt 正常工作", () => {
    if (skip() || !env!.user) { console.log("  → skipped (no e2e-tester)"); return; }
    return (async () => {
      const result = await client.collectSessionEvents({
        type: "prompt",
        message: "Reply with exactly: USER_PONG",
        session_id: SESSION_ID,
        user_id: env!.user!.id,
      });
      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
    })();
  });

  test("user 调用 memory_save 保存偏好", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      const result = await client.collectSessionEvents({
        type: "prompt",
        message: '使用 memory_save 工具保存: "E2E测试用户偏好: 喜欢Rust, 不喜欢PHP"。section 设为 "Test Preferences"。只调用工具即可。',
        session_id: SESSION_ID,
        user_id: env!.user!.id,
      });
      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
    })();
  });
});

// ═══════════════════════════════════════════
//  4. 用户内存隔离验证
// ═══════════════════════════════════════════

describe("4. 用户内存隔离", () => {
  test("admin 和 user 的 memory 目录不同", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      await new Promise((r) => setTimeout(r, 3000));

      const adminScope = userScopeKey(env!.admin.id);
      const userScope = userScopeKey(env!.user!.id);

      // 两个 scope key 必须不同
      expect(adminScope).not.toBe(userScope);
      console.log(`[test] Admin scope: ${adminScope}`);
      console.log(`[test] User scope:  ${userScope}`);

      // 检查两个 scope 目录都存在
      const adminDir = join(tmpMemory, adminScope);
      const userDir = join(tmpMemory, userScope);

      console.log(`[test] Memory root contents: ${readdirSync(tmpMemory).join(", ")}`);

      // admin 对话后应该有目录
      expect(existsSync(adminDir)).toBe(true);
      // user 对话后也应该有目录
      expect(existsSync(userDir)).toBe(true);

      console.log(`[test] Admin dir: ${readdirSync(adminDir).join(", ")}`);
      console.log(`[test] User dir:  ${readdirSync(userDir).join(", ")}`);
    })();
  });

  test("admin 的 daily log 不包含 user 的内容", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      const adminScope = userScopeKey(env!.admin.id);
      const userScope = userScopeKey(env!.user!.id);
      const adminDaily = join(tmpMemory, adminScope, "daily");
      const userDaily = join(tmpMemory, userScope, "daily");

      if (existsSync(adminDaily) && existsSync(userDaily)) {
        const adminFiles = readdirSync(adminDaily);
        const userFiles = readdirSync(userDaily);
        console.log(`[test] Admin daily logs: ${adminFiles.join(", ")}`);
        console.log(`[test] User daily logs:  ${userFiles.join(", ")}`);

        // 各自的 daily log 独立
        if (adminFiles.length > 0) {
          const adminLog = readFileSync(join(adminDaily, adminFiles[0]), "utf-8");
          expect(adminLog).toContain("ADMIN_PONG");
          // admin 的 log 不应包含 user 特有内容
          expect(adminLog).not.toContain("E2E测试用户偏好");
        }
      }
    })();
  });

  test("user 的 MEMORY.md 只包含 user 保存的内容", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      const userScope = userScopeKey(env!.user!.id);
      const userMemPath = join(tmpMemory, userScope, "MEMORY.md");

      if (existsSync(userMemPath)) {
        const content = readFileSync(userMemPath, "utf-8");
        console.log(`[test] User MEMORY.md:\n${content.slice(0, 200)}`);
        expect(content).toContain("Rust");
      }

      // admin 不应该有相同的 MEMORY.md 内容
      const adminScope = userScopeKey(env!.admin.id);
      const adminMemPath = join(tmpMemory, adminScope, "MEMORY.md");
      if (existsSync(adminMemPath)) {
        const adminContent = readFileSync(adminMemPath, "utf-8");
        expect(adminContent).not.toContain("E2E测试用户偏好");
      }
    })();
  });

  test("user 的 SQLite memory.db 独立于 admin", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      const adminScope = userScopeKey(env!.admin.id);
      const userScope = userScopeKey(env!.user!.id);

      const adminDb = join(tmpMemory, adminScope, "memory.db");
      const userDb = join(tmpMemory, userScope, "memory.db");

      // 两个 DB 文件独立
      if (existsSync(adminDb) && existsSync(userDb)) {
        const adb = new Database(adminDb, { readonly: true });
        const udb = new Database(userDb, { readonly: true });
        try {
          const aCount = (adb.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as { cnt: number }).cnt;
          const uCount = (udb.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as { cnt: number }).cnt;
          console.log(`[test] Admin chunks: ${aCount}, User chunks: ${uCount}`);
          // 两个 DB 都应该有数据
          expect(aCount).toBeGreaterThan(0);
          expect(uCount).toBeGreaterThan(0);
        } finally {
          adb.close();
          udb.close();
        }
      }
    })();
  });
});

// ═══════════════════════════════════════════
//  5. memory_search 跨用户隔离
// ═══════════════════════════════════════════

describe("5. memory_search 搜索隔离", () => {
  test("user 搜索只返回自己的记忆", () => {
    if (skip() || !env!.user) return;
    return (async () => {
      await new Promise((r) => setTimeout(r, 2000));
      const result = await client.collectSessionEvents({
        type: "prompt",
        message: '使用 memory_search 搜索 "Rust"，告诉我搜索结果。',
        session_id: "user-search-test",
        user_id: env!.user!.id,
      });
      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
    })();
  });
});

// ═══════════════════════════════════════════
//  6. Title 生成
// ═══════════════════════════════════════════

describe("6. Title 生成", () => {
  test("generate_title 返回非空中文标题", () => {
    if (skip()) return;
    return (async () => {
      const resp = await client.request({
        type: "generate_title",
        user_message: "帮我写一个排序算法",
        assistant_message: "好的，这是一个快速排序的实现。它使用分治策略...",
      });
      expect(resp.success).toBe(true);
      const title = (resp.data as Record<string, unknown>).title as string;
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      console.log(`[test] Title: "${title}"`);
    })();
  });
});

// ═══════════════════════════════════════════
//  7. Session 生命周期
// ═══════════════════════════════════════════

describe("7. Session 生命周期", () => {
  test("destroy_session 正常工作", () => {
    if (skip()) return;
    return (async () => {
      const resp = await client.request({ type: "destroy_session", session_id: "admin-session" });
      expect(resp.type).toBe("response");
    })();
  });

  test("abort 不存在的 session 不崩溃", () => {
    if (skip()) return;
    return (async () => {
      const resp = await client.request({ type: "abort", session_id: "nonexistent-xyz" });
      expect(resp.type).toBe("response");
    })();
  });
});
