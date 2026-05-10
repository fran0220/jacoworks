// cheat-on-content integration for JAcoworks
//
// Native Pi SDK 0.74 port of the three bash hooks from XBuilderLAB/cheat-on-content:
//   - PreToolUse  (prediction-immutability.sh) → pi.on("tool_call")
//   - SessionStart (session-start.sh)          → pi.on("context")
//   - PostToolUse  (log-event.sh)              → pi.on("tool_execution_end")
//
// Plus an llm_audit tool that replaces the original mcp__llm-chat__chat dependency
// used by /cheat-bump for cross-model rubric audit.
//
// Activation gate: every hook checks for `<workspace>/.cheat-state.json`. When the
// file is absent the hooks are a no-op so other users are unaffected.
//
// Bypass: set CHEAT_BYPASS_IMMUTABILITY=1 to disable the prediction-section block.

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join, isAbsolute, resolve, basename } from "node:path";
import { Type } from "typebox";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { log } from "../lib/logger.js";

const STATE_FILE = ".cheat-state.json";
const CACHE_DIR = ".cheat-cache";
const USAGE_FILE = "usage.jsonl";

// Matches "## 预测", "## 预测 v1", "## Prediction", "## Prediction v2", etc.
// Mirrors the awk pattern in prediction-immutability.sh.
const PREDICTION_HEADER_RE = /^## (预测|Prediction)([^a-zA-Z]|$)/m;

interface CheatState {
  schema_version?: string;
  rubric_version?: string;
  calibration_samples?: number;
  target_publish_cadence_days?: number | null;
  pending_retros?: string[];
  shoots?: unknown[];
  hooks_installed?: boolean | string;
  rubric_form_severe_mismatch?: boolean | string;
  last_trends_run_at?: string | null;
}

// ─── helpers ────────────────────────────────────────

function isPredictionPath(file: string, workspace: string): boolean {
  const abs = isAbsolute(file) ? file : resolve(workspace, file);
  const predictionsDir = resolve(workspace, "predictions") + "/";
  return abs.startsWith(predictionsDir) && abs.endsWith(".md");
}

function extractPredictionSection(content: string): string | null {
  const start = PREDICTION_HEADER_RE.exec(content);
  if (!start) return null;
  const startIdx = start.index;
  // Walk subsequent lines; section ends at the first H2 that is NOT a prediction header.
  const after = content.slice(startIdx + start[0].length);
  const lines = after.split("\n");
  let acc = 0;
  for (const line of lines) {
    if (/^## /.test(line) && !/^## (预测|Prediction)([^a-zA-Z]|$)/.test(line)) {
      return content.slice(startIdx, startIdx + start[0].length + acc);
    }
    acc += line.length + 1;
  }
  return content.slice(startIdx);
}

function readState(workspace: string): CheatState | null {
  const path = join(workspace, STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CheatState;
  } catch (err) {
    log.warn("cheat: failed to parse .cheat-state.json", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function bufferColor(shoots: number, cadence: number | null): { icon: string; label: string; warning?: string } {
  if (cadence == null) return { icon: "⚪", label: "灵活节奏" };
  const days = shoots * cadence;
  if (days < 1) return { icon: "🔴", label: "红", warning: "今天必须拍 ≥1 条稳分" };
  if (days <= 2) return { icon: "🟠", label: "橙" };
  if (days <= 5) return { icon: "🟢", label: "绿" };
  return { icon: "🔵", label: "蓝", warning: "建议暂停拍摄，先发存货 + 复盘" };
}

function confidenceLabel(samples: number): string {
  if (samples === 0) return "🔴 无 (尚未复盘)";
  if (samples <= 2) return "🟡 极低";
  if (samples <= 5) return "🟡 偏低";
  if (samples <= 10) return "🟢 中等";
  if (samples <= 20) return "🟢 较高";
  return "🟢 高";
}

function buildStatusReport(state: CheatState, workspace: string): string {
  const cadence = state.target_publish_cadence_days ?? null;
  const shootsCount = Array.isArray(state.shoots) ? state.shoots.length : 0;
  const buffer = bufferColor(shootsCount, cadence);
  const pending = Array.isArray(state.pending_retros) ? state.pending_retros : [];
  const samples = state.calibration_samples ?? 0;

  const lines: string[] = [];
  lines.push("[cheat-on-content / 状态报告]");
  lines.push("");
  const cadenceSuffix = cadence != null ? ` (按 cadence ${cadence}d ≈ ${shootsCount * cadence} 天预备)` : "";
  lines.push(`📦 Buffer: ${shootsCount} 篇 ${buffer.icon} ${buffer.label}${cadenceSuffix}`);
  lines.push(`⏰ 待复盘: ${pending.length} 篇`);

  // top 3 candidates from candidates.md
  try {
    const candPath = join(workspace, "candidates.md");
    if (existsSync(candPath)) {
      const titles: string[] = [];
      for (const line of readFileSync(candPath, "utf-8").split("\n")) {
        const m = /^### (.+)$/.exec(line);
        if (m) titles.push(m[1].trim());
        if (titles.length >= 3) break;
      }
      if (titles.length) lines.push(`🎯 候选 top 3: ${titles.join(" / ")}`);
    }
  } catch { /* swallow */ }

  lines.push(`📈 校准样本: ${samples} | Confidence: ${confidenceLabel(samples)}`);
  if (state.rubric_version) lines.push(`📜 Rubric: ${state.rubric_version}`);

  if (buffer.warning) lines.push(`⚠️ ${buffer.warning}`);
  if (state.hooks_installed === false || state.hooks_installed === "false") {
    lines.push("ℹ️ hooks_installed=false（vm-agent cheat extension 已接管原 bash hooks）");
  }
  if (state.rubric_form_severe_mismatch === true || state.rubric_form_severe_mismatch === "true") {
    lines.push("⚠️ rubric_form_severe_mismatch — 建议跑 /cheat-bump");
  }

  lines.push("");
  lines.push("（不要主动开始任何动作——等用户决定。说\"状态\"看完整看板。）");
  return lines.join("\n");
}

function appendUsageLog(workspace: string, record: Record<string, unknown>): void {
  try {
    const cacheDir = join(workspace, CACHE_DIR);
    mkdirSync(cacheDir, { recursive: true });
    appendFileSync(join(cacheDir, USAGE_FILE), JSON.stringify(record) + "\n");
  } catch (err) {
    log.debug("cheat: usage log write failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── llm_audit tool params ─────────────────────────

const LlmAuditParams = Type.Object({
  prompt: Type.String({
    description: "Full audit prompt — include the rubric bump proposal, evidence, and what you want the auditor to verify.",
  }),
  model: Type.Optional(Type.String({
    description: "Audit model id (default: claude-opus-4-7). Must be available on the small-cat gateway.",
  })),
  system: Type.Optional(Type.String({
    description: "Optional system message scoping the auditor's role (e.g. 'You are an independent rubric reviewer.').",
  })),
  max_tokens: Type.Optional(Type.Number({
    description: "Max output tokens (default: 4096).",
  })),
});

// ─── extension factory ─────────────────────────────

export function createCheatExtension(
  workspace: string,
  proxyUrl: string,
  proxyKey: string,
): ExtensionFactory {
  return (pi) => {
    // ── tool_call: prediction-immutability ──
    pi.on("tool_call", async (event) => {
      if (process.env.CHEAT_BYPASS_IMMUTABILITY === "1") return;
      if (!readState(workspace)) return; // gate

      if (event.toolName !== "edit" && event.toolName !== "write") return;

      const input = event.input as { path?: string; edits?: Array<{ oldText: string; newText: string }>; content?: string };
      const filePath = input.path;
      if (!filePath || !isPredictionPath(filePath, workspace)) return;

      const abs = isAbsolute(filePath) ? filePath : resolve(workspace, filePath);
      const fileExists = existsSync(abs);

      if (event.toolName === "write") {
        if (!fileExists) return; // creating a new prediction is fine
        return {
          block: true,
          reason: `predictions/*.md 是 immutable 区域。${basename(abs)} 已存在；要重做请新建 *_redo.md（保留原文件），要追加复盘请用 edit 在 ## 复盘 段下追加。set CHEAT_BYPASS_IMMUTABILITY=1 跳过。`,
        };
      }

      // edit
      if (!fileExists) return;
      let content: string;
      try {
        content = readFileSync(abs, "utf-8");
      } catch {
        return;
      }
      const section = extractPredictionSection(content);
      if (!section) return; // no prediction section to protect

      const edits = Array.isArray(input.edits) ? input.edits : [];
      for (const e of edits) {
        const old = (e?.oldText ?? "").trim();
        if (!old) continue;
        if (section.includes(old)) {
          return {
            block: true,
            reason: `拦截：试图修改 ${basename(abs)} 的 ## 预测 段（immutable）。要全量重做请新建 *_redo.md；要补充复盘请编辑 ## 复盘 段。set CHEAT_BYPASS_IMMUTABILITY=1 跳过本次。`,
          };
        }
      }
    });

    // ── context: inject buffer/retro/candidates header ──
    pi.on("context", async (event) => {
      const state = readState(workspace);
      if (!state) return {};
      const report = buildStatusReport(state, workspace);
      const msg = {
        role: "user" as const,
        content: [{
          type: "text" as const,
          text: `[SYSTEM CONTEXT - NOT USER INPUT]\n${report}`,
        }],
        timestamp: Date.now(),
      };
      return { messages: [msg, ...event.messages] };
    });

    // ── tool_result: append to .cheat-cache/usage.jsonl (replaces log-event.sh PostToolUse) ──
    pi.on("tool_result", async (event) => {
      if (!existsSync(join(workspace, STATE_FILE))) return;
      const input = (event.input ?? {}) as Record<string, unknown>;
      const filePath = typeof input.path === "string"
        ? input.path
        : (typeof input.file_path === "string" ? input.file_path : undefined);
      appendUsageLog(workspace, {
        ts: new Date().toISOString(),
        event: "tool_use",
        tool: event.toolName,
        file: filePath,
        success: !event.isError,
      });
    });

    // ── llm_audit tool: replaces mcp__llm-chat__chat for /cheat-bump ──
    const auditTool = defineTool<typeof LlmAuditParams, Record<string, unknown>>({
      name: "llm_audit",
      label: "LLM Audit",
      description:
        "Cross-model audit for /cheat-bump rubric evolution. Calls a second LLM (default claude-opus-4-7) " +
        "via the small-cat gateway and returns its critique. Use when proposing a rubric upgrade and you need " +
        "an independent reviewer to validate the change. Provide the full proposal — old vs. new rubric plus " +
        "calibration evidence — in `prompt`.",
      promptSnippet:
        "Use during /cheat-bump to get cross-model audit on a rubric change proposal.",
      parameters: LlmAuditParams,
      execute: async (_id, params) => {
        const model = params.model || "claude-opus-4-7";
        const max_tokens = params.max_tokens || 4096;
        try {
          const res = await fetch(`${proxyUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": proxyKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens,
              ...(params.system ? { system: params.system } : {}),
              messages: [{ role: "user", content: params.prompt }],
            }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            return {
              content: [{ type: "text" as const, text: `audit failed (${res.status}): ${body.slice(0, 400)}` }],
              details: { error: true, status: res.status },
            };
          }
          const data = (await res.json()) as { content?: Array<{ text?: string }> };
          const text = (data.content ?? [])
            .map((b) => b?.text ?? "")
            .join("\n")
            .trim() || "(empty audit response)";
          return {
            content: [{ type: "text" as const, text }],
            details: { model, length: text.length },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `audit error: ${message}` }],
            details: { error: true, message },
          };
        }
      },
    });

    pi.registerTool(auditTool);
  };
}
