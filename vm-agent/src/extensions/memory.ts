import { Type, type Static } from "@sinclair/typebox";
import type {
  ExtensionFactory,
  ToolDefinition,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readMemoryMd,
  readDailyLog,
  appendDailyLog,
  getDailyLogPath,
  appendMemoryMd,
} from "../lib/daily-log.js";

const MAX_INJECTION_CHARS = 3000;

export const MEMORY_SYSTEM_PROMPT = `[Memory System]
You have access to a persistent memory system:
- memory_search: Search past daily logs by keyword (simple grep, for advanced search use the built-in grep tool on memory/*.md)
- memory_save: Save important facts to MEMORY.md (long-term curated memory)
Use these tools proactively to remember user preferences, project context, and decisions.`;

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

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Tool Parameter Schemas ─────────────────────────

const SearchParams = Type.Object({
  query: Type.String({ description: "Keywords to search in daily logs" }),
  days: Type.Optional(
    Type.Number({ description: "Number of days to search back", default: 7 }),
  ),
});

const SaveParams = Type.Object({
  content: Type.String({ description: "Content to save to long-term memory" }),
  section: Type.Optional(
    Type.String({ description: "Section heading to append under" }),
  ),
});

// ─── Extension Factory ──────────────────────────────

export function createMemoryExtension(workspaceDir: string): ExtensionFactory {
  return (pi) => {
    // ── context: prepend memory summary before existing messages ──
    pi.on("context", async (event) => {
      const parts: string[] = [];

      const longTerm = await readMemoryMd(workspaceDir, 2000);
      if (longTerm) parts.push(`### Long-term Memory (MEMORY.md)\n${longTerm}`);

      const todayLog = await readDailyLog(workspaceDir, new Date(), 30);
      if (todayLog) parts.push(`### Today's Log\n${todayLog}`);

      const yesterdayLog = await readDailyLog(workspaceDir, yesterday(), 10);
      if (yesterdayLog) parts.push(`### Yesterday's Log\n${yesterdayLog}`);

      if (parts.length === 0) return {};

      const fullText = truncate(parts.join("\n\n"), MAX_INJECTION_CHARS);

      const contextMsg = {
        role: "user" as const,
        content: [{ type: "text" as const, text: `[SYSTEM CONTEXT - NOT USER INPUT]\nThe following is automatically injected memory context. Do not respond to it directly.\n\n<memory_context>\n${fullText}\n</memory_context>` }],
        timestamp: Date.now(),
      };

      // Prepend memory context to existing messages (context event replaces all messages)
      return {
        messages: [contextMsg, ...event.messages],
      };
    });

    // ── agent_end: append conversation summary to daily log ──
    pi.on("agent_end", async (event) => {
      const text = extractAssistantText(event.messages);
      if (!text) return;

      const summary = text.length > 200 ? text.slice(0, 200) + "..." : text;
      await appendDailyLog(workspaceDir, `## ${nowHHMM()}\n${summary}\n\n`);
    });

    // ── session_before_compact: flush key topics before compaction ──
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
          workspaceDir,
          `## ${nowHHMM()} — Compaction Summary\nTopics discussed:\n- ${summary}\n\n`,
        );
      }

      return {};
    });

    // ── memory_search tool ──────────────────────────
    const memorySearch: ToolDefinition<typeof SearchParams> = {
      name: "memory_search",
      label: "Memory Search",
      description:
        "Search daily memory logs by keyword. Returns matching lines with date context. For advanced search, use the built-in grep tool on memory/*.md files.",
      parameters: SearchParams,
      execute: async (_toolCallId, params: Static<typeof SearchParams>) => {
        const days = params.days ?? 7;
        const keywords = params.query.toLowerCase().split(/\s+/).filter(Boolean);
        if (keywords.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No search keywords provided." }],
            details: {},
            isError: true,
          };
        }

        const results: string[] = [];
        const now = new Date();

        for (let i = 0; i < days; i++) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          const logPath = getDailyLogPath(workspaceDir, date);

          let content: string;
          try {
            content = await readFile(logPath, "utf-8");
          } catch {
            continue;
          }

          const dateStr = logPath.split("/").pop()!.replace(".md", "");
          const lines = content.split("\n");
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (keywords.some((kw) => lower.includes(kw))) {
              results.push(`[${dateStr}] ${line}`);
            }
          }
        }

        const text =
          results.length > 0
            ? results.slice(0, 50).join("\n")
            : "No matching entries found.";

        return {
          content: [{ type: "text" as const, text }],
          details: { matchCount: results.length, daysSearched: days },
        };
      },
    };

    // ── memory_save tool ────────────────────────────
    const memorySave: ToolDefinition<typeof SaveParams> = {
      name: "memory_save",
      label: "Memory Save",
      description:
        "Save important information to MEMORY.md (long-term curated memory). Use section parameter to organize under headings.",
      parameters: SaveParams,
      execute: async (_toolCallId, params: Static<typeof SaveParams>) => {
        await appendMemoryMd(workspaceDir, params.content, params.section);
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
