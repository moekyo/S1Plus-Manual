# Source module rules

## Phase 0.5 ownership

This stage performs the generated-root cutover without extracting business
functions:

- `userscript.config.mjs` is the sole userscript metadata and version source.
- `src/main.js` is the production composition entry.
- `src/legacy/main.js` is the temporary sole owner of the intact legacy body.
- root `S1Plus.js` is the committed generated formal installable artifact.
- `dist/S1Plus.user.js` is the ignored generated preview artifact used by local loaders.
- root and preview are built from the same entry, source body, config, and esbuild options.

Run `npm run migrate:phase-0.5-source` once after pulling the cutover tooling. It
moves the existing root body intact, replaces only the runtime version literal
with the canonical build token, and generates matching root/preview artifacts.

After the cutover:

- edit production behavior only under `src/`
- never edit root `S1Plus.js` or `dist/` by hand
- run `npm run build:preview` or `npm run dev` for local browser work
- run `npm run build:release` whenever the committed formal artifact must be updated
- do not start Phase 1 extraction until Phase 0.5 is fully verified and merged back into `codex/s1plus-modularization-foundation`

## Module rules

- Keep the released artifact single-file; do not add runtime `@require` module loading as the production architecture.
- Prefer factory functions with injected dependencies over module-level mutable singletons.
- Domain modules must not read GM storage, browser globals, or DOM state unless those capabilities are explicitly owned by that module.
- Platform adapters own GM APIs, remote requests, timers, and browser lifecycle wiring.
- UI modules render state and emit intents; they must not coordinate sync locks, owner leases, persistence, or remote writes.
- Move the owning implementation and update all callers in the same extraction. Do not retain a root compatibility implementation.
- Move a factory definition before moving singleton construction. Singleton composition belongs at the composition root.
- Avoid broad barrel exports during migration. Import the owning module directly so dependency direction remains visible.
- Do not make user-visible behavior changes in an ownership-only extraction.

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

A lower layer must not import a higher layer. Cross-feature communication flows through an explicit core or façade interface. Import cycles are not allowed.

## Test ownership

Every extraction identifies which checks belong to each class:

- **Module unit:** imports an extracted factory directly.
- **VM characterization:** executes generated root `S1Plus.js` in test mode.
- **Final bundle integration:** executes `dist/S1Plus.user.js` through the same VM harness and compares the public test-hook surface and stable behavior probes.
- **Source structure:** temporary assertions that must be retired when their symbol moves.
- **Manual browser:** real Tampermonkey startup and feature smoke tests.

A production test hook may be removed only after direct module tests and final-bundle coverage replace it.

See `docs/plans/userscript-modularization.md` for source cutover, phase gates, ownership mapping, release policy, and rollback.
