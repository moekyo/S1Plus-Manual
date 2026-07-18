# S1 Plus userscript modularization plan

## Status

- Active branch: `codex/s1plus-modularization-foundation`
- Current canonical runtime source: repository-root `S1Plus.js`
- Transitional module entry: `src/main.js`
- Generated preview artifact: `dist/S1Plus.user.js`
- Foundation goal: establish a behavior-preserving bundle path before moving
  production logic out of the monolithic script.

## Target model

Development source is split into ES modules under `src/`. The release process
bundles those modules into one Tampermonkey-compatible userscript. Users install
one generated file; the browser never has to coordinate multiple runtime
`@require` files.

```text
src/**/*.js
    -> esbuild bundle
    -> dist/S1Plus.user.js
```

## Non-negotiable invariants

1. The released artifact remains one userscript file.
2. The userscript metadata block is the first content in the output and appears
   exactly once.
3. GM APIs continue to run inside the same userscript sandbox.
4. `@run-at document-start` behavior must not be delayed by runtime module
   downloads.
5. Module extraction must not intentionally change user-visible behavior.
6. The repository-root `S1Plus.js` remains directly installable until an
   explicit release cutover is approved.
7. Every extracted module exposes a narrow interface; callers must not regain
   access to private mutable state through test hooks or globals.
8. A migration step is complete only when its focused tests and the full
   userscript bundle verification pass.

## Foundation implementation

The first step deliberately does not move business logic:

- `src/main.js` imports the current `S1Plus.js`.
- `scripts/build-userscript.mjs` strips the canonical metadata block from the
  imported source, bundles the entry, and prepends the same metadata block to
  the generated artifact.
- `scripts/check-userscript-build.mjs` checks metadata equality, duplicate
  metadata, expected runtime markers, remaining ESM syntax, and JavaScript
  syntax.
- `dist/S1Plus.user.js` is a generated preview and is ignored by Git during the
  foundation phase.

Commands:

```bash
npm install
npm run build
npm run check:bundle
npm run verify:bundle
```

## Intended source layout

```text
src/
├── main.js
├── platform/
│   ├── gm-storage.js
│   ├── gm-request.js
│   └── browser-lifecycle.js
├── shared/
│   ├── normalization.js
│   ├── serialization.js
│   ├── ids.js
│   └── timing.js
├── core/
│   ├── initialization.js
│   ├── settings-semantics.js
│   ├── business-data.js
│   └── page-enhancement.js
├── sync/
│   ├── sync-system.js
│   ├── running-sync.js
│   ├── pending-dirty-scheduler.js
│   ├── lifecycle-adapter.js
│   ├── result-phase-policy.js
│   └── indicator-projection.js
├── features/
│   ├── reading-progress/
│   ├── image-viewer/
│   ├── blocking/
│   ├── user-tags/
│   └── bookmarks/
└── ui/
    ├── dialogs/
    ├── settings/
    ├── debug-panel/
    ├── toast/
    └── styles/
```

This is a target map, not permission to create empty abstractions. A directory
should be introduced only when the first real module moves into it.

## Migration sequence

### Phase 0 — Bundle foundation

- Add package and build scripts.
- Generate one installable preview artifact.
- Keep the current root script unchanged.
- Verify metadata and syntax automatically.

### Phase 1 — Pure shared utilities

Extract code with no DOM, GM API, or mutable singleton dependency first:

- normalization and sanitization
- deterministic serialization and hashing helpers
- ID and URL parsing
- immutable result helpers

Each extraction must replace the original definition instead of creating a
second implementation.

### Phase 2 — Existing bounded factories

Move modules that already have an explicit interface:

- settings semantics
- core business data
- image viewer interface
- page enhancement projection

Tests should import the source module directly. Production-only test hooks
should be removed when no longer needed.

### Phase 3 — Reading progress session

Move the complete reading-progress ownership boundary, including observer
lifecycle, confirmation policy, pending writes, lifecycle finalization, and
state projection. The page layer may only use the public session interface.

### Phase 4 — Sync system

Move the six established sync boundaries without flattening them back into one
large module:

- Running Sync
- Pending Dirty Scheduler
- Lifecycle Adapter
- Indicator State Projection
- Result Phase Policy
- `s1pSyncSystem` facade

Adapters for GM storage, timers, browser lifecycle, and remote requests should
be injected at module construction boundaries.

### Phase 5 — UI and page features

Move dialog infrastructure and feature renderers after their data ownership is
stable. CSS should be grouped by owned surface, while the final output may still
contain one generated style payload.

### Phase 6 — Release cutover

Cut over only after bundle parity is demonstrated:

- the generated artifact becomes the canonical installable file
- release and local loader documentation points to the generated output
- direct-root legacy execution is removed
- CI or the release workflow runs `npm run verify:bundle`
- versioning and update URLs are verified against the generated file

## Per-module extraction checklist

1. Identify the current owner, callers, mutable state, side effects, and tests.
2. Define the smallest stable public interface.
3. Move one implementation; do not leave a second compatibility copy.
4. Inject browser or GM dependencies instead of importing hidden globals into
   pure domain modules.
5. Update callers to use the interface.
6. Move tests to direct module imports where practical.
7. Run focused tests and `npm run verify:bundle`.
8. Confirm the generated artifact remains a single userscript with unchanged
   metadata.

## Foundation acceptance criteria

The foundation is ready for the first extraction when all of the following are
true:

- `npm install` completes.
- `npm run verify:bundle` succeeds against the current full `S1Plus.js`.
- `dist/S1Plus.user.js` installs in Tampermonkey as version `6.10.0`.
- A basic forum smoke test shows no startup regression.
- The generated artifact and root script expose the same metadata grants and
  match rules.

## Rollback

Until Phase 6, rollback is immediate: continue installing and releasing the
repository-root `S1Plus.js`. The modular build path is additive and does not
replace the existing production entry.
