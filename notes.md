# Notes: Sync Settings Migration and UI IA

## Migration Finding
- `buildNormalizedSettings(saved)` removes unknown keys like `syncAutoFetchMode` and reports `legacy_setting_key_removed:<key>`.
- `migrateLegacySettingsIfNeeded()` then calls `saveSettings(settings, { suppressSyncTrigger: true, markDataChangedWhenSuppressed: true })`.
- `saveSettings()` normalizes the incoming settings and compares them with `getSettings()`, which is also normalized from raw storage.
- Because both normalized objects omit the legacy key, the function returns before `GM_setValue("s1p_settings", normalizedSettings)`.
- Result: raw storage still contains the removed key, so the migration log repeats on every page load.

## Sync Settings Functional Map
- `syncDailyFirstLoad` default `true`: startup/day-first safe sync through `handleStartupSync()` and `runStartupModeAutoSyncCheckWithIndicator(...)`.
- `syncForcePullOnStartup` default `false`: child of daily-first startup sync; normalized to false unless daily sync is enabled.
- `syncPerLoadCheckEnabled` default `false`: every page load safe sync through `handlePerLoadSyncCheck()`.
- `syncCheckOnReturnToForeground` default `true`: foreground/page-visible metadata probe through `handleInitialForegroundRemoteFreshnessCheck()`, `visibilitychange`, and bfcache `pageshow`; follow-up delegates to startup-mode safe sync.
- `syncVisibleRemotePollingEnabled` default `false`: advanced child of foreground check; schedules visible-page metadata probes at about 4 minutes active / 12 minutes idle.
- `syncAutoEnabled` default `true`: background upload of local changes after debounce through pending auto-sync and `performAutoSync(false, SYNC_LOCK_MODE_BACKGROUND)`.
- `syncShowAutoSyncIndicator` default `true`: navbar status display for daily, per-load, foreground, visible-poll, background, and manual sync activity when a relevant path is enabled.

## UI IA Direction
- Separate “云端更新检查” from “自动上传本地变更”.
- Treat visible-page polling as an advanced child of foreground checks only.
- Treat the navbar indicator as status display, independent from the background upload switch.
- Keep manual helper options near manual/advanced data behavior, not as peers of auto-check modes.

## Implementation Notes
- Added a narrow `forceWrite` option to `saveSettings()` and used it only from `migrateLegacySettingsIfNeeded()`.
- Added a regression case that seeds raw `s1p_settings` with `syncAutoFetchMode`, runs the script, and asserts the persisted settings no longer contain the legacy key.
- Reworked the sync settings markup into sections:
  - `s1p-cloud-update-check-section`
  - `s1p-background-auto-sync-section`
  - `s1p-sync-status-section`
  - `s1p-sync-manual-options-section`
  - `s1p-github-connection-section`
- Updated `updateVisibleRemotePollingToggleState()` so the visible-page polling row is hidden outside the foreground strategy.
- Updated `updateForcePullState()` so the force-pull child is disabled when either remote sync or daily-first-load sync is off.
- Added `sync-across-multiple-tab/sync_settings_ia_redesign.md` as the handoff document matching the requested six-section structure.
