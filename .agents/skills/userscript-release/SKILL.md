---
name: userscript-release
description: Publish an S1Plus release by building the minified artifact and appending a linear commit to the generated `release-min` branch, which triggers the Greasy Fork webhook. Use when asked to release/发布/发版 S1Plus, when guarding release-artifact invariants before publishing (Greasy Fork's 2 MiB artifact ceiling, metadata/header equality, `@resource` pin freshness), or when a published release never reached Greasy Fork. Metadata steps live in the `s1plus-release` skill.
---

# S1Plus Release — `release-min` artifact + webhook

`main` carries readable source; `release-min` carries the published minified
artifact. The **publish action** is now:

```bash
scripts/publish-release-min.sh --version X.Y.Z
```

It builds a one-commit generated branch whose tree contains only the minified
artifact at `S1Plus.js`, fast-forwards `release-min`, and GitHub notifies
Greasy Fork. No browser step is needed. `main` and `release` never contain the
minified artifact.

Load `s1plus-release` for the metadata workflow, then run these steps on top of
it. Steps 1–8 repeat for every release; the setup section below ran once, for
v7.1.1.

## Facts that drive the steps

- Greasy Fork matches a push by ref: it builds
  `https://raw.githubusercontent.com/moekyo/S1Plus-Manual/<ref>/S1Plus.js` and
  compares that against the script's `sync_identifier`
  (`.../release-min/S1Plus.js`). A `main` push cannot publish; a tag push never
  matches.
- Only `modified` files are processed; a push that leaves `S1Plus.js` untouched
  publishes nothing. `release-min` gets one new commit per release whose parent is the previous tip
  commit each release, so `S1Plus.js` always differs.
- `@version` must increase every release. The webhook saves with
  `do_lenient_saving`, which bypasses Greasy Fork's version guard: nothing warns
  you, and Tampermonkey users simply never receive the update.
- The version's changelog is the pushed commit messages. The generated commit
  message is `release: vX.Y.Z` by default.
- The `@resource` pins live in the artifact's copied metadata header and point
  at immutable commits on `main`; `sync_identifier` points at `release-min`.

## Setup — done once (v7.1.1)

Verify these hold before the first release that uses this flow:

1. `release-min` exists on `origin` and is a generated branch only (never merge
   it, never tag it).
2. Greasy Fork → the script → Source Syncing → `sync_identifier` =
   `https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js`,
   type `Manual`, saved.
3. The push webhook from the old flow is still active (same Greasy Fork
   account secret).

## Workflow

1. Preflight. Read `S1Plus.js`, `CHANGELOG.md`, `README.md`; confirm
   `// @version` equals `SCRIPT_VERSION`, the target version differs, and the
   tree is clean. Confirm the Greasy Fork `sync_identifier` is already
   `.../release-min/S1Plus.js` (the branch may be created by this publish; if
   it exists, `git ls-remote --heads origin release-min` must point at a
   previous generated commit). Stop and report on any mismatch.

2. Guard the artifact invariants (after the version bump, before publishing):
   ```bash
   node scripts/build-release-artifact.js
   node scripts/check-release-artifact.js
   node tests/test-release-artifact-size.js
   ```
   The checker verifies the metadata header is byte-identical to the source,
   `@version` matches, the artifact fits Greasy Fork's 2 MiB ceiling (characters
   and bytes), no `sourceMappingURL`/`@require`/inline Base64 regressions, and
   `node --check` passes. Greasy Fork's ceiling is `2.megabytes` = 2,097,152
   characters (Rails `length` counts characters, not bytes); the checker also
   enforces the byte count as a repo guard.

   Every `@resource` pin must be an immutable pushed commit that serves the
   working-tree file:

   ```bash
   git log -1 --format=%H -- S1Plus.css
   git log -1 --format=%H -- S1Plus-static-data.json
   curl -sS https://raw.githubusercontent.com/moekyo/S1Plus-Manual/<pinned-sha>/S1Plus.css | cmp - S1Plus.css
   ```

   When an asset changed after its pinned commit, re-pin it to
   `git log -1 --format=%H -- <file>` and update the matching `assert.match(...)`
   SHA in `tests/test-release-artifact-size.js` in the same commit, then re-run
   the test and rebuild the artifact.

3. Prepare metadata — `s1plus-release` steps 2 through 6: popup draft and its
   approval gate (a hard gate), version/date bump, changelog roll, README
   calibration.

4. Validate. Review `git diff` for the release files plus any re-pinned
   assertion, then run the full sweep:

   ```bash
   for t in tests/test-*.js tests/settings-migration/test-*.js; do node "$t" >/dev/null || echo "FAIL $t"; done
   ```

5. Commit and tag. `git add` the release files, commit `release: vX.Y.Z`, tag
   `vX.Y.Z`, then confirm the tag points at that commit.

6. Push the readable source, after the user confirms: `git push origin main`,
   then `git push origin vX.Y.Z`. Neither publishes.

7. Publish, after the user confirms — build from the tagged source and
   append the new commit to the generated branch:

   ```bash
   node scripts/build-release-artifact.js
   node scripts/check-release-artifact.js
   scripts/publish-release-min.sh --version X.Y.Z
   ```

   `publish-release-min.sh` requires a clean tree and `dist/S1Plus.user.js`
   matching the source `@version`; it prints the generated commit, updates the
   local `release-min` branch, and fast-forwards
   `origin release-min`. A dry run is available with `--dry-run`.

8. Verify published. Fetch the published copy and read its `@version` — the
   fastest proof, and it needs no dashboard:

   ```bash
   curl -sS https://update.greasyfork.org/scripts/543685/S1Plus.user.js | grep -m2 -E '^// @(version|resource)'
   ```

   On this workstation that request needs the system proxy
   (`-x http://127.0.0.1:7890`); the download endpoint is not behind the
   Cloudflare challenge that blocks `greasyfork.org` HTML pages. Greasy Fork
   injects `@downloadURL` / `@updateURL` lines, so compare `@version` and the
   `@resource` pins rather than byte counts.

   Then confirm the delivery succeeded: GitHub → Settings → Webhooks → the hook
   → Recent Deliveries, whose push delivery returns `{"updated_scripts":[...]}`.

   ```bash
   gh api repos/moekyo/S1Plus-Manual/hooks --jq '.[] | {id, events, active, urlHasSecret: (.config.url | test("secret="))}'
   gh api repos/moekyo/S1Plus-Manual/hooks/<hook_id>/deliveries --jq '.[0] | {event, status_code, delivered_at}'
   ```

   Never print `.config.url` while inspecting a hook: a hook created from
   Greasy Fork's Bitbucket snippet carries the secret in its query string, so
   echoing it leaks the secret into the transcript.

   Read the response body in the delivery's Response tab. Report commit, tag,
   published `@version`, and delivery result.

## Diagnosing a publish that did not land

- **403**: GitHub's secret and Greasy Fork's `webhook_secret` differ — regenerate
  on `/users/webhook-info` and update the hook. GitHub replaces `config`
  wholesale on PATCH, so send `config[url]`, `config[content_type]=json`, and
  `config[secret]` in the **same** request: omitting `content_type` silently
  reverts the hook to form encoding (Greasy Fork then finds no commits and
  publishes nothing), and omitting `secret` clears it. Any hook edit ends with a
  ping delivery — GitHub reports 200 only when the HMAC matches.
- **No delivery**: hook inactive, wrong event, or the push left `S1Plus.js`
  unmodified (e.g. re-pushing the same `release-min` commit).
- **`No scripts found`**: the pushed ref does not match `sync_identifier`. A tag
  push (`refs/tags/...`) never matches; publish by pushing `release-min`.
- **`updated_failed`**: the delivery response message carries the validation
  errors, often a stale `@version` or an artifact over Greasy Fork's ceiling.
- **`No commits found in this push`**: Greasy Fork saw no changed files in the
  push. Two causes: (a) the commit is an orphan / force-pushed history, or
  (b) the new artifact is byte-identical to the previous `release-min` commit
  (an empty commit). Keep `release-min` linear and rebuild after the version
  bump; `publish-release-min.sh` refuses empty commits. A newly created
  `release-min` branch also reports this because branch-creation pushes list
  the file under `added`, and Greasy Fork only inspects `modified`; publish
  again with a changed artifact after the branch exists.
- **Manual fallback**: Greasy Fork → Source Syncing → "Update and sync", or the
  form's file-upload field, using `dist/S1Plus.user.js`. Prefer the file field
  over pasting: the web editor's optional syntax highlighting (Ace plus a JS
  lint worker) freezes on a ~2 MB file.
- Greasy Fork being unreachable from this workstation does not block publishing —
  the callback is GitHub-to-Greasy Fork.
