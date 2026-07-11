#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
} = require("./s1plus-test-helpers");
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露核心数据快照收敛测试钩子。",
  });

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const requestForegroundProbe = (hooks, reason, options = {}) =>
  hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason,
    options,
  });

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testReadProgressSnapshotResyncRefreshesStaleCache = () => {
  const { hooks, sandbox } = createHarness();
  const initialProgress = {
    123456: {
      postId: "70000001",
      page: "1",
      lastReadFloor: "3",
      timestamp: Date.now() - 5000,
    },
  };
  const newerProgress = {
    123456: {
      postId: "70000002",
      page: "2",
      lastReadFloor: "16",
      timestamp: Date.now(),
    },
  };

  sandbox.GM_setValue("s1p_read_progress", initialProgress);
  assert.deepStrictEqual(toPlainObject(hooks.getReadProgress()), initialProgress);
  hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_read_progress"],
    applyImmediately: false,
  });

  sandbox.GM_setValue("s1p_read_progress", newerProgress);
  const result = hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_read_progress"],
    applyImmediately: false,
  });

  assert.equal(result.didSync, true);
  assert.deepStrictEqual(toPlainObject(result.changedKeys), ["s1p_read_progress"]);
  assert.deepStrictEqual(toPlainObject(hooks.getReadProgress()), newerProgress);
};

const testFreshSnapshotExportBypassesStaleCache = async () => {
  const { hooks, sandbox } = createHarness();
  const initialProgress = {
    123456: {
      postId: "70000001",
      page: "1",
      lastReadFloor: "3",
      timestamp: Date.now() - 5000,
    },
  };
  const newerProgress = {
    123456: {
      postId: "70000002",
      page: "2",
      lastReadFloor: "16",
      timestamp: Date.now(),
    },
  };

  sandbox.GM_setValue("s1p_read_progress", initialProgress);
  hooks.getReadProgress();
  sandbox.GM_setValue("s1p_read_progress", newerProgress);

  const exported = await hooks.exportLocalDataObject({
    useFreshSnapshot: true,
    compactBookmarksForSync: false,
    compactBlockedPostsForSync: false,
  });

  assert.deepStrictEqual(
    toPlainObject(exported.data.read_progress),
    newerProgress
  );
};

const testNoopSnapshotResyncStaysQuietWhenUnchanged = () => {
  const { hooks, sandbox } = createHarness();
  const rules = [{ id: "rule_1", pattern: "foo", enabled: true }];

  sandbox.GM_setValue("s1p_title_filter_rules", rules);
  const result = hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_title_filter_rules"],
    applyImmediately: false,
  });

  assert.equal(result.didSync, false);
  assert.deepStrictEqual(toPlainObject(result.changedKeys), []);
};

const testBackgroundAutoSyncDefaultsToFreshSnapshot = () => {
  const { hooks } = createHarness();

  assert.equal(
    hooks.resolveAutoSyncExecutionOptions("background").useFreshLocalSnapshot,
    true
  );
  assert.equal(
    hooks.resolveAutoSyncExecutionOptions({
      mode: "foreground_followup",
    }).useFreshLocalSnapshot,
    true
  );
  assert.equal(
    hooks.resolveAutoSyncExecutionOptions(true).useFreshLocalSnapshot,
    false
  );
};

const testSyncDeviceIdStaysLocalOnlyInExport = async () => {
  const { hooks, sandbox } = createHarness();
  sandbox.GM_setValue("s1p_settings", {
    syncDeviceId: " Mac-Main ",
    syncRemoteGistId: "gist-id",
    syncRemotePat: "pat-token",
  });

  const normalizedSettings = hooks.buildNormalizedSettings(
    sandbox.GM_getValue("s1p_settings", {})
  ).settings;
  assert.equal(normalizedSettings.syncDeviceId, "Mac-Main");

  const exported = await hooks.exportLocalDataObject({
    useFreshSnapshot: true,
    compactBookmarksForSync: false,
    compactBlockedPostsForSync: false,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(exported.data.settings, "syncDeviceId"),
    false
  );
};

const testForegroundProbeResyncsSnapshotBeforeFollowUp = async () => {
  const { hooks, sandbox } = createHarness();
  const calls = [];
  sandbox.document.visibilityState = "visible";
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-18T09:00:00Z",
  });

  const result = await requestForegroundProbe(hooks, "foreground_resume", {
    now: 1760004400000,
    settingsSnapshot: enabledSettings,
    acquireRemoteProbeLock: async () => true,
    releaseRemoteProbeLockValue: () => {},
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-18T09:10:00Z",
      },
    }),
    syncCoreDataFromStorageSnapshotIfNeeded: () => {
      calls.push("core");
      return { didSync: true, changedKeys: ["s1p_read_progress"] };
    },
    syncSettingsFromStorageSnapshotIfNeeded: () => {
      calls.push("settings");
      return true;
    },
    requestForegroundRemoteSyncCheck: async () => {
      calls.push("follow-up");
      return {
        status: "success",
        action: "no_change",
        reason: "hash_equal_with_remote_timestamp_drift",
      };
    },
  });

  assert.deepStrictEqual(calls, ["core", "settings", "follow-up"]);
  assert.equal(result.status, "unchanged");
  assert.equal(result.reason, "hash_equal_after_resync");
};

const testCoreDataCrossTabSignalWiringPresent = () => {
  expectMatch(
    /const CORE_DATA_CROSS_TAB_SIGNAL_KEY = "s1p_core_data_refresh_signal";/,
    "未新增核心数据跨标签 signal key。"
  );
  expectMatch(
    /const emitCoreDataCrossTabSignal = \(key\) => \{/,
    "未新增核心数据跨标签 signal helper。"
  );
  expectMatch(
    /emitCoreDataCrossTabSignal\("s1p_read_progress"\);/,
    "阅读进度保存后未发送核心数据跨标签 signal。"
  );
  expectMatch(
    /bindCoreDataCacheSync\(CORE_DATA_CROSS_TAB_SIGNAL_KEY\);/,
    "核心数据缓存同步未监听新的 signal key。"
  );
  expectMatch(
    /if \(key === CORE_DATA_CROSS_TAB_SIGNAL_KEY\) \{[\s\S]*syncCoreDataFromStorageSnapshotIfNeeded\(\{[\s\S]*keys: \[signalPayload\.key\]/m,
    "核心数据 signal 未回退到 storage snapshot 收敛。"
  );
};

const main = async () => {
  testReadProgressSnapshotResyncRefreshesStaleCache();
  await testFreshSnapshotExportBypassesStaleCache();
  testNoopSnapshotResyncStaysQuietWhenUnchanged();
  testBackgroundAutoSyncDefaultsToFreshSnapshot();
  await testSyncDeviceIdStaysLocalOnlyInExport();
  await testForegroundProbeResyncsSnapshotBeforeFollowUp();
  testCoreDataCrossTabSignalWiringPresent();
  console.log("[core-data-snapshot-resync] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
