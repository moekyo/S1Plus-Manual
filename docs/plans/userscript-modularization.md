# S1 Plus userscript modularization plan

## Status

- Long-lived integration branch: `codex/s1plus-modularization-foundation`
- Stable product baseline: `main`
- Accepted integration stage: **Phase 0 — bundle foundation complete**
- Accepted stage branch: **Phase 0.5 — generated-root cutover complete**, pending merge into the integration branch
- Next technical stage after integration: **Phase 1 — pure shared utilities**, not started
- Canonical metadata/version source: `userscript.config.mjs`
- Editable production source: `src/**/*.js`
- Temporary unmigrated body owner: `src/legacy/main.js`
- Generated formal artifact: repository-root `S1Plus.js`
- Generated preview artifact: `dist/S1Plus.user.js`
- Generated build graph: `dist/S1Plus.meta.json`
- Phase 1 must not begin until Phase 0.5 is merged into `codex/s1plus-modularization-foundation` and the updated integration head is rechecked.
- Every later phase uses a dedicated stage branch created from the latest integration-branch head and merges back into `codex/s1plus-modularization-foundation` after its gates pass.
- Intermediate phases do not merge into `main`; the complete integration branch merges into `main` only after the overall modularization program and final gates are complete.
- GitHub Actions are intentionally not used. Verification is performed locally with locked commands and explicit release checklists.

Branch creation, targeting, sequencing, integration, and the final merge to `main` are governed by [`modularization-branch-workflow.md`](./modularization-branch-workflow.md). That document supersedes any earlier assumption that Phase 0 must merge into `main` before Phase 0.5. This document remains authoritative for technical scope, source ownership, phase gates, rollback, and release architecture.

The accepted Phase 0.5 execution, evidence and integration decision are recorded in [`phase-0.5-generated-root-cutover.md`](./phase-0.5-generated-root-cutover.md).

## Target model

Development code is split into ES modules, but Tampermonkey continues to install one synchronous classic userscript:

```text
src/**/*.js + userscript metadata config
                    ↓
               esbuild bundle
                    ↓
S1Plus.js                    committed formal release artifact
dist/S1Plus.user.js          ignored local preview artifact
```

The production architecture must not depend on runtime `@require` module downloads, native browser ESM, extra chunks, or external imports.

## Source-of-truth contract

### Phase 0: historical foundation contract

| Path | Historical role | Editable? |
|---|---|---:|
| `S1Plus.js` | Canonical runtime source, metadata owner, formal installable file, VM-test input | Yes |
| `src/main.js` | Transitional dependency-graph entry importing root `S1Plus.js` | Build-only |
| `dist/S1Plus.user.js` | Ignored preview bundle | No |
| `dist/S1Plus.meta.json` | Ignored esbuild graph evidence | No |
| `package.json` / `package-lock.json` | Build command and locked toolchain | Yes |

This role was acceptable only for proving the build path. It could not support real module extraction because root `S1Plus.js` was simultaneously source and release artifact.

### Phase 0.5: accepted generated-root contract

Phase 0.5 completed **before the first production function moved out of the legacy body**:

```text
userscript.config.mjs
src/main.js
src/legacy/main.js
src/shared/...
          ↓ build:release
S1Plus.js
```

Current ownership:

| Path | Role | Editable? |
|---|---|---:|
| `userscript.config.mjs` | Sole metadata and version source | Yes |
| `src/**/*.js` | Sole production development source | Yes |
| `src/legacy/main.js` | Temporary owner of the unmigrated legacy body | Yes |
| `S1Plus.js` | Committed generated formal release artifact | No |
| `dist/S1Plus.user.js` | Ignored local preview artifact | No |
| `dist/S1Plus.meta.json` | Ignored preview graph evidence | No |

The release build generates metadata `@version` and runtime `SCRIPT_VERSION` from the same canonical value. Before committing or publishing a release, the developer must run the formal release verification locally:

```bash
npm ci
npm run build:release
npm run verify:release
git status --porcelain
```

A local release script may automate these commands, but no GitHub-hosted CI workflow is required.

## Non-negotiable invariants

1. The released artifact remains one userscript file.
2. Metadata starts at byte zero, has no BOM, uses LF, and appears exactly once.
3. Metadata directive order and values are deterministic.
4. Runtime `SCRIPT_VERSION` equals metadata `@version`.
5. The final output is a synchronous classic script with no runtime imports, chunks, or external modules.
6. GM APIs continue to run in the same userscript sandbox.
7. `@run-at document-start` is not delayed by runtime dependency downloads.
8. Ownership-only migrations do not intentionally change user-visible behavior.
9. There is exactly one production implementation for every symbol.
10. A lower dependency layer never imports a higher layer; import cycles are forbidden.
11. Build and release dependencies are installed with `npm ci` from the committed lockfile.
12. Generated outputs are not edited manually.
13. A phase cannot close without its local automated gates and required manual browser evidence.

## Build implementation

`src/main.js` is the production composition entry and currently imports the intact legacy body from `src/legacy/main.js` solely as a side-effect module. esbuild emits one synchronous IIFE for both preview and formal release targets.

The build remains intentionally conservative:

- `format: "iife"`
- `platform: "browser"`
- `target: "esnext"`
- `splitting: false`
- `treeShaking: false`
- `minify: false`
- `sourcemap: false`
- `metafile: true`

The shared build core:

- reads metadata/version only from `userscript.config.mjs`
- injects the canonical runtime version token into the legacy body
- supports in-memory rendering before artifact writes
- emits byte-identical preview and formal root artifacts
- rejects symlinked output directories and output files
- restricts the formal output target to exact repository-root `S1Plus.js`
- verifies resolved output paths remain inside the repository
- writes through exclusive temporary files and atomic rename
- emits a preview metafile for graph verification

`npm run verify:bundle` runs:

1. metadata parser boundary tests
2. in-memory legacy override and missing-file-safe render checks
3. migration conflict/no-overwrite regression tests
4. output-boundary and symlink safety tests
5. local loader contract checks
6. full preview and formal release builds
7. byte-level metadata, source graph and root/preview parity checks
8. generated-root/preview VM test-hook and behavior probes
9. one-shot composition-entry execution checks
10. deterministic rebuild SHA-256 comparison

The VM harness executes generated root `S1Plus.js` or the preview bundle without converting the existing CommonJS test suite to ESM.

## Commands

```bash
npm ci
npm run build:preview
npm run dev
npm run build:release
npm run verify:migration-readiness
npm run check:metadata-parser
npm run check:in-memory-render
npm run check:migration
npm run check:build-safety
npm run check:loaders
npm run check:bundle
npm run check:bundle-runtime
npm run check:deterministic
npm run verify:bundle
npm run verify:release
```

Existing focused CommonJS tests remain valid:

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-core-business-data-module.js
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
node tests/test-sync-system-facade.js
```

## Dependency direction

```text
platform + shared
       ↓
      core
       ↓
 sync + features
       ↓
       ui
       ↓
      main
```

Rules:

- `shared` contains only environment-independent values and pure helpers.
- `platform` owns GM APIs, remote requests, browser globals, timers, and lifecycle adapters.
- `core` owns stable business contracts and data semantics.
- `sync` and `features` depend on core/platform interfaces, not each other's mutable state.
- `ui` reads projected state and emits intents; it does not own persistence or sync coordination.
- `main` is the composition root and the only normal owner of production singleton construction.
- Broad barrel exports are avoided during migration so dependency direction remains visible.
- A cycle blocks the extraction until an explicit interface or ownership correction removes it.

## Required ownership map

Before extracting a symbol or cluster, record:

| Field | Required content |
|---|---|
| Symbol or cluster | Exact functions, constants, state, CSS/template payload |
| Current owner | Current lexical and file owner |
| Intended module | Final source path |
| Mutable state | Variables, caches, timers, observers, locks |
| Callers | Production call sites and initialization order |
| Side effects | GM, network, DOM, timer, lifecycle, globals |
| Test hooks | Existing `__S1P_TEST_HOOKS__` exposure |
| Tests | Source, module, VM, bundle, browser checks |
| Rollback | How to restore the previous single owner |

Factory definition and singleton construction are separate migration decisions. Move the factory first; move singleton construction only when all production callers are ready to use the new composition root.

## Test classification

| Class | Purpose | Long-term target |
|---|---|---|
| Source structure | Temporary regex/order/CSS-source assertions | Retire or retarget when ownership moves |
| Module unit | Directly import an extracted factory | Primary test for pure/module behavior |
| VM characterization | Execute generated formal userscript in test mode | Preserve legacy behavior during migration |
| Final bundle integration | Execute the built preview userscript through the same VM harness | Required for every migration step |
| Manual browser | Real Tampermonkey install, startup, DOM and visual behavior | Required at phase/release gates |

A production test hook can be removed only after direct module tests and final-bundle coverage replace the same contract. Tests must not keep a symbol in the wrong module merely to preserve a source regex.

## Migration phases and gates

### Phase 0 — Bundle foundation

Status: **complete on `codex/s1plus-modularization-foundation`**.

Scope:

- add locked build tooling
- preserve all runtime code in root `S1Plus.js`
- generate and inspect a preview bundle
- prove metadata, graph, runtime-hook, behavior, one-shot entry, and deterministic parity
- align repository instructions with the active build foundation

Done criteria:

- `npm ci` succeeds without modifying the lockfile
- `npm run verify:bundle` succeeds against the full current script
- representative existing CommonJS tests still run
- symlink-output safety scenarios fail without modifying root `S1Plus.js`
- `dist/S1Plus.user.js` installs as version `6.10.0`
- real forum startup smoke shows no duplicate initialization or startup regression

Rollback: remove build-only files; root `S1Plus.js` remains installable as the canonical Phase 0 source.

### Phase 0.5 — Generated-root cutover

Status: **accepted on `codex/s1plus-modularization-phase-0.5`; pending merge into `codex/s1plus-modularization-foundation`**.

Scope:

- establish independent canonical metadata/version configuration
- move the legacy body to `src/legacy/main.js`
- make `src/main.js` the real production composition entry
- generate and commit root `S1Plus.js`
- introduce preview/watch and formal release build commands
- point local loaders to the continuously rebuilt preview artifact
- add a local committed-artifact drift check to the release command/checklist

Completed criteria:

- `src/` is the only editable production source
- root and preview builds are generated from the same source/config
- root formal artifact remains installable at the existing raw/update path
- Mac and Windows loaders declare metadata permissions from the same contract and load the preview artifact
- no root/source duplicate implementation exists
- running local release verification leaves the committed formal artifact unchanged
- representative CommonJS and browser smoke gates pass
- no Phase 1 business extraction is included

Integration criterion still pending: merge the accepted stage branch into `codex/s1plus-modularization-foundation`.

Rollback: restore the last Phase 0 root source and revert the source cutover as one stage change; never continue development with two active implementations.

### Phase 1 — Pure shared utilities

Status: **not started**.

Candidates:

- numeric ID normalization
- unsafe record-key filtering and record sanitization
- deterministic sorting/serialization
- environment-independent string and URL parsing only

Do not initially move crypto, DOM, window-dependent URL policy, GM storage, timers, initialization, settings singleton, sync, reading progress, image viewer, large CSS, or HTML templates.

Entry criteria: Phase 0.5 merged into the integration branch; ownership and test maps written; a dedicated Phase 1 branch created from the updated foundation head.

Done criteria: one implementation, all callers updated, direct module tests added, VM and bundle checks pass, no user-visible behavior change.

### Phase 2 — Existing bounded factories

Candidates after shared utilities stabilize:

- settings semantics factory
- core business data factory
- image viewer interface factory
- page enhancement projection factory

Move factory definitions before singleton construction. Keep private mutable state behind the established public interface.

### Phase 3 — Reading progress session

Move observer lifecycle, confirmation policy, pending writes, finalization, diagnostics, and state projection as one ownership boundary. Page callers use only the session interface.

### Phase 4 — Sync system

Preserve the six established boundaries:

- Running Sync
- Pending Dirty Scheduler
- Lifecycle Adapter
- Indicator State Projection
- Result Phase Policy
- `s1pSyncSystem` façade

GM storage, timers, lifecycle, and remote requests enter through adapters. Do not flatten the architecture during file extraction.

### Phase 5 — UI and page features

Move UI infrastructure and feature renderers after their data ownership is stable. CSS and HTML templates belong to the surface/module that owns them and are assembled into the final single output.

### Phase 6 — Release workflow closure

Close the migration only after:

- root `S1Plus.js` is reproducibly generated and committed
- the documented local release procedure uses `npm ci`, the formal release build, and drift checks
- GitHub raw/update URLs remain valid
- GitHub Release artifacts and GreasyFork uploads use the generated formal file
- release builds contain no source map; development maps, if introduced, remain external and ignored
- full regression and manual browser evidence pass
- legacy source directory and obsolete test hooks are removed

## Local development and loader policy

Current local development commands:

```text
npm run build:preview   -> dist/S1Plus.user.js
npm run dev             -> watch src and rebuild the preview
npm run build:release   -> generate and validate root S1Plus.js
npm run verify:release  -> local drift and release checks
```

Mac and Windows loaders `@require` the local preview bundle. Their `@grant`, `@connect`, `@match`, and `@run-at` contracts are validated against canonical metadata to prevent drift.

Root `S1Plus.js` is used for formal installation and release validation, not as an editable development source.

## Per-extraction checklist

1. Record current owner, intended owner, mutable state, callers, side effects, hooks, and tests.
2. Confirm allowed dependency direction and absence of cycles.
3. Define the smallest stable public interface.
4. Move one implementation and update all production callers in the same change.
5. Keep environment access behind explicit adapters.
6. Add direct module tests where applicable.
7. Retarget or retire source-structure tests that depended on the old file boundary.
8. Run focused tests and `npm run verify:bundle` locally.
9. Confirm generated root/preview runtime-hook parity and unchanged metadata/version.
10. Perform manual browser verification when DOM, startup, permissions, timing, or visual surfaces are involved.

## Phase 0 acceptance decision

Phase 0 is accepted and closed on `codex/s1plus-modularization-foundation`.

Recorded evidence:

- clean `npm ci` with pinned `esbuild 0.28.1`
- complete `npm run verify:bundle` success, including metadata parsing, build safety, bundle structure, runtime hook/behavior parity, and deterministic output
- representative CommonJS migration, settings, sync, business-data, image-viewer, and page-projection tests passed
- Tampermonkey installation and Stage1st list/detail startup smoke completed without observed regression, duplicate initialization, or metadata drift

## Phase 0.5 acceptance decision

Phase 0.5 implementation and stage gates are accepted on `codex/s1plus-modularization-phase-0.5`.

Recorded evidence:

- migration readiness, in-memory render, conflict/no-overwrite and output safety checks passed
- source ownership cutover committed as `e0dbb489a719ca578963df0660f73768fc275bcd`
- `npm run verify:release` passed after the cutover commit
- generated root and preview were byte-identical
- exact two-input source graph and `186` hook parity passed
- representative settings, sync, business-data, image-viewer and page-projection tests passed
- deterministic SHA-256 was `cae114e5f1346e8bc5c845d817a402761f9d6a9656e444c2f3aad75f378e4700`
- formal root and local preview loader browser smoke passed without observed regression

This acceptance does not start Phase 1. Phase 0.5 becomes part of the integration history only after the stage branch merges into `codex/s1plus-modularization-foundation`.
