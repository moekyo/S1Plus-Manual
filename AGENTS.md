# AGENTS.md

Compact entry guide for AI coding agents in this repository. Default to this file only; open linked docs only when the task matches their trigger.

## Project Snapshot

- S1 Plus is released as one classic Tampermonkey/Greasemonkey userscript for the Stage1st forum.
- Modularization Phase 0 is complete on the long-lived integration branch `codex/s1plus-modularization-foundation`.
- Every later modularization phase must start on a dedicated stage branch created from the latest integration-branch head, then merge back into `codex/s1plus-modularization-foundation` after its gates pass.
- Intermediate modularization stages do not merge into `main`; the complete integration branch merges into `main` only after the overall modularization program and final regression gates are complete.
- Until the Phase 0.5 generated-root cutover is completed and merged back, repository-root `S1Plus.js` remains the canonical runtime source and formal installable file.
- `src/main.js` remains a transitional esbuild entry that imports `S1Plus.js`; `dist/S1Plus.user.js` is an ignored preview artifact.
- Do not move production logic into `src/` until the Phase 0.5 generated-root cutover in `docs/plans/userscript-modularization.md` is approved and complete.
- Root `.js` tests remain CommonJS. ESM semantics are scoped to `src/` and `.mjs` build scripts.
- GitHub Actions are not used for this migration. Run the committed verification commands locally.

## On-Demand Docs

Do not preload every document below. Pick the smallest relevant source after inspecting the task and nearby code.

- `docs/plans/modularization-branch-workflow.md`: required before creating, targeting, merging, or sequencing any modularization stage branch.
- `docs/plans/userscript-modularization.md`: required for build, source ownership, module extraction, local-loader, or release-cutover work.
- `src/README.md`: required before adding or moving a source module.
- `docs/agents/repository-guide.md`: use when changing settings, sync, storage, initialization, UI shell/glass, S1 NUX compatibility, or release workflow.
- `DEVELOPMENT.md`: use for current build commands, local loaders, source ownership, test classification, and release checks.
- `docs/agents/runtime-development-reference.md`: historical index only. It links to the pre-foundation runtime guide for deep sync/UI/GM-key details; never follow its superseded build, ownership, loader, or release instructions.
- `CHANGELOG.md`: use when documenting user-visible changes or preparing a release.
- `README.md`: use when changing user-facing behavior or public feature descriptions.

## Working Style

- Name assumptions before coding; ask when ambiguity would change the implementation.
- Prefer the smallest code that solves the requested problem; do not add speculative flexibility.
- Keep edits surgical: every changed line should trace to the request or to cleanup caused by your change.
- Define the verification target before or while implementing, then run the focused check that proves it.

## Essential Rules

- Create each new modularization stage branch from the latest `codex/s1plus-modularization-foundation`, and merge the completed stage back into that integration branch rather than `main`.
- Do not implement a normal next stage directly on the integration branch; keep it as the accepted cross-stage integration history.
- Do not create a later stage from an unmerged earlier stage branch, and do not mix unrelated product work into modularization branches.
- Until Phase 0.5 is complete, edit runtime behavior only in root `S1Plus.js`; never edit generated files in `dist/`.
- Do not begin a real module extraction while root `S1Plus.js` is both source and release artifact. Complete Phase 0.5 first.
- Never keep duplicate production implementations in root and `src/`. A cutover or extraction must move one owner and update all callers in the same step.
- Build changes require local `npm ci` and `npm run verify:bundle`; the bundle must remain one synchronous classic userscript with no runtime imports.
- Use the `s1p` prefix for CSS classes, IDs, storage keys, and functions.
- Settings reads/writes must go through `getSettings()`, `getSettingsForWrite()`, and `saveSettings()`.
- When adding a setting, update both `defaultSettings` and `buildNormalizedSettings()`.
- User-generated content uses `textContent`; sanitize HTML with `sanitizeHtmlFragment()` when HTML is unavoidable.
- Links use `getSafeUrlAttributeValue()`.
- Stored/imported object keys use `sanitizeRecordObject()`.
- Sync changes are high-risk; run focused sync tests and consider multi-tab behavior.

## Common Commands

```bash
npm ci
npm run verify:bundle
node tests/settings-migration/test-settings-migration.js
node tests/test-startup-sync-freshness.js
node tests/test-foreground-remote-probe.js
node tests/test-foreground-trigger-integration.js
node tests/test-background-sync-shared-debounce.js
node tests/test-safe-sync-execution.js
```
