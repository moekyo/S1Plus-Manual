#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { createHarness, staticDataSource } = require("./s1plus-test-helpers");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");
const cssPath = path.join(repoRoot, "S1Plus.css");
const staticDataPath = path.join(repoRoot, "S1Plus-static-data.json");
const artifactPath = path.join(repoRoot, "dist", "S1Plus.user.js");
const source = fs.readFileSync(sourcePath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const staticData = JSON.parse(fs.readFileSync(staticDataPath, "utf8"));
const countCodePoints = (value) => Array.from(value).length;

// Greasy Fork 的 2 MiB 上限约束的是**发布产物**，不是可读源码。
// 源码是构建输入，可以超过上限；发布流程会先构建 dist/S1Plus.user.js
// 再用 scripts/check-release-artifact.js 校验（此处做同样的尺寸断言）。
const maxCharacters = 2 * 1024 * 1024;
const maxBytes = 2 * 1024 * 1024;
const sourceCharacters = countCodePoints(source);
const sourceBytes = Buffer.byteLength(source);

assert.match(
  source,
  /@resource\s+s1p-base-css\s+https:\/\/raw\.githubusercontent\.com\/moekyo\/S1Plus-Manual\/c60337a0537cb9e8dd60b81d7533ee929252d7c0\/S1Plus\.css/
);
assert.match(
  source,
  /@resource\s+s1p-static-data\s+https:\/\/raw\.githubusercontent\.com\/moekyo\/S1Plus-Manual\/3eeacec2007c7a4c64345e37659f63a7f8fe2521\/S1Plus-static-data\.json/
);
assert.match(source, /@grant\s+GM_getResourceText/);
assert.equal((source.match(/sourceMappingURL|sourceURL/g) || []).length, 0);
assert.equal((source.match(/@require\s+/g) || []).length, 0);
assert.equal((source.match(/base64/gi) || []).length, 0);
assert.equal((source.match(/@font-face/gi) || []).length, 0);
assert.ok(Array.isArray(staticData.uiShowcase.categories));
assert.ok(Object.keys(staticData.uiShowcase.sections).length >= 17);
assert.equal((staticDataSource.match(/<script|javascript:/gi) || []).length, 0);
assert.ok(css.includes("__S1P_NARROW_SCREEN_MAX_WIDTH_PX__"));
assert.ok(css.includes("__S1P_SVG_ICON_ARROW_MASK__"));
assert.equal((css.match(/<script|javascript:/gi) || []).length, 0);

const addedStyles = [];
createHarness({
  resourceTexts: { "s1p-base-css": css },
  addedStyles,
});

assert.equal(addedStyles.length, 1, "应注入一份主 CSS 资源。");
const injectedCss = addedStyles[0];
assert.ok(injectedCss.includes("@media (max-width: 909px)"));
assert.ok(injectedCss.includes("animation: s1p-auto-sync-indicator-enter 320ms"));
assert.ok(injectedCss.includes("animation: s1p-auto-sync-indicator-exit 260ms"));
assert.ok(injectedCss.includes("__S1P_") === false);

// dist/ 是构建产物，干净检出时可能不存在；发布流程会先构建再跑同一个断言。
let artifactSummary = "artifact not built (run scripts/build-release-artifact.js before releasing)";
if (fs.existsSync(artifactPath)) {
  const artifact = fs.readFileSync(artifactPath, "utf8");
  const artifactBytes = Buffer.byteLength(artifact);
  const artifactCharacters = countCodePoints(artifact);
  assert.ok(
    artifactBytes <= maxBytes,
    `发布产物超过 Greasy Fork 字节上限：${artifactBytes} > ${maxBytes}`
  );
  assert.ok(
    artifactCharacters <= maxCharacters,
    `发布产物超过 Greasy Fork 字符上限：${artifactCharacters} > ${maxCharacters}`
  );
  const sourceVersion = source.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
  const artifactVersion = artifact.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
  assert.equal(artifactVersion, sourceVersion, "产物 @version 必须与源码一致");
  artifactSummary = `artifact ${artifactBytes} bytes / ${artifactCharacters} characters (@version ${artifactVersion})`;
}

console.log(
  `[release-artifact-size] ${artifactSummary}; readable source ${sourceBytes} bytes / ${sourceCharacters} characters (not limited); CSS resource ${Buffer.byteLength(css)} bytes / ${countCodePoints(css)} characters; limit ${maxBytes}.`
);
