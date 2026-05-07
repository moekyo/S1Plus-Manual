# Task Plan: Multi-Tab Sync Performance Architecture Refactor

## Goal
Replace the storm-prone cross-tab title status and background push recovery paths with partitioned presence, stable owner leases, shared retry scheduling, and explicit validation coverage.

## Phases
- [x] Phase 1: Define scope and tracking files
- [x] Phase 2: Refactor title status presence/owner protocol
- [x] Phase 3: Move background retry/recovery fully onto shared scheduler
- [x] Phase 4: Update tests and diagnosis/progress docs
- [x] Phase 5: Run regression checks and summarize residual risks

## Key Questions
1. Can title presence stop using a shared read-modify-write object without losing cross-tab visibility?
2. Can owner election avoid tab churn while still recovering from closed/stalled tabs?
3. Can background retry/follow-up avoid per-tab timers and remain compatible with existing shared debounce cleanup?
4. Which potential issues remain after the architecture refactor?

## Decisions Made
- Keep the prior patch as a baseline, but move title presence toward per-tab records plus a shared signal key.
- Keep legacy aggregate presence readable for compatibility, but stop depending on it as the authoritative write path.
- Preserve the current shared debounce state key for background push scheduling; extend it rather than introducing a second scheduler.

## Errors Encountered
- None yet.

## Status
**Completed** - architecture refactor implemented and sync-related regression tests passed.

## Validation
- `node --check S1Plus.js`
- `node sync-across-multiple-tab/scripts/test-title-sync-status.js`
- `node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js`
- `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
- `node sync-across-multiple-tab/scripts/test-settings-migration.js`
- `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
- `node sync-across-multiple-tab/scripts/test-remote-probe-state.js`
- `node sync-across-multiple-tab/scripts/test-foreground-remote-probe.js`
- `node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
- `node sync-across-multiple-tab/scripts/test-visible-remote-polling.js`
- `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
- `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
- `node sync-across-multiple-tab/scripts/test-foreground-probe-diagnostics-feedback.js`
- `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
- `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
- `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
- `node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js`
- `node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
- `node sync-across-multiple-tab/scripts/test-phase6-interaction-copy.js`

## Residual Risks
- Needs real Tampermonkey/Greasemonkey multi-tab validation with browser task manager and DevTools Performance.
- Rolling upgrade with old script instances may still involve the legacy aggregate presence key until those tabs reload.
- Partitioned presence relies on `GM_listValues`; Tampermonkey supports it, but another script manager without it would need a per-tab index fallback.
