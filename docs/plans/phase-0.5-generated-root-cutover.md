# Phase 0.5 generated-root cutover

## Status

- Stage branch: `codex/s1plus-modularization-phase-0.5`
- Integration target: `codex/s1plus-modularization-foundation`
- Phase 0: accepted on the integration branch
- Phase 0.5: implementation in progress
- Phase 1 extraction: prohibited until this stage closes and merges back
- GitHub Actions: not used; all gates are local

## Scope

Phase 0.5 changes source ownership and the build/release path only. It must not
extract, reorganize, rename, or redesign business functions.

Target ownership:

```text
userscript.config.mjs       sole metadata/version source
src/main.js                 production composition entry
src/legacy/main.js          intact unmigrated legacy body
        ↓ shared esbuild core
S1Plus.js                   committed formal generated artifact
dist/S1Plus.user.js         ignored local preview artifact
dist/S1Plus.meta.json       ignored preview graph evidence
```

## One-time source migration

After pulling the stage tooling, run:

```bash
npm ci
npm run migrate:phase-0.5-source
```

The migration command must:

1. verify current root metadata exactly matches `userscript.config.mjs`;
2. verify root metadata and runtime version are both `6.10.0`;
3. remove only the metadata block from the editable source copy;
4. replace only the literal runtime version assignment with the build token;
5. write the remaining body intact to `src/legacy/main.js`;
6. build byte-identical preview and formal root artifacts;
7. refuse conflicting pre-existing legacy source or unsafe output paths.

Review the migration diff before committing. `src/legacy/main.js` should be the
former root body with no business reorganization. Root `S1Plus.js` should be a
generated classic userscript with canonical metadata and a generated-file banner.

## Development commands

```bash
npm run build:preview
npm run dev
```

Both commands write only ignored `dist` artifacts. Mac and Windows local loaders
must load `dist/S1Plus.user.js` and their permission contract must remain aligned
with canonical metadata.

## Formal artifact commands

```bash
npm run build:release
npm run verify:bundle
npm run verify:release
```

`verify:bundle` rebuilds root and preview from the same source/config and verifies:

- strict metadata parsing and byte-zero/LF/no-BOM output;
- canonical metadata and single version ownership;
- safe preview and formal output boundaries, including symlink rejection;
- exact source graph: `src/main.js` + `src/legacy/main.js`;
- one output, no chunks, no runtime imports, no source map;
- generated root and preview byte equality;
- classic-script parsing;
- root/preview hook and stable behavior parity;
- one-shot composition-entry execution in both outputs;
- deterministic preview rebuild without formal-root mutation;
- Mac/Windows loader path and permission parity.

`verify:release` additionally requires committed `S1Plus.js` and
`src/legacy/main.js` to remain clean after rebuilding.

## Representative regression commands

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-sync-system-facade.js
node tests/test-core-business-data-module.js
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
```

Before stage closure, run the broader relevant CommonJS/source-structure suite and
retarget only tests that genuinely depended on the old editable-root boundary.
Do not weaken behavior assertions merely to accommodate generated formatting.

## Browser gates

Install only one S1 Plus instance at a time and verify both:

1. formal generated root `S1Plus.js`;
2. local loader using `dist/S1Plus.user.js`.

Confirm metadata `6.10.0`, document-start behavior, single initialization,
navigation entry, settings panel, list/detail startup, and absence of new uncaught
errors or unhandled rejections.

## Done criteria

Phase 0.5 may close only when:

- `src/` is the only editable production source;
- `userscript.config.mjs` solely owns metadata/version;
- root is a committed generated artifact and is never manually edited;
- root and preview are reproducibly byte-identical;
- local loaders use preview and pass metadata-contract checks;
- automated, representative CommonJS, release-drift, and browser gates pass;
- no root/source duplicate implementation exists;
- no Phase 1 business-function extraction is included;
- the stage branch is reviewed and merged into `codex/s1plus-modularization-foundation`.

## Rollback

Revert the entire cutover as one stage change: restore the last Phase 0 root source,
remove the new generated-source ownership files and commands, and restore loaders
to the Phase 0 root path. Never continue with root and `src/legacy/main.js` both
acting as editable production implementations.
