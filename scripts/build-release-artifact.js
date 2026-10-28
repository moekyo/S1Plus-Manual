#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = path.resolve(repoRoot, readArg("--input", "S1Plus.js"));
const outputPath = path.resolve(
  repoRoot,
  readArg("--output", "dist/S1Plus.user.js")
);
const terserVersion = readArg("--terser", "5.44.0");
const source = fs.readFileSync(inputPath, "utf8");
const headerMatch = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\r?\n/);
if (!headerMatch) {
  throw new Error(`Userscript metadata block not found in ${inputPath}`);
}
const header = headerMatch[0];
const body = source.slice(header.length);
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", `terser@${terserVersion}`, "--compress", "--format", "comments=false"],
  { input: body, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  throw new Error(`Terser failed with exit code ${result.status}`);
}
const minified = `${header}\n${result.stdout.trim()}\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, minified, "utf8");
const check = spawnSync(process.execPath, ["--check", outputPath], {
  encoding: "utf8",
});
if (check.status !== 0) {
  process.stderr.write(check.stderr || "");
  throw new Error("Minified artifact failed node --check");
}
const headerVersion = header.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
if (!headerVersion) {
  throw new Error("Minified artifact header is missing @version");
}
console.log(
  `[release-artifact] ${path.relative(repoRoot, outputPath)}: ` +
  `${Buffer.byteLength(minified)} bytes (source ${Buffer.byteLength(source)}), ` +
  `@version ${headerVersion}`
);
