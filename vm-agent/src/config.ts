import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  mode: "sidecar" | "server";
  port: number;
  gatewayToken: string;
  proxyUrl: string;
  proxyKey: string;
  openaiApiKey: string;
  /** Embedding API base URL (不含 /embeddings 后缀), 默认 https://api.openai.com/v1 */
  embeddingBaseUrl: string;
  /** Embedding API key, 默认复用 OPENAI_API_KEY */
  embeddingApiKey: string;
  /** Embedding API 超时 (ms) */
  embedTimeoutMs: number;
  /** Embedding 缓存上限 */
  embedCacheMax: number;
  /** Hybrid search BM25 权重 */
  hybridWBm25: number;
  /** Hybrid search Vector 权重 */
  hybridWVec: number;
  workspaceDir: string;
  agentHomeDir: string;
  memoryRootDir: string;
  primaryModel: string;
  primaryProvider: string;
  memoryEnabled: boolean;
  skillsPaths: string[];
  /** 用户自建技能目录 (可编辑) */
  userSkillsDir: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatActiveHours?: { start: string; end: string };
  cronEnabled: boolean;
  toolDenyList: string[];
}

function defaultAppDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "JAcoworks");
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "JAcoworks");
  }

  const xdgDataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdgDataHome, "JAcoworks");
}

function defaultMemoryRootDir(): string {
  return join(defaultAppDataDir(), "memory");
}

function defaultUserSkillsDir(): string {
  return join(defaultAppDataDir(), "skills");
}

export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return 30 * 60 * 1000; // default 30m
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms": return val;
    case "s": return val * 1000;
    case "m": return val * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    default: return 30 * 60 * 1000;
  }
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) return null;

  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();

  // Handle quoted values
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    const wasDouble = val.startsWith('"');
    val = val.slice(1, -1);
    // Handle escape sequences in double-quoted values
    if (wasDouble) {
      val = val.replace(/\\n/g, "\n")
               .replace(/\\t/g, "\t")
               .replace(/\\\\/g, "\\")
               .replace(/\\"/g, '"');
    }
  } else {
    // Remove inline comments (only for unquoted values)
    const hashIdx = val.indexOf(" #");
    if (hashIdx !== -1) {
      val = val.slice(0, hashIdx).trim();
    }
  }

  return [key, val];
}

function resolveSkillsPaths(envVal?: string): string[] {
  if (envVal) {
    return envVal.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Default: look for skills/ relative to vm-agent root
  // Use fileURLToPath to correctly handle Windows paths (e.g. file:///C:/...)
  const currentFile = fileURLToPath(import.meta.url);
  const vmAgentRoot = resolve(dirname(currentFile), "..");
  const defaultPaths = [
    join(vmAgentRoot, "skills"), // vm-agent/skills (monorepo & bundled)
  ];
  if (process.platform === "linux") {
    defaultPaths.push("/shared/skills"); // container fallback
  }
  return defaultPaths;
}

export function loadConfig(): Config {
  // Load .env if exists (VM 部署用)
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, val] = parsed;
      if (!process.env[key]) process.env[key] = val;
    }
  }

  // 中转站配置：仅从网关下发的环境变量读取，无 fallback
  const proxyKey = process.env.LLM_PROXY_KEY || "";
  const proxyUrl = process.env.LLM_PROXY_URL || "";

  if (!proxyKey || !proxyUrl) {
    console.error("❌ 缺少 LLM_PROXY_URL 或 LLM_PROXY_KEY，请在管理后台「系统设置」中配置");
    process.exit(1);
  }

  const heartbeatActiveStart = process.env.HEARTBEAT_ACTIVE_START;
  const heartbeatActiveEnd = process.env.HEARTBEAT_ACTIVE_END;

  const mode = (process.env.MODE === "server" ? "server" : "sidecar") as "sidecar" | "server";
  const isServer = mode === "server";

  const openaiApiKey = process.env.OPENAI_API_KEY || "";
  const embeddingApiKey = process.env.EMBEDDING_API_KEY || openaiApiKey;
  const embeddingBaseUrl = process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1";

  return {
    mode,
    port: parseInt(process.env.PORT || "18789", 10),
    gatewayToken: process.env.GATEWAY_TOKEN || "",
    proxyUrl,
    proxyKey,
    openaiApiKey,
    embeddingBaseUrl,
    embeddingApiKey,
    embedTimeoutMs: parseInt(process.env.MEMORY_EMBED_TIMEOUT_MS || "8000", 10),
    embedCacheMax: parseInt(process.env.MEMORY_EMBED_CACHE_MAX || "10000", 10),
    hybridWBm25: parseFloat(process.env.MEMORY_HYBRID_W_BM25 || "0.3"),
    hybridWVec: parseFloat(process.env.MEMORY_HYBRID_W_VEC || "0.7"),
    workspaceDir: process.env.WORKSPACE_DIR || process.cwd(),
    agentHomeDir: process.env.AGENT_HOME_DIR || defaultAppDataDir(),
    memoryRootDir: process.env.MEMORY_ROOT_DIR || defaultMemoryRootDir(),
    primaryModel: process.env.PRIMARY_MODEL || "claude-opus-4-6",
    primaryProvider: process.env.PRIMARY_PROVIDER || "proxy-claude",
    memoryEnabled: process.env.MEMORY_ENABLED !== "false",
    skillsPaths: resolveSkillsPaths(process.env.SKILLS_PATHS),
    userSkillsDir: process.env.USER_SKILLS_DIR || defaultUserSkillsDir(),
    heartbeatEnabled: process.env.HEARTBEAT_ENABLED !== undefined
      ? process.env.HEARTBEAT_ENABLED === "true"
      : isServer,
    heartbeatIntervalMs: parseInterval(process.env.HEARTBEAT_INTERVAL || "30m"),
    heartbeatActiveHours:
      heartbeatActiveStart && heartbeatActiveEnd
        ? { start: heartbeatActiveStart, end: heartbeatActiveEnd }
        : undefined,
    cronEnabled: process.env.CRON_ENABLED !== undefined
      ? process.env.CRON_ENABLED === "true"
      : isServer,
    toolDenyList: (process.env.TOOL_DENY_LIST || "WebSearch,WebFetch,WebBrowse")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
