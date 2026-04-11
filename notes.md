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

## Phase 1 Implementation Notes

### Settings default and migration behavior
- Added `syncCheckOnReturnToForeground` to `defaultSettings`.
- New installs now default this setting to `true`.
- Existing saved settings that do not yet contain the new key migrate conservatively:
  - enable it only when remote sync is already enabled and auto sync is not disabled
  - otherwise persist `false`
- The optional advanced polling sub-setting was intentionally deferred:
  - it is not needed for Phase 1 storage groundwork
  - it should be introduced alongside real polling behavior in a later phase

### Probe state storage layout
- Added dedicated persisted keys instead of overloading baseline state:
  - `s1p_last_remote_probe_info`
  - `s1p_remote_probe_shared_cooldown`
  - `s1p_remote_probe_lock`
- `s1p_last_remote_probe_info` currently stores:
  - `lastObservedRemoteUpdatedAt`
  - `lastObservedAt`
  - `lastSyncedRemoteUpdatedAt`
- Shared cooldown state keeps cross-tab probe freshness separate from “synced” state.
- Lock storage is lightweight and independent from the main sync locks so later probe requests can throttle metadata probes without interfering with full sync ownership.

### Integration choices made in Phase 1
- `setSyncBaselineState(...)` now updates `lastSyncedRemoteUpdatedAt` when a reconciled remote timestamp is known.
- Remote target changes and remote-sync disable now clear probe info, shared cooldown, and probe lock together with the existing sync baseline/runtime cleanup.
- The Phase 1 helpers are read/write only groundwork:
  - no foreground probe execution path was added yet
  - no `pageshow` / `visibilitychange` / visible polling behavior was changed yet

### Validation added
- Expanded `tests/settings-migration/fixtures.json` to cover:
  - new-install default behavior
  - existing-install migration when remote sync is enabled
  - existing-install migration when remote sync is disabled
- Added `scripts/test-remote-probe-state.js` to validate:
  - probe info merge semantics
  - shared cooldown normalization
  - probe lock write/validate/release behavior
  - probe state clearing
  - baseline-to-`lastSyncedRemoteUpdatedAt` linkage

## Phase 2 Implementation Notes

### Sync settings UI scope chosen for this phase
- Added only the primary foreground freshness toggle:
  - `syncCheckOnReturnToForeground`
- Kept the optional visible-page polling sub-setting deferred:
  - the polling behavior does not exist yet
  - exposing it now would create a UI contract ahead of the actual runtime implementation

### Sync tab wiring completed
- Added the new control to the sync tab alongside the existing startup-style sync toggles.
- The description now positions it as:
  - a lightweight remote freshness probe on foreground return / bfcache restore / visible recovery
  - a supplement to daily-first-load and per-page-load checks
  - not a direct remote import path
- The new toggle is now wired into:
  - modal initial hydration from `getSettings()`
  - dirty-state tracking before save
  - save persistence through the sync settings save button
  - reset-to-defaults handling when clearing settings data
  - cross-tab settings refresh via `refreshSyncTabControlsFromSettings()`

### Integration constraints preserved
- The new control uses `data-s1p-sync-control`, so it follows the existing remote-sync master toggle enable/disable behavior.
- No runtime probe behavior was added in Phase 2:
  - no new network calls
  - no trigger changes
  - no sync-engine changes
- This keeps Phase 2 limited to UI/state wiring and avoids partially shipping probe behavior before the Phase 3/4 execution paths exist.

### Validation added in Phase 2
- Added `scripts/test-sync-settings-ui.js` to statically verify the key Phase 2 wiring points:
  - sync-tab control exists
  - initial load binds to `syncCheckOnReturnToForeground`
  - dirty tracking includes the new toggle
  - save path persists the value
  - reset path restores the default
  - cross-tab refresh rehydrates the control
