# Sync Development Task Checklist

## Goal
Turn the cross-device auto-pull design into an implementation-ready checklist with clear module boundaries, dependencies, and acceptance criteria.

## Execution Status
- Current status: Phase 6 completed on 2026-04-12.
- Overall progress: 6 of 9 phases completed.
- Validation completed:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
  - `node scripts/test-safe-sync-execution.js`
- Next step: Phase 7, add page-type-aware refresh policy without disrupting active reading or dirty settings edits.

## Phase 1: State and Settings [Completed]

### Task 1. Add new settings [Completed]
- Added `syncCheckOnReturnToForeground`
- Deferred optional advanced setting until visible-page polling is implemented:
  - `syncVisiblePagePollingEnabled`
- Implemented migration behavior:
  - new installs default to `true`
  - existing saved settings without this key migrate to `true` only when remote sync is enabled and auto sync is not disabled
  - other migrated installs persist `false`

Acceptance:
- [x] Settings normalize correctly in `buildNormalizedSettings()`
- [x] New installs get the intended default
- [x] Existing installs migrate safely

### Task 2. Add probe state storage [Completed]
- Added persisted probe info state:
  - `lastObservedRemoteUpdatedAt`
  - `lastObservedAt`
  - `lastSyncedRemoteUpdatedAt`
- Added shared cooldown data
- Added lightweight probe lock key and state clear helper
- Wired `lastSyncedRemoteUpdatedAt` to `setSyncBaselineState(...)`
- Clear probe state when remote target changes or remote sync is disabled

Acceptance:
- [x] Probe state can be read/written safely
- [x] “Observed” and “synced” remote states are clearly separated

## Phase 2: Settings UI [Completed]

### Task 3. Add sync settings controls [Completed]
- Add `启用回到前台时检查云端更新`
- If exposing polling separately, add advanced sub-setting for visible-page polling
- Update descriptions to explain:
  - foreground check
  - visible-page polling
  - relation to existing startup checks

Acceptance:
- [x] Setting appears in sync tab
- [x] Save/load/reset all work
- [x] Cross-tab settings refresh updates the new controls

## Phase 3: Probe Infrastructure [Completed]

### Task 4. Implement remote probe helpers [Completed]
- `getLastRemoteProbeInfo()`
- `setLastRemoteProbeInfo()`
- shared cooldown helpers
- probe lock helpers

Acceptance:
- [x] Shared cooldown suppresses repeated probes across tabs
- [x] Probe lock prevents simultaneous metadata requests during rapid tab switching

### Task 5. Implement foreground probe runner [Completed]
- `checkRemoteFreshnessOnForeground(reason)`
- Use `fetchRemoteData({ metadataOnly: true })`
- Compare against:
  - baseline remote timestamp
  - last observed remote timestamp
- On change, schedule safe full sync check

Acceptance:
- [x] Unchanged remote exits quietly
- [x] Changed remote triggers safe follow-up sync path
- [x] Conflict pause / circuit breaker / active lock conditions skip correctly

## Phase 4: Trigger Integration [Completed]

### Task 6. Integrate `pageshow` and `visibilitychange` [Completed]
- Extend existing hooks
- Avoid interfering with current pending local auto-sync recovery

Acceptance:
- [x] Returning to a hidden tab can trigger guarded remote freshness check
- [x] bfcache restore can trigger guarded remote freshness check
- [x] No request storm under rapid repeated visibility transitions

## Phase 5: Visible-Page Polling [Completed]

### Task 7. Add visible-page polling scheduler [Completed]
- Start when page becomes visible
- Stop when page becomes hidden
- Probe every 180-300 seconds while active
- Reuse same metadata-only probe path
- Implemented with:
  - `scheduleVisibleRemoteFreshnessPolling(...)`
  - `stopVisibleRemoteFreshnessPolling(...)`
  - `syncVisibleRemoteFreshnessPollingForCurrentState(...)`
- Current active polling interval:
  - `240s`

Acceptance:
- [x] Always-visible pages can eventually notice remote changes
- [x] Polling never performs full remote fetch directly

### Task 8. Add activity-aware polling backoff [Completed]
- Track recent user activity:
  - pointer
  - keyboard
  - scroll
- Degrade polling interval after long inactivity
- Optionally pause after very long inactivity
- Implemented with:
  - `lastUserInteractionAt`
  - `handleVisibleRemoteFreshnessUserActivity(...)`
  - `pointerdown` / `keydown` / `scroll` listeners
- Current backoff policy:
  - degrade from `240s` to `720s`
  - trigger degradation after `15m` without activity
  - new interaction immediately restores the active interval

Acceptance:
- [x] Visible but unattended pages reduce request frequency
- [x] New interaction restores normal polling interval

## Phase 6: Safe Sync Execution [Completed]

### Task 9. Reuse existing sync engine for follow-up execution [Completed]
- Add orchestration function such as:
  - `requestForegroundRemoteSyncCheck(reason)`
- Reuse startup lock path
- Continue to delegate final decision to `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`
- Implemented with:
  - `runStartupModeAutoSyncCheck(...)`
  - `requestForegroundRemoteSyncCheck(...)` now reusing the shared startup-path execution helper
  - `handleStartupSync()` and `handlePerLoadSyncCheck()` now reusing the same helper instead of open-coding their own startup-lock execution sequence

Acceptance:
- [x] No second sync decision engine is introduced
- [x] Existing safety behavior remains intact:
  - local-newer protection
  - conflict pause
  - read-progress merge

## Phase 7: Refresh Policy

### Task 10. Add page-type-aware post-sync behavior
- Lightweight list pages:
  - allow direct reload
- Thread pages:
  - prefer delayed/idle reload or soft prompt
- Settings modal with dirty edits:
  - never auto-reload

Acceptance:
- Auto-pull no longer feels unnecessarily disruptive on thread pages
- Unsaved settings edits are never blown away by auto-refresh

## Phase 8: Diagnostics and UI Feedback

### Task 11. Extend diagnostics
- Add:
  - `lastProbeTimestamp`
  - `lastProbeRemoteUpdatedAt`
  - `lastSyncedRemoteUpdatedAt`
  - `lastProbeResult`
  - `lastProbeTriggeredSync`
  - `lastProbeTriggeredSyncResult`

Acceptance:
- Probe layer and execution layer can be debugged independently

### Task 12. Update user-facing messages
- Add low-noise copy for:
  - remote changed and auto-pull succeeded
  - remote changed but local edits block pull
  - conflict detected
  - skipped due to pause / cooldown / active sync

Acceptance:
- Messages clearly explain why data did or did not update

## Phase 9: Testing

### Task 13. Functional tests
- Device A pushes, device B returns to tab
- Device A pushes while device B stays visible
- Device B has local unsynced edits
- Multiple tabs rapidly switch
- Multiple tabs detect change together
- Conflict pause active
- Circuit breaker active
- Metadata changes without meaningful content change

Acceptance:
- Expected sync behavior matches `sync_implementation_plan.md`

### Task 14. Regression tests
- Daily-first-load behavior unchanged
- Per-page-load behavior unchanged
- Pending local auto-push recovery unchanged
- Manual sync unchanged

Acceptance:
- No regressions to current sync behavior

## Recommended Build Order

1. State and settings
2. Settings UI
3. Probe helpers
4. Foreground triggers
5. Visible-page polling
6. Safe sync execution reuse
7. Refresh policy
8. Diagnostics and copy
9. Testing and polish
