# Source module rules

## Current ownership

Phase 0 is a build-proof stage only:

- `S1Plus.js` is still the canonical runtime source and formal installable file.
- `src/main.js` is only a transitional esbuild entry importing `S1Plus.js`.
- `dist/S1Plus.user.js` is an ignored preview artifact.
- No production function may move into `src/` until Phase 0.5 completes the generated-root cutover described in `docs/plans/userscript-modularization.md`.

After Phase 0.5, `src/` becomes the sole editable production source, root `S1Plus.js` becomes a committed generated release artifact, and duplicate implementations are forbidden.

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
- **VM characterization:** executes the canonical userscript in test mode.
- **Final bundle integration:** executes `dist/S1Plus.user.js` through the same VM harness and compares the public test-hook surface.
- **Source structure:** temporary assertions that must be retired when their symbol moves.
- **Manual browser:** real Tampermonkey startup and feature smoke tests.

A production test hook may be removed only after direct module tests and final-bundle coverage replace it.

See `docs/plans/userscript-modularization.md` for source cutover, phase gates, ownership mapping, release policy, and rollback.
