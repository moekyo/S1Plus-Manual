# Task Plan: Cross-Device Remote Sync Pull Optimization

## Goal
Execute the implementation from `sync_implementation_plan.md` in the order defined by `sync_dev_task_checklist.md`, so device B can detect and safely apply newer remote sync data in more real-world return/resume scenarios without weakening the existing conflict protections.

## Status
- Current status: Phase 8 completed, Phase 9 next.
- Overall progress: 8 of 9 implementation phases completed.
- Completed in this session:
  - Added the new foreground-check setting default and migration behavior.
  - Added persisted remote probe info, shared cooldown state, and lightweight probe lock helpers.
  - Hooked `lastSyncedRemoteUpdatedAt` into baseline writes and cleared probe state when the remote target changes or remote sync is disabled.
  - Added the Phase 2 sync-tab control for `自动检查云端更新`, with mutually exclusive `关闭` / `每次加载` / `回到前台` modes backed by the existing per-load + foreground flags.
  - Wired the control into sync-tab hydrate/save/reset/cross-tab refresh flows and normalized legacy dual-enabled state down to one effective mode.
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
  - Added `runStartupModeAutoSyncCheck(...)` as the shared startup-lock orchestration helper for safe auto-sync execution.
  - Rewired `requestForegroundRemoteSyncCheck(...)`, `handlePerLoadSyncCheck()`, and `handleStartupSync()` to reuse the same startup-path helper instead of open-coding independent lock + heartbeat + `performAutoSync(...)` sequences.
  - Kept the real sync decision inside `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`, so foreground probe follow-up, daily first-load sync, and per-load sync all converge on the same safety behavior.
  - Added `scripts/test-safe-sync-execution.js` to verify the shared startup execution helper, early short-circuit behavior, lock-unavailable handling, and Phase 6 call-site reuse.
  - Added a unified Phase 7 post-sync refresh policy via `getAutoPullRefreshPlan(...)` and `applyAutoPullRefreshPolicy(...)`.
  - Classified auto-pull success handling by current page context:
    - lightweight list pages still allow direct reload
    - thread pages now fall back to a soft prompt instead of auto-refresh
    - settings modal sessions with dirty edits now suppress auto-refresh entirely
  - Exposed settings-modal dirty state as DOM dataset markers so sync flows outside the modal can reliably detect unsaved edits before deciding whether to reload.
  - Rewired post-sync refresh handling in `handleStartupSync()`, `handlePerLoadSyncCheck()`, `handleBackgroundAutoSyncResult(...)`, and `checkRemoteFreshnessOnForeground(...)` so all auto-pull paths converge on the same Phase 7 policy.
  - Added `scripts/test-post-sync-refresh-policy.js` to verify policy selection, dirty-settings protection, thread-page soft prompting, and list-page reload scheduling.
  - Extended `s1p_sync_diagnostics` with probe-layer fields for the latest probe time, observed remote version, last synced remote version, probe result, follow-up sync trigger flag, and follow-up sync result.
  - Wired the new probe diagnostics into `buildSyncDiagnosticsSummary()`, `updateSyncDiagnosticsPanel()`, and `setSyncBaselineState(...)`, so synced-remote timestamps stay visible even when the full sync is triggered outside the foreground probe path.
  - Added `getForegroundProbeDiagnosticResult(...)`, `recordForegroundProbeDiagnostics(...)`, and `finalizeForegroundProbeResult(...)` so every foreground-probe outcome now lands in diagnostics through one shared write path.
  - Added low-noise foreground-probe feedback for “local edits blocked pull”, “conflict detected”, and “pause / cooldown / active sync” skip cases, while intentionally keeping low-priority polling skips silent.
  - Added short duplicate-toast suppression for foreground-probe skip feedback so `visibilitychange` + `pageshow` bursts do not spam the user with repeated notices.
  - Added `scripts/test-foreground-probe-diagnostics-feedback.js` to verify the new diagnostics fields, summary output, low-noise feedback copy, and polling-time feedback suppression.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-post-sync-refresh-policy.js`
  - `node scripts/test-foreground-probe-diagnostics-feedback.js`

## Phases
- [x] Phase 1: State and settings
- [x] Phase 2: Settings UI
- [x] Phase 3: Probe infrastructure
- [x] Phase 4: Trigger integration
- [x] Phase 5: Visible-page polling
- [x] Phase 6: Safe sync execution
- [x] Phase 7: Refresh policy
- [x] Phase 8: Diagnostics and UI feedback
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
- Phase 6 formalizes startup-path reuse with `runStartupModeAutoSyncCheck(...)`, so the only full auto-sync decision engine remains `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)` regardless of whether execution was triggered by startup, per-load checks, or a positive remote freshness probe.
- Phase 7 centralizes auto-pull refresh handling in `applyAutoPullRefreshPolicy(...)` instead of letting each caller open-code `location.reload()` decisions.
- The first refresh-policy rollout keeps behavior intentionally conservative:
  - list-like pages continue to auto-reload
  - thread pages only show a soft prompt
  - any open settings modal with dirty edits suppresses auto-reload
- Phase 8 keeps the probe diagnostics inside the existing `s1p_sync_diagnostics` record instead of creating a second debug store, so copy/export/reset all remain on one surface.
- Low-noise foreground-probe feedback follows two rules:
  - actionable “remote changed but not applied” outcomes may still toast during visible-page polling
  - low-priority skip reasons such as cooldown or an already-running sync stay silent during polling and are de-duplicated on foreground-return bursts

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
  - Added the `自动检查云端更新` mutually exclusive control to the sync settings tab, with `关闭` / `每次加载` / `回到前台` three-way selection.
  - Kept the stored behavior mapped onto the existing `syncPerLoadCheckEnabled` and `syncCheckOnReturnToForeground` flags, while normalizing legacy dual-enabled state down to a single effective mode.
  - Updated user-facing copy so the `回到前台` mode explicitly covers both return-to-foreground checks and the later visible-page low-frequency polling path before any safe sync decision.
  - Wired the control into sync-tab initial render, dirty-state tracking, save persistence, settings reset, and cross-tab control refresh.
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

## Phase 6 Update
- Status: Completed
- Completed:
  - Added `runStartupModeAutoSyncCheck(...)` to centralize startup-lock acquisition, heartbeat management, guarded pre-checks, `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)` execution, and guaranteed lock release.
  - Rewired `requestForegroundRemoteSyncCheck(...)` to reuse the shared helper, so probe follow-up execution no longer carries its own separate startup-lock orchestration.
  - Rewired `handlePerLoadSyncCheck()` and `handleStartupSync()` to call the same helper, preserving their existing UX/message handling while removing duplicated startup execution plumbing.
  - Added a `beforePerform` short-circuit path so the daily-first-load flow can still re-check `s1p_last_daily_sync_date` after lock acquisition without reintroducing a second execution skeleton.
  - Added `scripts/test-safe-sync-execution.js` to verify helper ordering, early short-circuit behavior, lock-unavailable handling, and the three Phase 6 call sites staying on the shared path.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-settings-migration.js`
  - `node scripts/test-remote-probe-state.js`
  - `node scripts/test-sync-settings-ui.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
  - `node scripts/test-safe-sync-execution.js`
- Remaining:
  - Post-sync refresh behavior is still coarse and not yet page-type-aware.
  - Automatic reload protection for dirty settings-modal edits remains for Phase 7.
  - Probe / sync diagnostics and user-facing probe-result messaging are still pending for Phase 8.
- Next:
  - Implement Phase 7 refresh policy so auto-pull on list pages can remain lightweight while thread pages and dirty settings sessions avoid disruptive reload behavior.

## Phase 7 Update
- Status: Completed
- Completed:
  - Added `hasDirtySettingsModalEdits(...)`, `isThreadDetailPageForAutoPullRefresh(...)`, `isLightweightListPageForAutoPullRefresh(...)`, `getAutoPullRefreshPlan(...)`, and `applyAutoPullRefreshPolicy(...)` to centralize auto-pull refresh decisions.
  - Added de-duplicated reload scheduling so list-like pages still refresh automatically without each auto-sync caller hand-writing a new `location.reload()` timer.
  - Marked settings-modal dirty state onto the modal DOM node, allowing sync flows outside `createManagementModal()` to reliably suppress auto-refresh when the user has unsaved edits.
  - Rewired `handleStartupSync()`, `handlePerLoadSyncCheck()`, `handleBackgroundAutoSyncResult(...)`, and foreground-probe follow-up success handling to reuse the same page-aware refresh policy.
  - Added `scripts/test-post-sync-refresh-policy.js` to cover list-page reload behavior, thread-page soft prompting, dirty-settings suppression, and key wiring expectations.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-post-sync-refresh-policy.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
- Remaining:
  - Phase 7 changes refresh behavior only; it does not yet add dedicated diagnostics fields or richer probe-result message taxonomy.
  - Thread pages currently use the conservative “soft prompt, no auto-reload” path rather than an idle-reload heuristic.
- Next:
  - Implement Phase 8 diagnostics and UI feedback so probe-layer decisions and refresh outcomes become easier to inspect and understand.

## Phase 8 Update
- Status: Completed
- Completed:
  - Extended `SYNC_DIAGNOSTICS_DEFAULT` / `normalizeSyncDiagnostics(...)` with:
    - `lastProbeTimestamp`
    - `lastProbeRemoteUpdatedAt`
    - `lastSyncedRemoteUpdatedAt`
    - `lastProbeResult`
    - `lastProbeTriggeredSync`
    - `lastProbeTriggeredSyncResult`
  - Added a shared foreground-probe finalization path, so early skips, unchanged probes, and positive remote-change follow-up checks all update diagnostics consistently instead of relying on scattered inline writes.
  - Updated sync diagnostics copy/export surfaces so the settings-panel diagnostics and clipboard summary now expose both the probe layer and the follow-up sync layer.
  - Added low-noise foreground-probe copy for:
    - remote changed but local edits blocked pull
    - conflict detected after the metadata probe
    - pause / cooldown / active-sync skip cases
  - Kept low-priority polling skips intentionally quiet and added short duplicate-feedback suppression to avoid repeated toasts during `pageshow` + `visibilitychange` bursts.
  - Added `scripts/test-foreground-probe-diagnostics-feedback.js` to verify diagnostics writes, summary output, actionable feedback copy, and polling-time quiet behavior.
- Validation:
  - `node --check S1Plus.js`
  - `node scripts/test-foreground-probe-diagnostics-feedback.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-post-sync-refresh-policy.js`
  - `node scripts/test-safe-sync-execution.js`
- Remaining:
  - Phase 8 improves probe diagnostics and user explanation, but it does not yet complete the end-to-end multi-device functional matrix or full regression sweep defined for Phase 9.
  - Thread pages still use the existing conservative soft-prompt refresh policy from Phase 7.
- Next:
  - Implement Phase 9 testing and regression verification across return-to-foreground, always-visible polling, multi-tab contention, local-unsynced-edit protection, and manual-sync regression cases.

## Errors Encountered
- A first pass of the new Phase 3 regression script used a synthetic timestamp for the circuit-breaker test while the production helper checked the real `Date.now()`. The test was corrected to use a real future `until` timestamp before final validation.
