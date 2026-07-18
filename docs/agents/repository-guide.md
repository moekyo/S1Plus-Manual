# Agent Repository Guide

Detailed guidance for AI coding agents working in this repository. Read this file only when the task touches the matching area.

## Project Shape

S1 Plus is released as one classic Tampermonkey/Greasemonkey userscript. During modularization Phase 0, root `S1Plus.js` is still the canonical runtime source and formal installable file, while `src/main.js` only imports it into an experimental esbuild graph. The ignored preview is `dist/S1Plus.user.js`.

Do not move production logic into `src/` until the Phase 0.5 generated-root cutover in `docs/plans/userscript-modularization.md` is approved and complete. After that cutover, `src/` becomes the only editable source and root `S1Plus.js` becomes a committed generated artifact.

GitHub Actions are intentionally not used for this work. Build, drift, release, and browser checks are executed locally with committed scripts and checklists.

## Development Commands

```bash
npm ci
npm run verify:bundle
```

The verification pipeline covers strict metadata parsing, one-output/no-import graph validation, classic-script parsing, root/bundle VM hook parity, one-shot entry execution, and deterministic output. It does not replace a real Tampermonkey startup smoke test.

Common focused checks:

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-core-business-data-module.js
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
node tests/test-sync-system-facade.js
```

`tests/s1plus-test-helpers.js` remains CommonJS and can execute either root `S1Plus.js` or a supplied built userscript in a VM sandbox. Do not add root `"type": "module"`; ESM scope belongs to `src/package.json` and `.mjs` scripts.

## Build And Source Ownership

- Phase 0 runtime edits still belong in root `S1Plus.js`.
- Never edit `dist/S1Plus.user.js`, `dist/S1Plus.meta.json`, or a future generated root artifact.
- A real module extraction cannot begin while root `S1Plus.js` is both source and release artifact.
- Never keep one implementation in root and another in `src/`.
- Move factory definitions before singleton construction; normal production singletons are assembled at the composition root.
- Build changes require `npm ci` and `npm run verify:bundle` locally.
- The final userscript must remain one synchronous classic script with no runtime imports or chunks.

## Work Discipline

- State assumptions when multiple interpretations would change behavior or data safety.
- Implement the minimum behavior that satisfies the request; avoid speculative abstractions.
- Keep changes surgical and review every changed line.
- Define a focused verification target before or while implementing.
- Ownership-only migrations must not include adjacent user-visible changes.

## Initialization

The script runs at `document-start` through these phases:

- `document-start`: low-dependency anti-flicker work
- `body-ready`
- `forum-ready`: forum-structure-dependent logic
- `services-ready`
- `content-ready`: first DOM scan and MutationObserver mount
- `deferred`: startup sync, recommendations, and non-first-paint work

Do not shift work earlier without proving its dependencies and timing.

## Storage And Core Business Data

All stored/imported record keys must pass `sanitizeRecordObject()`. Settings storage uses `s1p_settings`; settings reads and writes go through `getSettings()`, `getSettingsForWrite()`, and `saveSettings()`.

Core Business Data ownership is private to `s1pCoreBusinessData`. Callers use its frozen logical-kind interface instead of direct GM key access. Core kinds cover blocked threads/users/posts, user tags, bookmarked replies, title-filter rules, and read progress. Do not duplicate its normalizers, storage identities, sync identities, or cross-tab refresh semantics.

Sync and lock changes are high risk. Common identities include local/remote baseline state, background/manual/startup/foreground mode locks, and the global sync lock. Do not create new direct key readers outside the owning layer.

## Settings Architecture

Every setting must exist in:

- `defaultSettings`
- `buildNormalizedSettings(raw)`
- the relevant `s1pSettingsSemantics` definition

Repeated meaning belongs to `s1pSettingsSemantics`: refresh class, runtime intents, modal tabs, sync form projection/patching, and image-setting normalization. Primary page effects route through `s1pPageEnhancementProjection`; settings UI keeps only rendering, input, and animation concerns.

## Page Enhancement Projection

`s1pPageEnhancementProjection.project(event)` owns recurring orchestration for:

- full convergence
- scoped DOM mutation with safe fallback
- settings effects
- core-data semantic refresh intents

Event collectors retain transport and batching only. Do not recreate feature ordering, enable/disable convergence, or scope fallback in MutationObserver, settings, or cross-tab callers.

## DOM, Security, And Events

- User content uses `textContent`.
- Required HTML passes through `sanitizeHtmlFragment()`.
- Link attributes use `getSafeUrlAttributeValue()`.
- Stored/imported object keys use `sanitizeRecordObject()`.
- Dynamic forum content uses delegated listeners where practical.
- Popup/menu close paths must remove their listeners and DOM.

## UI Surface Rules

- Reuse `.s1p-glass-panel` for large settings/debug shells and do not nest it inside another backdrop-filter root.
- Top-level viewport modals use `.s1p-fullscreen-modal`.
- Settings-local secondary dialogs use the complete settings-secondary contract and mount inside settings content.
- Generic dialog structure uses `.s1p-dialog-content` and its size modifiers; surface presets own material, while feature classes own inner layout/content.
- Layered modal opening/closing preserves backdrop/content ordering.
- External image-viewer callers use the frozen `s1pImageViewer` interface, never mutable viewer state.
- Test standard and S1 NUX themes when changing transitions, glass, contrast, or scroll surfaces.

## Sync And Reading Progress Boundaries

`s1pSyncSystem` is the only page-facing sync interface. Page/UI callers express local mutations, lifecycle events, sync requests, and state reads through the façade; they do not coordinate internal locks, timers, owner leases, generations, result policy, or indicator projection.

Running background/startup/foreground sync keeps its network transaction and baseline/pending settlement inside `runRunningSync()`. UI results, refresh, messages, conflict handling, and retry policy happen after locks release. Manual pull/push remains an explicit preemptive override.

`pendingDirtyScheduler` owns Pending Dirty, shared generation, Scheduler Owner/lease, due timers, covered cleanup, handoff, and retry selection. Hidden/frozen owners cannot rely only on their own timers; lifecycle checkpoints and visible-page lease takeover must preserve pending work.

`s1pSyncLifecycleAdapter` is the reversible entry for `visibilitychange`, `pageshow`, `pagehide`, and `beforeunload`. Local finalizers run before scheduler checkpoint and foreground recovery work.

`s1pReadingProgressSession` is the only page-facing reading-progress session interface. Keep observer state, confirmation policy, timers, pending writes, lifecycle finalization, and diagnostics private.

## Modular Extraction Rules

Before moving a symbol, document its owner, state, callers, side effects, hooks, tests, intended module, and rollback. Respect this dependency direction:

```text
platform + shared -> core -> sync/features -> ui -> main
```

Cycles block the extraction. Tests are classified as module unit, VM characterization, final-bundle integration, temporary source-structure, or manual browser. Retire source regex assertions when their ownership boundary moves; do not preserve the wrong architecture for a regex.

## Release Workflow

During Phase 0, the existing release workflow still updates root `S1Plus.js`, including metadata `@version`, runtime `SCRIPT_VERSION`, release date, changelog, and welcome copy. The build checker enforces `@version`/`SCRIPT_VERSION` equality.

Phase 0.5 must replace manual dual version ownership with one canonical metadata/version config and generate the committed root artifact. Before release, run the documented local procedure: `npm ci`, the formal release build, local drift checks, focused tests, and the required browser smoke tests. Publish only the generated formal file. See the modularization plan before changing release or local-loader paths.

## Gotchas

- Forum HTML can change; verify list, thread, and search pages.
- Sync changes require focused concurrency tests and multi-tab reasoning.
- Manual override changes require `node tests/test-safe-sync-execution.js`.
- Sticky posts and collapsed threads need special DOM handling.
- `@connect *` supports current remote request behavior; do not modify permissions as an incidental modularization change.
