---
name: s1plus-release
description: Execute the standardized S1Plus userscript release workflow. Use when asked to release/发布/发版 a new S1Plus version, synchronize release metadata and docs, refresh the first-run welcome update popup, create a release commit, or create a release tag. Handles version/date updates in `S1Plus.js`, changelog rollout from `## [Unreleased]`, and a required preview-and-approval checkpoint for the first-run welcome popup before continuing release commit/tag creation.
---

# S1Plus Release

Run this workflow when the user gives a target version (for example `6.4.0`).

## Inputs

- Require a target version in `X.Y.Z` format.
- Use today's local date in `YYYY-MM-DD` format as the release date.

## Workflow

1. Perform preflight checks.
   - Read `S1Plus.js`, `CHANGELOG.md`, and `README.md`.
   - Extract current version from `// @version` and `SCRIPT_VERSION`.
   - Confirm these two current versions match before editing; if they do not, stop and report.
   - Confirm target version is different from current version.
2. Draft release popup highlights first (preview only, no commit/tag yet).
   - Use the current `## [Unreleased]` content as source material.
   - Produce a candidate `bodyHtml` highlights draft for `showFirstTimeWelcomeIfNeeded`.
   - Keep wording concise and user-facing: summarize outcomes/benefits, avoid deep implementation detail.
   - Prefer 3 to 5 short highlight paragraphs, grouped by theme (for example security, sync, UX/features).
   - Keep the modal title format unchanged (`S1 Plus v${SCRIPT_VERSION} 更新亮点`).
3. Human checkpoint (mandatory).
   - Show the generated popup highlights draft to the user for review.
   - Explicitly ask for confirmation before continuing.
   - If user requests changes, iterate only this popup draft until approved.
   - Do not proceed to version bump, changelog roll, commit, or tag until approval is received.
4. Update `S1Plus.js` after popup draft is approved.
   - Set `// @version` to the target version.
   - Set `const SCRIPT_VERSION` to the target version.
   - Set `const SCRIPT_RELEASE_DATE` to today's date.
   - Write the approved popup highlights into `showFirstTimeWelcomeIfNeeded`.
   - Re-read and verify all updated fields.
5. Roll `CHANGELOG.md` for release.
   - Keep `## [Unreleased]` at the top and leave it empty after release.
   - Move all content currently under `## [Unreleased]` into a new section directly below it: `## [vX.Y.Z] - YYYY-MM-DD`.
   - Preserve existing subsection structure and content order.
   - Ensure `---` is present between adjacent version sections.
6. Calibrate `README.md`.
   - Use current `S1Plus.js` behavior as source of truth.
   - Update README to reflect complete current capabilities, not only incremental changes in this release.
7. Validate local changes.
   - Review `git diff -- S1Plus.js CHANGELOG.md README.md`.
   - Verify versions and release date are consistent across edited content.
   - Verify approved `showFirstTimeWelcomeIfNeeded` highlights align with the released changelog and are written for general users.
8. Create release commit and tag.
   - Stage release files: `git add S1Plus.js CHANGELOG.md README.md`.
   - Check recent commit style with `git log -n 3 --oneline`.
   - Commit with exact message: `release: vX.Y.Z`.
   - Create tag with exact name: `vX.Y.Z`.
9. Report completion.
   - Summarize changed files, commit hash, and tag.
   - Ask whether to push with `git push` and `git push --tags`.

## Guardrails

- Execute steps in strict order and confirm each step before continuing.
- Popup draft approval is a hard gate; no release commit/tag steps before user confirmation.
- Re-read target files before editing when content may have changed.
- Preserve changelog conventions (`Unreleased` on top, version sections below, `---` separators).
- Do not push commits or tags unless the user explicitly confirms.
