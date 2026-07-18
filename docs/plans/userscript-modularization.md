# S1 Plus userscript modularization plan

## Status

- Active branch: `codex/s1plus-modularization-foundation`
- Current stage: **Phase 0 — bundle foundation remediation**
- Current canonical runtime source: repository-root `S1Plus.js`
- Transitional module entry: `src/main.js`
- Generated preview artifact: `dist/S1Plus.user.js`
- Generated build graph: `dist/S1Plus.meta.json`
- No production module extraction is permitted until Phase 0.5 is approved and completed.
- GitHub Actions are intentionally not used. Verification is performed locally with locked commands and explicit release checklists.

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

### Phase 0: current contract

| Path | Role | Editable? |
|---|---|---:|
| `S1Plus.js` | Canonical runtime source, metadata owner, formal installable file, VM-test input | Yes |
| `src/main.js` | Transitional dependency-graph entry importing root `S1Plus.js` | Build-only |
| `dist/S1Plus.user.js` | Ignored preview bundle | No |
| `dist/S1Plus.meta.json` | Ignored esbuild graph evidence | No |
| `package.json` / `package-lock.json` | Build command and locked toolchain | Yes |

This role is acceptable only for proving the build path. It cannot support a real module extraction because root `S1Plus.js` is simultaneously source and release artifact.

### Phase 0.5: required generated-root cutover

Phase 0.5 must happen **before the first production function moves into `src/`**:

```text
userscript.config.mjs or equivalent canonical metadata source
src/main.js
src/legacy/main.js
src/shared/...
          ↓ build:release
S1Plus.js
```

After cutover:

| Path | Role | Editable? |
|---|---|---:|
| canonical metadata config | Sole metadata and version source | Yes |
| `src/**/*.js` | Sole production development source | Yes |
| `src/legacy/main.js` | Temporary owner of the unmigrated legacy body | Yes |
| `S1Plus.js` | Committed generated formal release artifact | No |
| `dist/S1Plus.user.js` | Ignored local preview artifact | No |

The release build must generate metadata `@version` and runtime `SCRIPT_VERSION` from the same canonical value. Before committing or publishing a release, the developer must run the formal release build locally and verify:

```bash
npm ci
npm run build:release
git diff --exit-code -- S1Plus.js
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

## Phase 0 foundation implementation

`src/main.js` currently imports the root classic script solely as a side-effect module. esbuild emits one IIFE preview while the original legacy IIFE remains synchronous inside it.

The build is intentionally conservative:

- `format: "iife"`
- `platform: "browser"`
- `target: "esnext"`
- `splitting: false`
- `treeShaking: false`
- `minify: false`
- `sourcemap: false`
- `metafile: true`

The build script:

- strictly parses and removes the canonical metadata block only from the exact root source path
- prepends normalized metadata to the final output
- rejects symlinked output directories and output files
- verifies the resolved output directory remains inside the repository
- writes through an exclusive temporary file and atomic rename
- emits a build metafile for graph verification

`npm run verify:bundle` runs:

1. metadata parser boundary tests
2. full preview build
3. byte-level metadata and build-graph checks
4. root/bundle VM test-hook parity
5. one-shot bundle-entry execution check
6. deterministic rebuild SHA-256 comparison

The VM harness can execute either root `S1Plus.js` or the final bundle without converting the existing CommonJS test suite to ESM.

## Commands

```bash
npm ci
npm run build
npm run check:metadata-parser
npm run check:bundle
npm run check:bundle-runtime
npm run check:deterministic
npm run verify:bundle
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
| VM characterization | Execute canonical userscript in test mode | Preserve legacy behavior during migration |
| Final bundle integration | Execute the built userscript through the same VM harness | Required for every migration step |
| Manual browser | Real Tampermonkey install, startup, DOM and visual behavior | Required at phase/release gates |

A production test hook can be removed only after direct module tests and final-bundle coverage replace the same contract. Tests must not keep a symbol in the wrong module merely to preserve a source regex.

## Migration phases and gates

### Phase 0 — Bundle foundation

Scope:

- add locked build tooling
- preserve all runtime code in root `S1Plus.js`
- generate and inspect a preview bundle
- prove metadata, graph, runtime-hook, one-shot entry, and deterministic parity
- align repository instructions with the active build foundation

Done criteria:

- `npm ci` succeeds without modifying the lockfile
- `npm run verify:bundle` succeeds against the full current script
- representative existing CommonJS tests still run
- symlink-output safety scenarios fail without modifying root `S1Plus.js`
- `dist/S1Plus.user.js` installs as version `6.10.0`
- real forum startup smoke shows no duplicate initialization or startup regression

Rollback: remove build-only files; root `S1Plus.js` remains unchanged and installable.

### Phase 0.5 — Generated-root cutover

Scope:

- establish independent canonical metadata/version configuration
- move the legacy body to `src/legacy/main.js`
- make `src/main.js` the real production composition entry
- generate and commit root `S1Plus.js`
- introduce preview/watch and formal release build commands
- point local loaders to the continuously rebuilt preview artifact
- add a local committed-artifact drift check to the release command/checklist

Done criteria:

- `src/` is the only editable production source
- root and preview builds are generated from the same source/config
- root formal artifact remains installable at the existing raw/update path
- GreasyFork/release instructions identify the formal generated artifact
- Mac and Windows loaders declare metadata permissions from the same contract and load the preview artifact
- no root/source duplicate implementation exists
- running the local release verification leaves the committed formal artifact unchanged

Rollback: restore the last committed generated root artifact and revert the source cutover as one change; never continue development with two active implementations.

### Phase 1 — Pure shared utilities

Candidates:

- numeric ID normalization
- unsafe record-key filtering and record sanitization
- deterministic sorting/serialization
- environment-independent string and URL parsing only

Do not initially move crypto, DOM, window-dependent URL policy, GM storage, timers, initialization, settings singleton, sync, reading progress, image viewer, large CSS, or HTML templates.

Entry criteria: Phase 0.5 complete; ownership and test maps written.

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

Phase 0 loaders continue to read root `S1Plus.js` because it remains canonical.

Phase 0.5 must introduce:

```text
npm run build:preview   -> dist/S1Plus.user.js
npm run dev             -> watch src and rebuild the preview
npm run build:release   -> generate and validate root S1Plus.js
npm run verify:release  -> local drift and release checks
```

Mac and Windows loaders then `@require` the local preview bundle. Their `@grant`, `@connect`, `@match`, and `@run-at` contract must be generated or validated against canonical metadata to prevent drift.

## Per-extraction checklist

1. Record current owner, intended owner, mutable state, callers, side effects, hooks, and tests.
2. Confirm allowed dependency direction and absence of cycles.
3. Define the smallest stable public interface.
4. Move one implementation and update all production callers in the same change.
5. Keep environment access behind explicit adapters.
6. Add direct module tests where applicable.
7. Retarget or retire source-structure tests that depended on the old file boundary.
8. Run focused tests and `npm run verify:bundle` locally.
9. Confirm root/bundle runtime-hook parity and unchanged metadata/version.
10. Perform manual browser verification when DOM, startup, permissions, timing, or visual surfaces are involved.

## Phase 0 acceptance decision

Local automated foundation readiness requires all repository commands above. Final Phase 0 approval additionally requires a real Tampermonkey installation and basic Stage1st startup smoke test; connector-only or fixture-only results must not be represented as that browser evidence.
