# AGENTS.md

Compact entry guide for AI coding agents in this repository. Default to this file only; open linked docs only when the task matches their trigger.

## Project Snapshot

- S1 Plus is a single-file Tampermonkey/Greasemonkey userscript for the Stage1st forum.
- Main source: `S1Plus.js`.
- No build step, bundler, lint, or typecheck.
- Edit source directly and verify with focused Node tests or manual browser testing.

## On-Demand Docs

Do not preload every document below. Pick the smallest relevant source after inspecting the task and nearby code.

- `docs/agents/repository-guide.md`: use when changing settings, sync, storage, initialization, UI shell/glass, S1 NUX compatibility, or release workflow.
- `DEVELOPMENT.md`: use for deep sync behavior, GM key catalogs, diagnostics, initialization phase details, or test matrices.
- `CHANGELOG.md`: use when documenting user-visible changes or preparing a release.
- `README.md`: use when changing user-facing behavior or public feature descriptions.
- `sync-across-multiple-tab/`: use only for multi-tab sync design, regression analysis, or related tests.

## Working Style

- Name assumptions before coding; ask when ambiguity would change the implementation.
- Prefer the smallest code that solves the requested problem; do not add speculative flexibility.
- Keep edits surgical: every changed line should trace to the request or to cleanup caused by your change.
- Define the verification target before or while implementing, then run the focused check that proves it.

## Essential Rules

- All runtime logic lives in `S1Plus.js`; do not introduce a build pipeline.
- Use the `s1p` prefix for CSS classes, IDs, storage keys, and functions.
- Settings reads/writes must go through `getSettings()`, `getSettingsForWrite()`, and `saveSettings()`.
- When adding a setting, update both `defaultSettings` and `buildNormalizedSettings()`.
- User-generated content uses `textContent`; sanitize HTML with `sanitizeHtmlFragment()` when HTML is unavoidable.
- Links use `getSafeUrlAttributeValue()`.
- Stored/imported object keys use `sanitizeRecordObject()`.
- Sync changes are high-risk; run focused sync tests and consider multi-tab behavior.

## Common Commands

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-startup-sync-freshness.js
node tests/test-foreground-remote-probe.js
node tests/test-foreground-trigger-integration.js
node tests/test-background-sync-shared-debounce.js
node tests/test-safe-sync-execution.js
```
