import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { repositoryRoot, userscriptPaths } from "./userscript-build.mjs";

const hashFile = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const runPreviewBuild = () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/build-userscript.mjs", "--target=preview"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || "Determinism preview build failed."
    );
  }
};

const releaseHashBefore = await hashFile(userscriptPaths.release);
const firstPreviewHash = await hashFile(userscriptPaths.preview);
if (releaseHashBefore !== firstPreviewHash) {
  throw new Error(
    `Generated root and preview differ before determinism check: ${releaseHashBefore} != ${firstPreviewHash}.`
  );
}

runPreviewBuild();

const releaseHashAfter = await hashFile(userscriptPaths.release);
const secondPreviewHash = await hashFile(userscriptPaths.preview);
if (firstPreviewHash !== secondPreviewHash) {
  throw new Error(
    `Preview build is not deterministic: ${firstPreviewHash} != ${secondPreviewHash}.`
  );
}
if (releaseHashBefore !== releaseHashAfter) {
  throw new Error(
    `Preview build modified generated root: ${releaseHashBefore} != ${releaseHashAfter}.`
  );
}
if (releaseHashAfter !== secondPreviewHash) {
  throw new Error(
    `Generated root and rebuilt preview differ: ${releaseHashAfter} != ${secondPreviewHash}.`
  );
}

console.log(
  `Verified deterministic generated-root/preview SHA-256 ${secondPreviewHash}.`
);
