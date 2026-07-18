# AGENTS.md

Compact entry guide for AI coding agents in this repository. Default to this file only; open linked docs only when the task matches their trigger.

## Project Snapshot

- S1 Plus is released as one classic Tampermonkey/Greasemonkey userscript for the Stage1st forum.
- Modularization Phase 0 is complete on the long-lived integration branch `codex/s1plus-modularization-foundation`.
- Current stage branch: `codex/s1plus-modularization-phase-0.5`.
- Current stage scope: generated-root source-ownership cutover only; no business-function extraction.
- Run `npm run migrate:phase-0.5-source` once if `src/legacy/main.js` has not yet been created on the local checkout.
- After that migration, `userscript.config.mjs` owns metadata/version, `src/` is the only editable production source, root `S1Plus.js` is the committed generated formal artifact, and `dist/S1Plus.user.js` is the ignored preview artifact.
- Root `.js` tests remain CommonJS and execute generated root `S1Plus.js`; source modules and `.mjs` build scripts use ESM.
- Phase 1 must not start until Phase 0.5 closes and merges back into `codex/s1plus-modularization-foundation`.
- GitHub Actions are not used for this migration. Run the committed verification commands locally.

## On-Demand Docs

Do not preload every document below. Pick the smallest relevant source after inspecting the task and nearby code.

- `docs/plans/phase-0.5-generated-root-cutover.md`: required for the current stage implementation, migration sequence, gates, and rollback.
- `docs/plans/modularization-branch-workflow.md`: required before creating, targeting, merging, or sequencing any modularization stage branch.
- `docs/plans/userscript-modularization.md`: required for long-term source ownership, extraction phases, dependency direction, release architecture, and rollback.
- `src/README.md`: required before changing production source ownership or adding/moving a source module.
- `src/legacy/README.md`: required before touching the intact legacy source body.
- `docs/agents/repository-guide.md`: use when changing settings, sync, storage, initialization, UI shell/glass, S1 NUX compatibility, or release workflow.
- `DEVELOPMENT.md`: use for current build commands, local loaders, source ownership, test classification, and release checks.
- `docs/agents/runtime-development-reference.md`: historical index only. It links to the pre-foundation runtime guide for deep sync/UI/GM-key details; never follow its superseded build, ownership, loader, or release instructions.
- `CHANGELOG.md`: use when documenting user-visible changes or preparing a release.
- `README.md`: use when changing user-facing behavior or public feature descriptions.

## Working Style

- Name assumptions before coding; ask when ambiguity would change the implementation.
- Prefer the smallest code that solves the requested problem; do not add speculative flexibility.
- Keep edits surgical: every changed line should trace to the current stage or to cleanup caused by it.
- Define the verification target before or while implementing, then run the focused check that proves it.

## Essential Rules

- Implement Phase 0.5 only on `codex/s1plus-modularization-phase-0.5`; its merge target is `codex/s1plus-modularization-foundation`, not `main`.
- The one-time migration may transform the existing root source into `src/legacy/main.js` and regenerate root. After that, never edit root `S1Plus.js` manually.
- Keep the complete legacy business body intact in `src/legacy/main.js`; do not extract, reorder, rename, or redesign business functions in this stage.
- Metadata and runtime version must come only from `userscript.config.mjs`.
- Never keep duplicate production implementations in root and `src/`. Root and preview are generated from the same source/config.
- Local development uses `npm run build:preview` or `npm run dev`; formal artifact updates use `npm run build:release`.
- Build changes require local `npm ci`, `npm run verify:bundle`, and the affected representative CommonJS tests.
- Before stage closure, `npm run verify:release` and required Tampermonkey + Stage1st browser gates must pass.
- The final output remains one synchronous classic userscript with no runtime imports, chunks, or source map.
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
npm run migrate:phase-0.5-source
npm run build:preview
npm run dev
npm run build:release
npm run verify:bundle
npm run verify:release

node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-sync-system-facade.js
node tests/test-core-business-data-module.js
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
```
