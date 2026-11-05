#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

const testDefaultsAndNormalization = () => {
  const { hooks } = createHarness();
  const settings = hooks.getSettings();
  assert.equal(settings.syncGistMirrorMode, "off", "默认关闭 Gist 镜像");
  assert.equal(settings.syncGistMirrorInterval, "hourly", "默认定时间隔为每小时");
  assert.equal(settings.syncGistMirrorDailyTime, "04:00", "默认每天时间为 04:00");

  const normalized = hooks.buildNormalizedSettings({
    ...settings,
    syncGistMirrorMode: "bogus",
    syncGistMirrorInterval: "weekly",
    syncGistMirrorDailyTime: "9:05",
  }).settings;
  assert.equal(normalized.syncGistMirrorMode, "off");
  assert.equal(normalized.syncGistMirrorInterval, "hourly");
  assert.equal(normalized.syncGistMirrorDailyTime, "09:05");

  const config = hooks.s1pGetGistMirrorConfig({
    ...settings,
    syncGistMirrorMode: "scheduled",
    syncGistMirrorInterval: "daily",
    syncGistMirrorDailyTime: "7:05",
  });
  assert.equal(config.mode, "scheduled");
  assert.equal(config.interval, "daily");
  assert.equal(config.dailyTime, "07:05");

  assert.equal(hooks.s1pNormalizeGistMirrorDailyTimeValue("23:59"), "23:59");
  assert.equal(hooks.s1pNormalizeGistMirrorDailyTimeValue("24:00"), "04:00");
  assert.equal(hooks.s1pNormalizeGistMirrorDailyTimeValue(""), "04:00");
};

const testSettingsAreDeviceLocal = async () => {
  const { hooks } = createHarness();
  const exported = await hooks.exportLocalDataObject({ useFreshSnapshot: true });
  [
    "syncGistMirrorMode",
    "syncGistMirrorInterval",
    "syncGistMirrorDailyTime",
  ].forEach((key) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(exported.data.settings, key),
      false,
      `${key} 不应进入同步导出（设备本地设置）`
    );
  });
};

const testMirrorStateRoundTrip = () => {
  const { hooks } = createHarness();
  assert.equal(hooks.s1pGetGistMirrorState().lastAt, 0);
  hooks.s1pPatchGistMirrorState({
    lastAt: 1234,
    lastStatus: "success",
    lastMessage: "已合并",
    lastReason: "manual",
    lastHash: "abc",
  });
  const state = hooks.s1pGetGistMirrorState();
  assert.equal(state.lastAt, 1234);
  assert.equal(state.lastStatus, "success");
  assert.equal(state.lastMessage, "已合并");
  assert.equal(state.lastReason, "manual");
  assert.equal(state.lastHash, "abc");
};

const testDailyScheduleComputation = () => {
  const { hooks } = createHarness();
  const settings = {
    ...hooks.getSettings(),
    syncGistMirrorMode: "scheduled",
    syncGistMirrorInterval: "daily",
    syncGistMirrorDailyTime: "03:00",
  };
  const now = new Date(2026, 10, 5, 0, 30, 0).getTime();
  hooks.s1pPatchGistMirrorState({ lastAt: 0 });
  const dueBeforeRun = hooks.s1pComputeGistMirrorNextDueAt(settings, now);
  const dueBeforeRunDate = new Date(dueBeforeRun);
  assert.equal(dueBeforeRunDate.getDate(), 5, "未跑过时应在当天 03:00 触发");
  assert.equal(dueBeforeRunDate.getHours(), 3);
  assert.ok(dueBeforeRun > now, "当天 03:00 应在 00:30 之后");

  hooks.s1pPatchGistMirrorState({
    lastAt: new Date(2026, 10, 5, 4, 0, 0).getTime(),
  });
  const dueAfterRun = hooks.s1pComputeGistMirrorNextDueAt(settings, now);
  assert.ok(
    dueAfterRun - now > 24 * 60 * 60 * 1000,
    "当天已跑过时下一次应顺延到明天 03:00"
  );
  assert.equal(new Date(dueAfterRun).getDate(), 6);
  assert.equal(new Date(dueAfterRun).getHours(), 3);
};

const testHourlyScheduleComputation = () => {
  const { hooks } = createHarness();
  const settings = {
    ...hooks.getSettings(),
    syncGistMirrorMode: "scheduled",
    syncGistMirrorInterval: "hourly",
  };
  const now = new Date(2026, 10, 5, 12, 0, 0).getTime();
  const lastAt = now - 30 * 60 * 1000;
  hooks.s1pPatchGistMirrorState({ lastAt });
  assert.equal(
    hooks.s1pComputeGistMirrorNextDueAt(settings, now),
    lastAt + 60 * 60 * 1000
  );

  hooks.s1pPatchGistMirrorState({ lastAt: 0 });
  assert.equal(
    hooks.s1pComputeGistMirrorNextDueAt(settings, now),
    now + 60 * 1000,
    "首次启用定时镜像时先等 1 分钟再跑"
  );

  assert.equal(
    hooks.s1pComputeGistMirrorNextDueAt(
      { ...settings, syncGistMirrorMode: "manual" },
      now
    ),
    0,
    "非定时模式不返回计划时间"
  );
};

const testRunGates = async () => {
  const { hooks, sandbox } = createHarness();
  const notReady = await hooks.s1pRunGistMirrorOnce("scheduled");
  assert.equal(notReady.status, "skipped");
  assert.equal(notReady.reason, "sync_not_ready", "未配置 Gist 时应跳过镜像");

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      syncRemoteEnabled: true,
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat",
    },
    { suppressSyncTrigger: true }
  );

  sandbox.GM_setValue("s1p_gist_mirror_lock", {
    owner: "other-tab",
    token: "other-token",
    expiresAt: Date.now() + 60 * 1000,
  });
  const otherTab = await hooks.s1pRunGistMirrorOnce("scheduled");
  assert.equal(otherTab.reason, "other_tab", "其他标签页持锁时应跳过");
  sandbox.GM_deleteValue("s1p_gist_mirror_lock");

  const authority = await hooks.acquireModeSyncLock("background", {
    returnAuthority: true,
  });
  assert.ok(authority, "测试用的后台同步锁应能取得");
  try {
    const locked = await hooks.s1pRunGistMirrorOnce("scheduled");
    assert.equal(locked.reason, "sync_lock_active", "有同步锁时应跳过镜像");
  } finally {
    hooks.releaseModeSyncLock("background", authority.token, "test_cleanup");
  }
};

const run = async () => {
  testDefaultsAndNormalization();
  await testSettingsAreDeviceLocal();
  testMirrorStateRoundTrip();
  testDailyScheduleComputation();
  testHourlyScheduleComputation();
  await testRunGates();
  console.log("[gist-mirror] settings, device-local exclusion and schedule tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
