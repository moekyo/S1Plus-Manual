# Notes: Cross-Device Sync Pull Optimization

## 2026-04-21 Runtime Cleanup Note

- “自动检查云端更新”的运行时链路已从 `S1Plus.js` 删除。
- 保留内容：
  - 设置页里的三段式控件、问号说明、现有文案
  - `syncPerLoadCheckEnabled`
  - `syncCheckOnReturnToForeground`
- 当前这两个设置只用于 UI 回显和保存，不再触发：
  - 每次加载检查
  - 首次可见检查
  - 回到前台检查
  - visible poll
- 当前仍保留实际运行行为的自动同步来源只有：
  - `daily_startup`
  - `background_push`
  - `manual_sync`
- 下方其余笔记保留为历史设计记录，不再代表当前运行时实现。

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
- The first shipped UI only introduced the primary foreground freshness toggle:
  - `syncCheckOnReturnToForeground`
- After the later polling/refresh phases landed, the settings UI was consolidated into one mutually exclusive control:
  - `自动检查云端更新`
  - `关闭`: disable per-load checks plus foreground/visible-page checks
  - `每次加载`: map to `syncPerLoadCheckEnabled`
  - `回到前台`: map to `syncCheckOnReturnToForeground`, including visible-page low-frequency polling
- Legacy saved data that had both booleans enabled is now normalized down to a single effective mode (`每次加载`) so the stored state matches the new UI contract.

### Sync tab wiring completed
- Added the new control to the sync tab alongside the existing startup-style sync toggles.
- The description now positions it as:
  - a lightweight remote freshness probe on foreground return / bfcache restore / visible recovery
  - a supplement to daily-first-load and per-page-load checks
  - not a direct remote import path
- The shipped control is now wired into:
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

## Phase 5 Implementation Notes

### Visible-page polling runtime added
- Added runtime state for visible-page probing:
  - `lastUserInteractionAt`
  - `visibleRemoteProbeTimer`
  - `currentVisibleProbeIntervalMs`
- Added scheduler helpers:
  - `scheduleVisibleRemoteFreshnessPolling(...)`
  - `stopVisibleRemoteFreshnessPolling(...)`
  - `syncVisibleRemoteFreshnessPollingForCurrentState(...)`
- The polling path reuses `checkRemoteFreshnessOnForeground(...)`:
  - still metadata-only at the probe layer
  - still hands off any positive hit to the same safe follow-up sync path

### Activity-aware backoff choices implemented
- Added `handleVisibleRemoteFreshnessUserActivity(...)` plus pointer, keyboard, and scroll listeners.
- Current rollout policy:
  - active visible-page polling every `240s`
  - degrade to `720s` after `15m` of no interaction
  - new interaction restores the active interval immediately
- This closes the “always-visible device B” gap without keeping unattended tabs on an unnecessarily aggressive metadata cadence.

### Runtime reconciliation completed
- Visible-page polling now re-syncs with current settings and visibility when:
  - foreground recovery hooks fire
  - sync settings are saved
  - cross-tab settings refresh updates local controls
- Hidden pages stop polling immediately instead of relying on timer callbacks to discover visibility changes later.

### Validation added in Phase 5
- Added `scripts/test-visible-remote-polling.js` to verify:
  - scheduler start/stop behavior
  - polling execution through the existing foreground probe path
  - hidden-page stop behavior
  - inactivity backoff and post-idle recovery

## Phase 6 Implementation Notes

### Startup-path execution reuse is now explicit
- Added `runStartupModeAutoSyncCheck(...)` as the shared execution helper for any safe sync check that must run under the startup sync lock.
- The helper now owns:
  - startup lock acquisition
  - startup lock heartbeat lifecycle
  - optional pre-execution short-circuit checks
  - the final call to `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`
  - guaranteed lock release and optional post-release hooks

### What changed in call-site structure
- `requestForegroundRemoteSyncCheck(...)` now reuses `runStartupModeAutoSyncCheck(...)` instead of open-coding its own startup-lock / heartbeat / `performAutoSync(...)` sequence.
- `handlePerLoadSyncCheck()` now uses the same helper, so page-load sync checks and positive probe follow-up sync checks share the same execution skeleton.
- `handleStartupSync()` now also uses the shared helper, with a `beforePerform` hook that re-checks `s1p_last_daily_sync_date` after lock acquisition and can safely short-circuit if another tab already completed the daily sync.

### Why this matters for correctness
- Phase 3 already ensured the foreground probe handed off the full sync decision to `performAutoSync(...)`.
- Phase 6 makes that reuse structural rather than just behavioral:
  - there is no longer a separate handwritten startup-lock execution path for probe follow-up work
  - startup sync, per-load sync, and probe-triggered sync now converge on the same startup-mode execution helper
- This reduces drift risk in future changes to:
  - lock lifecycle behavior
  - heartbeat handling
  - startup-mode `performAutoSync(...)` invocation semantics

### Validation added in Phase 6
- Added `scripts/test-safe-sync-execution.js` to verify:
  - helper ordering for lock acquire / heartbeat / perform / release
  - `beforePerform` short-circuit behavior
  - lock-unavailable handling without accidental `performAutoSync(...)`
  - static call-site reuse for:
    - `requestForegroundRemoteSyncCheck(...)`
    - `handlePerLoadSyncCheck()`
    - `handleStartupSync()`

### Remaining gaps after Phase 6
- Refresh behavior is still not page-type-aware:
  - thread pages can still be more disruptive than ideal after auto-pull
  - dirty settings-modal edits still need explicit reload protection
- Diagnostics and user-facing probe-result messaging remain for later phases.

## Phase 7 Implementation Notes

### Refresh-policy model implemented
- Added a dedicated post-sync refresh-policy layer instead of leaving each sync caller to decide its own `location.reload()` behavior.
- The Phase 7 policy now distinguishes three situations:
  - lightweight list pages: allow automatic reload
  - thread detail pages: suppress automatic reload and show a soft prompt instead
  - settings modal with dirty edits: suppress automatic reload entirely
- This keeps auto-pull effective on low-risk pages while avoiding the most disruptive reading/editing interruptions.

### Dirty settings protection choice
- The existing settings modal already tracked dirty state for:
  - thread rules
  - nav settings
  - sync settings
- Phase 7 now mirrors that state onto the modal element through DOM dataset markers:
  - `data-s1p-settings-has-dirty-edits`
  - `data-s1p-settings-dirty-tabs`
- This avoids leaking modal-local state into more global sync code through ad-hoc globals while still letting startup/background/foreground sync flows detect unsaved edits safely.

### Page-type detection scope chosen for this phase
- Thread detail detection currently keys off:
  - `#postlist`
  - thread-style URLs
  - `mod=viewthread` / `tid` / `ptid`
- Lightweight list detection currently keys off:
  - `#threadlist`
  - `#threadlisttableid`
  - thread-row containers
  - forum/list-style URLs such as `forum-<id>-<page>.html`
- Pages outside those buckets currently stay on the existing conservative “reload is allowed” behavior.

### Integration choices made in Phase 7
- Added `getAutoPullRefreshPlan(...)` for pure policy selection and `applyAutoPullRefreshPolicy(...)` for side effects.
- Added de-duplicated reload scheduling so multiple success paths do not keep stacking independent reload timers.
- Rewired all successful auto-pull entry points that matter for the cross-device flow:
  - `handleStartupSync()`
  - `handlePerLoadSyncCheck()`
  - `handleBackgroundAutoSyncResult(...)`
  - `checkRemoteFreshnessOnForeground(...)` when the follow-up sync actually pulls newer remote data
- Manual force-pull / manual decision flows were intentionally left unchanged in Phase 7:
  - they are explicit user actions
  - the checklist goal here was auto-pull refresh behavior

### Validation added in Phase 7
- Added `scripts/test-post-sync-refresh-policy.js` to verify:
  - static wiring of the new refresh-policy helper and call sites
  - list-page auto-reload scheduling
  - thread-page soft-prompt suppression
  - dirty-settings suppression
- Re-ran adjacent sync regressions to ensure the new policy layer did not disturb earlier phases:
  - `scripts/test-safe-sync-execution.js`
  - `scripts/test-foreground-remote-probe.js`
  - `scripts/test-foreground-trigger-integration.js`
  - `scripts/test-visible-remote-polling.js`

### Remaining limitations after Phase 7
- Thread pages currently prefer the “soft prompt only” branch rather than a more ambitious idle-reload heuristic.
- Phase 7 does not yet record refresh-policy outcomes into diagnostics state.
- Probe-result copy is still relatively coarse and will need Phase 8 follow-up work.

## Phase 5 Implementation Notes

### Visible-page polling model implemented
- Added dedicated runtime state for polling orchestration:
  - `lastUserInteractionAt`
  - `visibleRemoteProbeTimer`
  - `currentVisibleProbeIntervalMs`
- Added these Phase 5 helpers:
  - `scheduleVisibleRemoteFreshnessPolling(...)`
  - `stopVisibleRemoteFreshnessPolling(...)`
  - `syncVisibleRemoteFreshnessPollingForCurrentState(...)`
  - `getVisibleRemoteFreshnessPollingIntervalMs(...)`
- Polling remains metadata-only:
  - each timer run still delegates to `checkRemoteFreshnessOnForeground(...)`
  - no new full-fetch path or alternate sync decision engine was introduced in Phase 5

### Polling cadence and backoff choices
- Active visible-page polling interval is currently `240s`.
- After `15m` without user activity, the polling interval degrades to `720s`.
- This keeps the Phase 5 implementation within the design target:
  - active mode still falls inside the recommended `180-300s` range
  - idle mode still falls inside the recommended `600-900s` range
- Phase 5 intentionally degrades instead of fully pausing after long inactivity:
  - it closes the always-visible stale-data gap now
  - it leaves room for a stricter pause heuristic later if GitHub API cost needs further tuning

### User-activity tracking behavior
- Added activity listeners for:
  - `pointerdown`
  - `keydown`
  - `scroll`
- New activity updates `lastUserInteractionAt`.
- If the page is currently on the degraded polling interval, new activity immediately re-arms polling back to the active interval instead of waiting for the old idle timer to expire.
- Scroll tracking was kept lightweight:
  - repeated activity during an already-active interval only refreshes the timestamp
  - the timer is only rescheduled when the page needs to leave idle mode

### Integration choices made in Phase 5
- `bindPendingAutoSyncRecoveryHooks()` now:
  - binds the Phase 5 activity listeners once
  - starts polling on visible pages
  - stops polling as soon as the page becomes hidden
  - re-arms polling on `pageshow` / `visibilitychange` returns
- Settings convergence was tightened so polling state follows current config without a reload:
  - `saveSettings(...)` now re-evaluates polling state after a local settings write
  - `runFullSettingsCrossTabRefresh(...)` and `runSettingsCrossTabRefresh(...)` now do the same for cross-tab updates
- Phase 5 continues to reuse the existing `syncCheckOnReturnToForeground` switch:
  - no separate visible-polling setting was added yet
  - this avoids prematurely committing to a second UX toggle before later phases settle the full behavior

### Validation added in Phase 5
- Added `scripts/test-visible-remote-polling.js` to verify:
  - Phase 5 listener wiring exists
  - visible pages schedule the active polling interval
  - hidden pages stop polling
  - a polling tick runs the metadata-only probe path and schedules the next tick
  - long inactivity degrades the interval
  - fresh user interaction restores the active interval

### Remaining limitations after Phase 5
- Polling-triggered full sync still flows through the previously added follow-up path; later checklist phases still need to document the safe-sync reuse boundary and UX outcomes more explicitly.
- Diagnostics, copy, and refresh policy have not changed yet.
- Phase 4 does not yet change post-sync refresh policy, diagnostics output, or user-facing status copy.

## Phase 8 Implementation Notes

### Diagnostics surface expanded in this phase
- Extended `s1p_sync_diagnostics` with probe-layer state so copy/reset/panel rendering stay on one existing diagnostics surface instead of introducing a second store.
- Added these fields:
  - `lastProbeTimestamp`
  - `lastProbeRemoteUpdatedAt`
  - `lastSyncedRemoteUpdatedAt`
  - `lastProbeResult`
  - `lastProbeTriggeredSync`
  - `lastProbeTriggeredSyncResult`
- The diagnostics panel and clipboard summary now expose both layers:
  - probe layer: when the most recent foreground/visible probe ran and what it saw
  - execution layer: whether that probe triggered a safe sync and how that follow-up finished

### Probe diagnostics write model chosen for Phase 8
- Added `getForegroundProbeDiagnosticResult(...)` to normalize raw probe outcomes into a compact taxonomy such as:
  - `unchanged`
  - `changed`
  - `throttled_shared_cooldown`
  - `skipped_active_sync`
  - `skipped_conflict_pause`
- Added `formatForegroundProbeSyncResultForDiagnostics(...)` so follow-up sync results are recorded separately from the probe result itself, for example:
  - `success:pulled`
  - `success:skipped_push_on_startup:local_changed_during_sync`
  - `conflict:both_changed_since_baseline`
  - `skipped:startup_lock_unavailable`
- Added `finalizeForegroundProbeResult(...)` so all foreground-probe exits now go through one place that:
  - writes diagnostics
  - optionally shows low-noise feedback
  - preserves a consistent timestamp for that probe attempt

### Synced-remote timestamp handling refined
- `setSyncBaselineState(...)` now also mirrors the latest synced remote timestamp into diagnostics.
- This keeps `lastSyncedRemoteUpdatedAt` current even when the latest successful sync came from:
  - startup sync
  - per-load sync
  - background sync
  - or a foreground probe follow-up sync
- Without this extra write, the new Phase 8 diagnostics could lag behind the real baseline state whenever the last successful sync did not originate from the probe helper itself.

### Low-noise feedback policy implemented
- Kept the existing Phase 7 refresh copy as the success path when a foreground probe ultimately auto-pulls and refresh behavior is applied.
- Added new foreground-probe feedback for actionable non-success outcomes:
  - remote changed but local edits blocked pull
  - conflict detected after the metadata probe
  - follow-up sync skipped because conflict pause / circuit breaker is still active
- Added low-priority skip feedback for:
  - cooldown already active
  - another sync task already running
- To keep this low-noise:
  - visible-page polling stays silent for low-priority skip reasons
  - duplicate skip toasts are suppressed inside a short per-tab cooldown window
  - actionable “remote changed but not applied” states can still surface during polling because they require user awareness

### Validation added in Phase 8
- Added `scripts/test-foreground-probe-diagnostics-feedback.js` to verify:
  - new diagnostics defaults and panel/summary wiring
  - unchanged-probe diagnostics writes
  - “remote changed but local edits blocked pull” feedback copy
  - polling-time suppression for low-priority cooldown feedback
  - active-sync skip feedback and diagnostics summary output
- Re-ran nearby regressions to ensure the new finalization path did not break prior phases:
  - `scripts/test-foreground-remote-probe.js`
  - `scripts/test-post-sync-refresh-policy.js`
  - `scripts/test-safe-sync-execution.js`

### Remaining limitations after Phase 8
- Phase 8 improves observability and user explanation, but it does not yet complete the end-to-end multi-device verification matrix from Phase 9.
- Low-noise feedback is currently toast-based; it does not yet extend the navbar sync indicator with dedicated foreground-probe reasons.
