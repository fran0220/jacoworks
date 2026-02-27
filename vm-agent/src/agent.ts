import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  createCodingTools,
  loadSkillsFromDir,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionFactory, CreateAgentSessionResult } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config.js";

import { createMemoryExtension } from "./extensions/memory.js";
import { initEmbedding, isEmbeddingAvailable } from "./lib/embedding.js";
import { buildSystemPrompt } from "./prompts/system.js";
import { createHeartbeatService, type HeartbeatService } from "./services/heartbeat.js";
import { createCronService, type CronService } from "./services/cron.js";
import { createPromptQueue, type PromptQueue } from "./lib/prompt-queue.js";

// ─── Session Metadata ───────────────────────────────

export interface SessionMeta {
  restricted: boolean;
  workspace: string;
  userScope: string;
  lastAccess: number;
}

const sessions = new Map<string, CreateAgentSessionResult>();
const sessionMetas = new Map<string, SessionMeta>();
const settingsCache = new Map<string, SettingsManager>();

let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let config: Config;

let heartbeatService: HeartbeatService | null = null;
let cronService: CronService | null = null;
let promptQueue: PromptQueue | null = null;

// ─── Restricted mode: no coding tools, skills still available ──

// ─── Cache key helpers ──────────────────────────────

function normalizeUserId(userId?: string): string {
  const normalized = userId?.trim();
  return normalized || "anonymous";
}

function userScopeKey(userId?: string): string {
  const normalized = normalizeUserId(userId);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function userMemoryRootDir(userId?: string): string {
  return join(config.memoryRootDir, userScopeKey(userId));
}

function sessionCacheKey(
  sessionId: string,
  workspace: string,
  restricted: boolean,
  userScope: string,
): string {
  return `${sessionId}::${workspace}::${restricted ? "restricted" : "full"}::${userScope}`;
}

function getSettingsManager(workspace: string): SettingsManager {
  let sm = settingsCache.get(workspace);
  if (!sm) {
    sm = SettingsManager.create(workspace);
    settingsCache.set(workspace, sm);
  }
  return sm;
}

// ─── LLM 中转站模型注册 ────────────────────────────
// 中转站 http://67.230.171.248:8317 支持 4 种原生协议：
//   Claude  → POST /v1/messages           (anthropic-messages)
//   GPT     → POST /v1/chat/completions   (openai-completions)
//   Gemini  → POST /v1/chat/completions   (openai-completions, 兼容模式)
//   Grok    → POST /v1/chat/completions   (openai-completions)

function registerProxyModels(registry: ModelRegistry, proxyUrl: string, proxyKey: string) {
  // 1. Claude — Anthropic 原生协议
  registry.registerProvider("proxy-claude", {
    baseUrl: proxyUrl,         // POST /v1/messages
    apiKey: proxyKey,
    api: "anthropic-messages",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });

  // 2. GPT — OpenAI 原生协议
  registry.registerProvider("proxy-gpt", {
    baseUrl: `${proxyUrl}/v1`,  // POST /v1/chat/completions
    apiKey: proxyKey,
    api: "openai-completions",
    models: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });

  // 3. Gemini — OpenAI 兼容协议 (中转站支持)
  registry.registerProvider("proxy-gemini", {
    baseUrl: `${proxyUrl}/v1`,
    apiKey: proxyKey,
    api: "openai-completions",
    models: [
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });

  // 4. Grok — OpenAI 兼容协议
  registry.registerProvider("proxy-grok", {
    baseUrl: `${proxyUrl}/v1`,
    apiKey: proxyKey,
    api: "openai-completions",
    models: [
      {
        id: "grok-4.20-beta",
        name: "Grok 4.20 Beta",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "grok-4.1-fast",
        name: "Grok 4.1 Fast",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
}

// ─── Init & Session Pool ────────────────────────────

export function initAgent(cfg: Config) {
  config = cfg;

  authStorage = AuthStorage.inMemory();
  modelRegistry = new ModelRegistry(authStorage);

  // 注册中转站所有模型
  registerProxyModels(modelRegistry, cfg.proxyUrl, cfg.proxyKey);

  // 初始化 Embedding API (向量记忆搜索)
  // 优先使用 EMBEDDING_API_KEY + EMBEDDING_BASE_URL, 回退到 OPENAI_API_KEY
  if (cfg.embeddingApiKey) {
    initEmbedding(cfg.embeddingApiKey, cfg.embeddingBaseUrl);
  } else if (cfg.openaiApiKey) {
    initEmbedding(cfg.openaiApiKey);
  }

  console.log("✅ Agent initialized");
  console.log(`   Default model: ${cfg.primaryProvider}/${cfg.primaryModel}`);
  console.log(`   LLM Proxy: ${cfg.proxyUrl}`);
  console.log(`   Workspace: ${cfg.workspaceDir}`);
  console.log(`   Memory root: ${cfg.memoryRootDir}`);
  console.log(`   Embedding: ${isEmbeddingAvailable() ? `text-embedding-3-small → ${cfg.embeddingBaseUrl || "https://api.openai.com/v1"}` : "disabled (no EMBEDDING_API_KEY / OPENAI_API_KEY)"}`);

  // 列出已注册的代理模型
  const proxyModels = modelRegistry
    .getAll()
    .filter((m) => m.provider.startsWith("proxy-"));
  console.log(`   Proxy models: ${proxyModels.length}`);
  for (const m of proxyModels) {
    console.log(`     - ${m.provider}/${m.id}`);
  }
}

export interface SessionOptions {
  workspace?: string;
  restricted?: boolean;
  model?: { provider: string; id: string } | null;
  userId?: string;
}

export async function getSession(sessionId: string, opts?: SessionOptions) {
  const workspace = opts?.workspace || config.workspaceDir;
  const restricted = !!opts?.restricted;
  const userScope = userScopeKey(opts?.userId);
  const cacheKey = sessionCacheKey(sessionId, workspace, restricted, userScope);

  let entry = sessions.get(cacheKey);
  if (entry) {
    // Update last access time
    const meta = sessionMetas.get(cacheKey);
    if (meta) meta.lastAccess = Date.now();
    return entry;
  }

  // Use requested model if provided, otherwise fall back to default
  const requestedModel = opts?.model
    ? modelRegistry.find(opts.model.provider, opts.model.id)
    : null;
  const model = requestedModel || modelRegistry.find(config.primaryProvider, config.primaryModel);
  if (!model) {
    const proxyModels = modelRegistry
      .getAll()
      .filter((m) => m.provider.startsWith("proxy-"))
      .map((m) => `${m.provider}/${m.id}`);
    throw new Error(
      `Model not found: ${config.primaryProvider}/${config.primaryModel}\n` +
        `Available proxy models: ${proxyModels.join(", ")}`
    );
  }

  const codingTools = createCodingTools(workspace);

  const extensionFactories: ExtensionFactory[] = [];

  if (config.memoryEnabled) {
    extensionFactories.push(createMemoryExtension(userMemoryRootDir(opts?.userId)));
  }

  if (config.cronEnabled && cronService) {
    extensionFactories.push(cronService.getExtensionFactory());
  }

  if (config.toolDenyList.length > 0) {
    extensionFactories.push((pi) => {
      pi.on("tool_call", async (event) => {
        if (config.toolDenyList.includes(event.toolName)) {
          return { block: true, reason: `Tool '${event.toolName}' is restricted` };
        }
      });
    });
  }

  const settingsManager = getSettingsManager(workspace);

  // Build system prompt: core identity + SOUL.md + active services
  const systemPrompt = await buildSystemPrompt({
    workspaceDir: workspace,
    memoryEnabled: config.memoryEnabled,
    cronEnabled: config.cronEnabled,
    heartbeatEnabled: config.heartbeatEnabled,
    userSkillsDir: config.userSkillsDir,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    settingsManager,
    extensionFactories,
    additionalSkillPaths: [
      ...(existsSync(config.remoteSkillsDir) ? [config.remoteSkillsDir] : []),
      ...config.skillsPaths.filter((p) => existsSync(p)),
      ...(existsSync(config.userSkillsDir) ? [config.userSkillsDir] : []),
    ],
    appendSystemPrompt: systemPrompt,
    noThemes: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  entry = await createAgentSession({
    sessionManager: SessionManager.inMemory(workspace),
    authStorage,
    modelRegistry,
    model,
    tools: opts?.restricted ? [] : codingTools,
    resourceLoader,
    settingsManager,
    cwd: workspace,
  });

  sessions.set(cacheKey, entry);
  sessionMetas.set(cacheKey, {
    restricted,
    workspace,
    userScope,
    lastAccess: Date.now(),
  });
  console.log(`[session] created: ${sessionId} -> ${model.provider}/${model.id} (workspace: ${workspace}, restricted: ${restricted}, userScope: ${userScope})`);
  return entry;
}

/**
 * 解析请求中的 model 字段，支持格式：
 *   "proxy-claude/claude-sonnet-4-6"  → provider: proxy-claude, id: claude-sonnet-4-6
 *   "claude-sonnet-4-6"               → 自动匹配 provider
 *   "gpt-5.2"                          → 自动匹配 proxy-gpt
 */
export function resolveModel(modelStr?: string) {
  if (!modelStr) return null;

  // 带 provider 前缀
  if (modelStr.includes("/")) {
    const [provider, id] = modelStr.split("/", 2);
    return modelRegistry.find(provider, id) ?? null;
  }

  // 无前缀：动态获取所有 proxy-* provider 查找
  const proxyProviders = [
    ...new Set(
      modelRegistry
        .getAll()
        .filter((m) => m.provider.startsWith("proxy-"))
        .map((m) => m.provider),
    ),
  ];
  for (const prefix of proxyProviders) {
    const found = modelRegistry.find(prefix, modelStr);
    if (found) return found;
  }
  return null;
}

export function destroySession(sessionId: string): boolean {
  // Find all cache keys matching this sessionId (any workspace)
  let destroyed = false;
  for (const [key, entry] of sessions.entries()) {
    if (key === sessionId || key.startsWith(`${sessionId}::`)) {
      entry.session.dispose();
      sessions.delete(key);
      sessionMetas.delete(key);
      destroyed = true;
    }
  }
  return destroyed;
}

export async function abortSession(sessionId: string): Promise<boolean> {
  for (const [key, entry] of sessions.entries()) {
    if (key === sessionId || key.startsWith(`${sessionId}::`)) {
      if (entry.session.isStreaming) {
        await entry.session.abort();
      }
      return true;
    }
  }
  return false;
}

export function destroyAllSessions(): void {
  for (const [, entry] of sessions.entries()) {
    entry.session.dispose();
  }
  sessions.clear();
  sessionMetas.clear();
}

export function cleanupStaleSessions(maxAgeMs: number = 3600_000): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, meta] of sessionMetas.entries()) {
    if (now - meta.lastAccess > maxAgeMs) {
      const entry = sessions.get(key);
      if (entry) entry.session.dispose();
      sessions.delete(key);
      sessionMetas.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

export function getSessionMeta(sessionId: string): SessionMeta | undefined {
  // Try exact match first, then prefix match
  const meta = sessionMetas.get(sessionId);
  if (meta) return meta;
  for (const [key, m] of sessionMetas.entries()) {
    if (key.startsWith(`${sessionId}::`)) return m;
  }
  return undefined;
}

export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

// ─── Background Session (isolated from user chat) ───

const BG_SESSION_SUFFIX = "::background";

async function executePrompt(prompt: string): Promise<string> {
  const bgSessionId = `${config.primaryProvider}/${config.primaryModel}${BG_SESSION_SUFFIX}`;
  const { session } = await getSession(bgSessionId);

  // Wait for any in-flight stream to finish
  if (session.isStreaming) {
    await new Promise<void>((resolve) => {
      const unsub = session.subscribe((event) => {
        if (event.type === "agent_end") {
          unsub();
          resolve();
        }
      });
    });
  }

  let fullText = "";

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("Background prompt timeout (5min)"));
    }, 300_000);

    const unsub = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        fullText += event.assistantMessageEvent.delta;
      }
      if (event.type === "agent_end") {
        clearTimeout(timeout);
        unsub();
        resolve(fullText);
      }
    });

    session.prompt(prompt).catch((err) => {
      clearTimeout(timeout);
      unsub();
      reject(err);
    });
  });
}

// ─── Background Services ────────────────────────────

export async function startBackgroundServices() {
  promptQueue = createPromptQueue(executePrompt, { timeoutMs: 300_000 });

  if (config.heartbeatEnabled) {
    heartbeatService = createHeartbeatService(
      {
        enabled: true,
        intervalMs: config.heartbeatIntervalMs,
        workspaceDir: config.workspaceDir,
        activeHours: config.heartbeatActiveHours,
      },
      (prompt) => promptQueue!.enqueue(prompt),
    );
    heartbeatService.start();
  }

  if (config.cronEnabled) {
    cronService = createCronService(
      { workspaceDir: config.workspaceDir },
      (prompt) => promptQueue!.enqueue(prompt),
    );
    cronService.start();
    // Register cron_manage tool into background session
    const bgSessionId = `${config.primaryProvider}/${config.primaryModel}${BG_SESSION_SUFFIX}`;
    const bgCacheKey = sessionCacheKey(
      bgSessionId,
      config.workspaceDir,
      false,
      userScopeKey(undefined),
    );
    const bgEntry = sessions.get(bgCacheKey);
    if (!bgEntry) {
      // Ensure bg session exists so cron tool gets registered on next getSession()
      console.log("⏰ Cron service started (cron_manage tool available via agent)");
    } else {
      console.log("⏰ Cron service started");
    }
  }
}

export function getHeartbeatService(): HeartbeatService | null {
  return heartbeatService;
}

export function getCronService(): CronService | null {
  return cronService;
}

// ─── Skill Discovery (Pi SDK native) ─────────────────

function readDisplayFields(filePath: string): { displayName?: string; displayDesc?: string } {
  try {
    const content = readFileSync(filePath, "utf-8");
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const result: Record<string, string> = {};
    for (const line of m[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (/^["'].*["']$/.test(val)) val = val.slice(1, -1);
      result[key] = val;
    }
    return { displayName: result["display-name"], displayDesc: result["display-description"] };
  } catch { return {}; }
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  group?: string;
  source: "builtin" | "user";
  editable: boolean;
}

export function listAvailableSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const userDir = config.userSkillsDir;

  // Helper: load skills from a directory and tag source
  function loadFrom(dir: string, source: "builtin" | "user") {
    if (!existsSync(dir)) return;
    const result = loadSkillsFromDir({ dir, source: "additional" });
    for (const s of result.skills) {
      const { displayName, displayDesc } = readDisplayFields(s.filePath);
      const rel = relative(dir, s.filePath);
      const parts = rel.split("/");
      const dirGroup = parts.length > 2 ? parts[0] : undefined;
      skills.push({
        id: s.name,
        name: displayName || s.name,
        description: displayDesc || s.description,
        group: dirGroup,
        source,
        editable: source === "user",
      });
    }
  }

  // Remote skills (from gateway, highest priority)
  if (existsSync(config.remoteSkillsDir)) {
    loadFrom(config.remoteSkillsDir, "builtin");
  }

  // Built-in skills (vm-agent/skills/ etc.)
  for (const dir of config.skillsPaths) {
    loadFrom(dir, "builtin");
  }

  // User-created skills
  loadFrom(userDir, "user");

  return skills;
}

// ─── Lightweight Title Generation ───────────────────

export async function generateSessionTitle(
  userMessage: string,
  assistantMessage: string,
): Promise<string> {
  const truncUser = userMessage.slice(0, 300);
  const truncAssistant = assistantMessage.slice(0, 500);
  const prompt = `根据以下对话生成一个简短标题（最多15个中文字符或30个英文字符）。只回复标题本身，不要加引号或标点。\n\n用户: ${truncUser}\n助手: ${truncAssistant}`;

  // 优先用轻量模型，回退到主模型
  const titleModels = [
    { model: "claude-haiku-4-5-20251001", api: "anthropic" },
    { model: config.primaryModel, api: config.primaryProvider.includes("claude") ? "anthropic" : "openai" },
  ];

  let lastError: Error | null = null;

  for (const { model, api } of titleModels) {
    try {
      if (api === "anthropic") {
        const res = await fetch(`${config.proxyUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.proxyKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 30,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Anthropic ${model} ${res.status}: ${body.slice(0, 200)}`);
        }

        const result = (await res.json()) as {
          content?: Array<{ text?: string }>;
        };
        const title = result.content?.[0]?.text?.trim() || "";
        if (title) return title;
      } else {
        const res = await fetch(`${config.proxyUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.proxyKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 30,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`OpenAI ${model} ${res.status}: ${body.slice(0, 200)}`);
        }

        const result = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const title = result.choices?.[0]?.message?.content?.trim() || "";
        if (title) return title;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[title] ${model} failed:`, lastError.message);
      continue;
    }
  }

  if (lastError) throw lastError;
  return "新会话";
}
