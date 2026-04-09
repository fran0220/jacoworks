---
name: ai-search
description: >
  Searches the web through the bundled ai-search CLI. Use when the user asks for
  fresh information, web research, recent news, documentation lookup, or current
  facts, and the agent should call the CLI through the built-in bash tool.
---

# AI Search

Use the bundled `ai-search` CLI through `bash`. Do not use the old `search.mjs` flow.

## When To Use

- Use for fresh web research, latest news, documentation lookup, comparisons, and general discovery.
- Use `content-extract` instead when the user gives a specific URL and wants the page content extracted.
- Use `browser` instead when the site needs login state, interactive navigation, or screenshots.

## Default Workflow

1. Start with the default fast mode:

```bash
ai-search "your query"
```

2. Read the JSON response. The useful fields are:

```json
{
  "ok": true,
  "data": {
    "content": "formatted text results",
    "results": [],
    "mode": "fast"
  }
}
```

3. Use `data.content` as the primary human-readable result.
4. Inspect `data.results` when you need source URLs, titles, or structured search hits.

## Modes

### Default: fast

Use this for almost everything.

```bash
ai-search "latest Bun release notes"
```

### AI summary: answer

Use this when the user wants a direct summary or synthesized answer.

```bash
ai-search "how does bun build --compile work" --mode answer
```

### Deep mode

Do not use `--mode deep` unless the user explicitly asks for deep search, multi-source search, or a slower exhaustive pass.

## Common Patterns

### Latest information

```bash
ai-search "AI news this week"
```

### Documentation lookup

```bash
ai-search "OpenAI Responses API docs"
```

### Compare options

```bash
ai-search "Bun vs Deno 2026"
```

### Direct answer / overview

```bash
ai-search "what is Model Context Protocol" --mode answer
```

### More breadth

Increase result count when the first pass is too narrow.

```bash
ai-search "vector database benchmark 2026" --num 8
```

### Query splitting

Let the CLI fan out broader research when useful.

```bash
ai-search "best browser automation cli for ai agents" --split 3
```

## Human-Readable Output

If you want terminal-friendly output instead of JSON, use:

```bash
ai-search "Claude Sonnet 4.6 release notes" --human
```

Use this only when raw JSON is not helpful for the current step.

## Operational Commands

Use these when debugging or checking availability:

```bash
ai-search health
ai-search models
ai-search providers
ai-search --help
```

## Configuration

- `AI_SEARCH_GATEWAY_URL` and authentication are injected by the sidecar environment.
- Do not ask the user to configure tokens for normal use.
- `--gateway-url` and `--token` exist for overrides, but they are not the default path.

## Response Handling Rules

- Quote or summarize `data.content` for the user instead of dumping raw JSON unless they ask for it.
- If the response includes useful `data.results`, cite the most relevant URLs or titles in your answer.
- If the CLI returns an error, explain that web search is temporarily unavailable and either retry with a simpler query or switch to another skill.

## Quick Reference

| Goal | Command |
|------|---------|
| Fresh search | `ai-search "query"` |
| AI summary | `ai-search "query" --mode answer` |
| More results | `ai-search "query" --num 8` |
| Broader expansion | `ai-search "query" --split 3` |
| Human-readable output | `ai-search "query" --human` |
| Help | `ai-search --help` |
