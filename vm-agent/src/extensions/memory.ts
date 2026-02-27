import { Type, type Static } from "@sinclair/typebox";
import type {
  ExtensionFactory,
  ToolDefinition,
  SessionMessageEntry,
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
  VectorStore,
  chunkMarkdown,
  type SearchResult,
} from "../lib/vector-store.js";
import { isEmbeddingAvailable } from "../lib/embedding.js";

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

function extractLatestUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
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
  }
  return "";
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
  query: Type.String({ description: "Natural language query to search memory (semantic search)" }),
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

async function indexMemoryFiles(store: VectorStore, memoryRootDir: string) {
  // 索引 MEMORY.md
  const longTerm = await readMemoryMd(memoryRootDir, 50_000);
  if (longTerm) {
    store.removeBySource("MEMORY.md");
    const chunks = chunkMarkdown(longTerm, "MEMORY.md");
    if (chunks.length > 0) {
      await store.index(chunks);
    }
  }

  // 索引最近 14 天的日志
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
      if (chunks.length > 0) {
        await store.index(chunks);
      }
    }
  }

  // 清理 30 天前的向量
  store.pruneOlderThan(30);
}

// ─── Keyword Fallback Search ────────────────────────

async function keywordSearch(
  memoryRootDir: string,
  query: string,
  days = 7,
): Promise<string[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return [];

  const results: string[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const logPath = getDailyLogPath(memoryRootDir, date);

    let content: string;
    try {
      content = await readFile(logPath, "utf-8");
    } catch {
      continue;
    }

    const dateStr = basename(logPath, ".md");
    const lines = content.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        results.push(`[${dateStr}] ${line}`);
      }
    }
  }

  return results;
}

// ─── Extension Factory ──────────────────────────────

export function createMemoryExtension(memoryRootDir: string): ExtensionFactory {
  return (pi) => {
    const store = new VectorStore(memoryRootDir);
    const useVector = isEmbeddingAvailable();

    // 初始化: 加载向量缓存 + 后台索引
    const initPromise = (async () => {
      if (!useVector) return;
      await store.load();
      try {
        await indexMemoryFiles(store, memoryRootDir);
        console.log(`[memory] Vector store ready: ${store.size} chunks indexed`);
      } catch (e) {
        console.error("[memory] Background indexing error:", e);
      }
    })();

    // ── context: 语义检索 or 传统注入 ──
    pi.on("context", async (event) => {
      const parts: string[] = [];

      if (useVector) {
        await initPromise;

        // 从最新用户消息提取查询
        const userQuery = extractLatestUserText(event.messages);
        if (userQuery && store.size > 0) {
          try {
            const results = await store.search(userQuery, 8, 0.25);
            if (results.length > 0) {
              const memoryText = results
                .map((r) => `[${r.source}] (score: ${r.score.toFixed(2)})\n${r.text}`)
                .join("\n\n");
              parts.push(`### Relevant Memory (semantic search)\n${memoryText}`);
            }
          } catch (e) {
            console.error("[memory] Search error, falling back:", e);
            // 回退到传统方式
            const longTerm = await readMemoryMd(memoryRootDir, 2000);
            if (longTerm) parts.push(`### Long-term Memory (MEMORY.md)\n${longTerm}`);
          }
        }

        // 始终注入今天的日志（最新上下文）
        const todayLog = await readDailyLog(memoryRootDir, new Date(), 20);
        if (todayLog) parts.push(`### Today's Log\n${todayLog}`);
      } else {
        // Embedding 不可用时的回退
        const longTerm = await readMemoryMd(memoryRootDir, 2000);
        if (longTerm) parts.push(`### Long-term Memory (MEMORY.md)\n${longTerm}`);

        const todayLog = await readDailyLog(memoryRootDir, new Date(), 30);
        if (todayLog) parts.push(`### Today's Log\n${todayLog}`);

        const yesterdayLog = await readDailyLog(memoryRootDir, yesterday(), 10);
        if (yesterdayLog) parts.push(`### Yesterday's Log\n${yesterdayLog}`);
      }

      if (parts.length === 0) return {};

      const fullText = truncate(parts.join("\n\n"), MAX_INJECTION_CHARS);

      const contextMsg = {
        role: "user" as const,
        content: [{ type: "text" as const, text: `[SYSTEM CONTEXT - NOT USER INPUT]\nThe following is automatically injected memory context. Do not respond to it directly.\n\n<memory_context>\n${fullText}\n</memory_context>` }],
        timestamp: Date.now(),
      };

      return {
        messages: [contextMsg, ...event.messages],
      };
    });

    // ── agent_end: 自动记录 + 增量索引 ──
    // NOTE: embedding 索引改为 fire-and-forget，不阻塞 agent_end hook，
    // 避免 OpenAI Embedding API 慢导致前端 streaming 状态卡住 ~1 分钟。
    pi.on("agent_end", async (event) => {
      const text = extractAssistantText(event.messages);
      if (!text) return;

      const summary = text.length > 200 ? text.slice(0, 200) + "..." : text;
      if (!shouldPersistAssistantSummary(summary)) return;

      const entry = `## ${nowHHMM()}\n${summary}\n\n`;
      await appendDailyLog(memoryRootDir, entry);

      // 增量索引新条目 — fire-and-forget，不阻塞 hook
      if (useVector) {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const source = `daily/${dateStr}.md`;
        store.index([{ text: entry.trim(), source }]).catch((e) => {
          console.error("[memory] Index new entry error:", e);
        });
      }
    });

    // ── session_before_compact: flush 话题到日志 ──
    pi.on("session_before_compact", async (event) => {
      const topics: string[] = [];
      for (const entry of event.branchEntries) {
        if (entry.type !== "message") continue;
        const { message } = entry as SessionMessageEntry;
        if (message.role !== "user") continue;
        let text = "";
        if (typeof message.content === "string") {
          text = message.content;
        } else if (Array.isArray(message.content)) {
          const block = message.content.find(
            (b) => b && typeof b === "object" && "type" in b && b.type === "text"
          ) as { text?: string } | undefined;
          text = block?.text ?? "";
        }
        const first100 = text.slice(0, 100);
        if (first100.trim()) topics.push(first100);
      }

      if (topics.length > 0) {
        const summary = topics.slice(0, 5).join("\n- ");
        await appendDailyLog(
          memoryRootDir,
          `## ${nowHHMM()} — Compaction Summary\nTopics discussed:\n- ${summary}\n\n`,
        );
      }

      return {};
    });

    // ── memory_search tool: 语义搜索 + 关键词回退 ──
    const memorySearch: ToolDefinition<typeof SearchParams> = {
      name: "memory_search",
      label: "Memory Search",
      description: useVector
        ? "Semantic search across all memory (MEMORY.md + daily logs). Uses OpenAI embedding vectors for relevance matching."
        : "Search daily memory logs by keyword. Returns matching lines with date context.",
      parameters: SearchParams,
      execute: async (_toolCallId, params: Static<typeof SearchParams>) => {
        const topK = params.top_k ?? 5;

        if (useVector && store.size > 0) {
          try {
            const results = await store.search(params.query, topK);
            if (results.length > 0) {
              const text = results
                .map(
                  (r, i) =>
                    `${i + 1}. [${r.source}] (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.text}`,
                )
                .join("\n\n");
              return {
                content: [{ type: "text" as const, text }],
                details: { matchCount: results.length, mode: "vector" },
              };
            }
          } catch (e) {
            console.error("[memory] Vector search failed, falling back to keyword:", e);
          }
        }

        // 关键词回退
        const results = await keywordSearch(memoryRootDir, params.query);
        const text =
          results.length > 0
            ? results.slice(0, 50).join("\n")
            : "No matching entries found.";

        return {
          content: [{ type: "text" as const, text }],
          details: { matchCount: results.length, mode: "keyword" },
        };
      },
    };

    // ── memory_save tool: 保存 + 立即索引 ──
    const memorySave: ToolDefinition<typeof SaveParams> = {
      name: "memory_save",
      label: "Memory Save",
      description:
        "Save important information to MEMORY.md (long-term curated memory). Content is automatically indexed for semantic search.",
      parameters: SaveParams,
      execute: async (_toolCallId, params: Static<typeof SaveParams>) => {
        await appendMemoryMd(memoryRootDir, params.content, params.section);

        // 立即索引新内容
        if (useVector) {
          try {
            const chunkText = params.section
              ? `## ${params.section}\n\n${params.content}`
              : params.content;
            await store.index([{ text: chunkText, source: "MEMORY.md" }]);
          } catch (e) {
            console.error("[memory] Index saved content error:", e);
          }
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
