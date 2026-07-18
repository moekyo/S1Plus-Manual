import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const outputPath = path.join(repositoryRoot, "dist", "S1Plus.user.js");
const hashFile = async () =>
  createHash("sha256").update(await readFile(outputPath)).digest("hex");
const runBuild = () => {
  const result = spawnSync(process.execPath, ["scripts/build-userscript.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Determinism build failed.");
  }
};

const firstHash = await hashFile();
runBuild();
const secondHash = await hashFile();
if (firstHash !== secondHash) {
  throw new Error(
    `Userscript build is not deterministic: ${firstHash} != ${secondHash}.`
  );
}
console.log(`Verified deterministic userscript SHA-256 ${secondHash}.`);
