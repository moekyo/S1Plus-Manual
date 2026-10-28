# Release Artifact Minification

> Status: **proposed** — tooling exists, but the default webhook flow still
> publishes readable `S1Plus.js`. Decision record and adoption triggers:
> `docs/adr/0002-release-artifact-minification.md`.

`S1Plus.js` is the readable source of truth and the file tests load. The
published Greasy Fork artifact may be minified separately; keep both roles
distinct so normal development, review, and tests never operate on minified code.

## Build

```bash
node scripts/build-release-artifact.js
```

Defaults:

- input: `S1Plus.js`
- output: `dist/S1Plus.user.js`
- minifier: `npx --yes terser@5.44.0` (`--compress`, comments stripped)
- the userscript metadata block is copied verbatim before the minified body
- the result is checked with `node --check`

Override paths with `--input` / `--output`; pin another terser version with
`--terser`. `dist/` is git-ignored.

Current output is about 1.39 MB versus the 2.06 MB readable source; the
userscript metadata (including `@version`, `@match`, `@grant`, and every
`@resource` pin) is unchanged.

## Publishing options

The default webhook release flow in `userscript-release` publishes
`S1Plus.js` from the `release` branch, i.e. the readable source. Choose one of
these if a minified published artifact is required:

### A. Manual Greasy Fork upload (no repository branch change)

1. Build the artifact.
2. Greasy Fork → the script → **Upload a new version** → choose
   `dist/S1Plus.user.js`.
3. Publish with the same version bump/changelog conventions as a normal
   release commit; do not publish the same version twice.

### B. Dedicated artifact branch + webhook

Use a separate branch so `main` and `release` keep readable, reviewable source.
The branch is rebuilt for each release and is not merged back.

1. One-time: create `release-min` from the current published commit and change
   the Greasy Fork sync identifier to
   `https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js`.
2. Per release, after the source tag exists:
   ```bash
   node scripts/build-release-artifact.js
   git switch --create release-min <tag>   # or force-update an existing branch
   cp dist/S1Plus.user.js S1Plus.js
   git add S1Plus.js
   git commit -m "build: minified vX.Y.Z"
   git push --force origin release-min
   ```
3. Verify the Greasy Fork delivery as usual. The artifact keeps the original
   `@version` header from the tag, and only `S1Plus.js` content differs.

Branch B intentionally force-pushes a generated branch; never force-push
`main` or `release`, which carry the readable source history.
