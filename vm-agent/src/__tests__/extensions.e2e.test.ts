/**
 * Extension 工具 E2E 测试
 *
 * 覆盖: web_search / read_document / generate_image。
 * 通过 RPC spawn 真实 vm-agent，验证工具调用事件 + 关键副作用。
 * 网关不可达时自动跳过。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";
import { RpcClient, type RpcMessage } from "./helpers/rpc-client.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const IMAGE_TIMEOUT_MS = 120_000;

interface PromptResult {
  response: RpcMessage;
  sessionEvents: RpcMessage[];
  done: RpcMessage;
  errors: RpcMessage[];
  fullText: string;
  toolCalls: string[];
  combinedText: string;
  combinedLowerText: string;
}

let env: TestEnv | null = null;
let client: RpcClient | null = null;
let tmpWorkspace = "";
let tmpMemory = "";
let csvPath = "";
let unsupportedPath = "";
let sessionSeq = 0;

function skip(): boolean {
  if (!env) {
    console.log("  → skipped (no gateway)");
    return true;
  }
  return false;
}

function nextSessionId(prefix: string): string {
  sessionSeq += 1;
  return `extensions-e2e-${prefix}-${sessionSeq}`;
}

function parseSessionEvents(sessionEvents: RpcMessage[]): {
  fullText: string;
  toolCalls: string[];
  combinedText: string;
  combinedLowerText: string;
} {
  let fullText = "";
  const toolCalls: string[] = [];

  for (const msg of sessionEvents) {
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event || typeof event !== "object") continue;

    if (event.type === "message_update") {
      const assistantEvent = (event as {
        assistantMessageEvent?: { type?: string; delta?: string };
      }).assistantMessageEvent;

      if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
        fullText += assistantEvent.delta;
      }
    }

    if (event.type === "tool_execution_start") {
      const toolName = (event as { toolName?: string }).toolName;
      if (toolName) toolCalls.push(toolName.toLowerCase());
    }
  }

  const eventDump = JSON.stringify(sessionEvents);
  const combinedText = `${fullText}\n${eventDump}`;
  return {
    fullText,
    toolCalls,
    combinedText,
    combinedLowerText: combinedText.toLowerCase(),
  };
}

async function promptForTool(
  message: string,
  expectedToolName: string,
  opts?: { timeoutMs?: number; attempts?: number; sessionPrefix?: string; requireToolCall?: boolean },
): Promise<PromptResult> {
  if (!client || !env) {
    throw new Error("test environment is not initialized");
  }

  const attempts = opts?.attempts ?? 2;
  const timeoutMs = opts?.timeoutMs;
  const sessionPrefix = opts?.sessionPrefix || expectedToolName;
  const requireToolCall = opts?.requireToolCall ?? true;
  let last: PromptResult | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const base = await client.collectSessionEvents(
      {
        type: "prompt",
        message,
        session_id: nextSessionId(`${sessionPrefix}-a${attempt}`),
        user_id: env.admin.id,
        restricted: true,
      },
      timeoutMs,
    );

    const parsed = parseSessionEvents(base.sessionEvents);
    last = { ...base, ...parsed };

    if (!requireToolCall || last.toolCalls.includes(expectedToolName)) {
      return last;
    }

    console.log(
      `[extensions-e2e] ${expectedToolName} not called on attempt ${attempt}/${attempts}. Tools=${last.toolCalls.join(",") || "none"}`,
    );
  }

  return last!;
}

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[extensions-e2e] ⚠️  No gateway reachable — tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "ext-e2e-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "ext-e2e-mem-"));

  mkdirSync(join(tmpWorkspace, "fixtures"), { recursive: true });
  csvPath = "fixtures/people.csv";
  unsupportedPath = "fixtures/unsupported.xyz";
  writeFileSync(join(tmpWorkspace, csvPath), "name,age\nAlice,30\nBob,25\n");
  writeFileSync(join(tmpWorkspace, unsupportedPath), "not-a-supported-document");

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
      WORKSPACE_DIR: tmpWorkspace,
      MEMORY_ROOT_DIR: tmpMemory,
      MEMORY_ENABLED: "false",
      HEARTBEAT_ENABLED: "false",
      CRON_ENABLED: "false",
      PRIMARY_MODEL: "claude-sonnet-4-6",
      PRIMARY_PROVIDER: "proxy-claude",
    },
  });

  client = new RpcClient(proc);
  await client.waitReady();
  console.log("[extensions-e2e] ✅ vm-agent ready");
});

afterAll(() => {
  client?.kill();
  client = null;

  if (tmpWorkspace) {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
  if (tmpMemory) {
    rmSync(tmpMemory, { recursive: true, force: true });
  }
});

describe("Extension Tools E2E", () => {
  test("web_search: 查询 Bun runtime", async () => {
    if (skip()) return;

    const result = await promptForTool(
      'You MUST call the web_search tool with query="Bun JavaScript runtime", num_results=3, include_answer=false. After the tool call, summarize in one short sentence.',
      "web_search",
      { sessionPrefix: "web-search-main" },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.toolCalls).toContain("web_search");
    expect(result.fullText.length).toBeGreaterThan(0);
  });

  test("web_search: 罕见查询不崩溃", async () => {
    if (skip()) return;

    const rareQuery = `site:nonexistent.invalid ${randomUUID()}`;
    const result = await promptForTool(
      `You MUST call the web_search tool with query="${rareQuery}", num_results=3. Keep your response short after calling the tool.`,
      "web_search",
      { sessionPrefix: "web-search-rare", requireToolCall: false },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.combinedText.length).toBeGreaterThan(0);
    expect(result.done.type).toBe("done");
  });

  test("read_document: 读取 CSV", async () => {
    if (skip()) return;

    const result = await promptForTool(
      `You MUST call the read_document tool with path="${csvPath}" and max_rows=10. Then report the names in the CSV.`,
      "read_document",
      { sessionPrefix: "read-csv" },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.toolCalls).toContain("read_document");
    expect(result.combinedText).toContain("Alice");
    expect(result.combinedText).toContain("Bob");
  });

  test("read_document: 文件不存在时返回错误提示", async () => {
    if (skip()) return;

    const result = await promptForTool(
      'You MUST call the read_document tool with path="fixtures/missing.csv". Return the tool result plainly.',
      "read_document",
      { sessionPrefix: "read-missing" },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.toolCalls).toContain("read_document");
    expect(/file not found|not found|不存在/.test(result.combinedLowerText)).toBe(true);
  });

  test("read_document: 不支持扩展名时返回错误提示", async () => {
    if (skip()) return;

    const result = await promptForTool(
      `You MUST call the read_document tool exactly once with path="${unsupportedPath}". Then reply with a short sentence describing the error.`,
      "read_document",
      { sessionPrefix: "read-unsupported", timeoutMs: 120_000, attempts: 1 },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.toolCalls).toContain("read_document");
    expect(/unsupported format|unsupported|不支持/.test(result.combinedLowerText)).toBe(true);
  });

  test("generate_image: 生成图片或优雅降级", async () => {
    if (skip()) return;

    const filename = "generated/test-red-circle.png";
    const outputPath = join(tmpWorkspace, filename);
    const result = await promptForTool(
      `You MUST call the generate_image tool with prompt="a flat icon of a red circle on white background", filename="${filename}", aspect_ratio="1:1". Do not use any other tool.`,
      "generate_image",
      { sessionPrefix: "generate-image", timeoutMs: IMAGE_TIMEOUT_MS, attempts: 1 },
    );

    expect(result.response.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.toolCalls).toContain("generate_image");

    if (!existsSync(outputPath)) {
      console.log(
        `[extensions-e2e] ⚠️ image file not generated (backend may not support image model). Output: ${result.fullText.slice(0, 240)}`,
      );
      return;
    }

    const size = statSync(outputPath).size;
    expect(size).toBeGreaterThan(0);
    console.log(`[extensions-e2e] Generated image: ${outputPath} (${size} bytes)`);
  });
});
