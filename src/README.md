# Source module rules

`src/` is the future canonical development tree. During the foundation phase,
`src/main.js` imports the repository-root `S1Plus.js` so the generated bundle
can be validated before business logic moves.

## Rules

- Keep the released artifact single-file; do not add runtime `@require` module
  loading as the production architecture.
- Prefer factory functions with injected dependencies over module-level mutable
  singletons.
- Domain modules must not read GM storage, browser globals, or DOM state unless
  those capabilities are explicitly owned by that module.
- Platform adapters own GM APIs, remote requests, timers, and browser lifecycle
  wiring.
- UI modules render state and emit intents; they must not coordinate sync locks,
  owner leases, persistence, or remote writes.
- Do not create forwarding wrappers that preserve two implementations. Move the
  implementation and update all callers in the same extraction step.
- Avoid broad barrel exports during migration. Import the owning module
  directly so dependency direction remains visible.
- Tests should import source factories directly once a module is extracted.
  Remove the corresponding production test hook after callers no longer need
  it.

## Recommended dependency direction

```text
platform/shared
      ↓
     core
      ↓
 sync + features
      ↓
      ui
      ↓
    main
```

A lower layer must not import a higher layer. Cross-feature communication should
flow through an explicit core or facade interface instead of direct mutable
state access.

See `docs/plans/userscript-modularization.md` for the migration sequence and
acceptance criteria.
