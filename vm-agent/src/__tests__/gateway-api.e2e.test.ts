/**
 * Gateway API E2E 完整测试套件
 *
 * 覆盖全部 30+ Gateway 端点，~60 test cases，分为：
 *   1. 健康检查 & 公开 API
 *   2. 认证 (登录/激活/登出/用户信息)
 *   3. 会话 CRUD + 隔离
 *   4. Agent 配置
 *   5. 记忆同步
 *   6. 技能同步 (upload/checksum/pull/ETag)
 *   7. 反馈提交
 *   8. 游戏 API
 *   9. 管理员 API (设置/激活码/容器列表)
 *  10. 聊天代理
 *  11. Cowork Bridge (ws-ticket/status)
 *  12. Cowork (container-status/provision)
 *
 * 使用测试账户:
 *   - admin: admin@jacoworks.local / admin123 (role=admin)
 *   - e2e-tester: e2e-tester / e2e-test-2026 (role=user)
 *
 * 运行: bun test src/__tests__/gateway-api.e2e.test.ts --timeout 60000
 * 网关不可达则全部跳过。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";
import { createHash } from "node:crypto";

// ─── Constants ──────────────────────────────────────

const T = 10_000; // default fetch timeout ms
const PREFIX = `e2e-api-${Date.now()}`;

const ADMIN_CREDS = { username: "admin@jacoworks.local", password: "admin123" };
const USER_CREDS = { username: "e2e-tester", password: "e2e-test-2026" };

// ─── State ──────────────────────────────────────────

let env: TestEnv | null = null;

// Tokens that may be refreshed during tests
let adminToken = "";
let userToken = "";

// Resources to clean up
const sessionsToDelete: Array<{ token: string; id: string }> = [];

function skip(): boolean {
  if (!env) { console.log("  → skipped (no gateway)"); return true; }
  return false;
}
function skipNoUser(): boolean {
  if (!env?.user) { console.log("  → skipped (no e2e-tester)"); return true; }
  return false;
}

// ─── Helpers ────────────────────────────────────────

async function api(
  path: string,
  opts: RequestInit & { token?: string } = {},
  timeout = T,
): Promise<Response> {
  const { token, ...init } = opts;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${env!.gatewayUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function login(creds: { username: string; password: string }): Promise<string> {
  const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify(creds) });
  expect(res.status).toBe(200);
  const data = await json<{ token: string }>(res);
  return data.token;
}

function contentChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ─── Setup / Teardown ───────────────────────────────

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[gateway-e2e] ⚠️  No gateway reachable — all tests will be skipped");
    return;
  }
  adminToken = env.admin.token;
  userToken = env.user?.token ?? "";
});

afterAll(async () => {
  if (!env) return;
  // Cleanup created sessions
  for (const s of sessionsToDelete) {
    try {
      await api(`/api/sessions/${s.id}`, { method: "DELETE", token: s.token });
    } catch { /* best effort */ }
  }
});

// ═══════════════════════════════════════════════════════
//  1. 健康检查 & 公开 API
// ═══════════════════════════════════════════════════════

describe("1. 健康检查 & 公开 API", () => {
  test("GET /health → 200 ok", async () => {
    if (skip()) return;
    const res = await api("/health");
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("ok");
  });

  test("GET /api/games → 200 (公开, 无需认证)", async () => {
    if (skip()) return;
    const res = await api("/api/games");
    expect(res.status).toBe(200);
    const body = await json<unknown[]>(res);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
//  2. 认证
// ═══════════════════════════════════════════════════════

describe("2. 认证", () => {
  // 2.1 Login
  test("POST /api/auth/login — admin 正确登录", async () => {
    if (skip()) return;
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(ADMIN_CREDS),
    });
    expect(res.status).toBe(200);
    const data = await json<{ token: string; user: { id: string; role: string; name: string; email: string } }>(res);
    expect(data.token.length).toBeGreaterThan(20);
    expect(data.user.role).toBe("admin");
    expect(data.user.email).toBe("admin@jacoworks.local");
    // Refresh admin token
    adminToken = data.token;
  });

  test("POST /api/auth/login — user 正确登录", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(USER_CREDS),
    });
    expect(res.status).toBe(200);
    const data = await json<{ token: string; user: { role: string } }>(res);
    expect(data.token.length).toBeGreaterThan(20);
    expect(data.user.role).toBe("user");
    userToken = data.token;
  });

  test("POST /api/auth/login — 空字段 → 400", async () => {
    if (skip()) return;
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "", password: "" }),
    });
    expect(res.status).toBe(400);
    const data = await json<{ error: string }>(res);
    expect(data.error).toBeTruthy();
  });

  test("POST /api/auth/login — 错误密码 → 401", async () => {
    if (skip()) return;
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: ADMIN_CREDS.username, password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/auth/login — 不存在用户 → 401", async () => {
    if (skip()) return;
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "nonexistent-user-xyz", password: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  // 2.2 Activate
  test("POST /api/auth/activate — 无效激活码 → 400", async () => {
    if (skip()) return;
    const res = await api("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({ code: "INVALID-CODE-XYZ", username: "fake-user", password: "fake123" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/auth/activate — 空字段 → 400", async () => {
    if (skip()) return;
    const res = await api("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({ code: "", username: "", password: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/auth/activate — 已存在用户名 → 409", async () => {
    if (skip()) return;
    // 用有效码但已存在的用户名注册
    const res = await api("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({ code: "JACO-USER-2026", username: "e2e-tester", password: "whatever" }),
    });
    // 已存在的用户名 → 409 conflict
    expect([400, 409]).toContain(res.status);
  });

  // 2.3 Users/me
  test("GET /api/users/me — admin token → 200 + role=admin", async () => {
    if (skip()) return;
    const res = await api("/api/users/me", { token: adminToken });
    expect(res.status).toBe(200);
    const me = await json<{ id: string; name: string; email: string; role: string }>(res);
    expect(me.role).toBe("admin");
    expect(me.id).toBeTruthy();
    expect(me.email).toBeTruthy();
  });

  test("GET /api/users/me — user token → 200 + role=user", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/users/me", { token: userToken });
    expect(res.status).toBe(200);
    const me = await json<{ role: string }>(res);
    expect(me.role).toBe("user");
  });

  test("GET /api/users/me — 无 token → 401", async () => {
    if (skip()) return;
    const res = await api("/api/users/me");
    expect(res.status).toBe(401);
  });

  test("GET /api/users/me — 无效 token → 401", async () => {
    if (skip()) return;
    const res = await api("/api/users/me", { token: "invalid-token-xyz-123" });
    expect(res.status).toBe(401);
  });

  // 2.4 Logout
  test("POST /api/auth/logout — 登出后 token 失效", async () => {
    if (skip()) return;
    // 先获取一个新 token 专用于登出测试
    const freshToken = await login(ADMIN_CREDS);
    // 验证 token 有效
    const before = await api("/api/users/me", { token: freshToken });
    expect(before.status).toBe(200);
    // 登出
    const logoutRes = await api("/api/auth/logout", { method: "POST", token: freshToken });
    expect(logoutRes.status).toBe(204);
    // 登出后 token 应失效
    const after = await api("/api/users/me", { token: freshToken });
    expect(after.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════
//  3. 会话 CRUD
// ═══════════════════════════════════════════════════════

describe("3. 会话 CRUD", () => {
  let adminSessionId = "";
  let userSessionId = "";

  // 3.1 Create
  test("POST /api/sessions — admin 创建会话", async () => {
    if (skip()) return;
    const res = await api("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ type: "chat", model: "claude-sonnet-4-6" }),
    });
    expect(res.status).toBe(201);
    const sess = await json<{ id: string; title: string; type: string }>(res);
    expect(sess.id).toBeTruthy();
    expect(sess.type).toBe("chat");
    adminSessionId = sess.id;
    sessionsToDelete.push({ token: adminToken, id: adminSessionId });
  });

  test("POST /api/sessions — user 创建会话", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/sessions", {
      method: "POST",
      token: userToken,
      body: JSON.stringify({ type: "chat", model: "claude-sonnet-4-6" }),
    });
    expect(res.status).toBe(201);
    const sess = await json<{ id: string }>(res);
    expect(sess.id).toBeTruthy();
    userSessionId = sess.id;
    sessionsToDelete.push({ token: userToken, id: userSessionId });
  });

  test("POST /api/sessions — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ type: "chat" }),
    });
    expect(res.status).toBe(401);
  });

  // 3.2 Get
  test("GET /api/sessions/{id} — 拥有者访问 → 200", async () => {
    if (skip() || !adminSessionId) return;
    const res = await api(`/api/sessions/${adminSessionId}`, { token: adminToken });
    expect(res.status).toBe(200);
    const sess = await json<{ id: string; type: string }>(res);
    expect(sess.id).toBe(adminSessionId);
  });

  test("GET /api/sessions/{id} — 他人访问 → 404", async () => {
    if (skip() || skipNoUser() || !adminSessionId) return;
    // user 尝试访问 admin 的 session
    const res = await api(`/api/sessions/${adminSessionId}`, { token: userToken });
    expect(res.status).toBe(404);
  });

  test("GET /api/sessions/{id} — 不存在 id → 404", async () => {
    if (skip()) return;
    const res = await api("/api/sessions/nonexistent-session-id-xyz", { token: adminToken });
    expect(res.status).toBe(404);
  });

  // 3.3 Update
  test("PUT /api/sessions/{id} — 更新 title", async () => {
    if (skip() || !adminSessionId) return;
    const newTitle = `${PREFIX}-updated-title`;
    const res = await api(`/api/sessions/${adminSessionId}`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({ title: newTitle }),
    });
    expect(res.status).toBe(200);
    const sess = await json<{ id: string; title: string }>(res);
    expect(sess.title).toBe(newTitle);
  });

  test("PUT /api/sessions/{id} — 更新 messages (JSONB)", async () => {
    if (skip() || !adminSessionId) return;
    const messages = JSON.stringify([{ role: "user", content: "hello" }]);
    const res = await api(`/api/sessions/${adminSessionId}`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({ messages }),
    });
    expect(res.status).toBe(200);
  });

  test("PUT /api/sessions/{id} — 他人更新 → 404", async () => {
    if (skip() || skipNoUser() || !adminSessionId) return;
    const res = await api(`/api/sessions/${adminSessionId}`, {
      method: "PUT",
      token: userToken,
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(res.status).toBe(404);
  });

  // 3.4 List
  test("GET /api/sessions — admin 列表仅含自己的", async () => {
    if (skip()) return;
    const res = await api("/api/sessions", { token: adminToken });
    expect(res.status).toBe(200);
    const list = await json<Array<{ id: string }>>(res);
    expect(Array.isArray(list)).toBe(true);
    if (adminSessionId) {
      expect(list.some((s) => s.id === adminSessionId)).toBe(true);
    }
    // 不应包含 user 的 session
    if (userSessionId) {
      expect(list.some((s) => s.id === userSessionId)).toBe(false);
    }
  });

  test("GET /api/sessions — user 列表仅含自己的", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/sessions", { token: userToken });
    expect(res.status).toBe(200);
    const list = await json<Array<{ id: string }>>(res);
    if (userSessionId) {
      expect(list.some((s) => s.id === userSessionId)).toBe(true);
    }
    if (adminSessionId) {
      expect(list.some((s) => s.id === adminSessionId)).toBe(false);
    }
  });

  test("GET /api/sessions — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/sessions");
    expect(res.status).toBe(401);
  });

  // 3.5 Delete
  test("DELETE /api/sessions/{id} — 他人删除 → 404", async () => {
    if (skip() || skipNoUser() || !adminSessionId) return;
    const res = await api(`/api/sessions/${adminSessionId}`, { method: "DELETE", token: userToken });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/sessions/{id} — 拥有者删除 → 204, 再 GET → 404", async () => {
    if (skip() || !adminSessionId) return;
    const del = await api(`/api/sessions/${adminSessionId}`, { method: "DELETE", token: adminToken });
    expect(del.status).toBe(204);
    const get = await api(`/api/sessions/${adminSessionId}`, { token: adminToken });
    expect(get.status).toBe(404);
    // Remove from cleanup list since already deleted
    const idx = sessionsToDelete.findIndex((s) => s.id === adminSessionId);
    if (idx >= 0) sessionsToDelete.splice(idx, 1);
    adminSessionId = "";
  });
});

// ═══════════════════════════════════════════════════════
//  4. Agent 配置
// ═══════════════════════════════════════════════════════

describe("4. Agent 配置", () => {
  test("GET /api/agent/config — admin → 200 含 LLM 配置", async () => {
    if (skip()) return;
    const res = await api("/api/agent/config", { token: adminToken });
    expect(res.status).toBe(200);
    const cfg = await json<{
      llm_proxy_url: string;
      llm_proxy_key: string;
      models: Array<{ id: string; provider: string; label: string }>;
    }>(res);
    expect(cfg.llm_proxy_url).toBeTruthy();
    expect(cfg.llm_proxy_key).toBeTruthy();
    expect(Array.isArray(cfg.models)).toBe(true);
    expect(cfg.models.length).toBeGreaterThan(0);
    // 验证模型结构
    const first = cfg.models[0];
    expect(first.id).toBeTruthy();
    expect(first.provider).toBeTruthy();
    expect(first.label).toBeTruthy();
  });

  test("GET /api/agent/config — user 同样可获取", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/agent/config", { token: userToken });
    expect(res.status).toBe(200);
    const cfg = await json<{ llm_proxy_url: string; models: unknown[] }>(res);
    expect(cfg.llm_proxy_url).toBeTruthy();
    expect(cfg.models.length).toBeGreaterThan(0);
  });

  test("GET /api/agent/config — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/agent/config");
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════
//  5. 记忆同步
// ═══════════════════════════════════════════════════════

describe("5. 记忆同步", () => {
  const memoryMarker = `${PREFIX}-memory-test`;

  test("POST /api/memory/sync — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/memory/sync", {
      method: "POST",
      body: JSON.stringify({ manifest: [], push: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/memory/sync — 上传新文件", async () => {
    if (skip()) return;
    const content = `# E2E Memory Test\n${memoryMarker}\n`;
    const res = await api("/api/memory/sync", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        manifest: [],
        push: [{ path: `${PREFIX}-MEMORY.md`, content }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ push_accepted: string[]; pull: unknown[]; server_time: string }>(res);
    expect(data.push_accepted).toContain(`${PREFIX}-MEMORY.md`);
    expect(typeof data.server_time).toBe("string");
  });

  test("POST /api/memory/sync — 幂等 (相同 checksum 无变化)", async () => {
    if (skip()) return;
    const content = `# E2E Memory Test\n${memoryMarker}\n`;
    const ck = contentChecksum(content);
    const res = await api("/api/memory/sync", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        manifest: [{ path: `${PREFIX}-MEMORY.md`, checksum: ck }],
        push: [],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ push_accepted: string[] | null; pull: Array<{ path: string }> | null }>(res);
    // 该文件 checksum 匹配，不应出现在 push_accepted 或 pull 中
    expect((data.push_accepted ?? []).includes(`${PREFIX}-MEMORY.md`)).toBe(false);
    const pulledOurFile = (data.pull ?? []).find((p) => p.path === `${PREFIX}-MEMORY.md`);
    expect(pulledOurFile).toBeUndefined();
  });

  test("POST /api/memory/sync — checksum 不匹配 → 服务端返回 pull", async () => {
    if (skip()) return;
    const res = await api("/api/memory/sync", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        manifest: [{ path: `${PREFIX}-MEMORY.md`, checksum: "wrong-checksum" }],
        push: [],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ pull: Array<{ path: string; content: string; checksum: string }> }>(res);
    // 服务端有该文件但 checksum 不匹配，应在 pull 中返回
    expect(data.pull.length).toBeGreaterThan(0);
    const pulled = data.pull.find((p) => p.path === `${PREFIX}-MEMORY.md`);
    expect(pulled).toBeTruthy();
    expect(pulled!.content).toContain(memoryMarker);
  });

  test("POST /api/memory/sync — 用户隔离 (user 看不到 admin 的专有文件)", async () => {
    if (skip() || skipNoUser()) return;
    // admin 上传了 PREFIX-MEMORY.md，user 的 manifest 中声明它 checksum 不匹配
    // 如果隔离正确，user 的 pull 中不应包含 admin 的 PREFIX-MEMORY.md
    const res = await api("/api/memory/sync", {
      method: "POST",
      token: userToken,
      body: JSON.stringify({
        manifest: [],
        push: [],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ pull: Array<{ path: string }> | null }>(res);
    // user 的 pull 不应包含 admin 独有的 PREFIX 文件
    const adminFile = (data.pull ?? []).find((p) => p.path === `${PREFIX}-MEMORY.md`);
    expect(adminFile).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
//  6. 技能同步
// ═══════════════════════════════════════════════════════

describe("6. 技能同步", () => {
  let baselineUserChecksum = "";

  test("POST /api/skills/upload — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/skills/upload", {
      method: "POST",
      body: JSON.stringify({ source: "user", files: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /api/skills/checksum — 获取基线", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/skills/checksum", { token: userToken });
    expect(res.status).toBe(200);
    const data = await json<{ system: string; user: string }>(res);
    expect(typeof data.system).toBe("string");
    expect(typeof data.user).toBe("string");
    baselineUserChecksum = data.user;
  });

  test("POST /api/skills/upload — 上传技能文件", async () => {
    if (skip() || skipNoUser()) return;
    const skillContent = `# ${PREFIX} Skill\nGenerated: ${new Date().toISOString()}\n`;
    const res = await api("/api/skills/upload", {
      method: "POST",
      token: userToken,
      body: JSON.stringify({
        source: "user",
        files: [{ path: `${PREFIX}/test-skill/SKILL.md`, content: skillContent }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ status: string; file_count: number }>(res);
    expect(data.status).toBe("ok");
    expect(data.file_count).toBe(1);
  });

  test("GET /api/skills/checksum — 上传后 checksum 变化", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/skills/checksum", { token: userToken });
    expect(res.status).toBe(200);
    const data = await json<{ user: string }>(res);
    expect(data.user).not.toBe(baselineUserChecksum);
  });

  test("GET /api/skills/pull — 拉取系统技能文件", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/skills/pull", { token: userToken });
    expect(res.status).toBe(200);
    const data = await json<{ files: Array<{ file_path: string }>; checksum: string }>(res);
    expect(Array.isArray(data.files)).toBe(true);
    expect(typeof data.checksum).toBe("string");
  });

  test("GET /api/skills/pull — ETag → If-None-Match → 304", async () => {
    if (skip() || skipNoUser()) return;
    const first = await api("/api/skills/pull", { token: userToken });
    expect(first.status).toBe(200);
    const data = await json<{ checksum: string }>(first);
    const etag = first.headers.get("ETag") || data.checksum;
    if (!etag) { console.log("  → skipped (no ETag)"); return; }

    const second = await api("/api/skills/pull", {
      token: userToken,
      headers: { "If-None-Match": etag },
    });
    expect(second.status).toBe(304);
  });

  test("GET /api/skills/checksum — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/skills/checksum");
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════
//  7. 反馈提交
// ═══════════════════════════════════════════════════════

describe("7. 反馈提交", () => {
  test("POST /api/feedback — 有效提交 → 200", async () => {
    if (skip()) return;
    const res = await api("/api/feedback", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        category: "bug",
        title: `${PREFIX} E2E feedback test`,
        description: "自动化测试反馈，请忽略。",
        version: PREFIX,
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ issue_number: number; issue_url: string }>(res);
    // GitHub 可能未配置，但应返回结构
    expect(typeof data.issue_number).toBe("number");
    expect(typeof data.issue_url).toBe("string");
  });

  test("POST /api/feedback — 缺少 title → 400", async () => {
    if (skip()) return;
    const res = await api("/api/feedback", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ category: "bug", title: "", description: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/feedback — 缺少 description → 400", async () => {
    if (skip()) return;
    const res = await api("/api/feedback", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ category: "bug", title: "test", description: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/feedback — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ category: "bug", title: "test", description: "test" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/feedback — user 也可提交", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/feedback", {
      method: "POST",
      token: userToken,
      body: JSON.stringify({
        category: "feature",
        title: `${PREFIX} user feedback`,
        description: "User 角色反馈测试",
        version: PREFIX,
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════
//  8. 游戏 API
// ═══════════════════════════════════════════════════════

describe("8. 游戏 API", () => {
  test("GET /api/games — 公开列表返回数组", async () => {
    if (skip()) return;
    const res = await api("/api/games");
    expect(res.status).toBe(200);
    const games = await json<unknown[]>(res);
    expect(Array.isArray(games)).toBe(true);
  });

  test("POST /api/games/deploy — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/games/deploy", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("DELETE /api/games/{id} — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/games/nonexistent-game", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("DELETE /api/games/{id} — 不存在 game → 404 或 500", async () => {
    if (skip()) return;
    const res = await api(`/api/games/${PREFIX}-fake-game`, {
      method: "DELETE",
      token: adminToken,
    });
    // 不存在的 game 应该返回错误
    expect([404, 500]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════
//  9. 管理员 API
// ═══════════════════════════════════════════════════════

describe("9. 管理员 API", () => {
  // 9.1 Settings
  test("GET /api/admin/settings — admin → 200", async () => {
    if (skip()) return;
    const res = await api("/api/admin/settings", { token: adminToken });
    expect(res.status).toBe(200);
    const settings = await json<Array<{ key: string; value: string }>>(res);
    expect(Array.isArray(settings)).toBe(true);
  });

  test("GET /api/admin/settings — user → 403", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/admin/settings", { token: userToken });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/settings — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/admin/settings");
    expect(res.status).toBe(401);
  });

  test("PUT /api/admin/settings — 未知 key → 400", async () => {
    if (skip()) return;
    const res = await api("/api/admin/settings", {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({ settings: { unknown_key_xyz: "value" } }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/admin/settings — user → 403", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/admin/settings", {
      method: "PUT",
      token: userToken,
      body: JSON.stringify({ settings: { llm_proxy_url: "test" } }),
    });
    expect(res.status).toBe(403);
  });

  // 9.2 Invite Codes
  test("GET /api/admin/invite-codes — admin → 200", async () => {
    if (skip()) return;
    const res = await api("/api/admin/invite-codes", { token: adminToken });
    expect(res.status).toBe(200);
    const codes = await json<Array<{ code: string; role: string }>>(res);
    expect(Array.isArray(codes)).toBe(true);
    expect(codes.length).toBeGreaterThan(0); // seed data has codes
  });

  test("GET /api/admin/invite-codes — user → 403", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/admin/invite-codes", { token: userToken });
    expect(res.status).toBe(403);
  });

  test("POST /api/admin/invite-codes — admin 创建激活码", async () => {
    if (skip()) return;
    const res = await api("/api/admin/invite-codes", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ role: "user", max_uses: 1, note: `${PREFIX} test code` }),
    });
    expect(res.status).toBe(201);
    const code = await json<{ code: string; role: string; max_uses: number }>(res);
    expect(code.code).toBeTruthy();
    expect(code.role).toBe("user");
    expect(code.max_uses).toBe(1);
  });

  test("POST /api/admin/invite-codes — user → 403", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/admin/invite-codes", {
      method: "POST",
      token: userToken,
      body: JSON.stringify({ role: "user", max_uses: 1 }),
    });
    expect(res.status).toBe(403);
  });

  // 9.3 Containers
  test("GET /api/admin/containers — admin → 200", async () => {
    if (skip()) return;
    const res = await api("/api/admin/containers", { token: adminToken });
    // 可能返回 200 (列表) 或 503 (Docker 不可达)
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      const body = await json<unknown>(res);
      // 应该是数组或对象
      expect(body).toBeTruthy();
    }
  });

  test("GET /api/admin/containers — user → 403", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/admin/containers", { token: userToken });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════
//  10. 聊天代理
// ═══════════════════════════════════════════════════════

describe("10. 聊天代理", () => {
  test("POST /v1/chat/completions — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /v1/chat/completions — admin 可访问 (路由存在)", async () => {
    if (skip()) return;
    // 注: 实际代理到 ChatAgent，可能返回 502/503 如果后端不可达
    // 这里只验证路由和认证正常工作
    const res = await api("/v1/chat/completions", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "reply PONG" }],
      }),
    }, 15_000);
    // 路由通过认证 → 不是 401/403
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════
//  11. Cowork Bridge
// ═══════════════════════════════════════════════════════

describe("11. Cowork Bridge", () => {
  test("POST /api/oc/ws-ticket — admin 签发 ticket", async () => {
    if (skip()) return;
    const res = await api("/api/oc/ws-ticket", { method: "POST", token: adminToken });
    expect(res.status).toBe(200);
    const data = await json<{ ticket: string }>(res);
    expect(typeof data.ticket).toBe("string");
    expect(data.ticket.length).toBeGreaterThan(10);
  });

  test("POST /api/oc/ws-ticket — user 也可签发", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/oc/ws-ticket", { method: "POST", token: userToken });
    expect(res.status).toBe(200);
    const data = await json<{ ticket: string }>(res);
    expect(data.ticket.length).toBeGreaterThan(10);
  });

  test("POST /api/oc/ws-ticket — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/oc/ws-ticket", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("GET /api/oc/status — admin 查询状态", async () => {
    if (skip()) return;
    const res = await api("/api/oc/status", { token: adminToken });
    expect(res.status).toBe(200);
    const data = await json<{ connected: boolean; reconnecting: boolean; containerName: string }>(res);
    expect(typeof data.connected).toBe("boolean");
    expect(typeof data.reconnecting).toBe("boolean");
    expect(typeof data.containerName).toBe("string");
  });

  test("GET /api/oc/status — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/oc/status");
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════
//  12. Cowork (container-status / provision)
// ═══════════════════════════════════════════════════════

describe("12. Cowork", () => {
  test("GET /api/cowork/container-status — admin → 200", async () => {
    if (skip()) return;
    const res = await api("/api/cowork/container-status", { token: adminToken });
    expect(res.status).toBe(200);
    const data = await json<{ provisioned: boolean }>(res);
    expect(typeof data.provisioned).toBe("boolean");
  });

  test("GET /api/cowork/container-status — user → 200", async () => {
    if (skip() || skipNoUser()) return;
    const res = await api("/api/cowork/container-status", { token: userToken });
    expect(res.status).toBe(200);
    const data = await json<{ provisioned: boolean }>(res);
    expect(typeof data.provisioned).toBe("boolean");
  });

  test("GET /api/cowork/container-status — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/cowork/container-status");
    expect(res.status).toBe(401);
  });

  // 注: POST /api/cowork/provision 会实际分配容器，不在 API 测试中触发
  // 改为验证路由存在 + 认证要求
  test("POST /api/cowork/provision — 无 auth → 401", async () => {
    if (skip()) return;
    const res = await api("/api/cowork/provision", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
