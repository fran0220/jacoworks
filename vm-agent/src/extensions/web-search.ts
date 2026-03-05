import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";

// ─── Parameter Schema ───────────────────────────────

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  num_results: Type.Optional(
    Type.Number({ description: "Number of results to return (default: 5, max: 10)" }),
  ),
  include_answer: Type.Optional(
    Type.Boolean({ description: "Include AI-generated answer summary (default: false)" }),
  ),
});

// ─── Result type ────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

// ─── Tavily Search ──────────────────────────────────

async function searchTavily(
  apiKey: string,
  query: string,
  num: number,
  includeAnswer: boolean,
): Promise<{ results: SearchResult[]; answer: string | null }> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: num,
      include_answer: includeAnswer,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Tavily HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
    answer?: string;
  };

  const results: SearchResult[] = (data.results || [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title || "",
      url: r.url!,
      snippet: r.content || "",
      source: "tavily",
    }));

  return { results, answer: data.answer || null };
}

// ─── Grok Fallback ──────────────────────────────────

async function searchGrok(
  proxyUrl: string,
  proxyKey: string,
  query: string,
  num: number,
): Promise<SearchResult[]> {
  const systemPrompt =
    "You are a web search engine. Given a query, return the most relevant and credible search results.\n" +
    "Output ONLY valid JSON — no markdown, no explanation.\n" +
    '{"results": [{"title": "...", "url": "...", "snippet": "..."}]}\n' +
    `Return up to ${num} results. Each must have a real, verifiable URL (http/https only).`;

  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${proxyKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `<query>${query}</query>` },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Grok HTTP ${res.status}`);

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  let content = data.choices?.[0]?.message?.content || "";
  // Strip thinking tags and code fences
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  // Extract JSON object
  if (!content.startsWith("{")) {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1) content = content.slice(start, end + 1);
  }

  const parsed = JSON.parse(content) as {
    results?: Array<{ title?: string; url?: string; snippet?: string }>;
  };

  return (parsed.results || [])
    .filter((r) => {
      try {
        const u = new URL(r.url || "");
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    })
    .map((r) => ({
      title: r.title || "",
      url: r.url!,
      snippet: r.snippet || "",
      source: "grok",
    }));
}

// ─── Format results ─────────────────────────────────

function formatResults(results: SearchResult[], answer: string | null): string {
  const lines: string[] = [];

  if (answer) {
    lines.push(answer, "");
  }

  if (results.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. [${r.title}](${r.url})`);
    if (r.snippet) {
      lines.push(`   ${r.snippet.slice(0, 300)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Extension Factory ──────────────────────────────

export function createWebSearchExtension(
  proxyUrl: string,
  proxyKey: string,
): ExtensionFactory {
  const tavilyKey = process.env.TAVILY_API_KEY || "";

  return (pi) => {
    const tool: ToolDefinition<typeof WebSearchParams> = {
      name: "web_search",
      label: "Web Search",
      description:
        "Search the web for current information. Returns titles, URLs, and snippets. " +
        "Use for factual lookups, recent news, documentation, API references, etc.",
      parameters: WebSearchParams,
      execute: async (_toolCallId, params: Static<typeof WebSearchParams>) => {
        const num = Math.min(params.num_results || 5, 10);
        const includeAnswer = params.include_answer || false;

        if (!tavilyKey && !proxyKey) {
          return {
            content: [{ type: "text" as const, text: "Error: no search API key configured" }],
            details: {},
          };
        }

        let results: SearchResult[] = [];
        let answer: string | null = null;

        // Primary: Grok (free via proxy, no extra key needed)
        if (proxyKey) {
          try {
            results = await searchGrok(proxyUrl, proxyKey, params.query, num);
          } catch (err) {
            console.error(`[web_search] Grok failed: ${(err as Error).message}`);
          }
        }

        // Fallback: Tavily (richer snippets + optional AI answer)
        if (results.length === 0 && tavilyKey) {
          try {
            const tavResult = await searchTavily(tavilyKey, params.query, num, includeAnswer);
            results = tavResult.results;
            answer = tavResult.answer;
          } catch (err) {
            console.error(`[web_search] Tavily failed: ${(err as Error).message}`);
          }
        }

        const text = formatResults(results, answer);

        return {
          content: [{ type: "text" as const, text }],
          details: { resultCount: results.length, source: results[0]?.source || "none" },
        };
      },
    };

    pi.registerTool(tool);
  };
}
