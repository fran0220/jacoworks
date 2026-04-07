# Mapping OpenClaw Templates To pi-agent-teams

This document explains how to translate the legacy file-driven team templates in `openclaw/templates/` into the runtime model used by `@tmustier/pi-agent-teams`.

It is a migration guide, not a full automatic converter.

## Key Mental Shift

Legacy OpenClaw templates are mostly declarative:

- one `template.json`
- a fixed list of agents
- per-agent prompts, skills, models, and cron schedules
- a shared workspace bootstrap

`pi-agent-teams` is more operational:

- a leader session becomes the active team lead
- workers are spawned dynamically with `/team spawn` or `/swarm`
- tasks are stored as JSON files under the team directory
- team membership lives in `config.json`
- coordination happens through task files, inboxes, and the shared working tree

## Directory Mapping

| Legacy OpenClaw | pi-agent-teams |
|---|---|
| `template.json.name` | `teamId` and directory name under `PI_TEAMS_ROOT_DIR` |
| `template.json.displayName` | Human-facing label in docs/UI notes |
| `template.json.description` | Team overview in bootstrap docs |
| `agents[].isLeader = true` | Current Pi session / `leadName` in `config.json` |
| `agents[]` non-leaders | Spawned teammates listed in `config.json.members[]` |
| `agents[].model` | `/team spawn ... --model <provider/model>` |
| `agents[].prompt` | Rewrite into Pi skill guidance, workspace docs, or role playbooks sent to the spawned agent |
| `agents[].skills` | Move into the unified `skills/` catalog and load through Pi |
| `agents[].cron` | No direct built-in equivalent; replace with seeded tasks, hooks, or an external scheduler |
| `workspace.sharedRoot` | Team working directory / shared repo path |
| `workspace.files` | Initial files copied into the team root |
| `theme` | Optional UI/theme metadata outside the core team runtime |

## Files Created By pi-agent-teams

A migrated team typically ends up like this:

```text
~/.pi/agent/teams/<teamId>/
  config.json
  tasks/<taskListId>/
    1.json
    2.json
    .highwatermark
  mailboxes/<namespace>/inboxes/
  sessions/
  worktrees/
  hook-logs/
```

Useful legacy workspace files can still live in the shared project directory, for example:

- `GOALS.md`
- `STATUS.md`
- `DECISIONS.md`
- `TOPICS.md`
- `CALENDAR.md`
- role-specific notes directories

## Recommended Migration Procedure

1. Pick the legacy `template.json` and keep its `name` as the Pi `teamId`.
2. Start a Pi session in the shared working directory that should act as the team lead.
3. Treat the legacy leader agent as the current interactive session instead of spawning it separately.
4. Spawn each non-leader agent with `/team spawn <name> [fresh|branch] [shared|worktree] --model <provider/model>`.
5. Convert each role prompt into one of these Pi-native forms:
   - a reusable skill in `skills/`
   - a role playbook file in the workspace
   - a kickoff message sent with `/team dm` or via task descriptions
6. Copy legacy shared workspace files into the shared repo or working directory.
7. Seed the first wave of work as `/team task add ...` items instead of relying on OpenClaw cron.
8. If the legacy template depended on periodic cron wakeups, move that behavior to an external scheduler, a future Pi extension, or explicit recurring task seeding.

## Cron Migration Guidance

OpenClaw templates often encode autonomy through `agents[].cron`. `pi-agent-teams` does not provide a one-to-one cron field in team config.

Use one of these patterns instead:

1. Manual orchestration for interactive sessions with `/swarm` and `/team task add`.
2. External scheduler that opens a leader session and seeds tasks/messages on a schedule.
3. Hook-based follow-up via `on_task_completed` / `on_task_failed` when the goal is workflow automation rather than wall-clock scheduling.
4. Separate future Pi extension if you need durable recurring jobs comparable to legacy OpenClaw cron.

## Example Mapping: `solo-founder`

Legacy shape:

- leader: `strategist`
- workers: `analyst`, `marketer`, `builder`
- models: Opus / Sonnet / Gemini / Codex
- workspace files: `GOALS.md`, `STATUS.md`, `DECISIONS.md`, `AGENTS.md`

Pi-oriented translation:

```bash
# leader = current session in the shared repo
/team spawn analyst branch shared --model proxy/claude-sonnet-4-6
/team spawn marketer fresh shared --model proxy/gemini-3.1-pro-preview
/team spawn builder branch worktree --model proxy/gpt-5.3-codex

/team task add analyst: Scan competitor moves and update GOALS.md
/team task add marketer: Find trending topics and add campaign ideas to STATUS.md
/team task add builder: Work on the top engineering task and record technical decisions in DECISIONS.md
```

Recommended supporting files:

- `GOALS.md` remains the source of priorities.
- `STATUS.md` remains the rolling team snapshot.
- `DECISIONS.md` remains append-only architecture memory.
- Role instructions move into Pi skills or role playbooks consumed at spawn time.

## Template-by-Template Notes

| Legacy Template | Suggested Pi Shape |
|---|---|
| `solo-founder` | One leader session plus 3 spawned workers with mixed `shared`/`worktree` modes |
| `content-factory` | Leader editor session plus researcher/writer/designer workers; seed tasks from `TOPICS.md` and `CALENDAR.md` |
| `morning-brief` | Small daily briefing team; best driven by an external morning scheduler that seeds recurring tasks |
| `research-team` | Leader plus long-running research workers; use `worktree` only when code changes are involved |
| `podcast-studio` | Producer-led team; task files map well to episode stages (research, script, assets) |
| `social-media` | Recurring campaign board; combine seeded tasks with external scheduling for daily cadence |
| `agent-city` | Showcase/demo team; good candidate for a sample scripted `/team spawn` bootstrap rather than a permanent template |

## What Not To Port Literally

Avoid building a compatibility layer that tries to preserve every OpenClaw field unchanged.

In particular:

- Do not force `template.json` into Pi as a hidden second config source.
- Do not invent fake static worker definitions if the team is naturally spawned on demand.
- Do not encode theme metadata into core runtime config unless the Pi UI actually consumes it.
- Do not treat cron as a required first-class field when task seeding or hooks are sufficient.

## Future Conversion Target

A later converter can likely take a legacy template and emit:

- `config.json` bootstrap
- workspace starter docs
- a spawn script for workers
- initial task JSON files
- optional hook templates

This thread intentionally stops at the mapping guide so later threads can decide the exact Pi team runtime shape.
