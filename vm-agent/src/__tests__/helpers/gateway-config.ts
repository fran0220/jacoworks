/**
 * 从真实网关获取 agent 配置 + 测试用户认证
 *
 * 流程: login → get token → GET /api/agent/config → 提取 LLM + Embedding 密钥
 * 双用户: admin (管理员) + e2e-tester (普通用户)
 */

export interface GatewayAgentConfig {
  llmProxyUrl: string;
  llmProxyKey: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  models: Array<{ id: string; label: string; provider: string }>;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: string;
  token: string;
}

export interface TestEnv {
  gatewayUrl: string;
  config: GatewayAgentConfig;
  admin: TestUser;
  user: TestUser | null;  // 可能注册失败
}

const GATEWAY_URLS = [
  "http://localhost:8847",
  "https://jacoapi.jingao.club",
];

const ADMIN_CREDS = { username: "admin@jacoworks.local", password: "admin123" };
const USER_CREDS = { username: "e2e-tester", password: "e2e-test-2026" };
const E2E_INVITE_CODE = "02fd4b5c6a128c762a99966de11ba110";

async function login(
  baseUrl: string,
  creds: { username: string; password: string },
  timeoutMs = 5000,
): Promise<TestUser | null> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token: string; user: Omit<TestUser, "token"> };
    return { ...data.user, token: data.token };
  } catch {
    return null;
  }
}

async function activateAndLogin(
  baseUrl: string,
  creds: { username: string; password: string },
  code: string,
): Promise<TestUser | null> {
  // 先尝试登录 (已注册)
  const existing = await login(baseUrl, creds);
  if (existing) return existing;

  // 未注册 → 用激活码注册
  try {
    const res = await fetch(`${baseUrl}/api/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, username: creds.username, password: creds.password }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(`[test] Activate ${creds.username} failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { token: string; user: Omit<TestUser, "token"> };
    return { ...data.user, token: data.token };
  } catch (e) {
    console.log(`[test] Activate ${creds.username} error:`, e);
    return null;
  }
}

async function getAgentConfig(
  baseUrl: string,
  token: string,
): Promise<GatewayAgentConfig | null> {
  try {
    const res = await fetch(`${baseUrl}/api/agent/config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const llmProxyUrl = data.llm_proxy_url as string || "";
    const llmProxyKey = data.llm_proxy_key as string || "";
    if (!llmProxyUrl || !llmProxyKey) return null;
    return {
      llmProxyUrl,
      llmProxyKey,
      embeddingBaseUrl: (data.embedding_base_url as string) || "",
      embeddingApiKey: (data.embedding_api_key as string) || "",
      models: (data.models as GatewayAgentConfig["models"]) || [],
    };
  } catch {
    return null;
  }
}

/** 尝试所有网关地址，返回完整测试环境 (admin + user + config) */
export async function setupTestEnv(): Promise<TestEnv | null> {
  for (const url of GATEWAY_URLS) {
    const admin = await login(url, ADMIN_CREDS);
    if (!admin) continue;

    const config = await getAgentConfig(url, admin.token);
    if (!config) continue;

    // 注册或登录 E2E 测试用户
    const user = await activateAndLogin(url, USER_CREDS, E2E_INVITE_CODE);

    console.log(`[test] Gateway: ${url}`);
    console.log(`[test] Admin: ${admin.name} (${admin.id})`);
    console.log(`[test] User: ${user ? `${user.name} (${user.id})` : "⚠️ unavailable"}`);
    console.log(`[test] LLM: ${config.llmProxyUrl}`);
    console.log(`[test] Embedding: ${config.embeddingBaseUrl || "disabled"}`);
    console.log(`[test] Models: ${config.models.length}`);

    return { gatewayUrl: url, config, admin, user };
  }
  return null;
}

// Re-export for backward compatibility
export { type GatewayAgentConfig as AgentConfig };
export async function fetchAgentConfig(): Promise<GatewayAgentConfig | null> {
  const env = await setupTestEnv();
  return env?.config ?? null;
}
