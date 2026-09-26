# Agent Repository Guide

Detailed guidance for AI coding agents working in this repository. Read this file only when the task touches the matching area.

## Project Shape

S1 Plus is a single-file Tampermonkey/Greasemonkey userscript that enhances the Stage1st forum. All runtime logic lives in `S1Plus.js`; there is no build system, bundler, compilation step, lint, or typecheck.

## Development Commands

- Edit `S1Plus.js` directly.
- Local dev loader: use `S1Plus-Local-Mac.user.js` or `S1Plus-Local-Windows.user.js` as the Tampermonkey loader that `@require`s local `S1Plus.js`.
- Settings migration test: `node tests/settings-migration/test-settings-migration.js`
- Settings semantics test: `node tests/test-settings-semantics-module.js`
- Core Business Data module test: `node tests/test-core-business-data-module.js`
- Image Viewer interface test: `node tests/test-image-viewer-interface.js`
- Page Enhancement Projection test: `node tests/test-page-enhancement-projection.js`
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

Settings storage key:

- `s1p_settings`

Core Business Data keys (owned by the private `s1pCoreBusinessData` kind catalog):

- `s1p_blocked_threads`
- `s1p_blocked_users`
- `s1p_blocked_posts`
- `s1p_user_tags`
- `s1p_bookmarked_replies`
- `s1p_title_filter_rules`
- `s1p_read_progress`

Callers use the six frozen module methods `read`, `write`, `projectForSync`, `importFromSync`, `syncFromStorage`, and `bindCrossTab` with logical kind names. Do not read/write these keys directly, duplicate their sync field names or normalizers, or expose the catalog. The legacy `s1p_title_keywords` identity also stays private to the catalog and is retired by title-rule writes.

Sync and lock keys include:

- `s1p_last_modified`
- `s1p_last_sync_timestamp`
- `s1p_sync_baseline_state`
- `s1p_background_sync_lock`
- `s1p_manual_sync_lock`
- `s1p_startup_sync_lock`
- `s1p_foreground_followup_sync_lock`
- `s1p_sync_global_lock`

旧版 `s1p_pending_manual_sync_intent` 及其 `:*` records 不再属于运行时状态；启动时只做 best-effort 清理，不会迁移或执行。

The sync export object (`exportLocalDataObject`) uses version `5.0` with `version`, `lastUpdated`, `contentHash`, `baseContentHash`, and `data`. Internal data keys use `snake_case`, such as `data.read_progress`.

## Settings Architecture

Every settings read and write must go through the normalization layer:

- `defaultSettings`: canonical defaults for every setting key.
- `buildNormalizedSettings(raw)`: schema migration and normalization on every `getSettings()` and `saveSettings()` call.
- `getSettings()`: reads from the 1-second TTL cache and normalizes on cache miss.
- `getSettingsForWrite()`: deep clones cached settings and returns a mutable copy.
- `saveSettings(settings)`: normalizes, writes `s1p_settings`, updates `last_modified`, writes cross-tab signal, and triggers sync.

Repeated per-setting meaning belongs to the frozen `s1pSettingsSemantics` interface. Use `resolveChangedPaths()` for refresh class, runtime intents, and modal tabs; use `projectSyncModal()` / `buildSyncSettingsPatch()` for sync-form mapping; use `normalizeImageSettings()` from `buildNormalizedSettings()`. Keep the private catalog private. Bespoke tab markup and rerendering stay with the settings modal; primary feature-toggle DOM effects go through `s1pPageEnhancementProjection`.

When adding a setting, update `defaultSettings`, `buildNormalizedSettings`, and its `s1pSettingsSemantics` definition, or the setting can be lost for users with existing data or fall back to a full refresh.

```js
const settings = getSettingsForWrite();
settings.someSetting = true;
saveSettings(settings);
```

## Page Enhancement Projection

`s1pPageEnhancementProjection` is the frozen shared seam for the four recurring forum-DOM orchestration flows identified by the architecture review. Its only public method is `project(event)`:

- `full` owns the complete feature order and enable/disable convergence.
- `mutation` validates connected scopes and limits, then owns scoped, `fallback-scoped`, and `fallback-full` dispatch.
- `settings` consumes `s1pSettingsSemantics` output and preserves modal versus cross-tab effects.
- `core-data` consumes semantic refresh intents from `s1pCoreBusinessData`; it never interprets GM keys or sync field names.

Those recurring event sources retain event collection and transport only: MutationObserver batching/finally cleanup, settings-modal rendering and animation, and cross-tab signal/cache coordination stay with their callers. Within these four flows, do not recreate feature ordering, enable/disable branches, or scope fallback outside `project(event)`. Feature internals remain behind their existing interfaces, including `s1pReadingProgressSession` and `s1pImageViewer`.

Current non-goals remain explicit action-driven convergence paths, including data import, the link-setting reset action, and clear-data reset. They may deliberately reuse direct feature refresh calls until a separate review proves that broadening the projection seam improves locality.

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
- Settings-local secondary dialogs such as `.s1p-token-config-modal` and `.s1p-reading-progress-modal` should reuse `.s1p-settings-secondary-modal`, mount inside `.s1p-modal-content`, and not be promoted to `.s1p-fullscreen-modal`.
- Generic first-level and settings-secondary dialogs share `.s1p-dialog-content` for shell structure and the `compact` / `default` / `wide` / `expanded` size modifiers (400 / 480 / 550 / 580px). Build them through `buildS1pDialogContentClassName()` so the same shell receives either first-level confirm glass or settings-secondary glass from its surface context. Feature-specific classes belong only on inner business content; do not create feature-specific outer content classes.
- Settings-hosted secondary dialogs opt in to the complete secondary modal contract with `useSettingsSecondaryModal: true`: `.s1p-settings-secondary-modal` owns the local container, settings content owns the DOM host, and its direct `.s1p-dialog-content.s1p-settings-secondary-glass` child exclusively owns the shell material. Do not opt in to the glass class alone. A portal-mounted subordinate control may reuse the material only through an explicit anchored context check such as `isSettingsSecondaryGlassContext(inputEl)`; the Token date picker is the current exception.
- Layered modal animation is shared through `runS1pLayeredModalOpenSequence()` and `closeS1pLayeredModalWithSequence()`. The animation helpers own state and timing only; `.s1p-fullscreen-modal` remains exclusive to first-level viewport coverage.
- First-level window glass is centralized on `.s1p-first-level-glass` plus a preset class. Use `s1p-first-level-glass--settings` for the main settings shell and `s1p-first-level-glass--confirm` for generic top-level confirm/input/advanced dialogs.
- Keep `.s1p-modal-content` for the large settings shell, `.s1p-glass-panel` for shell material semantics, and `.s1p-dialog-content` for generic dialog structure. Glass preset classes own background, shadow, and filter; structural classes own layout, sizing, scrolling, text, and motion behavior.
- Keep settings/debug shell blur aligned with `--s1p-dialog-glass-filter`; avoid hardcoded strong blur such as `blur(12px)`.
- Keep `--s1p-dialog-glass-*` available for settings/debug glass panels, the image-viewer toolbar divider, and dense inner surfaces such as sync comparison blocks. Token date configuration uses settings secondary glass instead.
- Settings `.s1p-modal-body` owns the rounded scroll viewport background and clipping; `.s1p-tab-panels` stays transparent.
- Image viewer previous/next buttons use `--s1p-image-viewer-nav-btn-shadow` for default-state shadow tuning. Do not change hover, background, or blur variables when only adjusting default shadow weight.
- External image-viewer callers use the frozen `s1pImageViewer` seam: `readState()` for the `open` / `closing` / `closed` projection, `refreshDefaultTransform()` for settings effects, and `closeImmediately()` for host teardown. Keep mutable lifecycle flags and close-finalization sequencing inside the viewer implementation.

## S1 NUX Theme Conflict

`S1 NUX.css` has a global rule like `*:not(.v-binder-follower-content) { transition-duration: .15s }`, which can override S1 Plus animation durations. Test with both standard and NUX themes. Critical transitions may need higher specificity or `!important`.

Theme authority is singular end-to-end. S1 Plus maintains one canonical runtime theme state, then projects it onto `html.s1p-theme-light` / `html.s1p-theme-dark`; CSS and JS compatibility fixes consume that canonical state/projection rather than independently reading system theme. NUX availability is re-read from the rendered `NUXISENABLED` marker and must converge both enabled → disabled and disabled → enabled. When NUX is enabled, a valid computed `--darktheme: 0|1` is authoritative. If `--darktheme` is absent (notably NUX custom themes), infer the effective theme conservatively from the rendered NUX palette such as `--bg` / `--t`; ambiguous palettes remain explicit unknown and default light rather than silently following the OS. `prefers-color-scheme` is retained as a synchronization trigger for NUX's own auto-theme CSS, and may be used as a resolver fallback only when an independent signal proves NUX is actually in system-follow mode. The current NUX integration exposes no reliable `@autotheme` runtime signal, so ordinary runtime resolution does not enable that fallback.

## Cross-Tab Synchronization

Settings cross-tab sync (`initializeSettingsCacheSync`) asks `s1pSettingsSemantics` to classify changes into:

- Full apply: submits a full settings event to `s1pPageEnhancementProjection`.
- Lightweight: submits targeted runtime intents through the same projection seam.
- Passive: skips broad content reapply; explicitly listed infrastructure intents such as navbar/title refresh still route through that seam.

The same Settings Semantics result supplies targeted runtime effects and open-modal tab refresh. Unknown paths fail safe to Full apply; callers must not recreate path lists or source-regex wiring assertions.

Core data cross-tab sync is owned by `s1pCoreBusinessData.bindCrossTab()` and initialized through `initializeCoreDataCacheSync`. The private catalog binds business data keys and the signal bridge, refreshes module caches, and publishes semantic refresh intents; `s1pPageEnhancementProjection` maps those intents to DOM effects, so callers must not interpret storage keys or rebuild effect switches.

Signal mechanism: each tab uses `SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID` to avoid reacting to its own writes. `s1p_settings_refresh_signal` acts as a heartbeat.

Fallback polling (`initializeSettingsFallbackSync`) polls settings if `GM_addValueChangeListener` is unreliable.

## Startup And Foreground Sync

- Startup sync is orchestrated in the `deferred` phase.
- `syncDailyFirstLoad` controls daily first-load sync.
- `syncPerLoadCheckEnabled` controls every-page-load checks.
- `syncCheckOnReturnToForeground` controls lightweight foreground remote metadata probes.
- Startup freshness uses a dynamic window: 4 seconds by default, extended up to 15 seconds only when the page is visible and no user click, wheel, touch, or key interaction has happened before the startup decision.
- Foreground probes must not be skipped just because local data appears clean; local clean state does not prove the remote Gist has not changed.
- A foreground follow-up result with a non-retryable `blocked + soft` reason (for example `local_changed_with_remote_timestamp_drift`) must persist its exact `requestId + remoteUpdatedAt + lastResult*`, stop recovery/reprobe timers, and return the indicator to idle while retaining the durable fact. New local mutation, a newer remote timestamp, or a successful explicit manual sync may clear or replace that marker. Retryable read-progress pending-write/debounce/initialization reasons remain eligible for retry. Keep attempt, suppression, settlement, and clear events structured so a log distinguishes “retrying” from “waiting for a new fact”. Foreground state uses a v3 mutable `record:<requestId>` plus a `terminal:<requestId>` cancellation/completion fence. The `current` marker and v2 main key are only compatibility/signal hints; the getter scans records and terminal fences and selects by immutable registration clock, fixed registrationCreatedAt, and deterministic requestId tie-break, so a late marker publication cannot hide a newer observation. Legacy records without a registration clock remain readable through the legacy marker rule until v3 metadata exists. `GM_listValues` is required for v3 shared authority; without it, new shared writes fail closed instead of pretending an unprotected read/write is CAS. Mutable records are retention-pruned while the winning active record is protected; terminal fences are compacted to the winning watermark, and late writes are rejected by the fence rather than reviving cancelled or completed work. The remote Gist protocol and business-data schema are unchanged.
- Foreground registration ordering is immutable after registration: the authority comparator uses `registrationClock`, then fixed `registrationCreatedAt`, then a deterministic `requestId` tie-break; mutable `lastSeenAt`, `lastAttemptAt`, and `lastResultAt` never change which request wins. A terminal fence only outranks the mutable record for the same registration identity, and terminal watermark pruning uses the same comparator, so compaction cannot make a late old write authoritative. The canonical terminal key remains a compatibility mirror, while immutable per-writer terminal candidates are merged by registration identity, fixed terminal-kind priority (`completed > cancelled > other`), and stable fields; `terminalAt` is not the sole winner. Settlement consumers must classify results as current, retryable, cancelled, or superseded; cancelled/superseded results skip Result Phase and cannot schedule old retries or alter a newer indicator. Result Phase captures an immutable retry owner token containing request identity, retry generation, and timer identity before awaiting; cleanup is allowed only when that exact token still owns the retry.
- Do not infer Result Phase ownership from `retained` alone. `retained` or `ignored` with `newer_pending_foreground_remote_sync`, `concurrent_pending_foreground_remote_sync`, or `concurrent_remote_probe_recovered` is `superseded`; only the current request's retryable/soft-block retention remains eligible for its follow-up policy. Retry scheduling with an expected request must validate the authoritative pending before replacing or clearing a timer. Direct follow-up cleanup captures an immutable retry owner token before awaiting Result Phase and may clear only that exact token (or a token explicitly returned by this Result Phase adapter); it must not reread mutable global request/generation fields and treat them as R1's ownership, so a late R1 continuation cannot cancel R2 or an unrelated same-request retry.
- Registration identity is carried through normalized v3 pending values, attempt/settlement calls, mutable records, and terminal fences. Terminal writes use the captured `registrationClock` (or the same request's existing record as fallback) and never reconstruct it from the non-authoritative current marker. A v3 record missing that clock still fails closed for mutable/terminal writes, but the unsettleable intent is abandoned instead of retained — retaining it replays a full follow-up sync on every foreground resume and keeps re-arming the navbar pending indicator. Promoting a legacy/v2 record to v3 must assign the clock in that same write, or the record becomes unsettleable on the spot; legacy/v2 records remain readable and settle using their fixed registration timestamp/requestId ordering. Concurrent terminal candidates for one request are retained until watermark compaction keeps the winning evidence keys, so a late weaker mirror write cannot erase a stronger terminal fence. The current marker remains a compatibility/allocation hint, not terminal identity or authority.
- `s1pSyncSystem` is the only page-facing sync interface. Page and UI code express local mutations, lifecycle changes, semantic sync requests, or projected-state reads through the façade; do not call the production Pending Dirty Scheduler, lifecycle adapter, Result Phase Policy, or projection singleton directly. `initialize()` owns lifecycle binding followed by Scheduler Owner and Pending Dirty recovery; if either recovery step fails, it hands off any partially recovered Scheduler Owner before unbinding lifecycle support so initialization remains retryable. `dispose()` is for explicit host teardown in tests or a future SPA remount, not ordinary page unload; it must clear the façade's initialized flag even when lifecycle unbinding throws.
- Background, startup, foreground follow-up, and manual sync share the same mode/global execution-exclusion boundary. `runTransaction` must not resolve until baseline/writer state is persisted and covered pending/shared work is cleared; the lifecycle intentionally accepts no separate finalizer. Indicator aggregation, refresh, messages, conflict UI, retry scheduling, and manual-intent settlement run only after both locks are released. A navbar manual request has priority only within its current page context: with no active execution it immediately invokes the existing manual handler; with an active execution it stores the latest direction in that coordinator's memory, hands off only that page's not-yet-started automatic scheduling, and projects `Pending(push|pull)`. At the next execution boundary it becomes `awaiting_confirmation`; the confirmation owns no execution lock, and a busy race keeps the page-local pending intent for the next boundary. The coordinator serializes only short intent preparation and result settlement; the network `executeDirection()` runs outside that queue, so a later click can register immediately while the earlier execution is still running. Request sequence is checked before every await continuation may mutate state, and lifecycle generation separately invalidates explicit teardown continuations. Refresh, tab close, or context destruction does not restore it; another tab neither sees nor inherits it. Actual manual side effects remain protected by the shared tokenized mode/global execution locks.
- Treat heartbeat stop and post-release cleanup as best-effort: log their failures without skipping lock release or an already-produced sync result. Acquisition exceptions and lock-unavailable callback failures still propagate; ordinary lock contention returns a skipped result.
- `s1pReadingProgressSession` is the only page-facing interface for a Reading Progress Session. Page/settings/data callers use `attach()`, `reset()`, or `discard()`; sync diagnostics and local-mutation paths use `readState()` and `recordLocalMutation()`; the lifecycle finalizer delegates to `handleLifecycle()`. Keep observer ownership, confirmation policy, timers, pending-write coalescing, and diagnostic session state private. Tests exercise the same session interface and assert persisted Read Progress instead of setting tracking fields directly.
- Inside the sync system, `pendingDirtyScheduler` is the only module interface for Pending Dirty, shared generation, Scheduler Owner/lease, due timers, covered cleanup, and shared-vs-local retry selection. Page callers enter through `s1pSyncSystem`; internal scheduler scenario tests may construct the module over the harness's in-memory GM adapter. `handoff()` must also cancel this tab's owner-recovery watch when another tab still owns the lease, so façade rollback cannot leave a delayed takeover behind. Keep owner/timer/coverage helpers inside its implementation. Covered cleanup must revalidate before deletion and recover newer `last_modified` as Pending Dirty after a cross-tab delete race.
- Shared background push debounce uses one cross-tab owner, but hidden/frozen owner tabs must not rely only on their own `setTimeout`. Lifecycle changes go through the sync lifecycle checkpoint: finalize local mutations first (especially read progress), then re-read pending/shared scheduler state, then either force a hidden-page push or release the owner for handoff. Visible non-owner pages should also watch the owner lease and take over after expiry so pending read-progress pushes do not stay stuck as `Pending(push)` with no diagnostic progress. Pending recovery may treat a covered shared debounce as non-duplicative, but it still has to arm owner lease recovery for visible non-owner pages.
- `s1pSyncLifecycleAdapter` is the single sync entry for `visibilitychange`, `pageshow`, `pagehide`, and `beforeunload`. Keep local mutation finalizers and Scheduler checkpoint work before foreground storage resync, Pending Dirty recovery, remote probing, and visible polling. Read-progress lifecycle flushes belong to its registered finalizer rather than separate DOM listeners. Keep `bind()` / `unbind()` reversible and idempotent: remove all four DOM listeners, release reference-counted GM/activity-listener leases, stop polling, and invalidate delayed callbacks on unbind. `pagehide` / `beforeunload` may hand off Scheduler Owner, and the lifecycle generation must fence new Running Sync starts. They must not take over an already-running transaction or delete an unsettled execution lock; a lock in the `acquiring` window, or a verified lock still at the local `transaction_start` boundary with `transactionStarted !== true`, may be canceled safely. The Running Sync fence remains closed after the scheduler's unload microtask and reopens only on `pageshow`, proven canceled-unload recovery, or explicit unbind. Fence only the handed-off generation so the unloading tab cannot reclaim its own empty-owner notification without blocking newer generations; a canceled `beforeunload` may recover Scheduler Owner only from a later task that proves the page is still alive, visible, and still on the same lifecycle transition.
- Navbar direct pull/push (`handleForcePull` / `handleForcePush`) is an explicit manual request, not an automatic recovery path. `s1pCreateManualSyncIntentCoordinator()` is the display/request authority for these two directions: no active execution means immediate execution; an active valid mode/global lock creates one small in-memory record in the current page context with `waiting_for_execution_boundary` and the navbar shows the requested direction as `Pending`, never as a busy drop. The record contains only version, direction, creation time, and phase. The coordinator additionally keeps a non-persisted request sequence so an older awaited execution cannot restore an earlier direction, including same-millisecond clicks; confirmation callbacks capture that sequence and validate it again immediately before calling the executor. After the lock boundary is free, that page changes the record to `awaiting_confirmation` and presents the existing custom modal; the dialog itself holds no execution lock. A confirmation race with a new execution closes the modal and returns the same local record to waiting. Same-page clicks overwrite the direction; refresh, tab close, and a new page context do not restore it. Different tabs have independent pending state and do not elect an owner or transfer state. Explicit `unbind` / `dispose` advances a separate coordinator lifecycle generation, invalidating old queue continuations, reconcile finally callbacks, timers, and modal callbacks; `pagehide` / `beforeunload` retain their existing page-local suspension behavior. Explicit teardown clears the local record. Legacy GM manual-intent mirror/record keys are only removed best-effort at startup and are never migrated into an operation. Actual force execution still calls the shared tokenized execution lock path, while foreground probe generations and Pending Dirty coverage remain separate mechanisms.

## Release Workflow

Use the `s1plus-release` skill for the metadata steps:

1. `@version` metadata in `S1Plus.js`
2. `SCRIPT_VERSION` and `SCRIPT_RELEASE_DATE`
3. `CHANGELOG.md`
4. Welcome popup text in `showFirstTimeWelcomeIfNeeded`

Use the `userscript-release` skill to publish. It guards the release-artifact invariants (Greasy Fork's 2 MiB code ceiling, `@resource` pin freshness), then fast-forwards `release` to the new tag with `git push origin vX.Y.Z:release`, which triggers the Greasy Fork webhook. Pushing `main` never publishes.

## Gotchas

- Forum HTML structure can change; verify list page, thread page, and search results.
- Sync has manual/background/startup/foreground-follow-up locks plus a global lock. Sync changes require focused concurrency tests.
- If a sync change touches manual override, run `node tests/test-safe-sync-execution.js`; it covers execution-lock exclusion, preservation of foreign locks and pending work, local scheduling handoff, and stale retry cancellation.
- Settings tab height transitions use `ResizeObserver`; if tab switching jitters, inspect `animateSettingsModalBodyHeight`, `scheduleModalBodyHeightReconcile`, and `updateObservedModalBodyTabContent`.
- Sticky posts and collapsed threads require special DOM handling.
- `@connect *` exists because `GM_xmlhttpRequest` targets the GitHub Gist API.
