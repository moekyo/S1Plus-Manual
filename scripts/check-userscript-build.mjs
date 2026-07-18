import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
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

try {
  new vm.Script(bundleParts.body, { filename: outputPath });
} catch (error) {
  throw new Error(
    `Bundle is not valid classic userscript JavaScript: ${error.message}`
  );
}

console.log(`Verified ${path.relative(repositoryRoot, outputPath)}.`);
