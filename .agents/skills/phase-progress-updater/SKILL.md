---
name: phase-progress-updater
description: Keep phase-based work tracking accurate and current across planning and progress documents. Use when Codex is working through phased tasks, milestones, checklists, implementation plans, research plans, or multi-step execution and must update the relevant text after each completed phase with precise completion status, detailed progress, validation results, remaining work, blockers, and next steps.
---

# Phase Progress Updater

## Overview

Use this skill to keep phase-tracking documents synchronized with real execution. After each phase completes, update the relevant planning and reporting text immediately so the written record matches the actual state of the work.

## Core Rule

Do not mark a phase complete in conversation only. When a phase finishes, update the corresponding tracking text before moving on.

## Tracking Files

Use the existing files if they already exist. If tracking files do not exist and persistent phase reporting is clearly needed, create the minimum useful set.

Preferred responsibilities:

- `task_plan.md`: source of truth for phase checklist, current status, decisions, and blockers
- `progress.md` or phase report file: detailed execution progress and completion notes
- `notes.md`: research findings, discoveries, constraints, and technical observations
- deliverable-specific docs: only update when phase completion changes the real deliverable state

If the repo already uses different names, follow the repo's naming instead of forcing these defaults.

## Workflow

### 1. Identify the tracking surface

Before substantial work:

- find the files that currently track plan, progress, findings, and deliverable state
- decide which files must be updated at the end of each phase
- keep the write set small and intentional

### 2. Define phase boundaries

Treat a phase as complete only when its intended output exists and its key validation has run or has been explicitly skipped with a reason.

Examples of valid phase completion:

- planning phase: scope, phases, and open questions are documented
- research phase: findings are captured and synthesized
- implementation phase: code changes are made and described
- verification phase: checks are run and outcomes are recorded

### 3. Update documents immediately after phase completion

When a phase completes, update all relevant text in the same work session:

- mark the phase complete
- update the current phase / status line
- describe what was finished
- record evidence or validation
- record what remains
- record blockers, risks, or follow-up items

Do not defer these updates to the end of the entire task unless the user explicitly wants a single final write-up.

### 4. Keep reports factual and granular

Write only what is true now.

Always distinguish:

- completed
- partially completed
- not started
- blocked
- deferred

Never blur "implemented", "planned", and "verified" into one statement.

### 5. Check consistency before finishing the phase update

Before moving on, verify that:

- checklist state matches reality
- status summary matches checklist state
- progress narrative does not overclaim completion
- remaining work is still listed if work remains
- validation results are explicitly present or explicitly unavailable

## Required Content for Each Phase Update

Every phase-completion update should capture these items when relevant:

- phase name
- final status for that phase
- exact work completed
- important files or artifacts created or changed
- validation performed and outcomes
- known limitations or incomplete areas
- blockers or risks
- next phase or next concrete step

If progress can be estimated meaningfully, include it. Use simple, defensible language such as:

- `Overall progress: 2 of 5 phases completed`
- `Implementation progress: major path complete, verification pending`

Do not invent percentages unless the plan structure makes them meaningful.

## Writing Standard

Reports must be:

- comprehensive: cover the real completed scope, not just the headline
- precise: separate facts from intentions
- detailed: include evidence, not vague summaries
- concise enough to scan: avoid filler and repetition

Good:

- `Phase 2 complete. Captured the current sync trigger paths, identified the missing remote freshness probe, and documented reuse constraints around locks, baseline state, and conflict pause.`

Bad:

- `Research done. Everything looks good.`

## Recommended Phase Update Pattern

Use this pattern when updating progress text:

1. Status
2. What was completed
3. Validation or evidence
4. Remaining work
5. Next step

Example:

```markdown
## Phase 3 Update

- Status: Completed
- Completed:
  - Added remote probe state helpers
  - Added guarded foreground metadata check flow
  - Reused existing startup sync execution path for full reconciliation
- Validation:
  - Syntax check passed
  - Multi-tab cooldown behavior reviewed against existing lock model
- Remaining:
  - Visible-page polling not implemented yet
  - Refresh policy still needs thread-page handling
- Next:
  - Implement visible-page polling and activity-aware backoff
```

## File-Specific Guidance

### `task_plan.md`

Update:

- phase checkboxes
- current status section
- key decisions
- errors encountered

Do not turn `task_plan.md` into a long narrative log. Keep it structured and current.

### `progress.md` or equivalent

Use for:

- detailed phase completion reports
- chronological progress entries
- validation outcomes
- blockers and follow-up actions

This is the right place for the detailed report the user asked for.

### `notes.md`

Use for:

- research findings
- technical facts
- discovered constraints
- comparisons and tradeoffs

Do not duplicate long narrative progress here unless the finding itself matters for future work.

## Anti-Patterns

Do not:

- mark a phase complete before updating the tracking text
- claim verification happened when it did not
- hide skipped validation
- replace detailed progress with generic success language
- overwrite prior progress in a way that loses meaningful history
- update only one file when multiple tracking files are clearly in use

## Completion Checklist

Before closing a phase, confirm:

- the phase completion is reflected in the relevant files
- the written report matches the actual outputs
- validation status is explicit
- remaining work is still visible
- the next step is clear

If any of these are missing, the phase update is not complete yet.
