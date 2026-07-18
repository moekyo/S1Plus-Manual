# AGENTS.md

Compact entry guide for AI coding agents in this repository. Default to this file only; open linked docs only when the task matches their trigger.

## Project Snapshot

- S1 Plus is released as one classic Tampermonkey/Greasemonkey userscript for the Stage1st forum.
- Modularization Phase 0 is complete on the long-lived integration branch `codex/s1plus-modularization-foundation`.
- Phase 0.5 generated-root cutover is accepted on `codex/s1plus-modularization-phase-0.5` and is waiting to merge back into the integration branch.
- `userscript.config.mjs` owns metadata/version, `src/` is the only editable production source, root `S1Plus.js` is the committed generated formal artifact, and `dist/S1Plus.user.js` is the ignored preview artifact.
- `src/legacy/main.js` temporarily owns the intact unmigrated legacy body; no Phase 1 business extraction has started.
- Root `.js` tests remain CommonJS and execute generated root `S1Plus.js`; source modules and `.mjs` build scripts use ESM.
- Phase 1 must not start until Phase 0.5 is merged into `codex/s1plus-modularization-foundation` and the updated integration branch is rechecked.
- GitHub Actions are not used for this migration. Run the committed verification commands locally.

## On-Demand Docs

Do not preload every document below. Pick the smallest relevant source after inspecting the task and nearby code.

- `docs/plans/phase-0.5-generated-root-cutover.md`: accepted Phase 0.5 scope, evidence, gates, integration target, and rollback.
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

- Merge `codex/s1plus-modularization-phase-0.5` only into `codex/s1plus-modularization-foundation`, never into `main`.
- Do not begin Phase 1 directly on the Phase 0.5 branch or integration branch. After integration, create a dedicated Phase 1 branch from the latest foundation head.
- Edit production behavior only under `src/`; never edit root `S1Plus.js` or files under `dist/` manually.
- Keep the complete legacy business body in `src/legacy/main.js` until an approved later stage moves one ownership boundary at a time.
- Metadata and runtime version must come only from `userscript.config.mjs`.
- Never keep duplicate production implementations in root and `src/`. Root and preview are generated from the same source/config.
- Local development uses `npm run build:preview` or `npm run dev`; formal artifact updates use `npm run build:release`.
- Build changes require local `npm ci`, `npm run verify:bundle`, and the affected representative CommonJS tests.
- Formal release/integration review requires `npm run verify:release` and required Tampermonkey + Stage1st browser gates.
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
npm run build:preview
npm run dev
npm run build:release
npm run verify:migration-readiness
npm run verify:bundle
npm run verify:release

node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-sync-system-facade.js
node tests/test-core-business-data-module.js
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
```
