import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { SearchClient } from "origin-search";
import type { SearchOptions } from "origin-search";
import { log } from "../lib/logger.js";

// ─── Parameter Schema ───────────────────────────────

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query in natural language" }),
  mode: Type.Optional(Type.Union([
    Type.Literal("fast"),
    Type.Literal("answer"),
  ], { description: "Search mode. 'fast' (default) returns raw results; 'answer' returns an AI-synthesized summary." })),
  num: Type.Optional(Type.Number({ description: "Number of results to return (default: 5)" })),
});

// ─── Extension Factory ──────────────────────────────

export function createWebSearchExtension(apiKey: string, baseUrl?: string): ExtensionFactory {
  const client = new SearchClient(apiKey, {
    baseUrl: baseUrl || "https://search.xiaomao.chat",
  });

  return (pi) => {
    const tool = defineTool<typeof WebSearchParams, Record<string, unknown>>({
      name: "web_search",
      label: "Web Search",
      description:
        "Search the web for fresh information, documentation, news, or facts.\n\n" +
        "Use mode='fast' (default) for quick factual lookups.\n" +
        "Use mode='answer' when you need a synthesized summary.\n" +
        "Do NOT use mode='deep' — it is slow and rarely needed.",
      parameters: WebSearchParams,
      execute: async (_toolCallId, params) => {
        const startMs = Date.now();

        try {
          const opts: SearchOptions = {};
          if (params.mode) opts.mode = params.mode;
          if (params.num) opts.num = params.num;

          const result = await client.search(params.query, opts);
          const elapsed = Date.now() - startMs;

          log.info("web search completed", {
            query: params.query,
            mode: params.mode || "fast",
            providers: result.providers,
            results_count: result.results?.length || 0,
            elapsed_ms: elapsed,
          });

          // Build human-readable response
          let text = result.content || "";

          if (result.answer) {
            text = result.answer + "\n\n---\n" + text;
          }

          // Append source URLs
          if (result.results?.length) {
            const sources = result.results
              .filter((r) => r.url && r.title)
              .slice(0, 8)
              .map((r) => `- [${r.title}](${r.url})`)
              .join("\n");
            if (sources) {
              text += "\n\nSources:\n" + sources;
            }
          }

          return {
            content: [{ type: "text" as const, text: text || "No results found." }],
            details: {
              query: params.query,
              mode: result.mode,
              providers: result.providers,
              results_count: result.results?.length || 0,
              elapsed_ms: elapsed,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error("web search failed", { error: message, query: params.query });
          return {
            content: [{ type: "text" as const, text: `Web search failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    });

    pi.registerTool(tool);
  };
}
