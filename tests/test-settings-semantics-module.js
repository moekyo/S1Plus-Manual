#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, toPlainObject } = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露 Settings Semantics 测试 seam。",
});
const { defaultSettings, s1pSettingsSemantics } = hooks;

assert.ok(s1pSettingsSemantics, "缺少 Settings Semantics 模块。");
assert.equal(Object.isFrozen(s1pSettingsSemantics), true);
assert.deepStrictEqual(Object.keys(s1pSettingsSemantics).sort(), [
  "buildSyncSettingsPatch",
  "normalizeImageSettings",
  "projectSyncModal",
  "resolveChangedPaths",
]);

const testChangedPathSemantics = () => {
  const full = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths(["enablePostBlocking"])
  );
  assert.deepStrictEqual(full, {
    effectClass: "full",
    runtimeIntents: [],
    modalTabs: ["threads"],
  });

  const lightweight = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths([
      "imageViewerDefaultZoomScalePercent",
      "syncShowTitleSyncStatus",
    ])
  );
  assert.equal(lightweight.effectClass, "lightweight");
  assert.deepStrictEqual(lightweight.runtimeIntents, [
    "image_viewer_transform",
    "navbar_initialize",
    "title_sync_status",
  ]);
  assert.deepStrictEqual(lightweight.modalTabs, ["general-settings", "sync"]);

  const nested = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths(["openInNewTab.progress"])
  );
  assert.equal(nested.effectClass, "lightweight");
  assert.deepStrictEqual(nested.runtimeIntents, [
    "global_link_behavior",
    "progress_buttons",
  ]);
  assert.deepStrictEqual(nested.modalTabs, ["general-settings"]);

  const nonProgressLink = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths(["openInNewTab.threadList"])
  );
  assert.deepStrictEqual(nonProgressLink, {
    effectClass: "lightweight",
    runtimeIntents: ["global_link_behavior"],
    modalTabs: ["general-settings"],
  });

  const passive = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths(["syncDeviceId"])
  );
  assert.deepStrictEqual(passive, {
    effectClass: "passive",
    runtimeIntents: [],
    modalTabs: ["sync"],
  });

  const unknown = toPlainObject(
    s1pSettingsSemantics.resolveChangedPaths(["futureSetting"])
  );
  assert.deepStrictEqual(unknown, {
    effectClass: "full",
    runtimeIntents: [],
    modalTabs: [],
  });

  const expectedFullSettings = new Map([
    ["enablePostBlocking", ["threads"]],
    ["enableGeneralSettings", ["general-settings"]],
    ["enableUserBlocking", ["users"]],
    ["enableUserTagging", ["tags"]],
    ["enableReadProgress", ["general-settings"]],
    ["enableBookmarkReplies", ["bookmarks"]],
  ]);
  Object.keys(defaultSettings).forEach((settingKey) => {
    const semantics = toPlainObject(
      s1pSettingsSemantics.resolveChangedPaths([settingKey])
    );
    if (expectedFullSettings.has(settingKey)) {
      assert.equal(semantics.effectClass, "full", settingKey);
      assert.deepStrictEqual(
        semantics.modalTabs,
        expectedFullSettings.get(settingKey),
        settingKey
      );
      return;
    }
    assert.notEqual(
      semantics.effectClass,
      "full",
      `${settingKey} 缺少显式语义定义。`
    );
  });
};

const testSyncModalProjectionAndPatch = () => {
  const projected = s1pSettingsSemantics.projectSyncModal({
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
  });

  assert.equal(Object.isFrozen(projected), true);
  assert.deepStrictEqual(toPlainObject(projected), {
    remoteEnabled: true,
    dailyFirstLoad: true,
    autoCheckMode: "per_load",
    autoEnabled: true,
    visibleRemotePollingEnabled: true,
    showAutoSyncIndicator: false,
    showTitleSyncStatus: true,
    forcePullOnStartup: true,
    bookmarkFullContent: true,
    deviceId: "Device A",
    remoteGistId: "gist-id",
    remotePat: "token",
    tokenExpiryEnabled: true,
    tokenExpiryDate: 1760000000000,
  });

  const patch = s1pSettingsSemantics.buildSyncSettingsPatch({
    remoteEnabled: true,
    dailyFirstLoad: false,
    autoCheckMode: "foreground",
    autoEnabled: true,
    visibleRemotePollingEnabled: true,
    showAutoSyncIndicator: true,
    showTitleSyncStatus: false,
    forcePullOnStartup: true,
    bookmarkFullContent: false,
    deviceId: "  Laptop  ",
    remoteGistId: "  gist  ",
    remotePat: "  pat  ",
    tokenExpiryEnabled: true,
    tokenExpiryDate: "1760000000100",
  });

  assert.equal(Object.isFrozen(patch), true);
  assert.deepStrictEqual(toPlainObject(patch), {
    syncRemoteEnabled: true,
    syncDailyFirstLoad: false,
    syncPerLoadCheckEnabled: false,
    syncCheckOnReturnToForeground: true,
    syncAutoEnabled: true,
    syncVisibleRemotePollingEnabled: true,
    syncShowAutoSyncIndicator: true,
    syncShowTitleSyncStatus: false,
    syncForcePullOnStartup: false,
    syncBookmarkFullContent: false,
    syncDeviceId: "Laptop",
    syncRemoteGistId: "gist",
    syncRemotePat: "pat",
    syncTokenExpiryEnabled: true,
    syncTokenExpiryDate: 1760000000100,
  });
  assert.equal(
    s1pSettingsSemantics.projectSyncModal({
      syncTokenExpiryDate: "invalid",
    }).tokenExpiryDate,
    null
  );
  assert.equal(
    s1pSettingsSemantics.buildSyncSettingsPatch({
      tokenExpiryDate: -1,
    }).syncTokenExpiryDate,
    null
  );
};

const testImageSettingsNormalization = () => {
  const result = toPlainObject(
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

  assert.deepStrictEqual(result.values, {
    limitImagesBySize: true,
    useS1PlusImageViewer: true,
    imageViewerDefaultFullDisplay: false,
    imageViewerDefaultZoomScalePercent: 60,
    imageViewerWheelMode: "zoom",
    imageViewerWheelZoomStepPercent: 18,
    imageViewerWheelScrollStepPercent: 1,
    imagePreviewMaxWidth: 800,
    imagePreviewMaxHeight: 400,
  });
  assert.deepStrictEqual(result.migrationReasons, [
    "limit_images_by_size_normalized",
    "use_s1plus_image_viewer_normalized",
    "image_viewer_default_full_display_normalized",
    "image_viewer_default_zoom_scale_percent_normalized",
    "image_viewer_wheel_mode_normalized",
    "image_viewer_wheel_zoom_step_percent_normalized",
    "image_viewer_wheel_scroll_step_percent_normalized",
    "image_preview_max_width_normalized",
  ]);
};

testChangedPathSemantics();
testSyncModalProjectionAndPatch();
testImageSettingsNormalization();
console.log("[settings-semantics-module] checks passed.");
