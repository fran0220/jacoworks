# Unified Pi Skills Directory

This directory is the new shared skill root for the Pi CLI migration tracked in `tasks/replace-openclaw-with-pi-cli.md`.

It consolidates skills from two legacy locations:

- `vm-agent/skills/` — desktop + sidecar skills grouped by domain (`创作`, `办公`, `工具`, `开发`)
- `openclaw/skills/` — cloud/OpenClaw agent skills (`team-builder`, `search`, `agent-reach`, etc.)

## Goals

- Give desktop and VM images a single `skills/` path to mount or copy.
- Keep existing skill content, scripts, references, and templates intact during the migration.
- Normalize `SKILL.md` frontmatter so Pi can load every skill without name warnings.
- Preserve category folders where they help humans browse the catalog.

## Pi Compatibility Rules

Pi discovers skills recursively, so nested paths such as `skills/创作/infographic/` and `skills/办公/data-analysis/` are valid.

For Pi compatibility, each leaf skill directory now follows these rules:

- It contains a `SKILL.md` file.
- The frontmatter `name` matches the leaf directory slug.
- The frontmatter includes a `description` field.

This means human-readable headings inside the document can stay bilingual, while the machine-readable `name` stays stable.

## Directory Layout

```text
skills/
  README.md
  teams/
    README.md                    # migration notes for legacy OpenClaw team templates
  building-skills/
  创作/
    infographic/
    nano-banana-pro/
    poster/
    slide-deck/
    video-gen/
    xhs-images/
  办公/
    data-analysis/
    document-processing/
    feishu/
    finance/
    legal/
    marketing/
  工具/
    content-extract/
    web-search/
  开发/
    game-dev-ai/
  agent-reach/
  asset-gateway/
  excel-xlsx/
  lark-feishu/
  search/
  team-builder/
  word-docx/
```

## Source-of-Truth Notes

- During the migration window, legacy skill directories remain in place so other threads can continue working safely.
- New Pi-oriented updates should land here first.
- The `team-builder` skill is no longer OpenClaw-specific; it now documents `@tmustier/pi-agent-teams` workflows.
- Legacy OpenClaw team templates are not converted in this thread. See `skills/teams/README.md` for the mapping guide.

## Related Pi Plugins

These skills are intended to work alongside the Pi community plugins planned for the new stack:

- `pi-subagents`
- `@tmustier/pi-agent-teams`
- `taskplane`
- `pi-web-access`
- `@apmantza/greedysearch-pi`
- `pi-mcp-adapter`
- `@aliou/pi-guardrails`
- `@aliou/pi-processes`
- `pi-rtk`
