# pi-config

Thread 1 shared Pi CLI runtime configuration for the `feat/replace-openclaw-with-pi-cli` migration.

## Contents

- `models.json` — shared provider/model registry for the Xiaomao LLM proxy
- `settings.json` — default provider/model and compaction tuning
- `extensions/visual.ts` — `render_visual` tool for inline HTML widgets
- `extensions/cron-proxy.ts` — `cron_manage` sidecar proxy to Gateway REST API
- `extensions/image-gen.ts` — `generate_image` tool with Gemini Flash primary and fal.ai fallback

## Intended Install Layout

Copy the contents of this directory into `~/.pi/agent/` on both desktop sidecar hosts and the Incus VM image:

```text
~/.pi/agent/
├── models.json
├── settings.json
└── extensions/
    ├── visual.ts
    ├── cron-proxy.ts
    └── image-gen.ts
```

Pi auto-discovers `~/.pi/agent/extensions/*.ts`, so `settings.json` does not need an explicit `extensions` array for these files.

## Required Environment Variables

- `LLM_PROXY_KEY` — required by `models.json` and `image-gen.ts`
- `LLM_PROXY_URL` — optional for `image-gen.ts`; defaults to `http://67.230.182.59:8317`
- `GATEWAY_URL` — required by `cron-proxy.ts`
- `GATEWAY_TOKEN` — required by `cron-proxy.ts`
- `FAL_API_KEY` — optional fallback for `image-gen.ts`

## Provider Notes

- `proxy-anthropic` uses Anthropic native protocol at `http://67.230.182.59:8317`
- `proxy-openai`, `proxy-gemini`, `proxy-grok`, and `proxy-glm` use OpenAI-compatible chat completions at `http://67.230.182.59:8317/v1`
- OpenAI-compatible providers pin `supportsDeveloperRole: false`, `supportsStore: false`, and `maxTokensField: "max_tokens"` to match the existing proxy behavior used by `vm-agent`
- All model costs remain `0` because this is an internal proxy
