# Phase 0.5 generated-root cutover

## Status

- Stage branch: `codex/s1plus-modularization-phase-0.5`
- Integration target: `codex/s1plus-modularization-foundation`
- Phase 0: accepted on the integration branch
- Phase 0.5 implementation and stage gates: **accepted on the stage branch**
- Integration state: **pending merge into `codex/s1plus-modularization-foundation`**
- Phase 1 extraction: not started and prohibited until this stage is merged back
- GitHub Actions: not used; all gates are local

## Accepted ownership

Phase 0.5 changed source ownership and the build/release path only. It did not
extract, reorganize, rename, or redesign business functions.

```text
userscript.config.mjs       sole metadata/version source
src/main.js                 production composition entry
src/legacy/main.js          intact unmigrated legacy body
        ↓ shared esbuild core
S1Plus.js                   committed formal generated artifact
dist/S1Plus.user.js         ignored local preview artifact
dist/S1Plus.meta.json       ignored preview graph evidence
```

After integration, production behavior must be edited only under `src/`.
Root `S1Plus.js` and files under `dist/` remain generated outputs and must not
be edited manually.

## One-time source migration

The accepted cutover used:

```bash
npm ci
npm run migrate:phase-0.5-source
```

The migration command:

1. verifies current root metadata exactly matches `userscript.config.mjs`;
2. verifies root metadata and runtime version are both `6.10.0`;
3. removes only the metadata block from the editable source copy;
4. replaces only the literal runtime version assignment with the build token;
5. writes the remaining body intact to `src/legacy/main.js`;
6. renders one candidate in memory before artifact writes;
7. refuses conflicting pre-existing legacy source or generated-root drift;
8. builds byte-identical preview and formal root artifacts.

Migration regression tests cover initial migration, safe resume, generated-root
idempotence, render failure, content conflict, candidate conflict, and no-overwrite
proof for root and preview.

The migration command is retained for recovery and characterization. Normal
post-cutover development must not rerun it as an everyday build command.

## Development commands

```bash
npm run build:preview
npm run dev
```

Both commands write only ignored `dist` artifacts. Mac and Windows local loaders
load `dist/S1Plus.user.js`, and their permission contracts are validated against
canonical metadata.

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

## Accepted evidence

The following evidence was completed on the stage branch:

- clean `npm ci` with no reported vulnerability;
- `npm run verify:migration-readiness` passed;
- one-time source migration completed and committed as
  `e0dbb489a719ca578963df0660f73768fc275bcd`;
- `npm run verify:release` passed after the migration commit;
- generated root and preview were byte-identical at `1,982,806` bytes;
- exact two-input build graph was verified;
- generated root/preview exposed the same `186` test hooks;
- stable settings, image and sync behavior probes matched;
- deterministic generated-root/preview SHA-256 was
  `cae114e5f1346e8bc5c845d817a402761f9d6a9656e444c2f3aad75f378e4700`;
- representative settings migration, settings semantics, sync façade,
  core-business-data, image-viewer and page-projection tests passed;
- formal generated root browser smoke passed;
- local preview loader browser smoke passed;
- Stage1st list/detail startup, single initialization, navigation, settings panel,
  metadata and console checks showed no observed regression;
- final `git status --short` and `git diff --check` were clean.

## Browser gates

The accepted browser evidence covered both:

1. formal generated root `S1Plus.js`;
2. local loader using `dist/S1Plus.user.js`.

Both paths were tested with only one S1 Plus instance enabled. Metadata `6.10.0`,
document-start behavior, single initialization, navigation entry, settings panel,
list/detail startup, watch-preview loading, and console error boundaries passed.

## Acceptance decision

**Phase 0.5 stage readiness: Yes.**

The stage has satisfied its source-ownership, automated, release-drift,
representative regression and browser requirements. No Phase 1 extraction was
included.

The stage is not yet part of the integration history until it is merged into:

```text
codex/s1plus-modularization-foundation
```

Do not merge this stage into `main`. Do not create or begin the Phase 1 branch
until the Phase 0.5 merge is complete and the integration branch has been
updated and rechecked.

## Rollback

Revert the entire cutover as one stage change: restore the last Phase 0 root source,
remove the generated-source ownership files and commands, and restore loaders
to the Phase 0 root path. Never continue with root and `src/legacy/main.js` both
acting as editable production implementations.
