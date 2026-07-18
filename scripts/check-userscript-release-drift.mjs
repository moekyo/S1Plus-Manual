import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { repositoryRoot, userscriptPaths } from "./userscript-build.mjs";

const runGit = (args, { allowFailure = false } = {}) => {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `git ${args.join(" ")} failed.`
    );
  }
  return result;
};

for (const trackedPath of ["S1Plus.js", "src/legacy/main.js"]) {
  const result = runGit(["ls-files", "--error-unmatch", trackedPath], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error(`${trackedPath} must be committed before release verification.`);
  }
}

const [release, preview] = await Promise.all([
  readFile(userscriptPaths.release),
  readFile(userscriptPaths.preview),
]);
if (!release.equals(preview)) {
  throw new Error(
    "Generated formal S1Plus.js differs from dist/S1Plus.user.js."
  );
}

const releaseDiff = runGit(["diff", "--exit-code", "--", "S1Plus.js"], {
  allowFailure: true,
});
if (releaseDiff.status !== 0) {
  throw new Error(
    "Formal S1Plus.js drifted after build:release. Commit the intentional generated artifact or fix the build."
  );
}

const releaseStatus = runGit([
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
  "--",
  "S1Plus.js",
  "src/legacy/main.js",
]);
if (releaseStatus.stdout.trim()) {
  throw new Error(
    `Release ownership files are not clean:\n${releaseStatus.stdout.trim()}`
  );
}

const whitespaceCheck = runGit(["diff", "--check"], { allowFailure: true });
if (whitespaceCheck.status !== 0) {
  throw new Error(whitespaceCheck.stdout || whitespaceCheck.stderr);
}

console.log(
  "[userscript-release-drift] Generated root is tracked, clean, and byte-identical to preview."
);
