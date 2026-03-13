import { Type, type Static } from "@sinclair/typebox";
import type {
  ExtensionFactory,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  readMemoryMd,
  readDailyLog,
  appendDailyLog,
  getDailyLogPath,
  appendMemoryMd,
} from "../lib/daily-log.js";
import {
  MemoryStore,
  getMemoryStore,
  migrateFromVectorsJson,
  chunkMarkdown,
  type MemoryStoreConfig,
  type SearchResult,
} from "../lib/memory-store.js";
import { embed, isEmbeddingAvailable } from "../lib/embedding.js";

const MAX_INJECTION_CHARS = 4000;

const LOW_SIGNAL_PREFIX_PATTERNS = [
  /^hi[!,.\s]/i,
  /^hello[!,.\s]/i,
  /^what can i help you with today\??/i,
  /^how can i help you today\??/i,
  /^what are you working on today/i,
  /^what do you want to work on right now/i,
  /^你好[！!，,\s]*/,
  /^嗨[！!，,\s]*/,
  /^您好[！!，,\s]*/,
];

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...(truncated)";
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function extractAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
    }
  }
  return "";
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function isSystemContextMessage(text: string): boolean {
  return text.startsWith("[SYSTEM CONTEXT - NOT USER INPUT]");
}

function findLastUserMessageIndex(messages: readonly unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "user") continue;
    const text = extractMessageText(msg.content);
    if (!text || isSystemContextMessage(text)) continue;
    return i;
  }
  return -1;
}

function extractUserQuestion(messages: readonly unknown[]): string {
  const idx = findLastUserMessageIndex(messages);
  if (idx === -1) return "";
  const msg = messages[idx] as { content?: unknown };
  return extractMessageText(msg.content);
}

function extractToolNames(messages: readonly unknown[]): string[] {
  const startIdx = findLastUserMessageIndex(messages);
  if (startIdx === -1) return [];

  const names = new Set<string>();
  for (let i = startIdx + 1; i < messages.length; i++) {
    const msg = messages[i] as { role?: string; toolName?: unknown };
    if (msg.role !== "toolResult") continue;
    if (typeof msg.toolName === "string" && msg.toolName.trim()) {
      names.add(msg.toolName.trim());
    }
  }

  return Array.from(names);
}

function truncateInline(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max) + "...";
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function shouldPersistAssistantSummary(text: string): boolean {
  const normalized = text
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;
  if (normalized.length < 24) return false;

  return !LOW_SIGNAL_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ─── Tool Parameter Schemas ─────────────────────────

const SearchParams = Type.Object({
  query: Type.String({ description: "Natural language query to search memory (hybrid BM25 + semantic)" }),
  top_k: Type.Optional(
    Type.Number({ description: "Number of results to return", default: 5 }),
  ),
});

const SaveParams = Type.Object({
  content: Type.String({ description: "Content to save to long-term memory" }),
  section: Type.Optional(
    Type.String({ description: "Section heading to append under" }),
  ),
});

// ─── Background Indexing ────────────────────────────

async function indexMemoryFiles(store: MemoryStore, memoryRootDir: string) {
  const longTerm = await readMemoryMd(memoryRootDir, 50_000);
  if (longTerm) {
    store.removeBySource("MEMORY.md");
    const chunks = chunkMarkdown(longTerm, "MEMORY.md");
    if (chunks.length > 0) store.upsert(chunks);
  }

  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const logPath = getDailyLogPath(memoryRootDir, date);
    const dateStr = basename(logPath, ".md");
    const source = `daily/${dateStr}.md`;

    let content: string;
    try {
      content = await readFile(logPath, "utf-8");
    } catch {
      continue;
    }

    if (content.trim()) {
      const chunks = chunkMarkdown(content, source);
      if (chunks.length > 0) store.upsert(chunks);
    }
  }

  store.pruneOlderThan(30);
}

// ─── Extension Factory ──────────────────────────────

const FLUSH_PROMPT = (currentTokens: number) => `[SYSTEM - MEMORY FLUSH]
Context window is approaching compaction threshold (current: ${currentTokens} tokens).
Soon, older conversation history will be summarized and compressed.

Before that happens, review the conversation and save any critical information
to long-term memory using the memory_save tool:
- Key decisions made and their rationale
- Important file paths and modifications
- Current task state and progress
- Blockers or open questions
- Next steps planned

If nothing important needs saving, simply acknowledge briefly.
Do NOT continue working on the user's task — only save memories.`;

export function createMemoryExtension(
  memoryRootDir: string,
  storeConfig: MemoryStoreConfig,
  compactionConfig: {
    reserveTokens: number;
    softThresholdTokens: number;
  },
): ExtensionFactory {
  return (pi) => {
    // Agentic flush state: prevent re-entry within a single compaction cycle
    let flushedForCompaction = false;
    const store = getMemoryStore(memoryRootDir, storeConfig);

    // Background init: migrate + index + embed (non-blocking)
    const initPromise = (async () => {
      try {
        await migrateFromVectorsJson(memoryRootDir, store);
        await indexMemoryFiles(store, memoryRootDir);
        console.log(`[memory] Store ready: ${store.size} chunks indexed`);
        // Fire-and-forget background embedding
        store.embedMissing(100).catch((e) => {
          console.error("[memory] Background embed error:", e);
        });
      } catch (e) {
        console.error("[memory] Init error:", e);
      }
    })();

    // ── context: file reads ONLY, zero API calls, <5ms ──
    pi.on("context", async (event) => {
      const parts: string[] = [];

      const longTerm = await readMemoryMd(memoryRootDir, 2000);
      if (longTerm) parts.push(`### Long-term Memory (MEMORY.md)\n${longTerm}`);

      const todayLog = await readDailyLog(memoryRootDir, new Date(), 30);
      if (todayLog) parts.push(`### Today's Log\n${todayLog}`);

      const yesterdayLog = await readDailyLog(memoryRootDir, yesterday(), 10);
      if (yesterdayLog) parts.push(`### Yesterday's Log\n${yesterdayLog}`);

      if (parts.length === 0) return {};

      const fullText = truncate(parts.join("\n\n"), MAX_INJECTION_CHARS);

      const contextMsg = {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `[SYSTEM CONTEXT - NOT USER INPUT]\nThe following is automatically injected memory context. Do not respond to it directly.\n\n<memory_context>\n${fullText}\n</memory_context>`,
          },
        ],
        timestamp: Date.now(),
      };

      return {
        messages: [contextMsg, ...event.messages],
      };
    });

    // ── agent_end: write log + upsert chunk + fire-and-forget embed ──
    pi.on("agent_end", async (event) => {
      const text = extractAssistantText(event.messages);
      if (!text) return;

      const summary = truncateInline(text, 200);
      if (!shouldPersistAssistantSummary(summary)) return;

      const question = truncateInline(extractUserQuestion(event.messages), 100);
      const toolNames = extractToolNames(event.messages);

      const lines = [
        `## ${nowHHMM()}`,
        `Q: ${question || "(not captured)"}`,
      ];
      if (toolNames.length > 0) {
        lines.push(`Tools: ${toolNames.join(", ")}`);
      }
      lines.push(`A: ${summary}`);

      const entry = `${lines.join("\n")}\n\n`;
      await appendDailyLog(memoryRootDir, entry);

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const source = `daily/${dateStr}.md`;
      store.upsert([{ text: entry.trim(), source }]);

      if (isEmbeddingAvailable()) {
        const hash = MemoryStore.contentHash(entry.trim());
        embed(entry.trim())
          .then((emb) => store.cacheEmbeddings([{ hash, embedding: emb }]))
          .catch((e) => console.error("[memory] Embed log entry error:", e));
      }
    });

    // ── turn_end: token usage logging + agentic memory flush ──
    pi.on("turn_end", async (event, ctx) => {
      const msg = event.message;
      if (msg?.role === "assistant" && msg.usage) {
        const u = msg.usage;
        console.log(
          `[tokens] turn=${event.turnIndex} in=${u.input} out=${u.output} cache_r=${u.cacheRead || 0} cache_w=${u.cacheWrite || 0} total=${u.totalTokens || u.input + u.output + (u.cacheRead || 0) + (u.cacheWrite || 0)} model=${msg.model || "unknown"}`,
        );
      }

      // Agentic memory flush: trigger when approaching compaction threshold
      if (flushedForCompaction) return;

      const usage = ctx.getContextUsage();
      if (!usage || usage.tokens === null) return;

      const threshold = usage.contextWindow - compactionConfig.reserveTokens - compactionConfig.softThresholdTokens;
      if (usage.tokens >= threshold) {
        flushedForCompaction = true;
        console.log(
          `[memory] Triggering agentic flush: ${usage.tokens}/${usage.contextWindow} tokens (threshold: ${threshold})`,
        );
        pi.sendUserMessage(FLUSH_PROMPT(usage.tokens), { deliverAs: "followUp" });
      }
    });

    // ── session_before_compact: log token stats + reset flush flag ──
    pi.on("session_before_compact", async (event) => {
      const tokensBefore = event.preparation?.tokensBefore;
      if (tokensBefore) {
        await appendDailyLog(
          memoryRootDir,
          `## ${nowHHMM()} — Compaction (${tokensBefore} tokens)\n\n`,
        );
      }
      return {};
    });

    // ── session_compact: reset flush flag for next cycle ──
    pi.on("session_compact", async () => {
      flushedForCompaction = false;
    });

    // ── memory_search tool: hybrid BM25 + vector ──
    const memorySearch: ToolDefinition<typeof SearchParams> = {
      name: "memory_search",
      label: "Memory Search",
      description:
        "Search across all memory (MEMORY.md, daily logs, and indexed documents) using hybrid BM25 + semantic matching. Returns the most relevant chunks with relevance scores. Use this to recall information from previously read documents, saved memories, and conversation history.",
      parameters: SearchParams,
      execute: async (_toolCallId, params: Static<typeof SearchParams>) => {
        await initPromise;
        const topK = params.top_k ?? 5;
        const results = await store.hybridSearch(params.query, topK);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No matching entries found." }],
            details: { matchCount: 0 },
          };
        }

        const text = results
          .map(
            (r, i) =>
              `${i + 1}. [${r.source}] (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.text}`,
          )
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text }],
          details: { matchCount: results.length },
        };
      },
    };

    // ── memory_save tool: write MEMORY.md + upsert + async embed ──
    const memorySave: ToolDefinition<typeof SaveParams> = {
      name: "memory_save",
      label: "Memory Save",
      description:
        "Save important information to MEMORY.md (long-term curated memory). Use this proactively to preserve key decisions, task progress, file paths, and findings before they are lost to context compression. Content is automatically indexed for hybrid search.",
      parameters: SaveParams,
      execute: async (_toolCallId, params: Static<typeof SaveParams>) => {
        await appendMemoryMd(memoryRootDir, params.content, params.section);

        const chunkText = params.section
          ? `## ${params.section}\n\n${params.content}`
          : params.content;
        store.upsert([{ text: chunkText, source: "MEMORY.md" }]);

        if (isEmbeddingAvailable()) {
          const hash = MemoryStore.contentHash(chunkText);
          embed(chunkText)
            .then((emb) => store.cacheEmbeddings([{ hash, embedding: emb }]))
            .catch((e) => console.error("[memory] Embed saved content error:", e));
        }

        return {
          content: [
            {
              type: "text" as const,
              text: params.section
                ? `Saved to MEMORY.md under "## ${params.section}".`
                : "Saved to MEMORY.md.",
            },
          ],
          details: {},
        };
      },
    };

    pi.registerTool(memorySearch);
    pi.registerTool(memorySave);
  };
}
