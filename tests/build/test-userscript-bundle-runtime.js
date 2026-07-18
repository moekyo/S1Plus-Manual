"use strict";

const assert = require("assert/strict");
const path = require("path");
const {
  createHarness,
  toPlainObject,
} = require("../s1plus-test-helpers");

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
assert.ok(rootHookKeys.length > 0, "Generated root should expose test hooks.");
assert.deepEqual(
  bundleHookKeys,
  rootHookKeys,
  "Generated root and preview bundle must expose the same test-hook surface."
);

for (const [label, harness] of [
  ["generated root", rootHarness],
  ["preview bundle", bundleHarness],
]) {
  assert.equal(
    harness.sandbox.__S1P_BUNDLE_ENTRY_EXECUTIONS__,
    1,
    `${label} composition-entry tail must execute exactly once.`
  );
  assert.equal(
    harness.sandbox.__S1P_TEST_MODE__,
    true,
    `${label} smoke test must execute in test mode.`
  );
}

const assertBehaviorParity = (label, invoke) => {
  const rootResult = toPlainObject(invoke(rootHarness.hooks));
  const bundleResult = toPlainObject(invoke(bundleHarness.hooks));
  assert.deepEqual(
    bundleResult,
    rootResult,
    `${label} must return the same result from generated root and preview bundle.`
  );
};

assertBehaviorParity("settings change semantics", ({ s1pSettingsSemantics }) =>
  s1pSettingsSemantics.resolveChangedPaths([
    "imageViewerDefaultZoomScalePercent",
    "syncShowTitleSyncStatus",
  ])
);

assertBehaviorParity("image setting normalization", ({ s1pSettingsSemantics }) =>
  s1pSettingsSemantics.normalizeImageSettings({
    limitImagesBySize: "yes",
    useS1PlusImageViewer: null,
    imageViewerDefaultFullDisplay: 1,
    imageViewerDefaultZoomScalePercent: 42,
    imageViewerWheelMode: "invalid",
    imageViewerWheelZoomStepPercent: 999,
    imageViewerWheelScrollStepPercent: -1,
    imagePreviewMaxWidth: "bad",
    imagePreviewMaxHeight: 400,
  })
);

assertBehaviorParity("sync modal projection", ({ s1pSettingsSemantics }) =>
  s1pSettingsSemantics.projectSyncModal({
    syncRemoteEnabled: true,
    syncDailyFirstLoad: true,
    syncPerLoadCheckEnabled: true,
    syncCheckOnReturnToForeground: true,
    syncAutoEnabled: true,
    syncVisibleRemotePollingEnabled: true,
    syncShowAutoSyncIndicator: false,
    syncShowTitleSyncStatus: true,
    syncForcePullOnStartup: true,
    syncBookmarkFullContent: true,
    syncDeviceId: " Device A ",
    syncRemoteGistId: " gist-id ",
    syncRemotePat: " token ",
    syncTokenExpiryEnabled: true,
    syncTokenExpiryDate: 1760000000000,
  })
);

console.log(
  `[userscript-bundle-runtime] Generated root/preview hook surface, behavior probes, and one-shot entry tails verified (${rootHookKeys.length} hooks).`
);
