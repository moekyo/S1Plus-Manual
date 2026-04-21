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

const testDecisionSplitsStartupAndBackground = () => {
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

  assert.equal(startupDecision.action, "skip_push_on_startup");
  assert.equal(backgroundDecision.action, "push");
};

const testPhase3CallSitesUseDedicatedHelpers = () => {
  expectMatch(
    /const handleStartupSync = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{/m,
    "每日首次加载同步未复用统一的启动安全同步 helper。"
  );
  assert.doesNotMatch(
    sourceCode,
    /const handlePerLoadSyncCheck = async/m,
    "自动检查入口 handlePerLoadSyncCheck 应已移除。"
  );
  assert.doesNotMatch(
    sourceCode,
    /const requestForegroundRemoteSyncCheck = async/m,
    "前台自动检查 follow-up 入口应已移除。"
  );
};

(async () => {
  await testRuntimeReusesStartupExecutionPath();
  await testBeforePerformCanShortCircuitSafely();
  await testLockUnavailableSkipsWithoutHeartbeat();
  testDecisionSplitsStartupAndBackground();
  testPhase3CallSitesUseDedicatedHelpers();

  console.log("[safe-sync-execution] startup and background sync execution verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
