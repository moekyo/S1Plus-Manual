import assert from "node:assert/strict";
import {
  getUserscriptMetadataValue,
  splitUserscriptSource,
} from "../../scripts/userscript-source.mjs";

const metadata = [
  "// ==UserScript==",
  "// @name Fixture",
  "// @version 1.2.3",
  "// ==/UserScript==",
].join("\n");

for (const source of [
  `${metadata}\n\nconsole.log('ok');\n`,
  `${metadata.replace(/\n/g, "\r\n")}\r\n\r\nconsole.log('ok');\r\n`,
  `\uFEFF${metadata}\nconsole.log('ok');\n`,
]) {
  const parts = splitUserscriptSource(source, "fixture.user.js");
  assert.equal(parts.metadata, metadata);
  assert.equal(parts.body, "console.log('ok');\n");
  assert.equal(getUserscriptMetadataValue(parts, "version"), "1.2.3");
  assert.equal(parts.source.startsWith("\uFEFF"), false);
  assert.equal(parts.source.includes("\r"), false);
}

for (const [label, source] of [
  ["leading blank", `\n${metadata}\nconsole.log('x');`],
  ["duplicate start", `${metadata}\n// ==UserScript==\nconsole.log('x');`],
  ["duplicate end", `${metadata}\n// ==/UserScript==\nconsole.log('x');`],
  ["missing end", "// ==UserScript==\n// @name Fixture\n"],
  [
    "non-comment metadata",
    "// ==UserScript==\nnot-a-comment\n// ==/UserScript==\n",
  ],
]) {
  assert.throws(
    () => splitUserscriptSource(source, `${label}.user.js`),
    undefined,
    label
  );
}

const markerInsideString = `${metadata}\nconst example = "// ==UserScript==";\n`;
assert.equal(
  splitUserscriptSource(markerInsideString).body,
  'const example = "// ==UserScript==";\n'
);

console.log("[userscript-source] strict metadata parsing verified.");
