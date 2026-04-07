# pi-config

Thread 1 shared Pi CLI runtime configuration for the `feat/replace-openclaw-with-pi-cli` migration.

## Contents

- `models.json` — shared provider/model registry for the Xiaomao LLM proxy
- `settings.json` — default provider/model, package installs, and compaction tuning
- `pi-messenger.json` — Crew orchestration defaults for `pi-messenger`
- `extensions/visual.ts` — `render_visual` tool for inline HTML widgets
- `extensions/cron-proxy.ts` — `cron_manage` sidecar proxy to Gateway REST API
- `extensions/image-gen.ts` — `generate_image` tool with Gemini Flash primary and fal.ai fallback
- `extensions/db0-memory.mjs` — db0 memory bridge with PostgreSQL backend via `DATABASE_URL`
- `crew-agents/` — project-specific `pi-messenger` crew agent definitions converted from the legacy pod templates

## Intended Install Layout

Copy the contents of this directory into `~/.pi/agent/` on both desktop sidecar hosts and the Incus VM image:

```text
~/.pi/agent/
├── models.json
├── pi-messenger.json
├── settings.json
├── crew-agents/
│   ├── builder-pod-planner.md
│   ├── builder-pod-developer.md
│   ├── builder-pod-tester.md
│   └── ...
└── extensions/
    ├── db0-memory.mjs
    ├── visual.ts
    ├── cron-proxy.ts
    └── image-gen.ts
```

Pi convention discovery auto-loads `.ts`, `.js`, and `.mjs` files from `extensions/`, so `db0-memory.mjs` is discovered automatically alongside the existing `.ts` extensions.

`pi-messenger` reads its user-level defaults from `~/.pi/agent/pi-messenger.json`. The `crew-agents/` directory in this repo is the converted source-of-truth for the custom pod agent prompts and is synced to runtime hosts for later installation into project-local `.pi/messenger/crew/agents/` directories.

## Required Environment Variables

- `LLM_PROXY_KEY` — required by `models.json` and `image-gen.ts`
- `LLM_PROXY_URL` — optional for `image-gen.ts`; defaults to `http://67.230.182.59:8317`
- `GATEWAY_URL` — required by `cron-proxy.ts`
- `GATEWAY_TOKEN` — required by `cron-proxy.ts`
- `FAL_API_KEY` — optional fallback for `image-gen.ts`
- `DATABASE_URL` — required by `db0-memory.mjs` for the shared PostgreSQL-backed db0 memory store

## Package Notes

- `pi-messenger` replaces the old `pi-subagents` + `@tmustier/pi-agent-teams` + `taskplane` stack.
- `@db0-ai/pi` provides the Pi memory tools (`db0_memory_write`, `db0_memory_search`, `db0_memory_list`).
- `@db0-ai/backends-postgres` is installed alongside `@db0-ai/pi` so `db0-memory.mjs` can attach db0 to PostgreSQL instead of the default SQLite backend.
- `settings.json.packages` is kept aligned with `packages/package.json` so the VM image build, `pi install`, and local sidecar bootstrap all install the same package set.

## Crew Defaults

- `pi-messenger.json` enables `autoRegister` and pins planner/worker/reviewer to `proxy-gpt/gpt-5.4`.
- The converted pod agents in `crew-agents/` all use `proxy-gpt/gpt-5.4` frontmatter and preserve the original pod-specific leadership, execution, and review prompts.
- Existing `team-templates/*.json` remain in place for legacy bootstrap consumers during the Phase 1 migration window.

## Provider Notes

- `proxy-anthropic` uses Anthropic native protocol at `http://67.230.182.59:8317`
- `proxy-openai`, `proxy-gemini`, `proxy-grok`, and `proxy-glm` use OpenAI-compatible chat completions at `http://67.230.182.59:8317/v1`
- OpenAI-compatible providers pin `supportsDeveloperRole: false`, `supportsStore: false`, and `maxTokensField: "max_tokens"` to match the existing proxy behavior used by `vm-agent`
- All model costs remain `0` because this is an internal proxy
