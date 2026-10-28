# Release Artifact Minification (Proposed)

The published Greasy Fork artifact has approached its 2 MiB ceiling while
`S1Plus.js` must remain readable for review, debugging, tests, and normal
development. Minifying only the published artifact keeps the source readable
and can recover roughly one third of the payload, but it introduces a generated
artifact, a second release path, and harder production debugging. This ADR
records the option and the conditions for adopting it; it does **not** switch
the current publishing flow yet.

## Context

- Canonical source: `S1Plus.js`, currently **2,062,397 bytes / 1,999,594
  characters**.
- Greasy Fork limit: **2,097,152**.
- Remaining space: **34,755 bytes (1.66%)** by byte count; **97,558
  characters (4.65%)** by Rails character count.
- Tests load and inspect the readable source; test-only hook blocks and large
  UI templates are already externalized so the source does not carry them.
- The default release flow (`userscript-release`) fast-forwards `release` to the
  release tag and publishes `release/S1Plus.js` through the Greasy Fork
  webhook. Pushing `main` does not publish.
- A representative minified build is **~1.39 MB**, preserving the complete
  userscript metadata header including `@version`, `@match`, `@grant`,
  `@connect`, and `@resource` pins.

## Decision

Keep `S1Plus.js` as the only source of truth and keep the readable-source
webhook flow as the default. Maintain an optional, reproducible minified
artifact tool:

- `scripts/build-release-artifact.js` copies the userscript metadata header
  verbatim, minifies the body with pinned `terser`, writes
  `dist/S1Plus.user.js`, and runs `node --check`.
- `dist/` is git-ignored and is never edited by hand.
- Tests, review, and debugging continue to use the readable source.

If/when minified publishing is adopted, choose one publishing path:

### A. Manual Greasy Fork upload

Build the artifact and upload `dist/S1Plus.user.js` through Greasy Fork's
"Upload a new version" flow. Simple, but gives up the release-branch webhook
automation and requires manual upload on every release.

### B. Dedicated `release-min` branch + webhook (preferred if adopting)

Rebuild a generated branch for each release and point the Greasy Fork
`sync_identifier` at:

`https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js`

Per release, after the readable source tag exists, copy the built artifact over
`S1Plus.js` on that branch, commit, and force-push `release-min`. This keeps
`main`/`release` readable and preserves webhook automation, at the cost of a
force-pushed generated branch and a one-time Greasy Fork sync-identifier
change. Never force-push `main` or `release`.

## Consequences

- Published payload drops by about one third; runtime behavior should be
  unchanged because minification does not alter semantics.
- Production stack traces and DevTools reading become harder; source maps are
  not published.
- The generated artifact cannot run the source-based test suite; validation is
  `node --check`, metadata comparison, and a smoke check. Behavioral tests stay
  on the readable source.
- Release bookkeeping gains one build artifact and (for option B) one generated
  branch; the source tag remains the release identity for changelog and pin
  management.
- `@resource` files remain separate and are not minified; their pins still
  follow the normal re-pin process.
- A CRLF/encoding or header-copy regression in the build script could affect
  every published release, so the script must stay pinned and reviewed.

## Adoption triggers

Evaluate switching the publishing path when either holds:

- byte headroom drops below roughly **16 KB** (about half of the current
  remaining space), or
- a single planned feature is expected to add more than the remaining
  headroom, or
- download/update payload size becomes a user-visible concern.

Until then, keep the readable-source webhook flow.

## Current status

**Status:** proposed — tooling and documentation exist, publishing flow is
unchanged and no minified artifact has been published.

**Implementation:**

- `scripts/build-release-artifact.js` — reproducible build.
- `docs/release-artifact-minification.md` — operational steps and publishing
  options.
- `dist/S1Plus.user.js` — local generated artifact (git-ignored), not committed.

**Verification:** `node scripts/build-release-artifact.js` produces
`dist/S1Plus.user.js` (~1.39 MB) with the original metadata header and passes
`node --check`; full source test suite passes.

**Next steps if accepted:**

1. Choose option A or B; for B, perform the one-time Greasy Fork
   `sync_identifier` change.
2. Add the artifact build command to the release checklist and verify the
   published `@version` with the normal Greasy Fork delivery check.
3. Record the chosen branch/upload policy in the release skill/guide.
