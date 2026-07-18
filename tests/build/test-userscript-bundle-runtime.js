"use strict";

const assert = require("assert/strict");
const path = require("path");
const { createHarness } = require("../s1plus-test-helpers");

const repositoryRoot = path.resolve(__dirname, "../..");
const bundlePath = path.join(repositoryRoot, "dist", "S1Plus.user.js");

const rootHarness = createHarness();
const bundleHarness = createHarness({
  sourcePath: bundlePath,
  filename: "dist/S1Plus.user.js",
  hookErrorMessage: "Bundled userscript did not expose S1 Plus test hooks.",
});

const rootHookKeys = Object.keys(rootHarness.hooks).sort();
const bundleHookKeys = Object.keys(bundleHarness.hooks).sort();
assert.ok(rootHookKeys.length > 0, "Canonical userscript should expose test hooks.");
assert.deepEqual(
  bundleHookKeys,
  rootHookKeys,
  "Canonical source and final bundle must expose the same test-hook surface."
);

assert.equal(
  rootHarness.sandbox.__S1P_BUNDLE_ENTRY_EXECUTIONS__,
  undefined,
  "Canonical root execution must not contain the transitional bundle entry."
);
assert.equal(
  bundleHarness.sandbox.__S1P_BUNDLE_ENTRY_EXECUTIONS__,
  1,
  "The final bundle entry and its side-effect import must execute exactly once."
);
assert.equal(
  bundleHarness.sandbox.__S1P_TEST_MODE__,
  true,
  "Bundle smoke test must execute in test mode."
);
assert.equal(
  bundleHarness.sandbox.__S1P_TEST_HOOKS__,
  bundleHarness.hooks,
  "Bundle must publish one stable hook object on the userscript global."
);

console.log(
  `[userscript-bundle-runtime] Root/bundle hook parity and one-shot entry verified (${rootHookKeys.length} hooks).`
);
