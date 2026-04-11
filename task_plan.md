# Task Plan: Cross-Device Remote Sync Pull Optimization

## Goal
Execute the implementation from `sync_implementation_plan.md` in the order defined by `sync_dev_task_checklist.md`, so device B can detect and safely apply newer remote sync data in more real-world return/resume scenarios without weakening the existing conflict protections.

## Status
- Current status: Phase 5 completed, Phase 6 next.
- Overall progress: 5 of 9 implementation phases completed.
- Completed in this session:
  - Added the new foreground-check setting default and migration behavior.
  - Added persisted remote probe info, shared cooldown state, and lightweight probe lock helpers.
  - Hooked `lastSyncedRemoteUpdatedAt` into baseline writes and cleared probe state when the remote target changes or remote sync is disabled.
  - Added the Phase 2 sync-tab control for `syncCheckOnReturnToForeground`.
  - Wired the new toggle into sync-tab hydrate/save/reset/cross-tab refresh flows.
  - Added a Phase 2 wiring verification script for the sync settings UI.
  - Added Phase 3 shared cooldown / per-tab cooldown helpers and a verified probe-lock acquisition path for metadata-only freshness checks.
  - Added `checkRemoteFreshnessOnForeground(...)` and `requestForegroundRemoteSyncCheck(...)`, so a positive probe can reuse the existing startup sync safety path without creating a second sync decision engine.
  - Added `scripts/test-foreground-remote-probe.js` to cover unchanged remote, changed remote, shared cooldown, probe lock contention, and early-skip guard conditions.
  - Added a dedicated Phase 4 trigger bridge so `visibilitychange` and bfcache `pageshow` can reuse the guarded foreground probe runner without replacing the existing pending local auto-sync recovery path.
  - Kept non-bfcache `pageshow` on recovery-only behavior to avoid duplicating startup/per-load sync checks on normal page load.
  - Added `scripts/test-foreground-trigger-integration.js` to verify trigger wiring, recovery ordering, persisted-`pageshow` probe behavior, and hidden-page early exits.
  - Added Phase 5 visible-page polling runtime state, including user-activity timestamps, active/idle polling intervals, and a timer-based scheduler for always-visible pages.
  - Wired visible-page polling into the existing foreground recovery hooks so visible pages start polling, hidden pages stop polling, and bfcache/foreground returns re-arm the timer without bypassing the metadata-only probe path.
  - Added pointer, keyboard, and scroll activity tracking so long-idle visible pages back off to a lower polling frequency and new user interaction restores the normal cadence.
  - Synced the polling scheduler with settings save and cross-tab settings refresh so enabling/disabling the feature converges without requiring a page reload.
  - Added `scripts/test-visible-remote-polling.js` to verify scheduler wiring, hidden-page stop behavior, polling execution, inactivity backoff, and post-idle recovery.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`

## Phases
- [x] Phase 1: State and settings
- [x] Phase 2: Settings UI
- [x] Phase 3: Probe infrastructure
- [x] Phase 4: Trigger integration
- [x] Phase 5: Visible-page polling
- [ ] Phase 6: Safe sync execution
- [ ] Phase 7: Refresh policy
- [ ] Phase 8: Diagnostics and UI feedback
- [ ] Phase 9: Testing and regression verification

## Decisions Made
- `syncCheckOnReturnToForeground` defaults to `true` for brand-new installs.
- Existing saved settings that do not yet contain `syncCheckOnReturnToForeground` migrate conservatively:
  - `true` only when `syncRemoteEnabled === true` and `syncAutoEnabled !== false`
  - `false` otherwise
- Probe state is split across dedicated keys instead of reusing baseline state:
  - `s1p_last_remote_probe_info`
  - `s1p_remote_probe_shared_cooldown`
  - `s1p_remote_probe_lock`
- `lastSyncedRemoteUpdatedAt` is updated from existing `setSyncBaselineState(...)` writes so later probe logic can distinguish “observed remote changed” from “remote already reconciled”.
- Probe state is cleared together with sync baseline / pending auto-sync runtime state when the remote target changes or remote sync is turned off.
- Phase 5 keeps visible-page polling behind the existing `syncCheckOnReturnToForeground` switch instead of adding a second user-facing toggle before the polling behavior is mature enough to justify a more granular setting.
- The first polling rollout uses:
  - `240s` active visible-page probe interval
  - `720s` degraded interval after `15m` without pointer/keyboard/scroll activity
  - the same metadata-only `checkRemoteFreshnessOnForeground(...)` path already validated in Phases 3-4

## Phase 1 Update
- Status: Completed
- Completed:
  - Added `syncCheckOnReturnToForeground` to `defaultSettings` and `buildNormalizedSettings()`.
  - Added migration coverage for new installs and existing saved settings without the new key.
  - Added remote probe info, shared cooldown, lock normalization/read-write helpers, plus a clear helper.
  - Exposed the new helpers in test mode and added dedicated regression coverage.
- Remaining:
  - The new setting is not wired into the settings modal yet; that belongs to Phase 2.
  - No foreground probe execution, trigger wiring, polling, diagnostics extension, or refresh policy changes have been implemented yet.
- Next:
  - Implement Phase 2 settings UI and bind the new toggle into modal hydrate/save/cross-tab refresh paths.

## Phase 2 Update
- Status: Completed
- Completed:
  - Added the `启用回到前台时检查云端更新` toggle to the sync settings tab.
  - Added user-facing copy explaining that the toggle supplements startup-style checks with a lightweight remote freshness probe before any safe sync decision.
  - Wired the toggle into sync-tab initial render, dirty-state tracking, save persistence, settings reset, and cross-tab control refresh.
  - Added `scripts/test-sync-settings-ui.js` to guard the Phase 2 wiring points against future regressions.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
- Remaining:
  - No remote probe helpers or execution path exist yet; the new toggle is UI/state wiring only at this stage.
  - `pageshow` / `visibilitychange` and visible-page polling still need implementation in later phases.
- Next:
  - Implement Phase 3 remote probe helpers and shared throttling/lock behavior.

## Phase 3 Update
- Status: Completed
- Completed:
  - Added explicit remote-probe cooldown helpers for cross-tab shared throttling and same-tab foreground flap suppression.
  - Added `acquireRemoteProbeLock(...)`, so rapid multi-tab foreground changes now have a verified single-owner metadata probe path instead of raw last-write-wins state only.
  - Added `checkRemoteFreshnessOnForeground(reason)` to run a metadata-only probe, persist the observed remote timestamp, and exit quietly when the remote timestamp already matches the last synced baseline.
  - Added `requestForegroundRemoteSyncCheck(reason)` to reuse `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)` under the existing startup lock/heartbeat path whenever the probe sees a newer remote snapshot.
  - Exposed focused Phase 3 test hooks and added `scripts/test-foreground-remote-probe.js` for behavioral regression coverage.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
- Remaining:
  - `pageshow` / `visibilitychange` still use only pending local auto-sync recovery; the new foreground probe runner is not wired into those triggers yet.
  - Visible-page polling, activity-aware backoff, diagnostics expansion, and refresh policy changes remain for later phases.
- Next:
  - Implement Phase 4 trigger integration so `pageshow` and `visibilitychange` can invoke the guarded foreground probe without regressing existing pending local auto-sync recovery behavior.

## Phase 4 Update
- Status: Completed
- Completed:
  - Added `triggerForegroundRemoteFreshnessProbe(...)` as the shared trigger bridge for foreground-return probe execution and error isolation.
  - Added `handlePendingAutoSyncRecoveryVisibilityChange(...)`, so visible-tab recovery now performs the original pending local auto-sync recovery first and then invokes the guarded metadata-only remote freshness probe.
  - Added `handlePendingAutoSyncRecoveryPageShow(...)`, so bfcache restores reuse the same recovery-first flow while normal non-persisted `pageshow` remains recovery-only.
  - Rewired `bindPendingAutoSyncRecoveryHooks()` to call the new Phase 4 handlers instead of directly embedding recovery logic.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
- Remaining:
  - Visible-page polling is still not implemented, so always-visible tabs still rely on a later phase to notice remote changes without a foreground transition.
  - Activity-aware backoff, diagnostics extension, and post-sync refresh policy remain for later phases.
- Next:
  - Implement Phase 5 visible-page polling so long-lived always-visible tabs can periodically run the same guarded metadata-only freshness probe.

## Phase 5 Update
- Status: Completed
- Completed:
  - Added visible-page polling runtime state via `lastUserInteractionAt`, `visibleRemoteProbeTimer`, and `currentVisibleProbeIntervalMs`.
  - Added `scheduleVisibleRemoteFreshnessPolling(...)`, `stopVisibleRemoteFreshnessPolling(...)`, and `syncVisibleRemoteFreshnessPollingForCurrentState(...)` so visible tabs now keep a low-frequency metadata-only remote freshness check alive even without a foreground transition.
  - Reused `checkRemoteFreshnessOnForeground(...)` for polling execution, so Phase 5 does not introduce a second remote-fetch or sync-decision path.
  - Added pointer, keyboard, and scroll activity listeners plus `handleVisibleRemoteFreshnessUserActivity(...)`, so long-idle visible tabs back off from `240s` polling to `720s`, and fresh interaction restores the normal interval.
  - Wired polling state reconciliation into `bindPendingAutoSyncRecoveryHooks()`, `saveSettings(...)`, `runFullSettingsCrossTabRefresh(...)`, and `runSettingsCrossTabRefresh(...)` so runtime behavior matches current visibility and settings state.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
- Remaining:
  - Phase 5 only adds the missing trigger/scheduler layer; post-probe sync execution still relies on the already existing follow-up path and Phase 6 remains the place to formalize that reuse boundary in the implementation checklist.
  - Diagnostics expansion, user-facing messaging, and page-type-aware refresh behavior are still pending in later phases.
- Next:
  - Implement Phase 6 safe sync execution as an explicit checklist milestone, keeping the existing startup lock reuse path as the only full-sync decision engine.

## Errors Encountered
- A first pass of the new Phase 3 regression script used a synthetic timestamp for the circuit-breaker test while the production helper checked the real `Date.now()`. The test was corrected to use a real future `until` timestamp before final validation.
