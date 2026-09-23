# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

S1 Plus is a single-file Tampermonkey/Greasemonkey userscript (~43,000 lines) that enhances the Stage1st forum. All logic lives in `S1Plus.js`. No build system, no bundler, no compilation step.

## Development Commands

- **Edit**: Modify `S1Plus.js` directly. No build step.
- **Local dev loader**: Use `S1Plus-Local-Mac.user.js` (Mac) or `S1Plus-Local-Windows.user.js` (Windows) as a Tampermonkey loader that `@require`s the local `S1Plus.js` file. Edit source, refresh page — changes apply instantly. Requires "Allow access to file URLs" enabled in Tampermonkey extension settings.
- **Tests** (sync/migration only):
  - Settings migration: `node tests/settings-migration/test-settings-migration.js`
  - Other sync tests in `tests/` (e.g. `test-foreground-remote-probe.js`, `test-background-open-passive-session.js`, `test-cleanup-provenance-guard.js`)
  - All tests run via Node.js. The test helper (`s1plus-test-helpers.js`) loads `S1Plus.js` in a `vm` sandbox stubbing browser/GM APIs.
  - **Test mode**: Set `globalThis.__S1P_TEST_MODE__ = true` before loading the script. This disables auto-startup (`document-start` handler), returns `{}` from `buildNormalizedSettings`, and exposes internal functions at `globalThis.__S1P_TEST_HOOKS__` (including `exportLocalDataObject`, `buildNormalizedSettings`, sync probe/lock state helpers).
  - There are no unit tests for non-sync features; those are tested manually in-browser.
- **No lint/typecheck**: This project has none.

## Architecture

### Initialization Phases

The script runs at `document-start` per `@run-at metadata`. Initialization proceeds through ordered phases (`S1P_INIT_PHASES`): `document-start` → `body-ready` → `forum-ready` → `services-ready` → `content-ready` → `deferred`. The `document-start` phase must only contain low-dependency, anti-flicker tasks. Forum-structure-dependent logic belongs in `forum-ready`. First DOM scan + MutationObserver mount belong in `content-ready`. Sync startup, recommendation popups etc. go in `deferred`.

### Data Storage

Uses Greasemonkey API (`GM_setValue` / `GM_getValue`). All keys are `s1p_` + `snake_case`.

Core business data keys:
- `s1p_settings`
- `s1p_blocked_threads`
- `s1p_blocked_users`
- `s1p_blocked_posts`
- `s1p_user_tags`
- `s1p_bookmarked_replies`
- `s1p_title_filter_rules`
- `s1p_read_progress`

Sync & lock keys (partial list — see `DEVELOPMENT.md` for full):
- `s1p_last_modified`, `s1p_last_sync_timestamp`, `s1p_sync_baseline_state`
- `s1p_background_sync_lock`, `s1p_manual_sync_lock`, `s1p_startup_sync_lock`, `s1p_sync_global_lock`

The sync data object (`exportLocalDataObject`) uses version `5.0` with keys `version`, `lastUpdated`, `contentHash`, `baseContentHash`, `data`. Internal data keys use `snake_case` (e.g., `data.read_progress`).

### Naming Convention

`CSS classes`, `IDs`, `storage keys`, and `function names` all use an `s1p` prefix.

## Critical Code Patterns (must follow)

### Settings Architecture

Every read and write goes through the normalization layer:

- **`defaultSettings`** (L25139): canonical default values for every setting key
- **`buildNormalizedSettings(raw)`** (L25206): schema migration + normalization applied on EVERY `getSettings()` and `saveSettings()` call. Handles old→new key mapping (`openInNewTab` → `open_in_new_tab`), boolean normalization, key removal, enum migration. **When adding a new setting, you MUST update BOTH `defaultSettings` and `buildNormalizedSettings`**, or the setting will not survive reads/writes for users with existing data.
- **`getSettings()`**: reads from 1-second TTL cache (`SETTINGS_CACHE_TTL_MS`). Calls `buildNormalizedSettings` on cache miss. Use `invalidateSettingsCache()` to force re-read.
- **`getSettingsForWrite()`**: deep clones the cached settings (via `structuredClone`), returns a fresh mutable copy.
- **`saveSettings(settings)`**: normalizes via `buildNormalizedSettings`, writes `GM_setValue("s1p_settings", ...)`, updates `last_modified` timestamp, writes cross-tab signal, triggers sync.

```js
const settings = getSettingsForWrite(); // deep clone, safe to mutate
// modify settings...
saveSettings(settings); // normalizes, persists, triggers sync
```

### DOM Safety
- User-generated content → `textContent` (not `innerHTML`)
- If HTML is required → `sanitizeHtmlFragment()` first
- Links → `getSafeUrlAttributeValue()` for href attributes
- Sanitize object keys → `sanitizeRecordObject()` to prevent prototype pollution

### Event Handling
- Use delegated event listeners for dynamically created elements (DOM is frequently rebuilt by forum JS and MutationObserver)
- Settings modal tabs: single delegated click handler checks `target.closest(".s1p-tab-btn")` → calls `switchSettingsTab()`
- Inline menus/popups: call corresponding `destroy`/`dismiss` on close

## S1 NUX Theme Conflict

`S1 NUX.css` has a global rule `*:not(.v-binder-follower-content) { transition-duration: .15s }` that overrides S1 Plus animation durations. Always test with both standard and NUX themes. Higher-specificity selectors or `!important` on critical transitions may be needed.

## Cross-Tab Synchronization

The script uses `GM_addValueChangeListener` to detect data changes from other tabs and keep all open tabs in sync.

**Settings cross-tab** (`initializeSettingsCacheSync`): When another tab changes `s1p_settings`, the listener detects what changed and applies the update on this tab. Changed keys are classified into 3 tiers:
- **Full apply**: `enablePostBlocking`, `enableGeneralSettings`, etc. → re-runs `applyChanges()` completely
- **Lightweight**: `hideImagesByDefault`, `limitImagesBySize`, navbar options, sync GUI keys → runs targeted apply functions
- **Passive**: `readingProgressCleanupDays`, sync timing options, etc. → updates cache only, no UI refresh

**Core data cross-tab** (`initializeCoreDataCacheSync`): Listens to all 7 business data keys + a cross-tab signal key. On change from another tab, updates the local cache and schedules a debounced DOM refresh. When the tab becomes visible (`visibilitychange`), pending refreshes are applied immediately.

**Signal mechanism**: Each tab has a unique `SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID`. When a tab writes data (e.g., `saveSettings`), it includes its source ID. Other tabs skip changes from their own source ID to avoid self-reactions. The `s1p_settings_refresh_signal` key acts as a cross-tab heartbeat.

**Open settings modal sync**: If the settings modal is open when another tab changes settings, the modal's UI is re-synced (currently active tab re-renders, navbar button updates, etc.).

**Fallback polling**: If `GM_addValueChangeListener` is unreliable, `initializeSettingsFallbackSync` polls `s1p_settings` at intervals (1.5s → 20s exponential backoff), checking a signal health window to determine whether listener-based sync is healthy.

## Release Workflow

1. Update `@version` in script metadata (line 4)
2. Update `SCRIPT_VERSION` and `SCRIPT_RELEASE_DATE` constants (lines 27-28)
3. Update `CHANGELOG.md`
4. Update welcome popup text in `showFirstTimeWelcomeIfNeeded`
5. Use the `s1plus-release` skill for the release metadata steps
6. Use the `userscript-release` skill to publish: it fast-forwards `release` to the new tag, which triggers the Greasy Fork webhook. Pushing `main` never publishes.

## Key Gotchas

- Forum HTML structure can change; selectors may break. Verify on list page, thread page, and search results.
- The sync system has 3 lock types (manual/background/startup) + 1 global lock. Modifying sync logic is high-risk; carefully test concurrency.
- Settings tab height transitions have complex pixel-locking reconciliation via `ResizeObserver`. If something jitters on tab switch, look at `animateSettingsModalBodyHeight`, `scheduleModalBodyHeightReconcile`, and `updateObservedModalBodyTabContent`.
- Sticky posts and collapsed threads require special DOM handling.
- `@connect *` in script metadata — used because `GM_xmlhttpRequest` targets GitHub Gist API.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root + `docs/adr/`. See `docs/agents/domain.md`.

## Related Docs

- `DEVELOPMENT.md` — comprehensive dev manual (code module map, storage key catalog, sync mechanics, test checklists, animation debugging)
- `CHANGELOG.md` — version history
- `README.md` — user-facing overview
- `sync-across-multiple-tab/` — multi-tab sync redesign docs and test scripts
