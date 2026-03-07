/**
 * E2E 远程文件系统测试 — 真实 WS + 真实 LLM + desktop 侧文件处理模拟
 *
 * 架构:
 *   1. 从网关获取 LLM 配置
 *   2. 启动 vm-agent server 模式 (WebSocket :18799)
 *   3. WS 客户端连接，拦截 fs.* 请求并模拟桌面端响应
 *   4. prompt agent 使用 remote_read / remote_list / remote_stat / remote_write
 *   5. 验证文件内容往返正确
 *
 * 运行: bun test src/__tests__/remote-fs.e2e.test.ts --timeout 180000
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";

const SERVER_ENTRY = join(import.meta.dir, "..", "server.ts");
const SERVER_PORT = 18799;
const TIMEOUT = 90_000;

// ─── WS Client with File Handler ────────────────────

interface WsMessage {
  id?: string | number;
  type: string;
  [key: string]: unknown;
}

class WsTestClient {
  private ws: WebSocket | null = null;
  private pending: Array<(msg: WsMessage) => void> = [];
  private messages: WsMessage[] = [];
  private workspacePath: string;
  private fileRequests: WsMessage[] = [];

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async connect(url: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS connect timeout")), timeoutMs);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : "";
        if (!raw) return;
        let msg: WsMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        // Handle fs.* requests (simulate desktop file handler)
        const type = typeof msg.type === "string" ? msg.type : "";
        if (type.startsWith("fs.") && !type.endsWith(".result")) {
          this.fileRequests.push(msg);
          this.handleFileRequest(msg);
          return;
        }

        this.messages.push(msg);
        const pending = this.pending.slice();
        this.pending = [];
        for (const resolve of pending) resolve(msg);
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("WS connection error"));
      };

      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  private handleFileRequest(msg: WsMessage) {
    const type = msg.type as string;
    const reqId = msg.req_id as string;

    try {
      if (type === "fs.read") {
        this.handleRead(reqId, msg.path as string);
      } else if (type === "fs.write") {
        this.handleWrite(reqId, msg.path as string, msg.content as string);
      } else if (type === "fs.list") {
        this.handleList(reqId, msg.path as string, msg.recursive as boolean);
      } else if (type === "fs.stat") {
        this.handleStat(reqId, msg.path as string);
      } else {
        this.send({ type: `${type}.result`, req_id: reqId, error: `Unknown: ${type}` });
      }
    } catch (err) {
      this.send({
        type: `${type}.result`,
        req_id: reqId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleRead(reqId: string, path: string) {
    // Security: reject path traversal
    if (path.includes("..") || path.startsWith("/")) {
      this.send({ type: "fs.read.result", req_id: reqId, error: "Path traversal not allowed" });
      return;
    }
    const full = join(this.workspacePath, path);
    if (!existsSync(full)) {
      this.send({ type: "fs.read.result", req_id: reqId, error: `File not found: ${path}` });
      return;
    }
    const content = readFileSync(full);
    const base64 = Buffer.from(content).toString("base64");
    this.send({ type: "fs.read.result", req_id: reqId, content: base64, size: content.length });
  }

  private handleWrite(reqId: string, path: string, contentB64: string) {
    if (path.includes("..") || path.startsWith("/")) {
      this.send({ type: "fs.write.result", req_id: reqId, error: "Path traversal not allowed" });
      return;
    }
    const full = join(this.workspacePath, path);
    const dir = join(full, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const decoded = Buffer.from(contentB64, "base64").toString("utf-8");
    writeFileSync(full, decoded);
    this.send({ type: "fs.write.result", req_id: reqId, ok: true });
  }

  private handleList(reqId: string, path: string, recursive: boolean) {
    if (path && path !== "." && (path.includes("..") || path.startsWith("/"))) {
      this.send({ type: "fs.list.result", req_id: reqId, error: "Path traversal not allowed" });
      return;
    }
    const full = path && path !== "." ? join(this.workspacePath, path) : this.workspacePath;
    if (!existsSync(full)) {
      this.send({ type: "fs.list.result", req_id: reqId, entries: [] });
      return;
    }
    const entries = this.listDir(full, full, recursive);
    this.send({ type: "fs.list.result", req_id: reqId, entries });
  }

  private listDir(root: string, dir: string, recursive: boolean): Array<{ name: string; is_dir: boolean; size: number }> {
    const entries: Array<{ name: string; is_dir: boolean; size: number }> = [];
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      const stat = statSync(full);
      entries.push({ name, is_dir: stat.isDirectory(), size: stat.size });
      if (recursive && stat.isDirectory()) {
        entries.push(...this.listDir(root, full, true));
      }
    }
    return entries;
  }

  private handleStat(reqId: string, path: string) {
    if (path.includes("..") || path.startsWith("/")) {
      this.send({ type: "fs.stat.result", req_id: reqId, error: "Path traversal not allowed" });
      return;
    }
    const full = join(this.workspacePath, path);
    if (!existsSync(full)) {
      this.send({ type: "fs.stat.result", req_id: reqId, exists: false, is_dir: false, size: 0 });
      return;
    }
    const stat = statSync(full);
    this.send({ type: "fs.stat.result", req_id: reqId, exists: true, is_dir: stat.isDirectory(), size: stat.size });
  }

  send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WS not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  async waitFor(predicate: (msg: WsMessage) => boolean, timeoutMs = TIMEOUT): Promise<WsMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return new Promise<WsMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `waitFor timeout (${timeoutMs}ms).\n` +
          `Messages: ${this.messages.length}, FileRequests: ${this.fileRequests.length}\n` +
          `Last msgs: ${JSON.stringify(this.messages.slice(-3))}`,
        ));
      }, timeoutMs);
      const check = (msg: WsMessage) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        } else {
          this.pending.push(check);
        }
      };
      this.pending.push(check);
    });
  }

  async collectSessionEvents(cmd: Record<string, unknown>, timeoutMs = TIMEOUT): Promise<{
    response: WsMessage;
    sessionEvents: WsMessage[];
    done: WsMessage;
    errors: WsMessage[];
  }> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });

    let response: WsMessage | null = null;
    const sessionEvents: WsMessage[] = [];
    const errors: WsMessage[] = [];

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `collectSessionEvents timeout (${timeoutMs}ms). response=${!!response}, events=${sessionEvents.length}\n` +
          `FileRequests: ${this.fileRequests.length}\n` +
          `Last msgs: ${JSON.stringify(this.messages.slice(-3))}`,
        ));
      }, timeoutMs);

      const check = (msg: WsMessage) => {
        if (msg.id !== id) {
          this.pending.push(check);
          return;
        }
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

  get receivedFileRequests(): WsMessage[] {
    return this.fileRequests;
  }

  get allMessages(): WsMessage[] {
    return this.messages;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ─── Test State ─────────────────────────────────────

let env: TestEnv | null = null;
let client: WsTestClient;
let serverProc: ReturnType<typeof spawn>;
let tmpWorkspace: string;
let tmpMemory: string;
let tmpAgentHome: string;
let stderrChunks: string[] = [];

function skip(): boolean {
  if (!env) {
    console.log("  → skipped (no gateway)");
    return true;
  }
  return false;
}

// ─── Setup / Teardown ───────────────────────────────

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[test] ⚠️  No gateway reachable — remote-fs E2E tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "e2e-remotefs-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "e2e-remotefs-mem-"));
  tmpAgentHome = mkdtempSync(join(tmpdir(), "e2e-remotefs-home-"));

  // Seed test files in workspace
  writeFileSync(join(tmpWorkspace, "hello.txt"), "Hello from desktop!\nLine two.\n");
  writeFileSync(join(tmpWorkspace, "data.json"), JSON.stringify({ key: "value", num: 42 }));
  mkdirSync(join(tmpWorkspace, "subdir"));
  writeFileSync(join(tmpWorkspace, "subdir", "nested.txt"), "Nested file content");

  // Start vm-agent in server mode
  serverProc = spawn({
    cmd: ["bun", SERVER_ENTRY],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      MODE: "server",
      PORT: String(SERVER_PORT),
      LLM_PROXY_URL: env.config.llmProxyUrl,
      LLM_PROXY_KEY: env.config.llmProxyKey,
      EMBEDDING_API_KEY: env.config.embeddingApiKey || "",
      EMBEDDING_BASE_URL: env.config.embeddingBaseUrl || "",
      WORKSPACE_DIR: tmpWorkspace,
      MEMORY_ROOT_DIR: tmpMemory,
      AGENT_HOME_DIR: tmpAgentHome,
      MEMORY_ENABLED: "false",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "false",
      PRIMARY_MODEL: "claude-haiku-4-5",
      PRIMARY_PROVIDER: "proxy-claude",
      GATEWAY_TOKEN: "",
    },
  });

  // Collect stderr
  const stderrStream = serverProc.stderr as ReadableStream<Uint8Array>;
  const stderrReader = stderrStream.getReader();
  const decoder = new TextDecoder();
  (async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        stderrChunks.push(text);
        process.stderr.write(text); // mirror to test output
      }
    } catch { /* closed */ }
  })();

  // Wait for server to be ready (health endpoint)
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = (await res.json()) as { ready?: boolean };
        if (data.ready) {
          ready = true;
          break;
        }
      }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!ready) {
    throw new Error(
      `vm-agent server not ready after 30s.\nStderr: ${stderrChunks.join("").slice(-500)}`,
    );
  }

  console.log("[test] ✅ vm-agent server ready");

  // Connect WS client
  client = new WsTestClient(tmpWorkspace);
  await client.connect(`ws://127.0.0.1:${SERVER_PORT}/ws`);
  console.log("[test] ✅ WS client connected");

  // Verify health via WS
  client.send({ type: "health", id: "h1" });
  const health = await client.waitFor((m) => m.id === "h1" && m.type === "response", 5000);
  expect((health as any).success).toBe(true);
  console.log("[test] ✅ Health check OK");
}, 60_000);

afterAll(() => {
  client?.close();
  try {
    serverProc?.kill();
  } catch { /* */ }
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpMemory) rmSync(tmpMemory, { recursive: true, force: true });
  if (tmpAgentHome) rmSync(tmpAgentHome, { recursive: true, force: true });
});

// ═══════════════════════════════════════════
//  1. remote_read — 读取桌面端文件
// ═══════════════════════════════════════════

describe("remote_read", () => {
  test("agent should read a file from desktop workspace", async () => {
    if (skip()) return;

    const result = await client.collectSessionEvents({
      type: "prompt",
      message:
        'Use the remote_read tool to read the file "hello.txt" and tell me its exact contents. Just repeat the content.',
      session_id: "test-remote-read",
    });

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);

    // Verify fs.read request was received
    const readRequests = client.receivedFileRequests.filter((r) => r.type === "fs.read");
    expect(readRequests.length).toBeGreaterThanOrEqual(1);
    expect(readRequests.some((r) => r.path === "hello.txt")).toBe(true);

    // Check agent output contains file content
    const textEvents = result.sessionEvents.filter(
      (e) =>
        e.type === "session_event" &&
        (e.event as any)?.type === "message_update" &&
        (e.event as any)?.assistantMessageEvent?.type === "text_delta",
    );
    const fullText = textEvents.map((e) => (e.event as any)?.assistantMessageEvent?.delta || "").join("");
    expect(fullText).toContain("Hello from desktop!");
  }, TIMEOUT);
});

// ═══════════════════════════════════════════
//  2. remote_list — 列出桌面端目录
// ═══════════════════════════════════════════

describe("remote_list", () => {
  test("agent should list workspace directory", async () => {
    if (skip()) return;

    const result = await client.collectSessionEvents({
      type: "prompt",
      message:
        'Use the remote_list tool to list the contents of "." (root directory). Tell me all file names you see.',
      session_id: "test-remote-list",
    });

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);

    // Verify fs.list request was received
    const listRequests = client.receivedFileRequests.filter((r) => r.type === "fs.list");
    expect(listRequests.length).toBeGreaterThanOrEqual(1);

    // Agent should mention the files
    const textEvents = result.sessionEvents.filter(
      (e) =>
        e.type === "session_event" &&
        (e.event as any)?.type === "message_update" &&
        (e.event as any)?.assistantMessageEvent?.type === "text_delta",
    );
    const fullText = textEvents.map((e) => (e.event as any)?.assistantMessageEvent?.delta || "").join("");
    expect(fullText).toContain("hello.txt");
  }, TIMEOUT);
});

// ═══════════════════════════════════════════
//  3. remote_stat — 检查文件是否存在
// ═══════════════════════════════════════════

describe("remote_stat", () => {
  test("agent should check file existence", async () => {
    if (skip()) return;

    const result = await client.collectSessionEvents({
      type: "prompt",
      message:
        'Use the remote_stat tool to check if "data.json" exists, and also check if "nonexistent.txt" exists. Tell me the results.',
      session_id: "test-remote-stat",
    });

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);

    // Verify fs.stat requests
    const statRequests = client.receivedFileRequests.filter((r) => r.type === "fs.stat");
    expect(statRequests.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════
//  4. remote_write — 写入桌面端文件
// ═══════════════════════════════════════════

describe("remote_write", () => {
  test("agent should write a file to desktop workspace", async () => {
    if (skip()) return;

    const result = await client.collectSessionEvents({
      type: "prompt",
      message:
        'Use the remote_write tool to create a file called "output.txt" with the exact content "Written by cloud agent". Then confirm you wrote it.',
      session_id: "test-remote-write",
    });

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);

    // Verify fs.write request was received
    const writeRequests = client.receivedFileRequests.filter((r) => r.type === "fs.write");
    expect(writeRequests.length).toBeGreaterThanOrEqual(1);

    // Verify file was actually written to workspace
    const outputPath = join(tmpWorkspace, "output.txt");
    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("Written by cloud agent");
  }, TIMEOUT);
});

// ═══════════════════════════════════════════
//  5. Protocol Correctness — 低级别验证
// ═══════════════════════════════════════════

describe("protocol correctness", () => {
  test("all file requests should have req_id", () => {
    if (skip()) return;

    for (const req of client.receivedFileRequests) {
      expect(typeof req.req_id).toBe("string");
      expect((req.req_id as string).length).toBeGreaterThan(0);
    }
  });

  test("file request types should be valid fs.* patterns", () => {
    if (skip()) return;

    for (const req of client.receivedFileRequests) {
      expect(req.type).toMatch(/^fs\.(read|write|list|stat)$/);
    }
  });
});
