import type {
  ExtensionFactory,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { appendDailyLog } from "../lib/daily-log.js";

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Extension Factory ──────────────────────────────

export function createCompactionSafeguardExtension(
  memoryRootDir: string,
): ExtensionFactory {
  return (pi) => {
    // ── turn_end: token usage logging ──
    pi.on("turn_end", async (event) => {
      const msg = event.message;
      if (msg?.role === "assistant" && msg.usage) {
        const u = msg.usage;
        console.log(
          `[tokens] turn=${event.turnIndex} in=${u.input} out=${u.output} cache_r=${u.cacheRead || 0} cache_w=${u.cacheWrite || 0} total=${u.totalTokens || u.input + u.output + (u.cacheRead || 0) + (u.cacheWrite || 0)} model=${msg.model || "unknown"}`,
        );
      }
    });

    // ── session_before_compact: flush topics to daily log ──
    pi.on("session_before_compact", async (event) => {
      if (event.signal?.aborted) return {};

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
            (b) => b && typeof b === "object" && "type" in b && b.type === "text",
          ) as { text?: string } | undefined;
          text = block?.text ?? "";
        }
        if (text.includes("[SYSTEM CONTEXT - NOT USER INPUT]")) continue;
        const first150 = text.slice(0, 150).trim();
        if (first150) topics.push(first150);
      }

      if (topics.length > 0) {
        const tokensBefore = event.preparation?.tokensBefore;
        const header = tokensBefore
          ? `## ${nowHHMM()} — Pre-compaction Flush (${tokensBefore} tokens)`
          : `## ${nowHHMM()} — Pre-compaction Flush`;
        const topicList = topics.slice(0, 10).map((t) => `- ${t}`).join("\n");
        const entry = `${header}\nTopics discussed before compaction:\n${topicList}\n\n`;
        await appendDailyLog(memoryRootDir, entry);
      }

      return {};
    });
  };
}
