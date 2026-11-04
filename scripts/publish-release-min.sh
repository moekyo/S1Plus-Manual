#!/usr/bin/env bash
# Publish the minified artifact to the generated `release-min` branch.
#
# Greasy Fork's sync_identifier points at:
#   https://raw.githubusercontent.com/moekyo/S1Plus-Manual/release-min/S1Plus.js
# The publish action appends one linear commit to `release-min` whose tree
# contains only the built artifact at S1Plus.js. main/release stay readable.
#
# The commit MUST have the previous release-min tip as its parent. Greasy Fork
# computes "commits in this push" from before..after; an orphan commit (or a
# force-push that rewrites history) yields `{"message":"No commits found in
# this push."}` and nothing is published.
#
# Usage:
#   scripts/publish-release-min.sh [--version X.Y.Z] [--message "release: vX.Y.Z"] [--dry-run]
#
# Preconditions:
#   - working tree clean
#   - dist/S1Plus.user.js already built from the current S1Plus.js
#     (node scripts/build-release-artifact.js && node scripts/check-release-artifact.js)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION=""
MESSAGE=""
DRY_RUN="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --message) MESSAGE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ARTIFACT="dist/S1Plus.user.js"
if [ ! -f "$ARTIFACT" ]; then
  echo "missing $ARTIFACT; run node scripts/build-release-artifact.js first" >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree is not clean; commit or stash changes before publishing" >&2
  exit 1
fi

SOURCE_VERSION="$(sed -E -n 's|^// @version[[:space:]]+([0-9][0-9.]*)$|\1|p' S1Plus.js | head -1)"
ARTIFACT_VERSION="$(sed -E -n 's|^// @version[[:space:]]+([0-9][0-9.]*)$|\1|p' "$ARTIFACT" | head -1)"
if [ -z "$SOURCE_VERSION" ] || [ "$SOURCE_VERSION" != "$ARTIFACT_VERSION" ]; then
  echo "artifact @version ($ARTIFACT_VERSION) does not match source ($SOURCE_VERSION); rebuild first" >&2
  exit 1
fi
if [ -z "$VERSION" ]; then
  VERSION="$SOURCE_VERSION"
fi
if [ "$VERSION" != "$SOURCE_VERSION" ]; then
  echo "--version $VERSION does not match source @version $SOURCE_VERSION" >&2
  exit 1
fi
if [ -z "$MESSAGE" ]; then
  MESSAGE="release: v$VERSION"
fi

PARENT=""
if git fetch --quiet origin refs/heads/release-min 2>/dev/null; then
  PARENT="$(git rev-parse FETCH_HEAD)"
fi

BLOB="$(git hash-object -w "$ARTIFACT")"
INDEX_FILE="$(mktemp)"
trap 'rm -f "$INDEX_FILE"' EXIT
GIT_INDEX_FILE="$INDEX_FILE" git read-tree --empty
GIT_INDEX_FILE="$INDEX_FILE" git update-index --add --cacheinfo "100644,$BLOB,S1Plus.js"
TREE="$(GIT_INDEX_FILE="$INDEX_FILE" git write-tree)"
if [ -n "$PARENT" ]; then
  PARENT_TREE="$(git rev-parse "$PARENT^{tree}")"
  if [ "$TREE" = "$PARENT_TREE" ]; then
    echo "artifact content is identical to the current release-min tip; refusing to create an empty commit." >&2
    echo "Greasy Fork reports 'No commits found in this push' for commits with no changed files." >&2
    exit 1
  fi
  COMMIT="$(git commit-tree "$TREE" -p "$PARENT" -m "$MESSAGE")"
else
  COMMIT="$(git commit-tree "$TREE" -m "$MESSAGE")"
fi

echo "release-min commit: $COMMIT (v$VERSION, $(wc -c < "$ARTIFACT" | tr -d ' ') bytes artifact)"
echo "parent: ${PARENT:-<root commit; first publish>}"

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run; not pushing. Would run: git branch -f release-min $COMMIT && git push origin $COMMIT:refs/heads/release-min"
  exit 0
fi

git branch -f release-min "$COMMIT"
git push origin "$COMMIT:refs/heads/release-min"
echo "pushed release-min; Greasy Fork webhook should now publish v$VERSION"
