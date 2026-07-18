import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  countUserscriptMetadataBlocks,
  normalizeUserscriptMetadata,
  splitUserscriptSource,
} from "./userscript-source.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sourcePath = path.join(repositoryRoot, "S1Plus.js");
const outputPath = path.join(repositoryRoot, "dist", "S1Plus.user.js");

const [canonicalSource, bundle] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8"),
]);
const canonicalParts = splitUserscriptSource(canonicalSource, sourcePath);
const bundleParts = splitUserscriptSource(bundle, outputPath);

if (
  normalizeUserscriptMetadata(canonicalParts.metadata) !==
  normalizeUserscriptMetadata(bundleParts.metadata)
) {
  throw new Error("Bundle metadata differs from canonical S1Plus.js metadata.");
}

if (countUserscriptMetadataBlocks(bundle) !== 1) {
  throw new Error("Bundle must contain exactly one userscript metadata block.");
}

for (const marker of [
  "SCRIPT_VERSION",
  "s1pSyncSystem",
  "s1pReadingProgressSession",
]) {
  if (!bundleParts.body.includes(marker)) {
    throw new Error(`Bundle is missing expected runtime marker: ${marker}.`);
  }
}

if (/^\s*(?:import|export)\s/m.test(bundleParts.body)) {
  throw new Error("Bundle still contains ESM import/export syntax.");
}

const syntaxCheck = spawnSync(process.execPath, ["--check", outputPath], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
if (syntaxCheck.status !== 0) {
  throw new Error(
    syntaxCheck.stderr || syntaxCheck.stdout || "Bundle syntax check failed."
  );
}

console.log(`Verified ${path.relative(repositoryRoot, outputPath)}.`);
