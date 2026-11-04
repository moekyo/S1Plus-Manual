# Release Artifact Minification

> Status: **adopted** (v7.1.1) — the published Greasy Fork artifact is built
> from `S1Plus.js`, minified, and pushed to the generated `release-min` branch.
> `main` and `release` keep the readable source. Decision record:
> `docs/adr/0002-release-artifact-minification.md`.

`S1Plus.js` is the readable source of truth and the file tests load. The
published Greasy Fork artifact is minified separately; keep both roles distinct
so normal development, review, and tests never operate on minified code.

## Build

```bash
node scripts/build-release-artifact.js
node scripts/check-release-artifact.js
```

Defaults:

- input: `S1Plus.js`
- output: `dist/S1Plus.user.js`
- minifier: `npx --yes terser@5.44.0` (`--compress`, comments stripped)
- the userscript metadata block is copied verbatim before the minified body
- the result is checked with `node --check`

Override paths with `--input` / `--output`; pin another terser version with
`--terser`. `dist/` is git-ignored.

Current output is about 1.39 MB versus the ~2.0 MB readable source; the
userscript metadata (including `@version`, `@match`, `@grant`, and every
`@resource` pin) is unchanged.

`scripts/check-release-artifact.js` verifies the header is byte-identical to the
source, `@version` matches, the artifact fits Greasy Fork's 2 MiB ceiling
(characters and bytes), no `sourceMappingURL`/`@require`/inline Base64 slipped
in, both `@resource` pins are immutable commit URLs, and `node --check` passes.

## Publishing (adopted: dedicated artifact branch + webhook)

`main` and `release` stay readable. `release-min` is a generated branch that is
advanced by one linear commit per release and contains only `S1Plus.js` (the
minified artifact). Each new commit's parent is the previous tip, so GitHub and
Greasy Fork see a normal fast-forward push. Greasy Fork's `sync_identifier` is:

```
https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js
```

Per release, after the readable source release commit and tag exist:

```bash
node scripts/build-release-artifact.js
node scripts/check-release-artifact.js
scripts/publish-release-min.sh --version X.Y.Z
```

The script creates a one-commit branch whose tree contains only the built
artifact at `S1Plus.js`, updates the local `release-min` branch, and
fast-forwards it. The Greasy Fork webhook then publishes that push.

Do not push release tags to `release-min`; the branch is generated and the tag
stays on `main`. Keep `release-min` linear: a force-push that rewrites its
history makes Greasy Fork report `No commits found in this push`. Never
force-push `main` or `release`.

### One-time Greasy Fork change

Greasy Fork → the script → Source Syncing → `sync_identifier` =
`https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js`,
type `Manual`, save. The webhook itself is unchanged. The old `release` branch
can stay for history but is no longer updated or published.

### Verify

Fetch the published copy and read its header (`@version` + `@resource` pins):

```bash
curl -sS https://update.greasyfork.org/scripts/543685/S1Plus.user.js | grep -m2 -E '^// @(version|resource)'
```

Then check the GitHub webhook delivery result (`updated_scripts`), as described
in the `userscript-release` skill.

## Why the source can exceed 2 MiB now

Greasy Fork's ceiling applies to the published artifact only. `S1Plus.js` is a
build input and may exceed 2 MiB; `tests/test-release-artifact-size.js` asserts
the built artifact stays under the ceiling (and reports the readable source size
as information only).
