---
name: search
description: "Multi-source web search (Exa + Tavily + Grok). Use when the user asks to search the web, find information, or research a topic."
---

# Web Search

Multi-source parallel search with intent-aware scoring.

## Usage

Credentials auto-discovered from `~/.openclaw/credentials/search.json`.

```bash
S=/home/node/.openclaw/skills/search/scripts

# Fast search (Exa only)
python3 $S/search.py "query" --mode fast

# Deep search (Exa + Tavily + Grok parallel)
python3 $S/search.py "query" --mode deep --num 5

# With intent + freshness filter
python3 $S/search.py "query" --mode deep --intent status --freshness pw

# Fetch full thread/page content
python3 $S/fetch_thread.py "https://github.com/owner/repo/issues/123"
```

## Modes
- `fast` — Exa only (low latency)
- `deep` — Exa + Tavily + Grok parallel (max coverage)
- `answer` — Tavily with AI-generated answer

## Intent types
factual, status, comparison, tutorial, exploratory, news, resource
