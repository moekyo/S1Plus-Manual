# Agent Repository Guide

Detailed guidance for AI coding agents working in this repository. Read this file only when the task touches the matching area.

## Project Shape

S1 Plus is a single-file Tampermonkey/Greasemonkey userscript that enhances the Stage1st forum. All runtime logic lives in `S1Plus.js`; there is no build system, bundler, compilation step, lint, or typecheck.

## Development Commands

- Edit `S1Plus.js` directly.
- Local dev loader: use `S1Plus-Local-Mac.user.js` or `S1Plus-Local-Windows.user.js` as the Tampermonkey loader that `@require`s local `S1Plus.js`.
- Settings migration test: `node tests/settings-migration/test-settings-migration.js`
- Sync tests: run focused `node tests/test-*.js` files from `tests/`.
- Test helper: `tests/s1plus-test-helpers.js` loads `S1Plus.js` in a `vm` sandbox with browser/GM stubs.
- Test mode: set `globalThis.__S1P_TEST_MODE__ = true` before loading the script. It disables auto-startup, returns `{}` from `buildNormalizedSettings`, and exposes hooks on `globalThis.__S1P_TEST_HOOKS__`.
- Non-sync features are usually verified manually in-browser.

## Work Discipline

Use these project-specific adaptations of the Karpathy-style coding guidelines:

- Think before coding: state assumptions when the request or code path has multiple plausible interpretations. Ask when guessing would affect behavior or data safety.
- Simplicity first: implement the minimum behavior that satisfies the request. Avoid one-off abstractions, speculative options, and broad rewrites.
- Surgical changes: match existing style and touch only relevant code. Do not refactor adjacent logic, rewrite comments, or clean unrelated dead code.
- Goal-driven execution: turn the task into a verifiable target. For bug fixes, prefer a focused regression test; for docs, check the entry points and routing language.
- Review your diff: every changed line should be explainable by the user request, a required invariant update, or cleanup caused by your own change.

## Initialization

The script runs at `document-start`. Initialization proceeds through `S1P_INIT_PHASES`:

- `document-start`
- `body-ready`
- `forum-ready`
- `services-ready`
- `content-ready`
- `deferred`

Rules:

- `document-start` is for low-dependency anti-flicker work only.
- Forum-structure-dependent logic belongs in `forum-ready`.
- First DOM scan and MutationObserver mount belong in `content-ready`.
- Startup sync, recommendation popups, and other non-first-paint work belong in `deferred`.

## Storage

The script uses Greasemonkey APIs (`GM_setValue` / `GM_getValue`). All keys use `s1p_` + `snake_case`.

Core business data keys:

- `s1p_settings`
- `s1p_blocked_threads`
- `s1p_blocked_users`
- `s1p_blocked_posts`
- `s1p_user_tags`
- `s1p_bookmarked_replies`
- `s1p_title_filter_rules`
- `s1p_read_progress`

Sync and lock keys include:

- `s1p_last_modified`
- `s1p_last_sync_timestamp`
- `s1p_sync_baseline_state`
- `s1p_background_sync_lock`
- `s1p_manual_sync_lock`
- `s1p_startup_sync_lock`
- `s1p_foreground_followup_sync_lock`
- `s1p_sync_global_lock`

The sync export object (`exportLocalDataObject`) uses version `5.0` with `version`, `lastUpdated`, `contentHash`, `baseContentHash`, and `data`. Internal data keys use `snake_case`, such as `data.read_progress`.

## Settings Architecture

Every settings read and write must go through the normalization layer:

- `defaultSettings`: canonical defaults for every setting key.
- `buildNormalizedSettings(raw)`: schema migration and normalization on every `getSettings()` and `saveSettings()` call.
- `getSettings()`: reads from the 1-second TTL cache and normalizes on cache miss.
- `getSettingsForWrite()`: deep clones cached settings and returns a mutable copy.
- `saveSettings(settings)`: normalizes, writes `s1p_settings`, updates `last_modified`, writes cross-tab signal, and triggers sync.

When adding a setting, update both `defaultSettings` and `buildNormalizedSettings`, or the setting can be lost for users with existing data.

```js
const settings = getSettingsForWrite();
settings.someSetting = true;
saveSettings(settings);
```

## DOM And Events

- User-generated content must use `textContent`, not `innerHTML`.
- If HTML is required, pass it through `sanitizeHtmlFragment()`.
- Links must use `getSafeUrlAttributeValue()` for href attributes.
- Object keys from stored/imported data must be sanitized with `sanitizeRecordObject()`.
- Use delegated event listeners for dynamically created forum content.
- Settings modal tabs use one delegated click handler via `target.closest(".s1p-tab-btn")`.
- Inline menus/popups should call their destroy/dismiss paths on close.

## UI Surface Glass

- Reuse `.s1p-glass-panel` for large shell-style frosted glass surfaces such as settings and debug panels.
- Do not nest `.s1p-glass-panel` inside another `backdrop-filter` root.
- Top-level fullscreen modals use `.s1p-fullscreen-modal` for viewport coverage and the unified backdrop pseudo-element.
- Top-level fullscreen modal motion should preserve queue order: open the backdrop before the content shell, and close the content shell before fading the backdrop.
- Settings panel `.s1p-modal` must keep direct `backdrop-filter: none`; `.s1p-modal-content.s1p-glass-panel` is the visible shell.
- Settings-local secondary dialogs such as `.s1p-token-config-modal` should be mounted inside `.s1p-modal-content`, not promoted to `.s1p-fullscreen-modal`.
- Settings-hosted secondary dialogs use the explicit secondary glass opt-in (`S1P_SETTINGS_SECONDARY_GLASS_CLASS`, `buildSettingsSecondaryGlassClassName()`, or `useSettingsSecondaryGlass: true`). Do not infer this state from a global `.s1p-modal` query; only use anchored checks such as `isSettingsSecondaryGlassContext(inputEl)` when the trigger element is known.
- Confirm dialog content shells (`.s1p-confirm-content`) use the floating-surface material variables (`--s1p-floating-surface-*`) for background, shadow, and filter while keeping dialog text tokens for readability.
- Keep settings/debug shell blur aligned with `--s1p-dialog-glass-filter`; avoid hardcoded strong blur such as `blur(12px)`.
- Keep `--s1p-dialog-glass-*` available for settings/debug glass panels, settings-local Token date configuration, and dense inner surfaces such as sync comparison blocks.
- Settings `.s1p-modal-body` owns the rounded scroll viewport background and clipping; `.s1p-tab-panels` stays transparent.
- Image viewer previous/next buttons use `--s1p-image-viewer-nav-btn-shadow` for default-state shadow tuning. Do not change hover, background, or blur variables when only adjusting default shadow weight.

## S1 NUX Theme Conflict

`S1 NUX.css` has a global rule like `*:not(.v-binder-follower-content) { transition-duration: .15s }`, which can override S1 Plus animation durations. Test with both standard and NUX themes. Critical transitions may need higher specificity or `!important`.

## Cross-Tab Synchronization

Settings cross-tab sync (`initializeSettingsCacheSync`) classifies changes into:

- Full apply: re-runs `applyChanges()`.
- Lightweight: runs targeted apply functions.
- Passive: updates cache only.

Core data cross-tab sync (`initializeCoreDataCacheSync`) listens to business data keys and a signal key. Other tabs update local caches and schedule debounced DOM refreshes; visible tabs apply pending refreshes immediately.

Signal mechanism: each tab uses `SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID` to avoid reacting to its own writes. `s1p_settings_refresh_signal` acts as a heartbeat.

Fallback polling (`initializeSettingsFallbackSync`) polls settings if `GM_addValueChangeListener` is unreliable.

## Startup And Foreground Sync

- Startup sync is orchestrated in the `deferred` phase.
- `syncDailyFirstLoad` controls daily first-load sync.
- `syncPerLoadCheckEnabled` controls every-page-load checks.
- `syncCheckOnReturnToForeground` controls lightweight foreground remote metadata probes.
- Startup freshness uses a dynamic window: 4 seconds by default, extended up to 15 seconds only when the page is visible and no user click, wheel, touch, or key interaction has happened before the startup decision.
- Foreground probes must not be skipped just because local data appears clean; local clean state does not prove the remote Gist has not changed.
- Shared background push debounce uses one cross-tab owner, but hidden/frozen owner tabs must not rely only on their own `setTimeout`. Lifecycle changes go through the sync lifecycle checkpoint: finalize local mutations first (especially read progress), then re-read pending/shared scheduler state, then either force a hidden-page push or release the owner for handoff. Visible non-owner pages should also watch the owner lease and take over after expiry so pending read-progress pushes do not stay stuck as `Pending(push)` with no diagnostic progress.
- Navbar direct pull/push (`handleForcePull` / `handleForcePush`) is an explicit manual override, not an automatic recovery path. It may preempt active auto sync by clearing queues, conflict pause, mode/global locks, heartbeats, and retry backoff before acquiring the manual lock. Keep `pagehide` / `beforeunload` recovery conservative: wait for lock expiry and rerun from fresh snapshots.

## Release Workflow

Use the `s1plus-release` skill for releases. The standard workflow updates:

1. `@version` metadata in `S1Plus.js`
2. `SCRIPT_VERSION` and `SCRIPT_RELEASE_DATE`
3. `CHANGELOG.md`
4. Welcome popup text in `showFirstTimeWelcomeIfNeeded`

## Gotchas

- Forum HTML structure can change; verify list page, thread page, and search results.
- Sync has manual/background/startup/foreground-follow-up locks plus a global lock. Sync changes require focused concurrency tests.
- If a sync change touches manual override, run `node tests/test-safe-sync-execution.js`; it covers direct pull/push preemption of locks, pending queues, runtime flags, heartbeats, and retry-backoff cancellation.
- Settings tab height transitions use `ResizeObserver`; if tab switching jitters, inspect `animateSettingsModalBodyHeight`, `scheduleModalBodyHeightReconcile`, and `updateObservedModalBodyTabContent`.
- Sticky posts and collapsed threads require special DOM handling.
- `@connect *` exists because `GM_xmlhttpRequest` targets the GitHub Gist API.
