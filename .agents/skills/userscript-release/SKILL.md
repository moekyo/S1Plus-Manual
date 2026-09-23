---
name: userscript-release
description: Publish an S1Plus release by fast-forwarding the `release` branch, which triggers the Greasy Fork webhook. Use when asked to release/发布/发版 S1Plus, when guarding release-artifact invariants before publishing (Greasy Fork's 2 MiB code ceiling, `@resource` pin freshness), or when a published release never reached Greasy Fork. Metadata steps live in the `s1plus-release` skill.
---

# S1Plus Release — release branch + webhook

`main` carries development; `release` carries the published artifact. The **publish push** — `git push origin vX.Y.Z:release` — is the release action: GitHub notifies Greasy Fork, which creates the new version with no browser step.

Load `s1plus-release` for the metadata workflow, then run these steps on top of it. Steps 1–8 repeat for every release; the setup section below runs once, on the first one.

## Facts that drive the steps

- Greasy Fork matches a push by ref: it builds `https://raw.githubusercontent.com/moekyo/S1Plus-Manual/<ref>/S1Plus.js` and compares that against the script's `sync_identifier` (`.../release/S1Plus.js`), so a `main` push cannot publish.
- Only `modified` files are processed; a push that leaves `S1Plus.js` untouched publishes nothing.
- `@version` must increase every release. The webhook saves with `do_lenient_saving`, which bypasses Greasy Fork's version guard: nothing warns you, and Tampermonkey users simply never receive the update.
- The version's changelog is the pushed commit messages.
- The first matched push flips the script to Webhook sync type; after that Greasy Fork's copy is overwritten by every sync.

## Setup — first release only

Do this once; later releases only verify it in step 1.

1. Create `release` at the last published tag:

   ```bash
   git ls-remote --heads origin release      # empty output means it does not exist yet
   git push origin vX.Y.Z:refs/heads/release # the tag already published manually
   ```

   This push publishes nothing: a new branch on an existing commit carries no new commits, and only `modified` files are processed.

2. Register the sync URL **before** the first publish push — Greasy Fork → script → Source Syncing → `sync_identifier` = `https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release/S1Plus.js`, type `Manual`, save. Order matters: an unmatched push is discarded, and re-pushing the same commit emits no event. If a release went out before this was configured, recover with that page's "Update and sync".

3. Add the webhook — Greasy Fork `/users/webhook-info` → generate the secret; GitHub → repo Settings → Webhooks → payload `https://api.greasyfork.org/users/<user_id>/webhook` (GitHub authenticates with the HMAC header, so the secret goes in the **Secret** field, not in the URL), content type `application/json`, event **push**.

## Workflow

1. Preflight. Read `S1Plus.js`, `CHANGELOG.md`, `README.md`; confirm `// @version` equals `SCRIPT_VERSION`, the target version differs, and the tree is clean. Confirm the setup from the section above still holds: `git ls-remote --heads origin release` names the last published tag's commit. Stop and report on any mismatch.

2. Guard the artifact invariants.
   - `node tests/test-release-artifact-size.js` passes. Greasy Fork's ceiling is `2.megabytes` = 2,097,152 characters (Rails `length` counts characters, not bytes), and this test asserts it.
   - Every `@resource` pin is an immutable pushed commit that serves the working-tree file:

     ```bash
     git log -1 --format=%H -- S1Plus.css
     git log -1 --format=%H -- S1Plus-static-data.json
     curl -sS https://raw.githubusercontent.com/moekyo/S1Plus-Manual/<pinned-sha>/S1Plus.css | cmp - S1Plus.css
     ```

   - When an asset changed after its pinned commit, re-pin it to `git log -1 --format=%H -- <file>` and update the matching `assert.match(...)` SHA in `tests/test-release-artifact-size.js` in the same commit, then re-run the test. A stale pin ships old CSS while every Greasy Fork screen still looks correct.

3. Prepare metadata — `s1plus-release` steps 2 through 6: popup draft and its approval gate (a hard gate), version/date bump, changelog roll, README calibration.

4. Validate. Review `git diff` for the release files plus any re-pinned assertion, then run the full sweep:

   ```bash
   for t in tests/test-*.js tests/settings-migration/test-*.js; do node "$t" >/dev/null || echo "FAIL $t"; done
   ```

5. Commit and tag. `git add` the release files, commit `release: vX.Y.Z`, tag `vX.Y.Z`, then confirm the tag points at that commit.

6. Push `main` and the tag, after the user confirms: `git push origin main`, then `git push origin vX.Y.Z`. Neither publishes.

7. Publish, after the user confirms — this is immediate: `git push origin vX.Y.Z:release`. Fast-forward expected; if it is rejected the branch diverged, so stop and reconcile rather than force-pushing.

8. Verify published. Fetch the published copy and read its `@version` — the fastest proof, and it needs no dashboard:

   ```bash
   curl -sS https://update.greasyfork.org/scripts/543685/S1Plus.user.js | grep -m2 -E '^// @(version|resource)'
   ```

   On this workstation that request needs the system proxy (`-x http://127.0.0.1:7890`); the download endpoint is not behind the Cloudflare challenge that blocks `greasyfork.org` HTML pages. Greasy Fork injects `@downloadURL` / `@updateURL` lines, so compare `@version` and the `@resource` pins rather than byte counts.

   Then confirm the delivery succeeded: GitHub → Settings → Webhooks → the hook → Recent Deliveries, whose push delivery returns `{"updated_scripts":[...]}`.

   ```bash
   gh api repos/moekyo/S1Plus-Manual/hooks --jq '.[] | {id, events, url: .config.url, active}'
   gh api repos/moekyo/S1Plus-Manual/hooks/<hook_id>/deliveries --jq '.[0] | {event, status_code, delivered_at}'
   ```

   Read the response body in the delivery's Response tab. Report commit, tag, published `@version`, and delivery result.

## Diagnosing a publish that did not land

- **403**: GitHub's secret and Greasy Fork's `webhook_secret` differ — regenerate on `/users/webhook-info` and update both.
- **No delivery**: hook inactive, wrong event, or the push left `S1Plus.js` unmodified.
- **`No scripts found`**: the pushed ref does not match `sync_identifier`. A tag push (`refs/tags/...`) never matches; publish by pushing the branch.
- **`updated_failed`**: the delivery response message carries the validation errors.
- **Manual fallback**: Greasy Fork → Source Syncing → "Update and sync", or the form's file-upload field. Prefer the file field over pasting: the web editor's optional syntax highlighting (Ace plus a JS lint worker) freezes on a ~2 MB file.
- Greasy Fork being unreachable from this workstation does not block publishing — the callback is GitHub-to-Greasy Fork.
