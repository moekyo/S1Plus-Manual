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
const source = fs.readFileSync(sourcePath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const staticData = JSON.parse(fs.readFileSync(staticDataPath, "utf8"));
const countCodePoints = (value) => Array.from(value).length;

const maxCharacters = 2 * 1024 * 1024;
const maxBytes = 2 * 1024 * 1024;
const sourceCharacters = countCodePoints(source);
const sourceBytes = Buffer.byteLength(source);
const sourceByteHeadroom = maxBytes - sourceBytes;

assert.ok(
  sourceCharacters <= maxCharacters,
  `S1Plus.js 超过 Greasy Fork 限制：${sourceCharacters} > ${maxCharacters}`
);
assert.ok(
  sourceBytes <= maxBytes,
  `S1Plus.js 字节数超过 Greasy Fork 限制：${sourceBytes} > ${maxBytes}`
);
assert.match(
  source,
  /@resource\s+s1p-base-css\s+https:\/\/raw\.githubusercontent\.com\/moekyo\/S1Plus-Manual\/a1165e575333eaa9a2c7332f47442844b24aa22b\/S1Plus\.css/
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

console.log(
  `[release-artifact-size] S1Plus.js ${sourceBytes} bytes / ${sourceCharacters} characters (+${sourceByteHeadroom} bytes headroom); CSS resource ${Buffer.byteLength(css)} bytes / ${countCodePoints(css)} characters; limit ${maxBytes}.`
);
