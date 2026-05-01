#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = () => {
  return createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 3 测试钩子。",
  });
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testRuntimeReusesStartupExecutionPath = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforePerform: async () => {
      calls.push("onBeforePerform");
    },
    onAfterRelease: async () => {
      calls.push("afterRelease");
    },
    performAutoSync: async (isStartupSafetyMode, lockMode) => {
      calls.push(`perform:${String(isStartupSafetyMode)}:${lockMode}`);
      return { status: "success", action: "pulled" };
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "onBeforePerform",
    "perform:true:startup",
    "heartbeat:stop",
    "release",
    "afterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pulled",
  });
};

const testForegroundFollowUpUsesDedicatedExecutionMode = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runForegroundFollowUpAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforePerform: async () => {
      calls.push("onBeforePerform");
    },
    onAfterRelease: async () => {
      calls.push("afterRelease");
    },
    performAutoSync: async (options) => {
      calls.push(
        `perform:${options.mode}:${options.syncLockMode}:${options.triggerSource}`
      );
      return {
        status: "blocked",
        blockLevel: "soft",
        reason: "local_changed_during_sync",
      };
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "onBeforePerform",
    "perform:foreground_followup:startup:foreground_resume",
    "heartbeat:stop",
    "release",
    "afterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_during_sync",
  });
};

const testBeforePerformCanShortCircuitSafely = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return {
        skip: true,
        result: { status: "skipped", reason: "daily_sync_already_completed" },
      };
    },
    performAutoSync: async () => {
      calls.push("perform");
      throw new Error("beforePerform 已要求跳过时不应继续 performAutoSync。");
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "heartbeat:stop",
    "release",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "daily_sync_already_completed",
  });
};

const testLockUnavailableSkipsWithoutHeartbeat = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return false;
    },
    onLockUnavailable: async () => {
      calls.push("lockUnavailable");
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    performAutoSync: async () => {
      calls.push("perform");
      return { status: "success" };
    },
  });

  assert.deepStrictEqual(calls, ["acquire", "lockUnavailable"]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "startup_lock_unavailable",
  });
};

const testOnBeforeReleaseFiresBeforeLockRelease = async () => {
  const { sandbox, hooks } = createHarness();
  let lockHeld = false;
  let onBeforeReleaseSeenLock = null;
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      lockHeld = true;
      return true;
    },
    startStartupSyncLockHeartbeat: () => { calls.push("hb:start"); },
    stopStartupSyncLockHeartbeat: () => { calls.push("hb:stop"); },
    releaseStartupSyncLock: () => {
      lockHeld = false;
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforeRelease: (syncResult) => {
      onBeforeReleaseSeenLock = lockHeld;
      calls.push("onBeforeRelease");
    },
    onAfterRelease: () => {
      calls.push("onAfterRelease");
    },
    performAutoSync: async () => {
      calls.push("perform");
      return { status: "success", action: "pulled" };
    },
  });

  assert.strictEqual(onBeforeReleaseSeenLock, true,
    "onBeforeRelease 应在锁仍然持有时执行");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
    "perform",
    "onBeforeRelease",
    "hb:stop",
    "release",
    "onAfterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pulled",
  });
};

const testOnBeforeReleaseFiresOnSkipBeforeLockRelease = async () => {
  const { sandbox, hooks } = createHarness();
  let lockHeld = false;
  let onBeforeReleaseSeenLock = null;
  let onBeforeReleaseSeenReason = null;
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      lockHeld = true;
      return true;
    },
    startStartupSyncLockHeartbeat: () => { calls.push("hb:start"); },
    stopStartupSyncLockHeartbeat: () => { calls.push("hb:stop"); },
    releaseStartupSyncLock: () => {
      lockHeld = false;
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return {
        skip: true,
        result: { status: "skipped", reason: "daily_sync_already_completed" },
      };
    },
    onBeforeRelease: (syncResult) => {
      onBeforeReleaseSeenLock = lockHeld;
      onBeforeReleaseSeenReason = syncResult?.reason;
      calls.push("onBeforeRelease");
    },
    performAutoSync: async () => {
      calls.push("perform");
      throw new Error("beforePerform 已跳过, 不应到达 perform");
    },
  });

  assert.strictEqual(onBeforeReleaseSeenLock, true,
    "skip 路径下 onBeforeRelease 应在锁仍然持有时执行");
  assert.strictEqual(onBeforeReleaseSeenReason, "daily_sync_already_completed",
    "onBeforeRelease 应能拿到 skip 原因 daily_sync_already_completed");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
    "onBeforeRelease",
    "hb:stop",
    "release",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "daily_sync_already_completed",
  });
};

const testShouldClearDeferredStartupSyncOnResult = () => {
  const { hooks } = createHarness();

  // deferred 未激活时不清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "daily_sync_already_completed" }, false
  ), false);

  // skipped + daily_sync_already_completed → 清理（本次新增的修复点）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "daily_sync_already_completed" }, true
  ), true);

  // skipped + conflict_paused → 清理（已有行为）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "conflict_paused" }, true
  ), true);

  // success → 清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "success", action: "pulled" }, true
  ), true);

  // conflict → 清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "conflict", reason: "both_changed_since_baseline" }, true
  ), true);

  // skipped + 其他 reason → 不清理（startup_lock_unavailable 等不应清 deferred）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "startup_lock_unavailable" }, true
  ), false);

  // failure → 不清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "failure", error: "test" }, true
  ), false);
};

const testDecisionSplitsStartupBackgroundAndForegroundFollowUp = () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const localDataObject = {
    contentHash: "local-newer",
    lastUpdated: 200,
  };
  const remoteDataObject = {
    contentHash: "baseline",
    lastUpdated: 100,
  };

  const startupDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "startup",
  });
  const backgroundDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "background",
  });
  const foregroundDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "foreground_followup",
  });

  assert.equal(startupDecision.action, "skip_push_on_startup");
  assert.equal(backgroundDecision.action, "push");
  assert.equal(
    foregroundDecision.action,
    "skip_push_on_foreground_followup"
  );
};

const testPhase3CallSitesUseDedicatedHelpers = () => {
  expectMatch(
    /const requestForegroundRemoteSyncCheck = async[\s\S]*?runForegroundFollowUpAutoSyncCheckWithIndicator\(\{/m,
    "前台 follow-up sync 入口未切到专用 foreground_followup helper。"
  );
  expectMatch(
    /const handlePerLoadSyncCheck = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{/m,
    "每次页面加载同步检查未复用统一的启动安全同步 helper。"
  );
  expectMatch(
    /const handleStartupSync = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{/m,
    "每日首次加载同步未复用统一的启动安全同步 helper。"
  );
};

(async () => {
  await testRuntimeReusesStartupExecutionPath();
  await testForegroundFollowUpUsesDedicatedExecutionMode();
  await testBeforePerformCanShortCircuitSafely();
  await testLockUnavailableSkipsWithoutHeartbeat();
  await testOnBeforeReleaseFiresBeforeLockRelease();
  await testOnBeforeReleaseFiresOnSkipBeforeLockRelease();
  testShouldClearDeferredStartupSyncOnResult();
  testDecisionSplitsStartupBackgroundAndForegroundFollowUp();
  testPhase3CallSitesUseDedicatedHelpers();

  console.log("[safe-sync-execution] Phase 3 sync execution layering verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
