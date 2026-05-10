/**
 * cheat.ts 单元测试
 *
 * 覆盖：
 * - 激活门：无 .cheat-state.json 时所有 hook 完全 no-op
 * - tool_call 拦截：edit 命中 ## 预测 段时 block；改 ## 复盘 段允许
 * - tool_call 拦截：write 新文件允许；write 已存在文件 block
 * - CHEAT_BYPASS_IMMUTABILITY=1 跳过
 * - context 注入：返回的 messages 含状态报告
 * - tool_result 日志：追加 JSONL 到 .cheat-cache/usage.jsonl
 * - llm_audit 工具被注册
 *
 * 运行: bun test src/extensions/__tests__/cheat.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheatExtension } from "../cheat.js";

// ─── Mock pi.ExtensionAPI ─────────────────────────

type Handler = (event: any, ctx?: any) => any;

interface MockPi {
  handlers: Map<string, Handler[]>;
  tools: any[];
  on(event: string, handler: Handler): void;
  registerTool(tool: any): void;
  fire(event: string, payload: any): Promise<any[]>;
}

function makeMockPi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  const tools: any[] = [];
  return {
    handlers,
    tools,
    on(event, handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    async fire(event, payload) {
      const arr = handlers.get(event) ?? [];
      const results: any[] = [];
      for (const h of arr) results.push(await h(payload));
      return results;
    },
  };
}

let workspace: string;
let pi: MockPi;

beforeEach(async () => {
  delete process.env.CHEAT_BYPASS_IMMUTABILITY;
  workspace = mkdtempSync(join(tmpdir(), "cheat-test-"));
  pi = makeMockPi();
  const factory = createCheatExtension(workspace, "https://api.test.invalid", "test-key");
  await factory(pi as any);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  delete process.env.CHEAT_BYPASS_IMMUTABILITY;
});

function writeState(state: Record<string, unknown>) {
  writeFileSync(join(workspace, ".cheat-state.json"), JSON.stringify(state));
}

function writePrediction(name: string, body: string) {
  mkdirSync(join(workspace, "predictions"), { recursive: true });
  writeFileSync(join(workspace, "predictions", name), body);
}

const PRED_BODY = `# Test prediction

## 预测

**Bucket**: \`30-100w\`

**内心概率分布**:
- \`<5w\` → 5%
- **\`30-100w\` → 60%**
- \`>100w\` → 35%

**一句话 reason**:
> 核心驱动 + 反例约束

## 复盘

待 T+3 追加。
`;

// ─── Activation gate ─────────────────────────────

describe("activation gate", () => {
  test("no .cheat-state.json → tool_call hook is no-op", async () => {
    writePrediction("2026-05-10_aaa_test.md", PRED_BODY);
    const results = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tc1",
      input: {
        path: "predictions/2026-05-10_aaa_test.md",
        edits: [{ oldText: "**Bucket**: `30-100w`", newText: "**Bucket**: `100-300w`" }],
      },
    });
    expect(results.every((r) => r === undefined)).toBe(true);
  });

  test("no .cheat-state.json → context returns empty", async () => {
    const results = await pi.fire("context", { type: "context", messages: [] });
    expect(results[0]).toEqual({});
  });
});

// ─── tool_call: prediction immutability ─────────

describe("prediction immutability", () => {
  beforeEach(() => writeState({ schema_version: "1.2", calibration_samples: 3, target_publish_cadence_days: 2, shoots: [], pending_retros: [] }));

  test("blocks edit hitting the ## 预测 section", async () => {
    writePrediction("2026-05-10_aaa_test.md", PRED_BODY);
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tc1",
      input: {
        path: "predictions/2026-05-10_aaa_test.md",
        edits: [{ oldText: "**Bucket**: `30-100w`", newText: "**Bucket**: `100-300w`" }],
      },
    });
    expect(res?.block).toBe(true);
    expect(res?.reason).toMatch(/预测/);
  });

  test("allows edit targeting the ## 复盘 section", async () => {
    writePrediction("2026-05-10_aaa_test.md", PRED_BODY);
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tc2",
      input: {
        path: "predictions/2026-05-10_aaa_test.md",
        edits: [{ oldText: "待 T+3 追加。", newText: "实际 80w，命中 30-100w 桶。" }],
      },
    });
    expect(res).toBeUndefined();
  });

  test("allows write on a new (non-existent) prediction file", async () => {
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "write",
      toolCallId: "tc3",
      input: { path: "predictions/2026-05-10_new_test.md", content: PRED_BODY },
    });
    expect(res).toBeUndefined();
  });

  test("blocks write on an existing prediction file", async () => {
    writePrediction("2026-05-10_aaa_test.md", PRED_BODY);
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "write",
      toolCallId: "tc4",
      input: { path: "predictions/2026-05-10_aaa_test.md", content: "overwrite" },
    });
    expect(res?.block).toBe(true);
    expect(res?.reason).toMatch(/immutable/i);
  });

  test("ignores edits to non-prediction paths", async () => {
    writeFileSync(join(workspace, "rubric_notes.md"), "# notes\n");
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tc5",
      input: {
        path: "rubric_notes.md",
        edits: [{ oldText: "# notes", newText: "# rubric notes" }],
      },
    });
    expect(res).toBeUndefined();
  });

  test("CHEAT_BYPASS_IMMUTABILITY=1 disables the block", async () => {
    process.env.CHEAT_BYPASS_IMMUTABILITY = "1";
    writePrediction("2026-05-10_aaa_test.md", PRED_BODY);
    const [res] = await pi.fire("tool_call", {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "tc6",
      input: {
        path: "predictions/2026-05-10_aaa_test.md",
        edits: [{ oldText: "**Bucket**: `30-100w`", newText: "**Bucket**: `100-300w`" }],
      },
    });
    expect(res).toBeUndefined();
  });
});

// ─── context injection ──────────────────────────

describe("context injection", () => {
  test("injects status report when state file exists", async () => {
    writeState({
      rubric_version: "v1",
      calibration_samples: 7,
      target_publish_cadence_days: 2,
      shoots: [{ id: "x" }, { id: "y" }],
      pending_retros: ["predictions/abc.md"],
    });
    writeFileSync(join(workspace, "candidates.md"), "### 标题一\n### 标题二\n### 标题三\n### 标题四\n");

    const [result] = await pi.fire("context", { type: "context", messages: [] });
    expect(result?.messages?.length).toBe(1);
    const text = result.messages[0].content[0].text;
    expect(text).toContain("[SYSTEM CONTEXT - NOT USER INPUT]");
    expect(text).toContain("Buffer: 2 篇");
    expect(text).toContain("待复盘: 1 篇");
    expect(text).toContain("候选 top 3: 标题一 / 标题二 / 标题三");
    expect(text).toContain("校准样本: 7");
    expect(text).toContain("Rubric: v1");
  });

  test("buffer color: 红 warning when shoots × cadence < 1", async () => {
    writeState({ shoots: [], target_publish_cadence_days: 2, calibration_samples: 0, pending_retros: [] });
    const [result] = await pi.fire("context", { type: "context", messages: [] });
    const text = result.messages[0].content[0].text;
    expect(text).toContain("🔴");
    expect(text).toContain("今天必须拍");
  });

  test("buffer color: 蓝 warning when shoots × cadence > 5", async () => {
    writeState({
      shoots: Array.from({ length: 5 }, (_, i) => ({ id: i })),
      target_publish_cadence_days: 2,
      calibration_samples: 25,
      pending_retros: [],
    });
    const [result] = await pi.fire("context", { type: "context", messages: [] });
    const text = result.messages[0].content[0].text;
    expect(text).toContain("🔵");
    expect(text).toContain("先发存货");
  });
});

// ─── tool_result usage logging ─────────────────

describe("usage logging", () => {
  test("appends JSONL line on tool_result when state exists", async () => {
    writeState({ calibration_samples: 0 });
    await pi.fire("tool_result", {
      type: "tool_result",
      toolName: "edit",
      toolCallId: "tc1",
      input: { path: "predictions/abc.md" },
      content: [],
      isError: false,
    });
    const logPath = join(workspace, ".cheat-cache", "usage.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.event).toBe("tool_use");
    expect(rec.tool).toBe("edit");
    expect(rec.file).toBe("predictions/abc.md");
    expect(rec.success).toBe(true);
    expect(typeof rec.ts).toBe("string");
  });

  test("does not log when state file is missing", async () => {
    await pi.fire("tool_result", {
      type: "tool_result",
      toolName: "read",
      toolCallId: "tc2",
      input: { path: "anything.md" },
      content: [],
      isError: false,
    });
    expect(existsSync(join(workspace, ".cheat-cache", "usage.jsonl"))).toBe(false);
  });
});

// ─── llm_audit tool ─────────────────────────────

describe("llm_audit tool", () => {
  test("is registered with correct name and promptSnippet", () => {
    const audit = pi.tools.find((t) => t.name === "llm_audit");
    expect(audit).toBeDefined();
    expect(audit.label).toBe("LLM Audit");
    expect(audit.promptSnippet).toContain("cheat-bump");
    expect(typeof audit.execute).toBe("function");
  });
});
