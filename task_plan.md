# Task Plan: Sync Settings Migration and IA Cleanup

## Goal
Fix repeated legacy settings migration, redesign the cloud sync automatic-check settings around the actual code paths, update docs/changelog, verify regressions, and commit.

## Phases
- [x] Phase 1: Inspect existing migration and sync settings code
- [x] Phase 2: Fix repeated migration persistence
- [x] Phase 3: Redesign and implement sync settings grouping/copy/interactions
- [x] Phase 4: Update documentation and changelog
- [x] Phase 5: Run regression checks
- [ ] Phase 6: Commit changes

## Key Questions
1. Why does `legacy_setting_key_removed:syncAutoFetchMode` reappear on every page load?
2. Which settings are true update checks, background upload, auto pull/follow-up, manual helpers, status display, or advanced optimizations?
3. How can the UI preserve existing fields while making dependencies visible?

## Decisions Made
- The repeated migration is caused by `saveSettings()` short-circuiting when normalized settings match cached normalized settings, even though raw storage still contains removed keys.
- Add a narrow `forceWrite` save option and use it from `migrateLegacySettingsIfNeeded()` so one-time cleanup is actually persisted.
- Keep existing config fields for compatibility; redesign the settings panel layout and copy instead of introducing unsupported behavior.
- The new UI separates cloud update checks, local-change background upload, status display, manual helpers, and GitHub connection details.
- `syncVisibleRemotePollingEnabled` remains preserved when its row is hidden, but runtime behavior stays gated by `syncCheckOnReturnToForeground`.

## Errors Encountered
- The first legacy-key persistence regression expected migration to run during VM load, but `main()` is intentionally skipped in test mode. The test now calls `migrateLegacySettingsIfNeeded()` through the test hook.

## Status
**Currently in Phase 6** - preparing git staging and commit.

## Validation
- `node --check S1Plus.js`
- `node sync-across-multiple-tab/scripts/test-settings-migration.js`
- `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
- `node sync-across-multiple-tab/scripts/test-remote-probe-state.js`
- `node sync-across-multiple-tab/scripts/test-foreground-remote-probe.js`
- `node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
- `node sync-across-multiple-tab/scripts/test-visible-remote-polling.js`
- `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
- `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
- `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
- `node sync-across-multiple-tab/scripts/test-foreground-probe-diagnostics-feedback.js`
- `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
- `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
- `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
- `node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js`
- `node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
- `node sync-across-multiple-tab/scripts/test-phase6-interaction-copy.js`
