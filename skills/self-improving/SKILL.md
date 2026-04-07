---
name: self-improving
description: "Captures errors, corrections, knowledge gaps, and recurring best practices in .learnings/ so Pi-based agents can improve prompts, AGENTS.md rules, and reusable skills over time. Use when a task reveals a mistake, failure, missing capability, or better approach worth preserving."
---

# Self-Improving

Maintain a lightweight learning loop for Pi CLI workflows.

## When To Use

Use this skill whenever you notice one of these signals during a task:

- A command, API call, or integration fails.
- The user corrects your assumption, behavior, or output.
- You discover a project convention or technical fact you did not know.
- You find a better implementation approach than the one you started with.
- The user asks for a capability the current setup does not have yet.

## First-Use Initialization

Before logging anything, make sure the workspace root contains `.learnings/` with these files:

- `.learnings/LEARNINGS.md`
- `.learnings/ERRORS.md`
- `.learnings/FEATURE_REQUESTS.md`

Create missing files only. Never overwrite existing logs.

Use these headers:

```markdown
# Learnings

Corrections, insights, knowledge gaps, and best practices captured during work.

---
```

```markdown
# Errors

Command failures, stack traces, and integration issues.

---
```

```markdown
# Feature Requests

Capabilities requested by the user that are not yet implemented.

---
```

## Logging Rules

- Do not log secrets, tokens, private keys, or raw credential values.
- Prefer concise summaries over full transcripts or giant command dumps.
- Log immediately while the context is fresh.
- Link related files so the next agent can act quickly.
- Search existing entries first and connect repeated issues with `See Also`.

## What Goes Where

- Log command failures, exceptions, timeouts, and broken integrations in `ERRORS.md`.
- Log corrections, insights, knowledge gaps, and better approaches in `LEARNINGS.md`.
- Log missing-product-capability requests in `FEATURE_REQUESTS.md`.

## Entry IDs

Use this format:

- `LRN-YYYYMMDD-XXX`
- `ERR-YYYYMMDD-XXX`
- `FEAT-YYYYMMDD-XXX`

Use either a sequential counter or a short stable suffix for `XXX`.

## Learning Entry Format

Append entries like this to `.learnings/LEARNINGS.md`:

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: 2026-04-06T12:34:56Z
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
One-line description of the learning.

### Details
What happened, what was wrong, and what is correct now.

### Suggested Action
Specific follow-up that would prevent or reuse the learning.

### Metadata
- Source: conversation | error | user_feedback | simplify-and-harden
- Related Files: path/to/file
- Tags: tag1, tag2
- See Also: LRN-20260406-001
- Pattern-Key: optional.recurring.pattern
- Recurrence-Count: 1
- First-Seen: 2026-04-06
- Last-Seen: 2026-04-06

---
```

## Error Entry Format

Append entries like this to `.learnings/ERRORS.md`:

```markdown
## [ERR-YYYYMMDD-XXX] short title

**Logged**: 2026-04-06T12:34:56Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Failure
Short description of the failing command, tool, or API.

### Evidence
Relevant stderr, exception, or observed behavior, sanitized if needed.

### Suspected Cause
Best current explanation.

### Suggested Action
Exact remediation or next debug step.

### Metadata
- Related Files: path/to/file
- Tags: command-failure, integration
- See Also: ERR-20260404-002

---
```

## Feature Request Format

Append entries like this to `.learnings/FEATURE_REQUESTS.md`:

```markdown
## [FEAT-YYYYMMDD-XXX] short title

**Logged**: 2026-04-06T12:34:56Z
**Priority**: medium
**Status**: pending
**Area**: config

### Request
What the user wanted.

### Gap
Why the current workflow or tooling could not satisfy it directly.

### Suggested Action
What should be implemented, automated, or documented.

### Metadata
- Related Files: path/to/file
- Tags: feature-request, workflow

---
```

## Promotion Rules

Promote a learning when it is broadly useful, prevents repeat mistakes, or applies across multiple tasks.

Promotion targets:

- `AGENTS.md` for workflow rules, verification rules, or agent operating guidance.
- A standalone skill under `skills/<name>/SKILL.md` when the learning becomes a reusable workflow.
- Project docs when the learning is human-facing product or architecture knowledge.

When promoting:

1. Rewrite the learning as a short prevention rule or durable workflow.
2. Update the original log entry status to `promoted` or `promoted_to_skill`.
3. Link the destination file in the entry metadata.

## Recurring Pattern Detection

When something similar happens again:

1. Search `.learnings/` for an existing `Pattern-Key` or related wording.
2. Increment `Recurrence-Count`.
3. Update `Last-Seen`.
4. Raise priority if the issue is spreading or repeating.
5. Promote it once the pattern is clearly systemic.

A recurring pattern should be promoted aggressively when all of these are true:

- It has happened at least 3 times.
- It spans at least 2 different tasks or features.
- It appeared within a recent working window instead of being ancient history.

## Skill Extraction Criteria

Extract a learning into a skill when any of these are true:

- The user explicitly says to save it as a skill.
- The fix is non-obvious and now repeatable.
- The same pattern has multiple linked incidents.
- The solution is broadly useful outside one file or one repo.

When creating a new skill, follow the normal Agent Skills frontmatter rules and keep the skill self-contained.

## Review Cadence

Review `.learnings/` at natural breakpoints:

- Before starting a major task in the same area.
- After completing a feature or bug fix.
- When the user corrects you.
- During periodic cleanup of docs and prompts.

A quick review should answer:

- Which high-priority items are still pending?
- Which repeated issues should become AGENTS.md rules?
- Which learned workflows deserve their own skill?
