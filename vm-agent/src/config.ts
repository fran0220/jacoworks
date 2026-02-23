import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  port: number;
  gatewayToken: string;
  proxyUrl: string;
  proxyKey: string;
  workspaceDir: string;
  primaryModel: string;
  primaryProvider: string;
  memoryEnabled: boolean;
  skillsPaths: string[];
  heartbeatEnabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatActiveHours?: { start: string; end: string };
  cronEnabled: boolean;
  toolDenyList: string[];
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

export function loadConfig(): Config {
  // Load .env if exists (VM 部署用)
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }

  // 中转站配置：LLM_PROXY_KEY > ANTHROPIC_API_KEY
  const proxyKey =
    process.env.LLM_PROXY_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";

  const proxyUrl =
    process.env.LLM_PROXY_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    "http://67.230.171.248:8317";

  if (!proxyKey) {
    console.error("❌ 需要 LLM_PROXY_KEY 或 ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const heartbeatActiveStart = process.env.HEARTBEAT_ACTIVE_START;
  const heartbeatActiveEnd = process.env.HEARTBEAT_ACTIVE_END;

  return {
    port: parseInt(process.env.PORT || "18789", 10),
    gatewayToken: process.env.GATEWAY_TOKEN || "",
    proxyUrl,
    proxyKey,
    workspaceDir: process.env.WORKSPACE_DIR || process.cwd(),
    primaryModel: process.env.PRIMARY_MODEL || "claude-sonnet-4-6",
    primaryProvider: process.env.PRIMARY_PROVIDER || "proxy-claude",
    memoryEnabled: process.env.MEMORY_ENABLED !== "false",
    skillsPaths: (process.env.SKILLS_PATHS || "/shared/skills,/workspace/skills")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    heartbeatEnabled: process.env.HEARTBEAT_ENABLED === "true",
    heartbeatIntervalMs: parseInterval(process.env.HEARTBEAT_INTERVAL || "30m"),
    heartbeatActiveHours:
      heartbeatActiveStart && heartbeatActiveEnd
        ? { start: heartbeatActiveStart, end: heartbeatActiveEnd }
        : undefined,
    cronEnabled: process.env.CRON_ENABLED === "true",
    toolDenyList: (process.env.TOOL_DENY_LIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
