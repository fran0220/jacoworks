import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
import { createImageGenExtension } from "./extensions/image-gen.js";
import { createReadDocumentExtension, ocrWithVision } from "./extensions/read-document.js";
import { createWebSearchExtension } from "./extensions/web-search.js";
import { createRemoteFsExtension } from "./extensions/remote-fs.js";
import { registerTransportResponseHandler } from "./transport/handler.js";
import type { TransportSender } from "./transport/types.js";
import { initEmbedding, isEmbeddingAvailable } from "./lib/embedding.js";
import { buildSystemPrompt, seedAgentHome } from "./prompts/system.js";
import { createHeartbeatService, type HeartbeatService } from "./services/heartbeat.js";
import { createCronService, type CronService, type CronResultEvent } from "./services/cron.js";
import { createPromptQueue, type PromptQueue } from "./lib/prompt-queue.js";
import { createBashExtension } from "./tools/remote-bash.js";
import { log } from "./lib/logger.js";
import { EventEmitter } from "node:events";

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

// ─── Remote FS Transport (cloud mode only) ──────────

let currentSender: TransportSender | null = null;
export function setTransportSender(sender: TransportSender | null) {
  currentSender = sender;
}

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
// 中转站 http://67.230.182.59:8317 支持 4 种原生协议：
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
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
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
        id: "claude-haiku-4-5",
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
        id: "gpt-5.4",
        name: "GPT-5.4",
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

  // 5. GLM — OpenAI 兼容协议
  registry.registerProvider("proxy-glm", {
    baseUrl: `${proxyUrl}/v1`,
    apiKey: proxyKey,
    api: "openai-completions",
    models: [
      {
        id: "glm-5",
        name: "GLM-5",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
}

// ─── Document Processing Packages ───────────────────

const DOC_PACKAGES: Record<string, string> = {
  mammoth: "^1.11.0",
  docx: "^9.6.0",
  exceljs: "^4.4.0",
  "pdf-lib": "^1.17.1",
  "@pdf-lib/fontkit": "^1.1.1",
  "pdf-parse": "^2.4.5",
  "csv-parse": "^6.1.0",
};

function ensureDocPackages(dir: string): boolean {
  const nmDir = join(dir, "node_modules");
  if (existsSync(join(nmDir, "mammoth"))) return true;

  log.info("installing document processing packages");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "jacoworks-doc-packages", private: true, dependencies: DOC_PACKAGES }),
    );
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    execSync(`${npmCmd} install --production --no-audit --no-fund`, {
      cwd: dir,
      timeout: 120_000,
      stdio: "pipe",
    });
    log.info("document processing packages installed");
    return true;
  } catch (err) {
    log.warn("doc packages install failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function setupNodePath(cfg: Config): void {
  const sep = process.platform === "win32" ? ";" : ":";
  const nodePaths: string[] = [];

  // 1. DOC_PACKAGES_DIR from sidecar (production: extracted from bundled tar.gz)
  const docPkgDir = process.env.DOC_PACKAGES_DIR;
  if (docPkgDir) {
    const docNm = join(docPkgDir, "node_modules");
    if (existsSync(docNm)) {
      nodePaths.push(docNm);
    } else {
      // First-time setup: install via npm (fallback when tar.gz not bundled)
      if (ensureDocPackages(docPkgDir)) {
        nodePaths.push(join(docPkgDir, "node_modules"));
      }
    }
  }

  // 2. Dev mode: vm-agent's own node_modules
  const vmAgentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const devNm = join(vmAgentRoot, "node_modules");
  if (existsSync(devNm)) {
    nodePaths.push(devNm);
  }

  // 3. Merge with existing NODE_PATH
  if (process.env.NODE_PATH) {
    nodePaths.push(...process.env.NODE_PATH.split(sep));
  }

  const uniquePaths = [...new Set(nodePaths)];
  if (uniquePaths.length > 0) {
    process.env.NODE_PATH = uniquePaths.join(sep);
  }
}

// ─── Init & Session Pool ────────────────────────────

export function initAgent(cfg: Config) {
  config = cfg;

  authStorage = AuthStorage.inMemory();
  modelRegistry = new ModelRegistry(authStorage);

  // 注册中转站所有模型
  registerProxyModels(modelRegistry, cfg.proxyUrl, cfg.proxyKey);

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

  // 设置 NODE_PATH 让文档处理脚本能找到预装包
  setupNodePath(cfg);

  log.info("agent initialized", {
    model: `${cfg.primaryProvider}/${cfg.primaryModel}`,
    proxy: cfg.proxyUrl,
    workspace: cfg.workspaceDir,
    memory_root: cfg.memoryRootDir,
    node_path: process.env.NODE_PATH || "(not set)",
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

  // Override built-in bash with the container-local executor.
  if (!restricted) {
    extensionFactories.push(createBashExtension());
  }

  if (config.memoryEnabled && !opts?.anonymous) {
    const memRoot = userMemoryRootDir(opts?.userId);
    extensionFactories.push(
      createMemoryExtension(memRoot, {
        embedCacheMax: config.embedCacheMax,
        hybridWBm25: config.hybridWBm25,
        hybridWVec: config.hybridWVec,
      }, {
        reserveTokens: config.compactionReserveTokens,
        softThresholdTokens: config.compactionSoftThresholdTokens,
      }),
    );
  }

  if (cronService) {
    extensionFactories.push(cronService.getExtensionFactory());
  }

  // Image generation tool (available when proxy or fal.ai key is configured)
  const falApiKey = process.env.FAL_API_KEY || "";
  if (config.proxyKey || falApiKey) {
    extensionFactories.push(
      createImageGenExtension(config.proxyUrl, config.proxyKey, falApiKey, workspace),
    );
  }

  // Document reading tool (docx, xlsx, csv, pdf, pptx, images via OCR)
  if (config.proxyKey) {
    extensionFactories.push(
      createReadDocumentExtension(config.proxyUrl, config.proxyKey, workspace),
    );
  }

  // Web search tool (Tavily primary, Grok fallback)
  if (process.env.TAVILY_API_KEY || config.proxyKey) {
    extensionFactories.push(
      createWebSearchExtension(config.proxyUrl, config.proxyKey),
    );
  }

  // Remote filesystem (cloud mode only — when transport sender is available)
  if (config.mode === "server" && currentSender) {
    extensionFactories.push(
      createRemoteFsExtension(() => currentSender, registerTransportResponseHandler),
    );
  }

  // Intercept read tool for binary documents and images.
  // Binary docs → block with guidance to use read_document.
  // Images → let read execute, then replace base64 result with OCR text
  //          (Pi SDK's block:true throws Error, so we use tool_result for images).
  const BINARY_DOC_EXTS = /\.(docx|xlsx|xls|pdf|pptx|doc|ppt)$/i;
  const IMAGE_EXTS_RE = /\.(png|jpg|jpeg|gif|webp|bmp|tiff|tif)$/i;
  // Track image paths intercepted in tool_call so tool_result can replace them
  const pendingImageOcr = new Map<string, string>(); // toolCallId → filePath
  extensionFactories.push((pi) => {
    // Phase 1: tool_call — block binary docs, mark images for OCR replacement
    pi.on("tool_call", async (event) => {
      if (event.toolName === "read" && typeof event.input?.path === "string") {
        if (BINARY_DOC_EXTS.test(event.input.path)) {
          return {
            block: true,
            reason: `Cannot read binary file "${event.input.path}" with the read tool. Use the read_document tool instead.`,
          };
        }
        if (IMAGE_EXTS_RE.test(event.input.path) && config.proxyKey) {
          const filePath = resolve(workspace, event.input.path);
          if (existsSync(filePath)) {
            pendingImageOcr.set(event.toolCallId, filePath);
          }
        }
      }
    });

    // Phase 2: tool_result — replace image base64 with OCR text
    pi.on("tool_result", async (event) => {
      if (event.toolName !== "read") return;
      const filePath = pendingImageOcr.get(event.toolCallId);
      if (!filePath) return;
      pendingImageOcr.delete(event.toolCallId);

      try {
        const text = await ocrWithVision(config.proxyUrl, config.proxyKey, filePath);
        return {
          content: [{ type: "text" as const, text: `[Image analyzed via OCR: ${filePath}]\n\n${text}` }],
          details: { path: filePath, method: "ocr" },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `[Image: ${filePath}] OCR failed: ${(err as Error).message}. Use read_document tool for manual inspection.` }],
          details: { path: filePath, method: "ocr-failed" },
        };
      }
    });
  });

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
    settingsManager,
    extensionFactories,
    additionalSkillPaths: [
      ...config.skillsPaths.filter((p) => existsSync(p)),
      ...(existsSync(config.userSkillsDir) ? [config.userSkillsDir] : []),
    ],
    appendSystemPrompt: systemPrompt,
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
    userId: opts?.userId,
    anonymous: !!opts?.anonymous,
    lastAccess: Date.now(),
  });
  log.info("session created", { session_id: sessionId, model: `${model.provider}/${model.id}`, workspace, restricted, user_scope: userScope });
  return entry;
}

/**
 * 解析请求中的 model 字段，支持格式：
 *   "proxy-claude/claude-opus-4-6"    → provider: proxy-claude, id: claude-opus-4-6
 *   "claude-opus-4-6"                 → 自动匹配 provider
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
  const seen = new Set<string>();
  const userDir = config.userSkillsDir;

  // Helper: load skills from a directory and tag source (skip duplicates)
  function loadFrom(dir: string, source: "builtin" | "user") {
    if (!existsSync(dir)) return;
    const result = loadSkillsFromDir({ dir, source: "additional" });
    for (const s of result.skills) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      const { displayName, displayDesc } = readDisplayFields(s.filePath);
      const rel = relative(dir, s.filePath);
      const parts = rel.split(/[\\/]+/).filter(Boolean);
      const dirGroup = parts.length >= 3 && parts[0] !== ".." ? parts[0] : undefined;
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
