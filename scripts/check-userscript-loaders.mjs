import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderUserscriptMetadata } from "../userscript.config.mjs";
import { repositoryRoot } from "./userscript-build.mjs";
import { splitUserscriptSource } from "./userscript-source.mjs";

const contractDirectiveNames = new Set(["match", "grant", "connect", "run-at"]);
const getDirectiveName = (line) => line.match(/^\/\/\s+@([^\s]+)/)?.[1] || "";
const selectContractDirectives = (parts) =>
  parts.directives.filter((line) => contractDirectiveNames.has(getDirectiveName(line)));
const getRequireDirectives = (parts) =>
  parts.directives.filter((line) => getDirectiveName(line) === "require");

const canonicalParts = splitUserscriptSource(
  `${renderUserscriptMetadata()}\n`,
  "userscript.config.mjs"
);
const canonicalContract = selectContractDirectives(canonicalParts);

const loaders = [
  {
    path: path.join(repositoryRoot, "S1Plus-Local-Mac.user.js"),
    expectedRequire:
      "// @require      file:///Users/rexxin/Development/S1Plus-Manual/dist/S1Plus.user.js",
  },
  {
    path: path.join(repositoryRoot, "S1Plus-Local-Windows.user.js"),
    expectedRequire:
      "// @require      file:///D:/MyZone/S1Plus-Manual/dist/S1Plus.user.js",
  },
];

for (const loader of loaders) {
  const source = await readFile(loader.path, "utf8");
  const parts = splitUserscriptSource(source, loader.path);
  assert.deepEqual(
    selectContractDirectives(parts),
    canonicalContract,
    `${path.basename(loader.path)} metadata permissions differ from userscript.config.mjs.`
  );
  assert.deepEqual(
    getRequireDirectives(parts),
    [loader.expectedRequire],
    `${path.basename(loader.path)} must load the Phase 0.5 preview artifact.`
  );
}

console.log(
  "[userscript-loaders] Mac/Windows preview paths and metadata contracts verified."
);
