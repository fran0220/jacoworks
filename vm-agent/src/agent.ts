import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory, CreateAgentSessionResult, Skill } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.js";

import { createMemoryExtension } from "./extensions/memory.js";
import { createVisualExtension } from "./extensions/visual.js";
import { createImageGenExtension } from "./extensions/image-gen.js";
import { createVideoGenExtension } from "./extensions/video-gen.js";
import { createWebSearchExtension } from "./extensions/web-search.js";
import { createCheatExtension } from "./extensions/cheat.js";
import { initEmbedding, isEmbeddingAvailable } from "./lib/embedding.js";
import { buildSystemPrompt, seedAgentHome } from "./prompts/system.js";
import { createHeartbeatService, type HeartbeatService } from "./services/heartbeat.js";
import { createCronService, type CronService, type CronResultEvent } from "./services/cron.js";
import { createPromptQueue, type PromptQueue } from "./lib/prompt-queue.js";
import { createPythonExtension } from "./tools/python.js";
import { log } from "./lib/logger.js";
import { EventEmitter } from "node:events";
import type { MemoryStoreConfig } from "./lib/memory-store.js";

// ─── Session Metadata ───────────────────────────────

export interface SessionMeta {
  restricted: boolean;
  workspace: string;
  userScope: string;
  userId?: string;
  anonymous?: boolean;
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
export const agentEvents = new EventEmitter();

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

// ─── LLM 模型动态注册 ────────────────────────────
// 模型列表由 Gateway /api/agent/config 下发，Desktop 通过 LLM_MODELS_JSON 环境变量传入。
// 不再硬编码模型列表，加减模型只需在管理后台 llm_providers / llm_models 表操作。

interface DynamicModelEntry {
  id: string;
  provider: string;
  label: string;
  context_window: number;
  max_tokens: number;
  reasoning: boolean;
  api_type: string;
}

function registerDynamicModels(registry: ModelRegistry, proxyUrl: string, proxyKey: string) {
  const raw = process.env.LLM_MODELS_JSON;
  if (!raw) {
    log.error("LLM_MODELS_JSON not set — no models available. Check gateway /api/agent/config");
    return;
  }

  let entries: DynamicModelEntry[];
  try {
    entries = JSON.parse(raw);
  } catch (err) {
    log.error("failed to parse LLM_MODELS_JSON", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    log.error("LLM_MODELS_JSON is empty — no models available");
    return;
  }

  // Group by provider
  const groups = new Map<string, DynamicModelEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.provider) || [];
    group.push(entry);
    groups.set(entry.provider, group);
  }

  let totalModels = 0;
  for (const [providerKey, models] of groups) {
    const isAnthropic = models[0].api_type === "anthropic";
    registry.registerProvider(providerKey, {
      baseUrl: isAnthropic ? proxyUrl : `${proxyUrl}/v1`,
      apiKey: proxyKey,
      api: isAnthropic ? "anthropic-messages" : "openai-completions",
      models: models.map((m) => ({
        id: m.id,
        name: m.label,
        reasoning: m.reasoning,
        input: ["text", "image"] as ("text" | "image")[],
        contextWindow: m.context_window,
        maxTokens: m.max_tokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    });
    totalModels += models.length;
  }

  log.info("dynamic models registered", {
    providers: groups.size,
    models: totalModels,
  });
}

// ─── Init & Session Pool ────────────────────────────

export function initAgent(cfg: Config) {
  config = cfg;

  authStorage = AuthStorage.inMemory();
  modelRegistry = ModelRegistry.inMemory(authStorage);

  // 模型列表由 Gateway 下发，通过 LLM_MODELS_JSON 环境变量传入
  registerDynamicModels(modelRegistry, cfg.proxyUrl, cfg.proxyKey);

  // Seed agent home directory with default bootstrap files (non-fatal)
  seedAgentHome(cfg.agentHomeDir).catch((err) => {
    log.warn("failed to seed agent home", { error: err instanceof Error ? err.message : String(err) });
  });

  // 初始化 Embedding API (向量记忆搜索)
  // 优先使用 EMBEDDING_API_KEY + EMBEDDING_BASE_URL, 回退到 OPENAI_API_KEY
  if (cfg.embeddingApiKey) {
    initEmbedding(cfg.embeddingApiKey, cfg.embeddingBaseUrl, cfg.embedTimeoutMs);
  } else if (cfg.openaiApiKey) {
    initEmbedding(cfg.openaiApiKey, undefined, cfg.embedTimeoutMs);
  }

  log.info("agent initialized", {
    model: `${cfg.primaryProvider}/${cfg.primaryModel}`,
    proxy: cfg.proxyUrl,
    workspace: cfg.workspaceDir,
    memory_root: cfg.memoryRootDir,
    embedding: isEmbeddingAvailable() ? `text-embedding-3-small → ${cfg.embeddingBaseUrl || "https://api.openai.com/v1"}` : "disabled",
  });

  const proxyModels = modelRegistry
    .getAll()
    .filter((m) => m.provider.startsWith("proxy-"));
  log.info("proxy models registered", { count: proxyModels.length, models: proxyModels.map((m) => `${m.provider}/${m.id}`) });
}

export interface SessionOptions {
  workspace?: string;
  restricted?: boolean;
  model?: { provider: string; id: string } | null;
  userId?: string;
  anonymous?: boolean;
}

export async function getSession(sessionId: string, opts?: SessionOptions) {
  const workspace = config.workspaceDir;
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

  const memRoot = userMemoryRootDir(opts?.userId);
  const memoryStoreConfig: MemoryStoreConfig = {
    embedCacheMax: config.embedCacheMax,
    hybridWBm25: config.hybridWBm25,
    hybridWVec: config.hybridWVec,
  };

  const extensionFactories: ExtensionFactory[] = [];

  if (config.memoryEnabled && !opts?.anonymous) {
    extensionFactories.push(
      createMemoryExtension(memRoot, {
        embedCacheMax: memoryStoreConfig.embedCacheMax,
        hybridWBm25: memoryStoreConfig.hybridWBm25,
        hybridWVec: memoryStoreConfig.hybridWVec,
      }, {
        reserveTokens: config.compactionReserveTokens,
        softThresholdTokens: config.compactionSoftThresholdTokens,
      }),
    );
  }

  if (cronService) {
    extensionFactories.push(cronService.getExtensionFactory());
  }

  // Python tool (available when python is on PATH or bundled in runtimes/)
  if (!restricted) {
    extensionFactories.push(createPythonExtension());
  }

  // Visual rendering tool (always available)
  extensionFactories.push(createVisualExtension());

  // Image generation / editing — requires ASSET_GATEWAY_TOKEN or LLM_PROXY_KEY
  const assetToken = process.env.ASSET_GATEWAY_TOKEN || config.proxyKey;
  if (assetToken) {
    extensionFactories.push(createImageGenExtension(assetToken, process.env.ASSET_GATEWAY_URL));
    extensionFactories.push(createVideoGenExtension(assetToken, process.env.ASSET_GATEWAY_URL));
  }

  // Web search tool — requires AI_SEARCH_TOKEN or LLM_PROXY_KEY
  const searchToken = process.env.AI_SEARCH_TOKEN || config.proxyKey;
  if (searchToken) {
    extensionFactories.push(
      createWebSearchExtension(searchToken, process.env.AI_SEARCH_GATEWAY_URL),
    );
  }

  // cheat-on-content extension (always registered; activates only when
  // .cheat-state.json exists in the session workspace).
  if (config.proxyUrl && config.proxyKey) {
    extensionFactories.push(createCheatExtension(workspace, config.proxyUrl, config.proxyKey));
  }

  // ─── Context compression: trim old tool results to save tokens ───
  // Before each LLM call, compress old messages to reduce input tokens.
  // - Keep only the last N toolResult messages intact
  // - Older toolResult with long text → truncate to summary
  // - Older toolResult with ImageContent → replace with text placeholder
  const CONTEXT_KEEP_RECENT = 4;         // keep last N toolResults intact
  const CONTEXT_MAX_TOOL_TEXT = 800;      // max chars for old toolResult text
  const CONTEXT_INDEXED_TO_MEMORY_MARKER = "indexed to memory";
  extensionFactories.push((pi) => {
    pi.on("context", async (event) => {
      const messages = event.messages;

      // Find indices of all toolResult messages
      const toolResultIndices: number[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg && typeof msg === "object" && "role" in msg && msg.role === "toolResult") {
          toolResultIndices.push(i);
        }
      }

      // Only compress if there are old tool results beyond the keep window
      if (toolResultIndices.length <= CONTEXT_KEEP_RECENT) return;

      const compressUpTo = toolResultIndices[toolResultIndices.length - CONTEXT_KEEP_RECENT];
      const compressed = messages.map((msg, idx) => {
        if (idx >= compressUpTo) return msg; // recent: keep intact
        if (!msg || typeof msg !== "object" || !("role" in msg) || msg.role !== "toolResult") return msg;

        const tr = msg as { role: "toolResult"; toolCallId: string; toolName: string; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details?: unknown; isError: boolean; timestamp: number };
        const newContent: Array<{ type: "text"; text: string }> = [];
        let hadImage = false;

        for (const part of tr.content) {
          if (part.type === "image") {
            hadImage = true;
          } else if (part.type === "text" && part.text) {
            if (part.text.toLowerCase().includes(CONTEXT_INDEXED_TO_MEMORY_MARKER)) {
              const summaryLine = part.text
                .split("\n")
                .map((line) => line.trim())
                .find((line) => line.length > 0) || "[document indexed to memory]";
              newContent.push({ type: "text", text: summaryLine });
              continue;
            }

            if (part.text.length > CONTEXT_MAX_TOOL_TEXT) {
              newContent.push({
                type: "text",
                text: part.text.slice(0, CONTEXT_MAX_TOOL_TEXT) + "\n…[truncated, use tool again if needed]",
              });
            } else {
              newContent.push({ type: "text", text: part.text });
            }
          }
        }

        if (hadImage) {
          newContent.unshift({ type: "text", text: `[image previously viewed by model — not resent to save tokens]` });
        }

        if (newContent.length === 0) {
          newContent.push({ type: "text", text: "[result omitted to save tokens]" });
        }

        return { ...tr, content: newContent };
      });

      return { messages: compressed };
    });
  });

  const settingsManager = getSettingsManager(workspace);

  // Apply compaction settings: earlier trigger + more recent context preserved
  settingsManager.applyOverrides({
    compaction: {
      reserveTokens: config.compactionReserveTokens,
      keepRecentTokens: config.compactionKeepRecentTokens,
    },
  });

  // Build system prompt: runtime context + bootstrap files from agentHomeDir + project SOUL.md
  const systemPrompt = await buildSystemPrompt({
    mode: config.mode,
    agentHomeDir: config.agentHomeDir,
    workspaceDir: workspace,
    memoryEnabled: config.memoryEnabled,
    cronEnabled: config.cronEnabled,
    heartbeatEnabled: config.heartbeatEnabled,
    userSkillsDir: config.userSkillsDir,
    maxFileChars: config.systemPromptFileChars,
    maxTotalChars: config.systemPromptTotalChars,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir: config.agentHomeDir,
    settingsManager,
    extensionFactories,
    additionalSkillPaths: [
      ...config.skillsPaths.filter((p) => existsSync(p)),
      ...(existsSync(config.userSkillsDir) ? [config.userSkillsDir] : []),
    ],
    appendSystemPrompt: [systemPrompt],
    noThemes: true,
    noPromptTemplates: true,
    // Enforce per-file char limit on Pi SDK's AGENTS.md loading to prevent prompt bloat
    agentsFilesOverride: (base) => ({
      agentsFiles: base.agentsFiles.map((f) => ({
        path: f.path,
        content: f.content.length > config.systemPromptFileChars
          ? f.content.slice(0, config.systemPromptFileChars) + "\n\n[... truncated ...]"
          : f.content,
      })),
    }),
  });
  await resourceLoader.reload();

  entry = await createAgentSession({
    sessionManager: SessionManager.inMemory(workspace),
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: model.reasoning ? "medium" : "off",
    tools: opts?.restricted ? [] : undefined,
    resourceLoader,
    settingsManager,
    cwd: workspace,
  });

  sessions.set(cacheKey, entry);
  sessionMetas.set(cacheKey, {
    restricted,
    workspace,
    userScope,
    userId: opts?.userId,
    anonymous: !!opts?.anonymous,
    lastAccess: Date.now(),
  });
  log.info("session created", { session_id: sessionId, model: `${model.provider}/${model.id}`, workspace, restricted, user_scope: userScope });
  return entry;
}

/**
 * 解析请求中的 model 字段，支持格式：
 *   "proxy-claude/claude-opus-4-7"    → provider: proxy-claude, id: claude-opus-4-7
 *   "claude-opus-4-7"                 → 自动匹配 provider
 *   "gpt-5.4"                          → 自动匹配 proxy-gpt
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

// ─── Isolated Prompt (fresh session per cron job run) ──

const CRON_SESSION_PREFIX = "cron::";

async function executeIsolatedPrompt(prompt: string, cronSessionId: string): Promise<string> {
  const sessionId = `${CRON_SESSION_PREFIX}${cronSessionId}`;
  const { session } = await getSession(sessionId);

  let fullText = "";

  const result = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("Isolated cron prompt timeout (5min)"));
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

  // Destroy isolated session after use to avoid memory leak
  destroySession(sessionId);

  return result;
}

// ─── Background Services ────────────────────────────

export async function startBackgroundServices() {
  promptQueue = createPromptQueue(executePrompt, { timeoutMs: 300_000 });

  if (config.heartbeatEnabled) {
    heartbeatService = createHeartbeatService(
      {
        enabled: true,
        intervalMs: config.heartbeatIntervalMs,
        agentHomeDir: config.agentHomeDir,
        activeHours: config.heartbeatActiveHours,
      },
      (prompt) => promptQueue!.enqueue(prompt),
    );
    heartbeatService.start();
  }

  // Always create cron service for tool registration (proxy in sidecar, local in server)
  cronService = createCronService(
    {
      agentHomeDir: config.agentHomeDir,
      mode: config.mode,
      gatewayUrl: process.env.GATEWAY_URL || undefined,
      gatewayToken: config.gatewayToken || undefined,
    },
    (prompt) => promptQueue!.enqueue(prompt),
    (prompt, sessionId) => executeIsolatedPrompt(prompt, sessionId),
    (event) => agentEvents.emit("cron_result", event),
  );

  // Only start the local scheduler in server mode
  if (config.cronEnabled) {
    cronService.start();
    log.info("cron service started", { mode: "local" });
  } else {
    log.info("cron service registered", { mode: "sidecar-proxy" });
  }
}

export function getHeartbeatService(): HeartbeatService | null {
  return heartbeatService;
}

export function getCronService(): CronService | null {
  return cronService;
}

// ─── Skill Discovery (Pi SDK native) ─────────────────

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  group?: string;
  source: "builtin" | "user";
  editable: boolean;
}

function toSkillInfo(skill: Skill, dir: string): SkillInfo {
  const rel = relative(dir, skill.filePath);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  const source = skill.sourceInfo?.source === "user" ? "user" : "builtin";

  return {
    id: skill.name,
    name: skill.name,
    description: skill.description,
    group: parts.length >= 3 && parts[0] !== ".." ? parts[0] : undefined,
    source,
    editable: source === "user",
  };
}

export function listAvailableSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();
  const userDir = config.userSkillsDir;

  function loadFrom(dir: string, source: "builtin" | "user") {
    if (!existsSync(dir)) return;
    const result = loadSkillsFromDir({ dir, source });
    for (const s of result.skills) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      skills.push(toSkillInfo(s, dir));
    }
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
    { model: "claude-haiku-4-5", api: "anthropic" },
    { model: "gemini-3-flash-preview", api: "openai" },
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
      log.error("title generation failed", { model, error: lastError.message });
      continue;
    }
  }

  if (lastError) throw lastError;
  return "新会话";
}
