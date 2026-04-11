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

## Phase 3 Implementation Notes

### Probe throttling model implemented in this phase
- Added a shared cross-tab probe cooldown helper around `s1p_remote_probe_shared_cooldown`:
  - current window is `45s`
  - any successful metadata probe updates `lastObservedAt`, `lastObservedRemoteUpdatedAt`, and `checkedBy`
- Added a same-tab in-memory cooldown for foreground probes:
  - current window is `12s`
  - this smooths repeated `visibilitychange` flaps before persisted shared state is re-read
- Added `recordRemoteProbeObservation(...)` so the persisted “what remote snapshot was just seen” write stays consistent between the probe info key and the shared cooldown key.

### Probe lock behavior chosen for Phase 3
- The Phase 1 raw lock storage helpers were extended with `acquireRemoteProbeLock(...)`.
- Acquisition now uses the same short verification pattern as the existing sync locks:
  - write candidate owner/timestamp
  - wait the standard verification delay
  - re-read storage and confirm this tab still owns the latest lock value
- This keeps probe locking lightweight, but materially improves rapid tab-switch correctness over a plain last-write-wins write.

### Foreground probe execution path implemented
- Added `checkRemoteFreshnessOnForeground(reason)` with these guard layers:
  - remote sync enabled and credentials complete
  - `syncCheckOnReturnToForeground === true`
  - no active conflict pause
  - no open circuit breaker
  - no active sync lock
  - no in-flight foreground probe or foreground follow-up sync
  - same-tab cooldown elapsed
  - shared cross-tab cooldown elapsed
  - probe lock acquired
- The probe itself only calls `fetchRemoteData({ metadataOnly: true })`.
- After a successful metadata fetch:
  - the newly observed remote `updatedAt` is persisted
  - if it matches the last synced remote timestamp, the runner exits as `unchanged`
  - otherwise it calls `requestForegroundRemoteSyncCheck(...)`

### Follow-up sync reuse choice
- Added `requestForegroundRemoteSyncCheck(reason)` instead of introducing new sync resolution logic.
- The helper acquires the existing startup sync lock, starts the normal startup lock heartbeat, and delegates the real decision to:
  - `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`
- This means Phase 3 already reuses current protections for:
  - local-newer startup protection
  - conflict pause handling
  - circuit breaker behavior
  - read-progress-only auto-merge
- What remains for later phases is trigger wiring and UX policy, not sync correctness logic.

### Validation added in Phase 3
- Added `scripts/test-foreground-remote-probe.js` to verify:
  - unchanged remote metadata exits without follow-up sync
  - changed remote metadata triggers the safe follow-up sync path
  - shared cooldown suppresses repeated probes
  - probe lock rejects a second owner while active
  - conflict pause / circuit breaker / active sync lock guard conditions all skip before network work

### Limitations intentionally left for later phases
- Phase 3 does not yet bind the new runner to `pageshow` / `visibilitychange`.
- Phase 3 does not yet add visible-page polling, user-activity backoff, diagnostics surface, or page-type-aware refresh behavior.
- Because trigger wiring is still pending, the new runner currently exists as infrastructure plus verified behavior, not as user-visible automatic foreground probing yet.

## Phase 4 Implementation Notes

### Trigger integration scope chosen for this phase
- Added a small trigger-layer bridge instead of mixing new probe logic directly into the existing listeners:
  - `triggerForegroundRemoteFreshnessProbe(...)`
  - `handlePendingAutoSyncRecoveryVisibilityChange(...)`
  - `handlePendingAutoSyncRecoveryPageShow(...)`
- This keeps Phase 4 focused on event wiring and preserves Phase 3 as the single place where probe guard conditions and follow-up sync reuse are decided.

### Listener behavior after Phase 4
- `visibilitychange` now does two things when the page becomes visible:
  - first runs the original `recoverPendingAutoSyncIfNeeded()`
  - then triggers the guarded metadata-only foreground probe
- `pageshow` now keeps the original recovery behavior for every restore/load path, but only bfcache restores (`event.persisted === true`) trigger the extra foreground probe.
- Non-persisted `pageshow` intentionally stays recovery-only:
  - startup sync and per-load sync already cover normal fresh page loads
  - probing there would add redundant remote metadata checks on top of existing load-time sync paths

### Safety and noise-control choices preserved
- The Phase 4 bridge does not bypass any of the Phase 3 protections:
  - same-tab cooldown
  - shared cross-tab cooldown
  - lightweight probe lock
  - active sync lock checks
  - conflict pause / circuit breaker guards
- The trigger bridge wraps probe execution with local error handling so listener callbacks do not surface unhandled promise rejections if a metadata probe throws unexpectedly.
- Because `pageshow` and `visibilitychange` may both occur during a foreground restore, Phase 4 still relies on the existing cooldown/lock model to suppress duplicate network work rather than inventing a second event-level dedupe path.

### Validation added in Phase 4
- Added `scripts/test-foreground-trigger-integration.js` to verify:
  - listener wiring uses the dedicated Phase 4 handlers
  - visible `visibilitychange` runs recovery before the guarded probe
  - hidden `visibilitychange` exits without recovery or probe work
  - persisted `pageshow` runs recovery plus probe
  - non-persisted `pageshow` remains recovery-only

### Remaining limitations after Phase 4
- Always-visible tabs still do not notice remote changes without a foreground-style trigger; that gap is intentionally left for Phase 5 visible-page polling.
- Phase 4 does not yet change post-sync refresh policy, diagnostics output, or user-facing status copy.
