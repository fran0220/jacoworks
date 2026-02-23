import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// ─── Parameter Schemas ──────────────────────────────

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  maxResults: Type.Optional(
    Type.Number({ description: "Max results to return", default: 5 })
  ),
});

const FetchParams = Type.Object({
  url: Type.String({ description: "URL to fetch" }),
  maxChars: Type.Optional(
    Type.Number({ description: "Maximum characters to return", default: 50000 })
  ),
});

// ─── Tools ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWebTools(): ToolDefinition<any>[] {
  const webSearch: ToolDefinition<typeof SearchParams> = {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for information. Returns relevant search results.",
    parameters: SearchParams,
    execute: async (_toolCallId, params: Static<typeof SearchParams>) => {
      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return {
            content: [{ type: "text" as const, text: "Web search unavailable: TAVILY_API_KEY not set" }],
            details: {},
            isError: true,
          };
        }

        const resp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: params.query,
            max_results: params.maxResults ?? 5,
            include_answer: true,
          }),
        });

        if (!resp.ok) throw new Error(`Tavily API error: ${resp.status}`);

        const data = (await resp.json()) as {
          answer?: string;
          results: Array<{ title: string; url: string; content: string }>;
        };

        const formatted = data.results
          .map((r) => `### ${r.title}\n${r.url}\n${r.content}`)
          .join("\n\n---\n\n");

        return {
          content: [{
            type: "text" as const,
            text: data.answer ? `**Answer:** ${data.answer}\n\n---\n\n${formatted}` : formatted,
          }],
          details: { resultCount: data.results.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  };

  const webFetch: ToolDefinition<typeof FetchParams> = {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch and extract text content from a URL. Returns the page content as text.",
    parameters: FetchParams,
    execute: async (_toolCallId, params: Static<typeof FetchParams>) => {
      try {
        const resp = await fetch(params.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JAcoworks-Agent/1.0)" },
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

        let text = await resp.text();
        const maxChars = params.maxChars ?? 50000;
        if (text.length > maxChars) {
          text = text.slice(0, maxChars) + "\n\n... (truncated)";
        }

        return {
          content: [{ type: "text" as const, text }],
          details: { url: params.url, length: text.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  };

  return [webSearch, webFetch];
}
