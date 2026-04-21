#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
  syncDeviceId: "Mac-Main",
};

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 same-session remote write 测试钩子。",
  });

const testSameSessionRemoteWriteStaysQuiet = async () => {
  const { hooks, sandbox } = createHarness();
  const remoteUpdatedAt = "2026-04-18T05:00:00Z";
  const messages = [];
  const calls = [];
  let scheduledReload = null;
  let reloadCount = 0;

  sandbox.document.visibilityState = "visible";
  hooks.recordLocalSessionRemoteWrite({
    action: "pushed",
    remoteUpdatedAt,
    threadId: "123456",
    syncMode: "background",
  });

  const result = await hooks.checkRemoteFreshnessOnForeground(
    "foreground_resume",
    {
      settingsSnapshot: enabledSettings,
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => ({
        meta: {
          updatedAt: remoteUpdatedAt,
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
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "pulled",
      }),
      showMessage: (message, isSuccess) => {
        messages.push({ message, isSuccess });
      },
      setTimeoutFn: (callback, delay) => {
        scheduledReload = { callback, delay };
        return 1;
      },
      locationObject: {
        reload: () => {
          reloadCount += 1;
        },
      },
    }
  );

  assert.deepStrictEqual(calls, ["core", "settings"]);
  assert.strictEqual(result.sameSessionRemoteWrite, true);
  assert.strictEqual(messages.length, 0);
  assert.ok(scheduledReload, "同机会话 quiet handling 仍应保持必要的自动刷新。");
  assert.equal(result.refreshPlan.reloadSchedule.status, "scheduled");
  assert.equal(
    hooks.getSyncDiagnostics().lastProbeSameSessionRemoteWrite,
    true
  );

  scheduledReload.callback();
  assert.equal(reloadCount, 1);
};

const testSameDeviceRemoteWriteUsesSpecificCopy = async () => {
  const { hooks, sandbox } = createHarness();
  const remoteUpdatedAt = "2026-04-18T06:00:00Z";
  const messages = [];
  let scheduledReload = null;

  sandbox.document.visibilityState = "visible";

  const result = await hooks.checkRemoteFreshnessOnForeground(
    "foreground_resume",
    {
      settingsSnapshot: enabledSettings,
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => ({
        meta: {
          updatedAt: remoteUpdatedAt,
        },
      }),
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "pulled",
        sameDeviceRemoteWrite: true,
        remoteWriter: {
          deviceId: "Mac-Main",
          action: "pushed",
          syncMode: "background",
          createdAt: Date.now(),
        },
      }),
      showMessage: (message, isSuccess) => {
        messages.push({ message, isSuccess });
      },
      setTimeoutFn: (callback, delay) => {
        scheduledReload = { callback, delay };
        return 1;
      },
      locationObject: {
        reload: () => {},
      },
    }
  );

  assert.equal(result.sameDeviceRemoteWrite, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /同设备「Mac-Main」已同步更新/);
  assert.equal(messages[0].isSuccess, true);
  assert.ok(scheduledReload, "同设备写入仍应保留必要的自动刷新。");
  assert.equal(
    hooks.getSyncDiagnostics().lastProbeSameDeviceRemoteWrite,
    true
  );
};

const main = async () => {
  await testSameSessionRemoteWriteStaysQuiet();
  await testSameDeviceRemoteWriteUsesSpecificCopy();
  console.log("[foreground-same-session-remote-write] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
