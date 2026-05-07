# Notes: Multi-Tab Sync Performance Architecture Refactor

## Scope
- Title sync status cross-tab protocol:
  - presence storage
  - owner lease selection
  - GM/localStorage change listeners
  - title display runtime
- Background push scheduler:
  - pending recovery
  - lock-collision retry
  - newer-dirty follow-up scheduling
- Diagnosis and validation:
  - update performance diagnosis document
  - add/extend regression tests

## Initial Architecture Direction
- Presence should be partitioned by tab id to avoid whole-object lost updates.
- A lightweight presence signal key should notify other tabs that the partitioned records changed.
- Owner election should preserve an unexpired owner lease even when recent-activity ordering changes.
- Background retry should re-enter the shared debounce scheduler instead of creating a per-tab timer whenever possible.

## Phase 2 Findings
- Added per-tab presence keys under `s1p_title_sync_status_tab:`.
- Added `s1p_title_sync_status_presence_signal` so listeners no longer need to observe a shared aggregate object.
- Kept the legacy aggregate presence key readable/listened for rolling upgrade compatibility, but new writes no longer depend on it.
- Added owner token/generation verification so a tab only treats a lease as acquired when the verified owner still matches the same write context.

## Phase 3 Findings
- Extended the shared background debounce scheduler with a forced-delay path for retry scheduling.
- `scheduleBackgroundSyncRetry()` now first queues retry through the shared scheduler; the per-tab timer remains only as a fallback when shared scheduling cannot be used.
- Added test coverage that `background_retry` uses shared owner timer dueAt instead of independent per-tab retry timers.

## Phase 4 Findings
- Updated the performance diagnosis document from patch progress to full architecture refactor progress.
- Added regression coverage for partitioned title presence and shared retry forced-delay scheduling.
- Remaining validation requirement is real browser multi-tab testing with browser task manager and DevTools Performance.

## Phase 5 Findings
- `node --check S1Plus.js` passed.
- Sync-related regression tests under `sync-across-multiple-tab/scripts` passed.
- The expected `metadata fetch exploded` console output belongs to the foreground probe failure diagnostics test and still ends in PASS.

## Debug Removal
- Removed the temporary `window.__s1pPerfDebug` interface, `S1P-PERF` logging, and performance event aggregation from production code after the diagnosis was complete.
