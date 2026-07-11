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

const requestForegroundProbe = (hooks, reason, options = {}) =>
  hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason,
    options,
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

  const result = await requestForegroundProbe(hooks,
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
  assert.strictEqual(result.remoteChangeKind, "same_session_write");
  assert.strictEqual(messages.length, 0);
  assert.equal(scheduledReload, null, "同机会话写入不应调度自动刷新。");
  assert.equal(result.refreshPlan.reloadSchedule.status, "suppressed");
  assert.equal(result.refreshPlan.policy, "foreground_probe_suppressed");
  assert.equal(
    hooks.getSyncDiagnostics().lastProbeSameSessionRemoteWrite,
    true
  );
};

const testSameDeviceRemoteWriteUsesSpecificCopy = async () => {
  const { hooks, sandbox } = createHarness();
  const remoteUpdatedAt = "2026-04-18T06:00:00Z";
  const messages = [];
  let scheduledReload = null;

  sandbox.document.visibilityState = "visible";

  const result = await requestForegroundProbe(hooks,
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
  assert.equal(result.remoteChangeKind, "same_device_write");
  assert.equal(messages.length, 0, "同设备写入不应弹出提示。");
  assert.equal(scheduledReload, null, "同设备写入不应调度自动刷新。");
  assert.equal(
    hooks.getSyncDiagnostics().lastProbeSameDeviceRemoteWrite,
    true
  );
};

const testExternalRemoteWriteKeepsCloudCopy = async () => {
  const { hooks, sandbox } = createHarness();
  const remoteUpdatedAt = "2026-04-18T07:00:00Z";
  const messages = [];

  sandbox.document.visibilityState = "visible";

  const result = await requestForegroundProbe(hooks,
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
        remoteWriter: {
          deviceId: "Windows-Idle",
          action: "pushed",
          syncMode: "background",
          createdAt: Date.now(),
        },
      }),
      showMessage: (message, isSuccess) => {
        messages.push({ message, isSuccess });
      },
      setTimeoutFn: () => 1,
      locationObject: {
        reload: () => {},
      },
    }
  );

  assert.equal(result.remoteChangeKind, "external_remote_change");
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /检测到云端备份比当前页面更新/);
};

const testHashEqualAfterResyncStaysQuiet = async () => {
  const { hooks, sandbox } = createHarness();
  const remoteUpdatedAt = "2026-04-18T08:00:00Z";
  const messages = [];
  let scheduledReload = null;

  sandbox.document.visibilityState = "visible";

  const result = await requestForegroundProbe(hooks,
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
        action: "no_change",
        reason: "hash_equal_with_remote_timestamp_drift",
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

  assert.equal(result.status, "unchanged");
  assert.equal(result.reason, "hash_equal_after_resync");
  assert.equal(result.remoteChangeKind, "hash_equal_after_resync");
  assert.deepStrictEqual(messages, []);
  assert.equal(scheduledReload, null);
};

const main = async () => {
  await testSameSessionRemoteWriteStaysQuiet();
  await testSameDeviceRemoteWriteUsesSpecificCopy();
  await testExternalRemoteWriteKeepsCloudCopy();
  await testHashEqualAfterResyncStaysQuiet();
  console.log("[foreground-same-session-remote-write] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
