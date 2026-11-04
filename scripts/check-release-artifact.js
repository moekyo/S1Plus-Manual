#!/usr/bin/env node
"use strict";

/**
 * Verifies that the minified release artifact is safe to publish to Greasy Fork:
 * - userscript metadata header is copied verbatim from the readable source
 * - @version matches the source
 * - Greasy Fork payload ceiling (both characters and UTF-8 bytes)
 * - no sourceMappingURL / @require / inline Base64 regressions
 * - `node --check` passes
 *
 * Run after `node scripts/build-release-artifact.js` and before publishing.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const sourcePath = path.resolve(repoRoot, readArg("--source", "S1Plus.js"));
const artifactPath = path.resolve(
  repoRoot,
  readArg("--artifact", "dist/S1Plus.user.js")
);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARACTERS = 2 * 1024 * 1024;

const fail = (message) => {
  console.error(`[check-release-artifact] FAIL: ${message}`);
  process.exit(1);
};

const readUserscriptHeader = (file, source) => {
  const match = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\r?\n/);
  if (!match) {
    fail(`userscript metadata block not found: ${path.relative(repoRoot, file)}`);
  }
  return match[0];
};

const source = fs.readFileSync(sourcePath, "utf8");
if (!fs.existsSync(artifactPath)) {
  fail(
    `artifact not found: ${path.relative(repoRoot, artifactPath)} ` +
      "(run `node scripts/build-release-artifact.js` first)"
  );
}
const artifact = fs.readFileSync(artifactPath, "utf8");

const sourceHeader = readUserscriptHeader(sourcePath, source);
const artifactHeader = readUserscriptHeader(artifactPath, artifact);
if (artifactHeader !== sourceHeader) {
  fail(
    "artifact metadata header differs from source; the build script must copy " +
      "the header verbatim (including @version, @match, @grant, @connect, @resource)"
  );
}

const sourceVersion = sourceHeader.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
const artifactVersion = artifactHeader
  .match(/^\/\/ @version\s+(.+)$/m)?.[1]
  ?.trim();
if (!sourceVersion || !artifactVersion) {
  fail("missing @version in source or artifact metadata");
}
if (sourceVersion !== artifactVersion) {
  fail(`@version mismatch: source ${sourceVersion}, artifact ${artifactVersion}`);
}
if (!/^\d+\.\d+\.\d+$/.test(artifactVersion)) {
  fail(`@version is not X.Y.Z: ${artifactVersion}`);
}

const artifactBytes = Buffer.byteLength(artifact);
const artifactCharacters = Array.from(artifact).length;
if (artifactBytes > MAX_BYTES) {
  fail(`artifact is ${artifactBytes} bytes > ${MAX_BYTES} byte ceiling`);
}
if (artifactCharacters > MAX_CHARACTERS) {
  fail(
    `artifact is ${artifactCharacters} characters > ${MAX_CHARACTERS} ` +
      "Greasy Fork ceiling"
  );
}

if (artifactBytes >= Buffer.byteLength(source)) {
  fail(
    `artifact (${artifactBytes} bytes) is not smaller than the readable source ` +
      `(${Buffer.byteLength(source)} bytes); minification likely did not run`
  );
}
if (/sourceMappingURL|sourceURL/.test(artifact)) {
  fail("artifact contains a sourceMappingURL/sourceURL reference");
}
if (/@require\s+/.test(artifactHeader)) {
  fail("artifact metadata must not add @require entries");
}
if (/base64/i.test(artifact)) {
  fail("artifact contains inline Base64 content");
}

const syntaxCheck = spawnSync(
  process.execPath,
  ["--check", path.relative(repoRoot, artifactPath)],
  { cwd: repoRoot, encoding: "utf8" }
);
if (syntaxCheck.status !== 0) {
  process.stderr.write(syntaxCheck.stderr || "");
  fail("artifact failed node --check");
}

const resourcePins = [
  ...artifactHeader.matchAll(/^\/\/ @resource\s+s1p-[^\s]+\s+(\S+)$/gm),
].map((match) => match[1]);
if (resourcePins.length !== 2) {
  fail(`expected 2 @resource pins in artifact header, found ${resourcePins.length}`);
}
resourcePins.forEach((url) => {
  if (!/^https:\/\/raw\.githubusercontent\.com\/moekyo\/S1Plus-Manual\/[0-9a-f]{40}\//.test(url)) {
    fail(`@resource pin is not an immutable 40-char commit URL: ${url}`);
  }
});

console.log(
  `[check-release-artifact] OK @version ${artifactVersion}: ` +
    `${artifactBytes} bytes / ${artifactCharacters} characters ` +
    `(source ${Buffer.byteLength(source)} bytes); ` +
    `${resourcePins.length} @resource pins verifiable`
);
