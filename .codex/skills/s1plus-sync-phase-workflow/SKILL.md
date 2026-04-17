---
name: s1plus-sync-phase-workflow
description: Execute the phased S1 Plus sync and multi-tab redesign workflow in this repository. Use when asked to continue a specific sync/multi-tab redesign phase, implement one phase without spilling into later phases, map a reported sync symptom to the right phase, keep the redesign docs' status/progress/validation in sync with actual code changes, or prepare/reuse the repository's copyable phase-execution prompt.
---

# S1Plus Sync Phase Workflow

## Overview

Use this skill to move the S1 Plus sync and multi-tab redesign forward one phase at a time while keeping the tracking docs truthful and current.

Default to the smallest useful document set. Treat multi-tab behavior as a first-class constraint. Update the root redesign doc and the active phase doc before considering the phase work done.

## Short Invocation Contract

After this skill exists, the user should usually only need a short request such as:

- `使用 $s1plus-sync-phase-workflow 执行 Phase 1`
- `使用 $s1plus-sync-phase-workflow 继续 Phase 4`
- `使用 $s1plus-sync-phase-workflow 修 Phase 5，并更新文档状态`
- `使用 $s1plus-sync-phase-workflow 看这个现象应该落在哪个 phase`

Treat those short requests as sufficient.

Do not require the user to repeat the long prompt unless one of these is true:

1. the environment cannot reliably invoke the skill
2. the user wants a copyable prompt for another model or another tool
3. the user wants to override the skill's normal defaults for scope, reading set, or reporting

## Required Read Set

Always read:

- `../../../sync_multitab_review_and_redesign.md`
- the active phase doc

Read only if needed:

- `../../../sync_multitab_redesign/coverage_matrix.md`
- `../../../sync_multitab_redesign/problem_catalog.md`
- `../../../sync_multitab_redesign/architecture_principles.md`

Avoid loading `../../../discussion.md` by default. Read it only when you need the original discussion wording or need to confirm that a subtle edge case was already discussed.

## Phase Selection

If the user names a phase, use that phase directly.

If the user reports a symptom instead of naming a phase, use `../../../sync_multitab_redesign/coverage_matrix.md` to map the symptom to the right phase. Ask a concise clarification only when the mapping is genuinely ambiguous and the risk of choosing wrong is non-trivial.

Phase docs:

- `Phase 1`: `../../../sync_multitab_redesign/phases/phase_1_startup_and_trigger_model.md`
- `Phase 2`: `../../../sync_multitab_redesign/phases/phase_2_read_progress_denoising.md`
- `Phase 3`: `../../../sync_multitab_redesign/phases/phase_3_sync_state_layering.md`
- `Phase 4`: `../../../sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md`
- `Phase 5`: `../../../sync_multitab_redesign/phases/phase_5_cleanup_provenance_and_manual_sync.md`
- `Phase 6`: `../../../sync_multitab_redesign/phases/phase_6_interaction_and_copy.md`
- `Phase 7`: `../../../sync_multitab_redesign/phases/phase_7_diagnostics_and_regression.md`

## Phase Defaults

When the user names a phase without extra detail, assume the default scope below.

### Phase 1 default scope

- unify trigger source naming
- formalize the startup orchestrator
- keep startup-only checks inside the freshness window
- allow stale startup only to defer or compensate `daily_startup`
- keep manual sync separate from daily first auto sync
- align startup-related pending indicator wording with the actual source

Do not use Phase 1 to:

- rewrite read-progress persistence
- redesign visible poll behavior
- redesign cleanup provenance
- redesign the nav `处理` interaction

### Phase 2 default scope

- make read-progress persistence happen only after real reading is established
- keep background-opened tabs passive by default
- remove synthetic initial fallback writes
- add read-progress provenance
- expose pending/debounce signals for later probe logic

### Phase 3 default scope

- split foreground follow-up from startup mode
- introduce `soft block / hard pause`
- narrow global conflict-pause writes
- define global vs tab-local vs thread-local state boundaries

### Phase 4 default scope

- add a probe gate for `foreground_resume` and `visible_poll`
- explicitly check pending writes, debounce windows, and initialization noise
- downgrade visible-poll handling for low-severity cases
- add retry/backoff behavior that waits for local state to settle

### Phase 5 default scope

- replace `s1p_pending_cleanup_info` with structured provenance
- distinguish auto cleanup from manual single/group delete
- add strict cleanup-shortcut guards
- prevent cleanup from other threads contaminating the current page's handling path

### Phase 6 default scope

- rewrite copy for auto refresh / auto pull / persistent banners
- make it clear that nav `处理` triggers global manual sync
- show cleanup provenance and original trigger cause without letting one overwrite the other

### Phase 7 default scope

- expand diagnostic fields and result codes
- make sync reasons and block reasons directly observable
- establish multi-tab regression coverage as a standing baseline

## Execution Workflow

1. Identify the active phase and read only the minimum required docs.
2. Restate the current phase scope in terms of:
   - goal
   - covered problem IDs or user symptoms
   - non-goals for this turn
3. Implement only the current phase's intended output.
4. Preserve already-fixed behavior from earlier phases.
5. Do not pull in later-phase work unless it is a tiny prerequisite that unblocks the current phase. If that happens, say so explicitly and keep it minimal.
6. Validate the phase with the best checks available in this environment.
7. Update the redesign docs immediately after the implementation state is known.
8. Report the phase result as `Completed`, `In Progress`, or `Blocked` with a short explanation.

## Document Update Contract

After every substantial phase pass, update the tracking docs in the same work session.

### Root Doc

Update `../../../sync_multitab_review_and_redesign.md`.

If it does not already contain a concise implementation progress section, add one.

Record at least:

- current phase
- per-phase status
- overall progress such as `2 / 7 phases completed`
- next step

### Active Phase Doc

Update the current phase doc.

If it does not already contain an execution progress section, add one.

Record at least:

- `状态`
- `本轮完成`
- `涉及文件`
- `验证`
- `剩余工作`
- `风险 / 限制`
- `下一步`

### Reference Docs

Update these only when the underlying facts really changed:

- `../../../sync_multitab_redesign/problem_catalog.md`
- `../../../sync_multitab_redesign/architecture_principles.md`
- `../../../sync_multitab_redesign/coverage_matrix.md`

## Status Rules

Use these statuses consistently:

- `Not Started`
- `In Progress`
- `Completed`
- `Blocked`
- `Deferred`

Do not mark a phase `Completed` unless:

- the intended output for that phase exists
- the key validation ran, or the doc explicitly records why it could not run

If only part of the phase was done, keep the phase at `In Progress` and list the remaining work plainly.

Do not write planned work as if it were already complete.

## Validation Rules

Run the strongest checks that fit the phase.

Examples:

- syntax or static checks for code changes
- targeted local verification commands
- explicit browser or multi-tab manual test recommendations when automation is unavailable

Always record:

- what was validated
- what passed
- what could not be validated here

## Guardrails

- Treat multi-tab behavior as a priority constraint, not as an edge case.
- Avoid unrelated refactors while inside a phase.
- Avoid "just one more fix" drift into later phases.
- Do not change docs in a way that overstates progress.
- If the current phase touches prompts or workflow docs, keep `../../../sync_multitab_phase_execution_prompt.md` aligned with the real workflow.
- Prefer using `phase-progress-updater` behavior: update tracking text immediately after phase progress changes.
- Prefer the skill's built-in defaults over asking the user to restate long instructions that are already encoded here.

## When The User Wants A Copyable Prompt

If the user asks for a reusable prompt instead of direct implementation, use `../../../sync_multitab_phase_execution_prompt.md` as the canonical copyable prompt and keep it aligned with this skill's workflow.

## Final Reporting

End each run by stating:

1. the current phase result
2. the main code changes
3. validation outcome
4. which docs were updated
5. remaining work, risks, and the next phase or next step
