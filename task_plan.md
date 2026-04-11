# Task Plan: Cross-Device Remote Sync Pull Optimization

## Goal
Execute the implementation from `sync_implementation_plan.md` in the order defined by `sync_dev_task_checklist.md`, so device B can detect and safely apply newer remote sync data in more real-world return/resume scenarios without weakening the existing conflict protections.

## Status
- Current status: Phase 3 completed, Phase 4 next.
- Overall progress: 3 of 9 implementation phases completed.
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
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`

## Phases
- [x] Phase 1: State and settings
- [x] Phase 2: Settings UI
- [x] Phase 3: Probe infrastructure
- [ ] Phase 4: Trigger integration
- [ ] Phase 5: Visible-page polling
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

## Errors Encountered
- A first pass of the new Phase 3 regression script used a synthetic timestamp for the circuit-breaker test while the production helper checked the real `Date.now()`. The test was corrected to use a real future `until` timestamp before final validation.
