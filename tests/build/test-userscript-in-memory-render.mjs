import assert from "node:assert/strict";
import vm from "node:vm";
import {
  renderUserscriptMetadata,
  USERSCRIPT_VERSION,
} from "../../userscript.config.mjs";
import {
  GENERATED_USERSCRIPT_BANNER,
  renderUserscript,
} from "../../scripts/userscript-build.mjs";
import { splitUserscriptSource } from "../../scripts/userscript-source.mjs";

const legacySourceOverride = `(function () {\n  "use strict";\n  const SCRIPT_VERSION = __S1P_USERSCRIPT_VERSION__;\n  globalThis.__S1P_IN_MEMORY_RENDER_VERSION__ = SCRIPT_VERSION;\n})();\n`;

const result = await renderUserscript({ legacySourceOverride });
const parts = splitUserscriptSource(result.output, "in-memory userscript candidate");

assert.equal(parts.metadata, renderUserscriptMetadata());
assert.ok(parts.body.startsWith(`${GENERATED_USERSCRIPT_BANNER}\n`));
assert.equal(parts.body.includes("__S1P_USERSCRIPT_VERSION__"), false);
assert.equal(parts.body.includes(`"${USERSCRIPT_VERSION}"`), true);

const outputEntries = Object.entries(result.metafile.outputs || {});
assert.equal(outputEntries.length, 1);
const [outputPath, outputInfo] = outputEntries[0];
assert.equal(outputPath.endsWith("dist/S1Plus.user.js"), true);
assert.equal(outputInfo.entryPoint, "src/main.js");
assert.deepEqual(Object.keys(result.metafile.inputs || {}).sort(), [
  "src/legacy/main.js",
  "src/main.js",
]);
assert.deepEqual(outputInfo.imports || [], []);

const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(parts.body, sandbox, {
  filename: "in-memory userscript candidate",
});
assert.equal(sandbox.__S1P_IN_MEMORY_RENDER_VERSION__, USERSCRIPT_VERSION);

console.log(
  "[userscript-in-memory-render] Missing-file-safe legacy override, source graph, version injection, and classic execution verified."
);
