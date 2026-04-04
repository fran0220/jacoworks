---
name: team-builder
description: Design and operate Pi multi-agent teams with @tmustier/pi-agent-teams. Use when the user wants to create a team, spawn specialist teammates, assign coordinated tasks, or migrate an older OpenClaw-style team workflow into Pi CLI.
---

# Team Builder For Pi

Use this skill when the user wants a multi-agent workflow in Pi CLI.

This skill assumes the environment has `@tmustier/pi-agent-teams` installed:

```bash
pi install npm:@tmustier/pi-agent-teams
```

## What This Skill Does

- turns a user goal into a leader + worker team plan
- chooses when to use `fresh` vs `branch` context
- chooses when to use `shared` vs `worktree` workspace mode
- seeds clear tasks for each worker
- explains how to migrate older OpenClaw-style templates into Pi

## Recommended Workflow

### 1. Prefer the fastest path first

If the user gives a broad goal and wants autonomous execution, start with:

```bash
/swarm <goal>
```

This is the quickest way to let Pi create and coordinate a team automatically.

### 2. Use manual team setup when roles matter

For structured teams, use `/team` commands directly:

```bash
/team spawn alice
/team spawn bob branch worktree --model proxy/gpt-5.3-codex
/team task add alice: Investigate the bug and write findings
/team task add bob: Implement the fix and run verification
/team status
```

## Command Reference

### Team lifecycle

```bash
/team spawn <name> [fresh|branch] [shared|worktree] [plan] [--model <provider/model>] [--thinking <level>]
/team list
/team status [name]
/team stop <name>
/team shutdown <name>
/team shutdown
/team done
/team cleanup [--force]
```

### Communication

```bash
/team dm <name> <message>
/team broadcast <message>
/team steer <name> <message>
```

### Task management

```bash
/team task add <text>
/team task add alice: Fix the failing tests
/team task assign <id> <agent>
/team task list
/team task show <id>
/team task dep add <id> <depId>
/team task dep ls <id>
```

## How To Design A Good Team

### Pick a leader

The current Pi session usually acts as the leader.

Use the leader to:

- break the goal into worker-sized tasks
- monitor progress
- resolve blockers
- review outputs before closing the run

### Pick worker modes intentionally

Use `fresh` when a worker should start from a clean slate.

Use `branch` when a worker should inherit the current conversation context.

Use `shared` when teammates should collaborate in the same working tree.

Use `worktree` when a worker may make risky code changes or should work in isolation.

## Migration From OpenClaw Templates

OpenClaw templates used fixed agents, prompts, skills, and cron schedules.

In Pi:

- the leader is usually the current session
- workers are spawned dynamically
- role prompts should become Pi skills or workspace playbooks
- recurring cron behavior should become seeded tasks, hooks, or an external scheduler

See `skills/teams/README.md` for the field-by-field mapping guide.

## Operating Rules

- keep the team as small as possible
- assign one clear deliverable per task
- prefer task dependencies over vague cross-agent coordination
- use `worktree` only when isolation matters
- end with `/team done`, then `/team cleanup` when artifacts are no longer needed

## When To Avoid A Team

Do not spawn a team when:

- the task is a simple single-file edit
- the user wants a direct answer rather than delegated work
- coordination overhead would exceed the work itself
