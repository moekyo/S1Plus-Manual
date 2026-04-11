# Notes: Cross-Device Sync Pull Optimization

## Current Behavior Findings

### Automatic push path
- Local changes call `updateLastModifiedTimestamp(...)`, which updates `s1p_last_modified`.
- When `triggerSync` is true, the script marks `s1p_pending_auto_sync_request` and schedules debounced background sync.
- Background auto sync eventually calls `performAutoSync(false, SYNC_LOCK_MODE_BACKGROUND)`.
- This path already keeps remote data fairly fresh after actions on device A.

### Automatic pull path
- Startup checks run through two paths:
  - `handleStartupSync()` for `syncDailyFirstLoad`
  - `handlePerLoadSyncCheck()` for `syncPerLoadCheckEnabled`
- Both eventually call `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`.
- Pulls are allowed only when version comparison decides remote is newer and no local-safety guard blocks overwrite.

### Gap causing the original problem
- `pageshow` / `visibilitychange` hooks currently only recover pending local auto-sync requests.
- They do not probe remote freshness when the local device has not changed.
- Therefore device B can stay on stale local data until:
  - next daily-first-load check
  - next full page-load check if enabled
  - or a manual sync

### Existing safety primitives worth reusing
- Global + per-mode sync locks
- Baseline state: `s1p_sync_baseline_state`
- Conflict pause state: `s1p_auto_sync_conflict_pause`
- Circuit breaker for repeated failures
- Remote optimistic concurrency check via `expectedRemoteUpdatedAt`
- Automatic read-progress-only merge in `performAutoSync()`

## Design Constraints
- Must not silently overwrite meaningful local edits on device B.
- Should minimize GitHub API cost; full fetch on every tab focus is too expensive.
- Should fit current state machine instead of duplicating sync logic.
- UI copy should clearly distinguish:
  - remote update detected
  - safe auto-pull performed
  - local changes block pull
  - conflict requires manual resolution

## Additional Edge Cases Raised During Planning

### Always-visible page left unattended
- A pure `hidden -> visible` trigger is not enough.
- If device B stays visible the whole time while the user walks away, remote updates from device A will not be noticed.
- This means foreground checks should be paired with a low-frequency visible-page probe to close the gap.

### Multiple tabs with rapid switching
- Per-tab cooldown alone is insufficient because each tab would still probe independently.
- The design needs shared cross-tab throttling, not just local in-memory throttling.
- The safest model is:
  - shared persisted probe timestamp
  - optional lightweight probe lock
  - existing global sync lock for the full sync phase

## Additional Potential Issues and Optimization Opportunities

### Remote `updated_at` is only a freshness hint
- A changed `updated_at` does not guarantee meaningful data change.
- The system should treat probe hits as “needs safe re-check”, not “must import”.

### Observed remote state and synced remote state should be separated
- `lastObservedRemoteUpdatedAt` and `lastSyncedRemoteUpdatedAt` solve different problems.
- Conflating them could cause a probed-but-not-applied remote version to be treated as already processed.

### Auto-refresh can be disruptive on thread pages
- Immediate page reload after auto-pull is safer but can interrupt reading.
- Page-type-aware refresh policy is preferable.

### Visible-page polling should be activity-aware
- Polling while the page is visible but unattended can still accumulate GitHub requests.
- Polling should slow down or pause after long inactivity.

### Unsaved local UI edits need protection
- If the settings modal is open with dirty state, an automatic refresh would be a poor experience.
- The design should treat unsaved UI edits as a “busy local session” and suppress auto-refresh.
