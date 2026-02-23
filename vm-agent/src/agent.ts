import { existsSync } from "node:fs";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionFactory, CreateAgentSessionResult } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config.js";
import { createWebTools } from "./tools/web.js";
import { createMemoryExtension, MEMORY_SYSTEM_PROMPT } from "./extensions/memory.js";
import { createHeartbeatService, type HeartbeatService } from "./services/heartbeat.js";
import { createCronService, type CronService } from "./services/cron.js";
import { createPromptQueue, type PromptQueue } from "./lib/prompt-queue.js";

const sessions = new Map<string, CreateAgentSessionResult>();

let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let config: Config;

let heartbeatService: HeartbeatService | null = null;
let cronService: CronService | null = null;
let promptQueue: PromptQueue | null = null;

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

  console.log("✅ Agent initialized");
  console.log(`   Default model: ${cfg.primaryProvider}/${cfg.primaryModel}`);
  console.log(`   LLM Proxy: ${cfg.proxyUrl}`);
  console.log(`   Workspace: ${cfg.workspaceDir}`);

  // 列出已注册的代理模型
  const proxyModels = modelRegistry
    .getAll()
    .filter((m) => m.provider.startsWith("proxy-"));
  console.log(`   Proxy models: ${proxyModels.length}`);
  for (const m of proxyModels) {
    console.log(`     - ${m.provider}/${m.id}`);
  }
}

export async function getSession(sessionId: string) {
  let entry = sessions.get(sessionId);
  if (entry) return entry;

  const model = modelRegistry.find(config.primaryProvider, config.primaryModel);
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

  const codingTools = createCodingTools(config.workspaceDir);
  const webTools = createWebTools();

  const extensionFactories: ExtensionFactory[] = [];

  if (config.memoryEnabled) {
    extensionFactories.push(createMemoryExtension(config.workspaceDir));
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

  const settingsManager = SettingsManager.create(config.workspaceDir);

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.workspaceDir,
    settingsManager,
    extensionFactories,
    additionalSkillPaths: config.skillsPaths.filter((p) => existsSync(p)),
    appendSystemPrompt: config.memoryEnabled ? MEMORY_SYSTEM_PROMPT : undefined,
    noThemes: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  entry = await createAgentSession({
    sessionManager: SessionManager.create(config.workspaceDir),
    authStorage,
    modelRegistry,
    model,
    tools: codingTools,
    customTools: webTools,
    resourceLoader,
    settingsManager,
    cwd: config.workspaceDir,
  });

  sessions.set(sessionId, entry);
  console.log(`📝 Session created: ${sessionId} → ${model.provider}/${model.id}`);
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

  // 无前缀：遍历 proxy-* provider 查找
  for (const prefix of ["proxy-claude", "proxy-gpt", "proxy-gemini", "proxy-grok"]) {
    const found = modelRegistry.find(prefix, modelStr);
    if (found) return found;
  }
  return null;
}

export function destroySession(sessionId: string) {
  sessions.delete(sessionId);
}

export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

// ─── Background Session (isolated from user chat) ───

const BG_SESSION_SUFFIX = "::background";

async function executePrompt(prompt: string): Promise<string> {
  const bgSessionId = `${config.primaryProvider}/${config.primaryModel}${BG_SESSION_SUFFIX}`;
  const { session } = await getSession(bgSessionId);
  let fullText = "";

  return new Promise<string>((resolve, reject) => {
    const unsub = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        fullText += event.assistantMessageEvent.delta;
      }
      if (event.type === "agent_end") {
        unsub();
        resolve(fullText);
      }
    });

    session.prompt(prompt).catch((err) => {
      unsub();
      reject(err);
    });
  });
}

// ─── Background Services ────────────────────────────

export async function startBackgroundServices() {
  promptQueue = createPromptQueue(executePrompt);

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
    const bgEntry = sessions.get(bgSessionId);
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
