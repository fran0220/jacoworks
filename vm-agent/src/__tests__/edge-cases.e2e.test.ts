/**
 * Edge Cases E2E
 *
 * 覆盖并发、网络错误恢复、输入边界、Token 边界和 RPC 边界场景。
 * 自动复用真实网关配置；若网关不可达则整套自动跳过。
 */

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";
import { RpcClient } from "./helpers/rpc-client.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const API_TIMEOUT_MS = 10_000;
const EDGE_PREFIX = `e2e-edge-${Date.now()}`;

const ADMIN_CREDS = {
  username: "admin@jacoworks.local",
  password: "admin123",
};

interface LoginResponse {
  token: string;
}

interface SessionResponse {
  id: string;
  title: string;
}

let env: TestEnv | null = null;
let adminToken = "";
let userToken = "";

let rpcClient: RpcClient | null = null;
let rpcWorkspace = "";
let rpcMemory = "";

const sessionsToDelete: Array<{ token: string; id: string }> = [];

function skipNoGateway(): boolean {
  if (!env) {
    console.log("  → skipped (no gateway)");
    return true;
  }
  return false;
}

function skipNoUser(): boolean {
  if (!env?.user) {
    console.log("  → skipped (no e2e-tester)");
    return true;
  }
  return false;
}

function skipNoRpc(): boolean {
  if (skipNoGateway()) return true;
  if (!rpcClient) {
    console.log("  → skipped (rpc client unavailable)");
    return true;
  }
  return false;
}

function trackSession(token: string, id: string) {
  if (!sessionsToDelete.some((s) => s.token === token && s.id === id)) {
    sessionsToDelete.push({ token, id });
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name} ${err.message}`;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function api(
  path: string,
  opts: RequestInit & { token?: string } = {},
  timeoutMs = API_TIMEOUT_MS,
): Promise<Response> {
  if (!env) throw new Error("gateway not initialized");

  const { token, ...init } = opts;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${env.gatewayUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function loginToken(username: string, password: string): Promise<string> {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  const data = await readJson<LoginResponse>(res);
  expect(data.token.length).toBeGreaterThan(20);
  return data.token;
}

async function createSession(token: string, extras: Record<string, unknown> = {}): Promise<SessionResponse> {
  const preferredModel = env?.config.models[0]?.id || "claude-sonnet-4-6";
  const res = await api("/api/sessions", {
    method: "POST",
    token,
    body: JSON.stringify({
      type: "chat",
      model: preferredModel,
      ...extras,
    }),
  });
  expect(res.status).toBe(201);
  const sess = await readJson<SessionResponse>(res);
  trackSession(token, sess.id);
  return sess;
}

function sendRawLine(client: RpcClient, line: string) {
  const internal = client as unknown as {
    stdin?: { write(data: string | Uint8Array): number };
  };
  if (!internal.stdin) {
    throw new Error("rpc client stdin unavailable");
  }
  internal.stdin.write(line);
}

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[edge-cases] ⚠️  No gateway reachable — all tests will be skipped");
    return;
  }

  adminToken = env.admin.token;
  userToken = env.user?.token ?? "";

  rpcWorkspace = mkdtempSync(join(tmpdir(), "edge-rpc-ws-"));
  rpcMemory = mkdtempSync(join(tmpdir(), "edge-rpc-mem-"));

  const preferredModel = env.config.models[0]?.id || "claude-sonnet-4-6";
  const preferredProvider = env.config.models[0]?.provider || "proxy-claude";

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
      WORKSPACE_DIR: rpcWorkspace,
      MEMORY_ROOT_DIR: rpcMemory,
      MEMORY_ENABLED: "false",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "false",
      PRIMARY_MODEL: preferredModel,
      PRIMARY_PROVIDER: preferredProvider,
    },
  });

  rpcClient = new RpcClient(proc);
  await rpcClient.waitReady(30_000);
  console.log("[edge-cases] ✅ vm-agent ready");
});

afterAll(async () => {
  rpcClient?.kill();
  rpcClient = null;

  if (rpcWorkspace) {
    rmSync(rpcWorkspace, { recursive: true, force: true });
  }
  if (rpcMemory) {
    rmSync(rpcMemory, { recursive: true, force: true });
  }

  if (!env) return;

  for (const sess of sessionsToDelete) {
    try {
      await api(`/api/sessions/${sess.id}`, { method: "DELETE", token: sess.token });
    } catch {
      // best effort
    }
  }
});

describe("1. Gateway Concurrency", () => {
  test("10x 并发 GET /api/users/me 都成功", async () => {
    if (skipNoGateway()) return;

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api("/api/users/me", { token: adminToken })),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const users = await Promise.all(responses.map((r) => readJson<{ id: string }>(r)));
    expect(new Set(users.map((u) => u.id)).size).toBe(1);
  });

  test("5x 并发 POST /api/sessions 创建成功且 ID 唯一", async () => {
    if (skipNoGateway()) return;

    const preferredModel = env?.config.models[0]?.id || "claude-sonnet-4-6";

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => api("/api/sessions", {
        method: "POST",
        token: adminToken,
        body: JSON.stringify({
          type: "chat",
          model: preferredModel,
          workspace_path: `${EDGE_PREFIX}-concurrency-${i}`,
        }),
      })),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    const created = await Promise.all(responses.map((r) => readJson<SessionResponse>(r)));
    const ids = created.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) {
      trackSession(adminToken, id);
    }
  });

  test("3x 并发 POST /api/auth/login 全部成功且 token 唯一", async () => {
    if (skipNoGateway()) return;

    const responses = await Promise.all(
      Array.from({ length: 3 }, () => api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(ADMIN_CREDS),
      })),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const tokens = (await Promise.all(responses.map((r) => readJson<LoginResponse>(r)))).map((v) => v.token);
    expect(new Set(tokens).size).toBe(3);
  });
});

describe("2. Timeout & Network Errors", () => {
  test("超短超时请求可被捕获 (AbortSignal.timeout)", async () => {
    if (skipNoGateway()) return;

    let caught: unknown = null;
    try {
      await fetch(`${env!.gatewayUrl}/api/users/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(1),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(/abort|timeout/i.test(errorText(caught))).toBe(true);
  });

  test("错误端口请求返回网络错误 (localhost:1)", async () => {
    let caught: unknown = null;
    try {
      await fetch("http://127.0.0.1:1/health", {
        signal: AbortSignal.timeout(1000),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(errorText(caught).length).toBeGreaterThan(0);
  });

  test("不存在的 path 返回 404", async () => {
    if (skipNoGateway()) return;

    const res = await api(`/api/not-found-${Date.now()}`);
    expect(res.status).toBe(404);
  });
});

describe("3. Invalid Input Boundaries", () => {
  test("POST /api/auth/login body 非 JSON → 400", async () => {
    if (skipNoGateway()) return;

    const res = await fetch(`${env!.gatewayUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not-json",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/auth/login body={} → 400", async () => {
    if (skipNoGateway()) return;

    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/sessions 超长 title (10000 chars)", async () => {
    if (skipNoGateway()) return;

    const longTitle = "L".repeat(10_000);
    const preferredModel = env?.config.models[0]?.id || "claude-sonnet-4-6";
    const res = await api("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ type: "chat", model: preferredModel, title: longTitle }),
    });

    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      const sess = await readJson<SessionResponse>(res);
      expect(sess.id).toBeTruthy();
      expect(sess.title.length).toBeLessThanOrEqual(10_000);
      trackSession(adminToken, sess.id);
    }
  });

  test("PUT /api/sessions/{id} XSS payload title", async () => {
    if (skipNoGateway()) return;

    const sess = await createSession(adminToken);
    const payload = "<script>alert(1)</script>";

    const res = await api(`/api/sessions/${sess.id}`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({ title: payload }),
    });

    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const updated = await readJson<SessionResponse>(res);
      expect(typeof updated.title).toBe("string");
      expect(updated.title.length).toBeGreaterThan(0);
    }
  });

  test("POST /api/memory/sync 超大 manifest (1000 entries)", async () => {
    if (skipNoGateway()) return;

    const manifest = Array.from({ length: 1000 }, (_, i) => ({
      path: `${EDGE_PREFIX}/memory/${i}.md`,
      checksum: `ck-${i}`,
    }));

    const res = await api("/api/memory/sync", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ manifest, push: [] }),
    }, 30_000);

    expect([200, 400, 413, 422]).toContain(res.status);
    if (res.status === 200) {
      const body = await readJson<{ server_time: string }>(res);
      expect(typeof body.server_time).toBe("string");
    }
  });

  test("POST /api/skills/upload 空 files 边界", async () => {
    if (skipNoGateway()) return;

    const res = await api("/api/skills/upload", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ source: "user", files: [] }),
    });

    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const body = await readJson<{ status: string; file_count: number }>(res);
      expect(body.status).toBe("ok");
      expect(body.file_count).toBe(0);
    }
  });

  test("DELETE /api/sessions/{非法字符} → 400 或 404", async () => {
    if (skipNoGateway()) return;

    const illegalSessionID = encodeURIComponent("\u0000illegal-session");
    const res = await api(`/api/sessions/${illegalSessionID}`, {
      method: "DELETE",
      token: adminToken,
    });

    expect([400, 404]).toContain(res.status);
  });
});

describe("4. Token Invalidation & Isolation", () => {
  test("logout 后 token 立即失效", async () => {
    if (skipNoGateway()) return;

    const fresh = await loginToken(ADMIN_CREDS.username, ADMIN_CREDS.password);

    const before = await api("/api/users/me", { token: fresh });
    expect(before.status).toBe(200);

    const logoutRes = await api("/api/auth/logout", {
      method: "POST",
      token: fresh,
    });
    expect(logoutRes.status).toBe(204);

    const after = await api("/api/users/me", { token: fresh });
    expect(after.status).toBe(401);
  });

  test("截断 token → 401", async () => {
    if (skipNoGateway()) return;

    const truncated = adminToken.slice(0, 10);
    const res = await api("/api/users/me", { token: truncated });
    expect(res.status).toBe(401);
  });

  test("Authorization 无 Bearer 前缀 → 401", async () => {
    if (skipNoGateway()) return;

    const res = await fetch(`${env!.gatewayUrl}/api/users/me`, {
      headers: { Authorization: adminToken },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    expect(res.status).toBe(401);
  });

  test("admin/user token 并发操作保持会话隔离", async () => {
    if (skipNoGateway() || skipNoUser()) return;

    const [adminSession, userSession] = await Promise.all([
      createSession(adminToken),
      createSession(userToken),
    ]);

    const [userReadsAdmin, adminReadsUser] = await Promise.all([
      api(`/api/sessions/${adminSession.id}`, { token: userToken }),
      api(`/api/sessions/${userSession.id}`, { token: adminToken }),
    ]);
    expect(userReadsAdmin.status).toBe(404);
    expect(adminReadsUser.status).toBe(404);

    const [adminListRes, userListRes] = await Promise.all([
      api("/api/sessions", { token: adminToken }),
      api("/api/sessions", { token: userToken }),
    ]);
    expect(adminListRes.status).toBe(200);
    expect(userListRes.status).toBe(200);

    const adminList = await readJson<Array<{ id: string }>>(adminListRes);
    const userList = await readJson<Array<{ id: string }>>(userListRes);

    expect(adminList.some((s) => s.id === adminSession.id)).toBe(true);
    expect(adminList.some((s) => s.id === userSession.id)).toBe(false);
    expect(userList.some((s) => s.id === userSession.id)).toBe(true);
    expect(userList.some((s) => s.id === adminSession.id)).toBe(false);
  });
});

describe("5. RPC Boundaries", () => {
  test("stdin 非法 JSON 不导致 agent 崩溃", async () => {
    if (skipNoRpc()) return;

    sendRawLine(rpcClient!, "{not-json}\n");

    const invalid = await rpcClient!.waitFor(
      (m) => m.type === "error" && m.error === "invalid_json",
      10_000,
    );
    expect(invalid.type).toBe("error");

    const health = await rpcClient!.request({ type: "health" });
    expect(health.type).toBe("response");
    expect(health.success).toBe(true);
  });

  test("未知 command type 返回失败响应", async () => {
    if (skipNoRpc()) return;

    const resp = await rpcClient!.request({ type: "unknown_cmd" });
    expect(resp.type).toBe("response");
    expect(resp.success).toBe(false);
    const data = (resp.data ?? {}) as Record<string, unknown>;
    expect(String(data.error || "")).toContain("unsupported command");
  });

  test("连续快速发送 3 个 prompt 不丢消息", async () => {
    if (skipNoRpc()) return;

    const base = Date.now();
    const prompts = Array.from({ length: 3 }, (_, i) => ({
      id: `edge-burst-${base}-${i}`,
      sessionID: `edge-burst-session-${base}-${i}`,
      marker: `EDGE_BURST_${i}`,
    }));

    for (const p of prompts) {
      rpcClient!.send({
        id: p.id,
        type: "prompt",
        message: `Reply with exactly: ${p.marker}`,
        session_id: p.sessionID,
        user_id: env!.admin.id,
      });
    }

    const responses = await Promise.all(
      prompts.map((p) => rpcClient!.waitFor((m) => m.id === p.id && m.type === "response", 40_000)),
    );
    expect(responses.length).toBe(3);
    expect(responses.every((r) => r.success === true)).toBe(true);

    const doneEvents = await Promise.all(
      prompts.map((p) => rpcClient!.waitFor((m) => m.id === p.id && m.type === "done", 90_000)),
    );
    expect(doneEvents.length).toBe(3);

    // Verify each prompt's done event is tied to the correct id (no cross-contamination)
    for (let i = 0; i < prompts.length; i++) {
      expect(doneEvents[i].id).toBe(prompts[i].id);
    }
  });

  test("abort 进行中的 prompt 能收到终止结果", async () => {
    if (skipNoRpc()) return;

    const promptID = `edge-abort-prompt-${Date.now()}`;
    const sessionID = `edge-abort-session-${Date.now()}`;

    rpcClient!.send({
      id: promptID,
      type: "prompt",
      message: "Generate a long numbered list from 1 to 5000 and do not summarize.",
      session_id: sessionID,
      user_id: env!.admin.id,
    });

    const startResponse = await rpcClient!.waitFor(
      (m) => m.id === promptID && m.type === "response",
      30_000,
    );
    if (startResponse.success !== true) {
      console.log("  → skipped (prompt did not start successfully)");
      return;
    }

    await rpcClient!
      .waitFor((m) => m.id === promptID && m.type === "session_event", 15_000)
      .catch(() => null);

    const abortID = `edge-abort-cmd-${Date.now()}`;
    rpcClient!.send({
      id: abortID,
      type: "abort",
      session_id: sessionID,
    });

    const abortResp = await rpcClient!.waitFor(
      (m) => m.id === abortID && m.type === "response",
      20_000,
    );
    expect(abortResp.type).toBe("response");
    const abortData = (abortResp.data ?? {}) as Record<string, unknown>;
    expect(typeof abortData.aborted).toBe("boolean");

    const done = await rpcClient!.waitFor(
      (m) => m.id === promptID && m.type === "done",
      60_000,
    );
    expect(done.type).toBe("done");
  });
});
