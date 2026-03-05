/**
 * Workspace 文件操作 E2E 测试 — 真实网关 + 真实 LLM
 *
 * 覆盖：
 * 1) Agent 创建文件
 * 2) Agent 读取文件
 * 3) Agent 列出目录
 * 4) 请求级 workspace 覆盖
 * 5) restricted 模式禁用编码工具
 *
 * 运行: bun test src/__tests__/workspace.e2e.test.ts --timeout 120000
 * 需要真实网关 + LLM，不可达时自动跳过。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";
import { RpcClient, type RpcMessage } from "./helpers/rpc-client.js";

const ENTRY = join(import.meta.dir, "..", "index.ts");
const PROMPT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

interface PromptResult {
  response: RpcMessage;
  sessionEvents: RpcMessage[];
  done: RpcMessage;
  errors: RpcMessage[];
  text: string;
  toolCalls: string[];
}

let env: TestEnv | null = null;
let client: RpcClient;
let tmpWorkspace = "";
let tmpMemory = "";
let tmpOtherWorkspace = "";

function skip(): boolean {
  if (!env) {
    console.log("  → skipped (no gateway)");
    return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function collectText(events: RpcMessage[]): string {
  let text = "";
  for (const msg of events) {
    const event = msg.event as { type?: string; assistantMessageEvent?: { type?: string; delta?: string } } | undefined;
    if (event?.type !== "message_update") continue;
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
      text += assistantEvent.delta;
    }
  }
  return text;
}

function collectToolCalls(events: RpcMessage[]): string[] {
  const names: string[] = [];
  for (const msg of events) {
    const event = msg.event as { type?: string; toolName?: string } | undefined;
    if (event?.type === "tool_execution_start") {
      names.push((event.toolName || "unknown").toLowerCase());
    }
  }
  return names;
}

async function promptAndCollect(command: Record<string, unknown>): Promise<PromptResult> {
  const result = await client.collectSessionEvents(command);
  return {
    ...result,
    text: collectText(result.sessionEvents),
    toolCalls: collectToolCalls(result.sessionEvents),
  };
}

async function promptWithRetry(
  buildCommand: (attempt: number) => Record<string, unknown>,
  isSatisfied: (result: PromptResult) => boolean,
  retries = MAX_RETRIES,
): Promise<PromptResult> {
  let lastResult: PromptResult | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const cmd = buildCommand(attempt);
    // Ensure unique session_id per attempt to avoid "prompt already in-flight" collision
    if (typeof cmd.session_id === "string") {
      cmd.session_id = `${cmd.session_id}-a${attempt}`;
    }
    const result = await promptAndCollect(cmd);
    lastResult = result;
    if (isSatisfied(result)) {
      return result;
    }

    if (attempt < retries) {
      console.log(`[workspace-e2e] retrying prompt (attempt ${attempt + 1}/${retries})`);
      await delay(1500);
    }
  }

  throw new Error(
    `Prompt condition not satisfied after ${retries} attempts. ` +
    `response=${JSON.stringify(lastResult?.response)} ` +
    `errors=${JSON.stringify(lastResult?.errors)} ` +
    `toolCalls=${JSON.stringify(lastResult?.toolCalls)} ` +
    `text=${JSON.stringify(lastResult?.text.slice(0, 300))} ` +
    `stderr=${client.stderr.slice(-500)}`,
  );
}

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[workspace-e2e] ⚠️  No gateway reachable — tests will be skipped");
    return;
  }

  tmpWorkspace = mkdtempSync(join(tmpdir(), "workspace-e2e-ws-"));
  tmpMemory = mkdtempSync(join(tmpdir(), "workspace-e2e-mem-"));
  tmpOtherWorkspace = mkdtempSync(join(tmpdir(), "workspace-e2e-other-"));

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
  await client.waitReady(PROMPT_TIMEOUT_MS);
  console.log("[workspace-e2e] ✅ vm-agent ready");
});

afterAll(() => {
  client?.kill();
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpMemory) rmSync(tmpMemory, { recursive: true, force: true });
  if (tmpOtherWorkspace) rmSync(tmpOtherWorkspace, { recursive: true, force: true });
});

describe("Workspace E2E (真实 LLM)", () => {
  test("1. agent 创建 hello.txt", () => {
    if (skip()) return;
    return (async () => {
      const target = join(tmpWorkspace, "hello.txt");

      const result = await promptWithRetry(
        (attempt) => ({
          type: "prompt",
          session_id: "workspace-create",
          user_id: env!.admin.id,
          message: attempt === 1
            ? 'Use coding tools to create a file named "hello.txt" in the workspace with exactly this content: Hello E2E. Do not explain.'
            : 'IMPORTANT: Use coding tools now. Create or overwrite "hello.txt" with exactly: Hello E2E. No extra text.',
        }),
        () => existsSync(target) && normalizeContent(readFileSync(target, "utf-8")) === "Hello E2E",
      );

      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(existsSync(target)).toBe(true);
      expect(normalizeContent(readFileSync(target, "utf-8"))).toBe("Hello E2E");
      console.log(`[workspace-e2e] create tools: ${result.toolCalls.join(",") || "none"}`);
    })();
  });

  test("2. agent 读取 test.txt 内容", () => {
    if (skip()) return;
    return (async () => {
      const token = `WS_READ_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const target = join(tmpWorkspace, "test.txt");
      writeFileSync(target, `${token}\n`, "utf-8");

      const result = await promptWithRetry(
        (attempt) => ({
          type: "prompt",
          session_id: "workspace-read",
          user_id: env!.admin.id,
          message: attempt === 1
            ? 'Read the file "test.txt" in the workspace and reply with its exact content only.'
            : 'IMPORTANT: Use the file reading tool to read "test.txt" and output the exact file content only.',
        }),
        (r) => r.text.includes(token),
      );

      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.text).toContain(token);
      console.log(`[workspace-e2e] read response: ${result.text.slice(0, 200)}`);
    })();
  });

  test("3. agent 列出 workspace 文件", () => {
    if (skip()) return;
    return (async () => {
      const fileA = `ws-list-a-${Date.now()}.txt`;
      const fileB = `ws-list-b-${Date.now()}.txt`;
      writeFileSync(join(tmpWorkspace, fileA), "A", "utf-8");
      writeFileSync(join(tmpWorkspace, fileB), "B", "utf-8");

      const result = await promptWithRetry(
        (attempt) => ({
          type: "prompt",
          session_id: "workspace-list",
          user_id: env!.admin.id,
          message: attempt === 1
            ? "List files in the current workspace and include exact filenames."
            : "IMPORTANT: Use workspace listing tools and return the exact filenames in this workspace.",
        }),
        (r) => r.text.includes(fileA) && r.text.includes(fileB),
      );

      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.text).toContain(fileA);
      expect(result.text).toContain(fileB);
      console.log(`[workspace-e2e] list response: ${result.text.slice(0, 200)}`);
    })();
  });

  test("4. 请求级 workspace 覆盖生效", () => {
    if (skip()) return;
    return (async () => {
      mkdirSync(tmpOtherWorkspace, { recursive: true });

      const fileName = `override-${Date.now()}.txt`;
      const expected = `workspace override ok ${Date.now()}`;
      const targetInOther = join(tmpOtherWorkspace, fileName);
      const targetInDefault = join(tmpWorkspace, fileName);

      const result = await promptWithRetry(
        (attempt) => ({
          type: "prompt",
          session_id: "workspace-override",
          user_id: env!.admin.id,
          workspace: tmpOtherWorkspace,
          message: attempt === 1
            ? `Create file "${fileName}" with exact content "${expected}" in the current workspace.`
            : `IMPORTANT: Use file tools in this request workspace and create "${fileName}" with exact content "${expected}".`,
        }),
        () => existsSync(targetInOther) && normalizeContent(readFileSync(targetInOther, "utf-8")) === expected,
      );

      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(existsSync(targetInOther)).toBe(true);
      expect(normalizeContent(readFileSync(targetInOther, "utf-8"))).toBe(expected);
      expect(existsSync(targetInDefault)).toBe(false);
      console.log(`[workspace-e2e] override tools: ${result.toolCalls.join(",") || "none"}`);
    })();
  });

  test("5. restricted 模式禁止编码工具写文件", () => {
    if (skip()) return;
    return (async () => {
      const fileName = `restricted-${Date.now()}.txt`;
      const blockedTarget = join(tmpWorkspace, fileName);

      const result = await promptAndCollect({
        type: "prompt",
        session_id: "workspace-restricted",
        user_id: env!.admin.id,
        restricted: true,
        message: `Use coding tools to create file "${fileName}" with content "restricted write".`,
      });

      const codingTools = new Set([
        "bash",
        "create",
        "write",
        "edit",
        "read",
        "list",
        "grep",
        "glob",
        "delete",
        "move",
      ]);
      const usedCodingTools = result.toolCalls.filter((name) => codingTools.has(name));

      expect(result.response.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(existsSync(blockedTarget)).toBe(false);
      expect(usedCodingTools.length).toBe(0);
      console.log(`[workspace-e2e] restricted tools: ${result.toolCalls.join(",") || "none"}`);
      console.log(`[workspace-e2e] restricted response: ${result.text.slice(0, 200)}`);
    })();
  });
});
