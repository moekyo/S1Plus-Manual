#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const GLOBAL_SYNC_LOCK_KEY = "s1p_sync_global_lock";
const MANUAL_SYNC_LOCK_KEY = "s1p_manual_sync_lock";
const BACKGROUND_SYNC_LOCK_KEY = "s1p_background_sync_lock";
const STARTUP_SYNC_LOCK_KEY = "s1p_startup_sync_lock";
const FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY =
  "s1p_foreground_followup_sync_lock";
const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
const PENDING_FOREGROUND_REMOTE_SYNC_KEY =
  "s1p_pending_foreground_remote_sync_request";
const DEFERRED_STARTUP_SYNC_KEY = "s1p_deferred_startup_sync";
const STARTUP_AUTO_SYNC_LAST_TS_KEY = "s1p_startup_auto_sync_last_ts";
const AUTO_SYNC_CONFLICT_PAUSE_KEY = "s1p_auto_sync_conflict_pause";

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
    "perform:foreground_followup:foreground_followup:foreground_resume",
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

const testForegroundFollowUpUsesShortDedicatedLock = async () => {
  const { hooks, store } = createHarness();
  let performOptions = null;
  let modeLockDuringPerform = null;
  let globalLockDuringPerform = null;
  const now = 1_000_000;

  const result = await hooks.runForegroundFollowUpAutoSyncCheck({
    performAutoSync: async (options) => {
      performOptions = options;
      modeLockDuringPerform = store.get(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY);
      globalLockDuringPerform = store.get(GLOBAL_SYNC_LOCK_KEY);
      return { status: "success", action: "no_change" };
    },
  });

  assert.equal(performOptions.syncLockMode, "foreground_followup");
  assert.equal(performOptions.mode, "foreground_followup");
  assert.ok(modeLockDuringPerform, "前台补同步应持有独立模式锁。");
  assert.equal(globalLockDuringPerform.mode, "foreground_followup");
  assert.equal(
    globalLockDuringPerform.ttlMs,
    45 * 1000,
    "前台补同步锁不应复用 3 分钟启动锁租约。"
  );
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "no_change",
  });
  assert.equal(store.has(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY), false);
  assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), false);

  store.set(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY, {
    owner: "other-tab",
    timestamp: now,
  });
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-tab",
    mode: "foreground_followup",
    timestamp: now,
    ttlMs: 45 * 1000,
  });
  assert.equal(hooks.hasAnyActiveSyncLock(now + 44_000), true);
  assert.equal(
    hooks.hasAnyActiveSyncLock(now + 46_000),
    false,
    "卡住的前台补同步锁应按 45 秒租约过期，而不是沿用 3 分钟启动锁。"
  );
};

const testRunningSyncReleasesBeforeResultHandling = async () => {
  const { hooks } = createHarness();
  const calls = [];
  let lockHeld = false;

  const result = await hooks.runRunningSync({
    mode: "background",
    lockAdapter: {
      acquire: async () => {
        calls.push("lock:acquire");
        lockHeld = true;
        return true;
      },
      startHeartbeat: () => {
        calls.push("heartbeat:start");
      },
      stopHeartbeat: () => {
        calls.push("heartbeat:stop");
      },
      release: () => {
        calls.push("lock:release");
        lockHeld = false;
      },
    },
    runTransaction: async () => {
      assert.equal(lockHeld, true, "同步事务必须在持锁状态下执行。");
      calls.push("transaction:run");
      const syncResult = { status: "success", action: "pushed" };
      calls.push("transaction:finalize");
      return { ...syncResult, finalized: true };
    },
    handleResult: async (syncResult) => {
      assert.equal(lockHeld, false, "Result Phase 处理开始前必须释放锁。");
      assert.equal(syncResult.finalized, true);
      calls.push("result:handle");
    },
  });

  assert.deepStrictEqual(calls, [
    "lock:acquire",
    "heartbeat:start",
    "transaction:run",
    "transaction:finalize",
    "heartbeat:stop",
    "lock:release",
    "result:handle",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pushed",
    finalized: true,
  });
};

const testRunningSyncKeepsLockReleasedWhenResultHandlingFails = async () => {
  const { hooks } = createHarness();
  let lockHeld = false;

  await assert.rejects(
    hooks.runRunningSync({
      mode: "background",
      lockAdapter: {
        acquire: async () => {
          lockHeld = true;
          return true;
        },
        startHeartbeat: () => {},
        stopHeartbeat: () => {},
        release: () => {
          lockHeld = false;
        },
      },
      runTransaction: async () => ({ status: "success" }),
      handleResult: async () => {
        assert.equal(lockHeld, false);
        throw new Error("result handling failed");
      },
    }),
    /result handling failed/
  );

  assert.equal(lockHeld, false);
};

const testRunningSyncContinuesResultHandlingWhenAfterReleaseFails = async () => {
  const { hooks } = createHarness();
  const calls = [];
  let lockHeld = false;

  const result = await hooks.runRunningSync({
    mode: "background",
    lockAdapter: {
      acquire: async () => {
        lockHeld = true;
        calls.push("lock:acquire");
        return true;
      },
      startHeartbeat: () => calls.push("heartbeat:start"),
      stopHeartbeat: () => calls.push("heartbeat:stop"),
      release: () => {
        lockHeld = false;
        calls.push("lock:release");
      },
    },
    runTransaction: async () => {
      calls.push("transaction:run");
      return { status: "success", action: "pushed" };
    },
    afterRelease: async () => {
      assert.equal(lockHeld, false);
      calls.push("afterRelease");
      throw new Error("after release failed");
    },
    handleResult: async () => {
      assert.equal(lockHeld, false);
      calls.push("result:handle");
    },
  });

  assert.deepStrictEqual(calls, [
    "lock:acquire",
    "heartbeat:start",
    "transaction:run",
    "heartbeat:stop",
    "lock:release",
    "afterRelease",
    "result:handle",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pushed",
  });
};

const testRunningSyncContinuesResultHandlingWhenHeartbeatStopFails = async () => {
  const { hooks } = createHarness();
  const calls = [];
  let lockHeld = false;

  const result = await hooks.runRunningSync({
    mode: "background",
    lockAdapter: {
      acquire: async () => {
        lockHeld = true;
        calls.push("lock:acquire");
        return true;
      },
      startHeartbeat: () => calls.push("heartbeat:start"),
      stopHeartbeat: () => {
        calls.push("heartbeat:stop");
        throw new Error("heartbeat stop failed");
      },
      release: () => {
        lockHeld = false;
        calls.push("lock:release");
      },
    },
    runTransaction: async () => {
      calls.push("transaction:run");
      return { status: "success", action: "no_change" };
    },
    afterRelease: async () => {
      assert.equal(lockHeld, false);
      calls.push("afterRelease");
    },
    handleResult: async () => {
      assert.equal(lockHeld, false);
      calls.push("result:handle");
    },
  });

  assert.deepStrictEqual(calls, [
    "lock:acquire",
    "heartbeat:start",
    "transaction:run",
    "heartbeat:stop",
    "lock:release",
    "afterRelease",
    "result:handle",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "no_change",
  });
};

const testRunningSyncReleasesLockWhenHeartbeatStartFails = async () => {
  const { hooks } = createHarness();
  const calls = [];
  let lockHeld = false;

  await assert.rejects(
    hooks.runRunningSync({
      mode: "background",
      lockAdapter: {
        acquire: async () => {
          lockHeld = true;
          calls.push("lock:acquire");
          return true;
        },
        startHeartbeat: () => {
          calls.push("heartbeat:start");
          throw new Error("heartbeat start failed");
        },
        stopHeartbeat: () => calls.push("heartbeat:stop"),
        release: () => {
          lockHeld = false;
          calls.push("lock:release");
        },
      },
      runTransaction: async () => {
        calls.push("transaction:run");
        return { status: "success" };
      },
    }),
    /heartbeat start failed/
  );

  assert.equal(lockHeld, false);
  assert.deepStrictEqual(calls, [
    "lock:acquire",
    "heartbeat:start",
    "lock:release",
  ]);
};

const testBackgroundIterationReleasesPersistedLocksBeforePendingResult = async () => {
  const { hooks, store } = createHarness();
  let signalResultStarted;
  let releaseResultHandler;
  const resultStarted = new Promise((resolve) => {
    signalResultStarted = resolve;
  });
  const resultGate = new Promise((resolve) => {
    releaseResultHandler = resolve;
  });

  const iterationPromise = hooks.runBackgroundAutoSyncIteration({
    reason: "phase1_result_gate",
    drainCount: 1,
    initialSchedulerContext: {
      debounceGeneration: 3,
      intendedMaxLastModified: 100,
    },
    performAutoSync: async (isStartupSafetyMode, lockMode, triggerSource) => {
      assert.equal(isStartupSafetyMode, false);
      assert.equal(lockMode, "background");
      assert.equal(triggerSource, "background_push");
      assert.ok(store.get(BACKGROUND_SYNC_LOCK_KEY));
      assert.equal(store.get(GLOBAL_SYNC_LOCK_KEY)?.mode, "background");
      return {
        status: "success",
        action: "pushed",
        coveredLastModified: 100,
      };
    },
    handleBackgroundAutoSyncResult: async (syncResult) => {
      assert.equal(
        syncResult.backgroundSchedulerCleanup?.status,
        "completed",
        "scheduler cleanup 必须由生产迭代 seam 在事务返回前完成。"
      );
      signalResultStarted();
      await resultGate;
    },
  });

  await resultStarted;
  assert.equal(
    store.has(BACKGROUND_SYNC_LOCK_KEY),
    false,
    "Result Phase 即使永久等待，后台模式锁也必须已经释放。"
  );
  assert.equal(
    store.has(GLOBAL_SYNC_LOCK_KEY),
    false,
    "Result Phase 即使永久等待，全局锁也必须已经释放。"
  );

  releaseResultHandler();
  const iteration = await iterationPromise;
  assert.equal(iteration.result.status, "success");
  assert.ok(iteration.indicatorCompletion);
};

const testBackgroundResultPolicyWritesConflictPauseAfterLockRelease = async () => {
  const { hooks, store, sandbox } = createHarness();
  const originalSetValue = sandbox.GM_setValue;
  let pauseWriteObserved = false;
  sandbox.GM_setValue = (key, value) => {
    if (key === AUTO_SYNC_CONFLICT_PAUSE_KEY) {
      assert.equal(
        store.has(BACKGROUND_SYNC_LOCK_KEY),
        false,
        "Result Phase 写入冲突暂停前必须释放后台模式锁。"
      );
      assert.equal(
        store.has(GLOBAL_SYNC_LOCK_KEY),
        false,
        "Result Phase 写入冲突暂停前必须释放全局锁。"
      );
      pauseWriteObserved = true;
    }
    originalSetValue(key, value);
  };

  const iteration = await hooks.runBackgroundAutoSyncIteration({
    reason: "phase5_conflict_policy",
    drainCount: 1,
    initialSchedulerContext: {
      debounceGeneration: 5,
      intendedMaxLastModified: 200,
    },
    performAutoSync: async () => ({
      status: "conflict",
      reason: "local_changed_during_sync",
      coveredLastModified: 200,
    }),
  });

  assert.equal(iteration.result.status, "conflict");
  assert.equal(pauseWriteObserved, true);
  assert.equal(store.get(AUTO_SYNC_CONFLICT_PAUSE_KEY)?.paused, true);
};

const testRunningSyncModeProfilesPreserveLocksAndTtls = async () => {
  const { hooks, store } = createHarness();
  const cases = [
    {
      mode: "background",
      lockKey: BACKGROUND_SYNC_LOCK_KEY,
      ttlMs: 45 * 1000,
    },
    {
      mode: "foreground_followup",
      lockKey: FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY,
      ttlMs: 45 * 1000,
    },
    {
      mode: "startup",
      lockKey: STARTUP_SYNC_LOCK_KEY,
      ttlMs: 3 * 60 * 1000,
    },
    {
      mode: "manual",
      lockKey: MANUAL_SYNC_LOCK_KEY,
      ttlMs: 3 * 60 * 1000,
    },
  ];

  for (const testCase of cases) {
    let modeLockDuringTransaction = null;
    let globalLockDuringTransaction = null;
    let modeLockDuringResultHandling = null;
    let globalLockDuringResultHandling = null;

    await hooks.runRunningSync({
      mode: testCase.mode,
      runTransaction: async () => {
        modeLockDuringTransaction = store.get(testCase.lockKey);
        globalLockDuringTransaction = store.get(GLOBAL_SYNC_LOCK_KEY);
        return { status: "success", action: "no_change" };
      },
      handleResult: async () => {
        modeLockDuringResultHandling = store.get(testCase.lockKey) || null;
        globalLockDuringResultHandling =
          store.get(GLOBAL_SYNC_LOCK_KEY) || null;
      },
    });

    assert.ok(modeLockDuringTransaction, `${testCase.mode} 应取得模式锁。`);
    assert.equal(globalLockDuringTransaction.mode, testCase.mode);
    assert.equal(globalLockDuringTransaction.ttlMs, testCase.ttlMs);
    assert.equal(modeLockDuringResultHandling, null);
    assert.equal(globalLockDuringResultHandling, null);
    assert.equal(store.has(testCase.lockKey), false);
    assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), false);
  }
};

const testExpiredOwnedModeLockCanBeReacquired = async () => {
  const { hooks, store } = createHarness();
  const staleTimestamp = Date.now() - 4 * 60 * 1000;
  store.set(BACKGROUND_SYNC_LOCK_KEY, {
    owner: hooks.BACKGROUND_SYNC_OWNER_ID,
    timestamp: staleTimestamp,
  });
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: hooks.BACKGROUND_SYNC_OWNER_ID,
    mode: "background",
    timestamp: staleTimestamp,
    ttlMs: 45 * 1000,
  });

  let acquiredModeLock = null;
  const result = await hooks.runRunningSync({
    mode: "background",
    runTransaction: async () => {
      acquiredModeLock = store.get(BACKGROUND_SYNC_LOCK_KEY);
      return { status: "success", action: "no_change" };
    },
  });

  assert.equal(result.status, "success");
  assert.ok(acquiredModeLock.timestamp > staleTimestamp);
  assert.equal(store.has(BACKGROUND_SYNC_LOCK_KEY), false);
  assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), false);
};

const testValidOtherModeLockBlocksNonPreemptiveAcquire = async () => {
  const { hooks, store } = createHarness();
  const timestamp = Date.now();
  const startupLock = { owner: "other-tab", timestamp };
  const globalLock = {
    owner: "other-tab",
    mode: "startup",
    timestamp,
    ttlMs: 3 * 60 * 1000,
  };
  store.set(STARTUP_SYNC_LOCK_KEY, startupLock);
  store.set(GLOBAL_SYNC_LOCK_KEY, globalLock);
  let transactionRan = false;

  const result = await hooks.runRunningSync({
    mode: "background",
    runTransaction: async () => {
      transactionRan = true;
      return { status: "success" };
    },
  });

  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "sync_lock_unavailable",
  });
  assert.equal(transactionRan, false);
  assert.deepStrictEqual(store.get(STARTUP_SYNC_LOCK_KEY), startupLock);
  assert.deepStrictEqual(store.get(GLOBAL_SYNC_LOCK_KEY), globalLock);
};

const testOwnershipVerificationFailureRollsBackOwnedModeLock = async () => {
  const { hooks, store } = createHarness();
  const competingGlobalLock = {
    owner: "other-tab",
    mode: "startup",
    timestamp: Date.now(),
    ttlMs: 3 * 60 * 1000,
  };
  let transactionRan = false;

  const runningSync = hooks.runRunningSync({
    mode: "background",
    runTransaction: async () => {
      transactionRan = true;
      return { status: "success" };
    },
  });
  setTimeout(() => {
    store.set(GLOBAL_SYNC_LOCK_KEY, competingGlobalLock);
  }, 10);

  const result = await runningSync;
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "sync_lock_unavailable",
  });
  assert.equal(transactionRan, false);
  assert.equal(
    store.has(BACKGROUND_SYNC_LOCK_KEY),
    false,
    "ownership verification 失败后必须回滚本标签页写入的模式锁。"
  );
  assert.deepStrictEqual(
    store.get(GLOBAL_SYNC_LOCK_KEY),
    competingGlobalLock,
    "回滚不得删除竞争标签页取得的全局锁。"
  );
};

const testLockUnavailableCallbackFailurePropagatesWithoutStartingSync = async () => {
  const { hooks } = createHarness();
  const calls = [];

  await assert.rejects(
    hooks.runRunningSync({
      mode: "background",
      lockAdapter: {
        acquire: async () => false,
        startHeartbeat: () => calls.push("heartbeat:start"),
        stopHeartbeat: () => calls.push("heartbeat:stop"),
        release: () => calls.push("lock:release"),
      },
      onLockUnavailable: async () => {
        calls.push("lock:unavailable");
        throw new Error("lock unavailable callback failed");
      },
      runTransaction: async () => {
        calls.push("transaction:run");
        return { status: "success" };
      },
    }),
    /lock unavailable callback failed/
  );

  assert.deepStrictEqual(calls, ["lock:unavailable"]);
};

const testAcquireFailurePropagatesWithoutStartingSync = async () => {
  const { hooks } = createHarness();
  const calls = [];

  await assert.rejects(
    hooks.runRunningSync({
      mode: "background",
      lockAdapter: {
        acquire: async () => {
          calls.push("lock:acquire");
          throw new Error("lock acquire failed");
        },
        startHeartbeat: () => calls.push("heartbeat:start"),
        stopHeartbeat: () => calls.push("heartbeat:stop"),
        release: () => calls.push("lock:release"),
      },
      runTransaction: async () => {
        calls.push("transaction:run");
        return { status: "success" };
      },
    }),
    /lock acquire failed/
  );

  assert.deepStrictEqual(calls, ["lock:acquire"]);
};

const testManualOverridePreservesActiveSyncLocksAndPendingWork = async () => {
  const { hooks, store } = createHarness();
  const now = Date.now();

  store.set(BACKGROUND_SYNC_LOCK_KEY, {
    owner: "other-background-tab",
    timestamp: now,
  });
  store.set(STARTUP_SYNC_LOCK_KEY, {
    owner: "other-startup-tab",
    timestamp: now,
  });
  store.set(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY, {
    owner: "other-foreground-tab",
    timestamp: now,
  });
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-background-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 45 * 1000,
  });
  store.set(MANUAL_SYNC_LOCK_KEY, {
    owner: "other-manual-tab",
    timestamp: now,
  });
  store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "read_progress",
    lastModified: now,
    maxLastModified: now,
    createdAt: now,
    firstDirtyAt: now,
    lastDirtyAt: now,
    sources: { read_progress: 1 },
    threadIds: ["123"],
  });
  store.set(PENDING_FOREGROUND_REMOTE_SYNC_KEY, {
    version: 1,
    requestId: "foreground-request",
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    createdAt: now,
    lastSeenAt: now,
  });
  hooks.seedSyncRuntimeStateForManualOverrideTest({
    hasPendingBackgroundSync: true,
    hasLocalRetryTimer: true,
    isBackgroundAutoSyncInProgress: true,
    isInitialSyncInProgress: true,
    backgroundSyncRetryAttempts: 7,
    manualSyncLockHeartbeatActive: true,
    backgroundSyncLockHeartbeatActive: true,
    startupSyncLockHeartbeatActive: true,
    foregroundFollowUpSyncLockHeartbeatActive: true,
  });

  const acquired = await hooks.acquireManualSyncLock({
    preemptActiveSync: true,
    operation: "force_pull",
  });

  assert.equal(acquired, false);
  assert.equal(store.has(MANUAL_SYNC_LOCK_KEY), true);
  assert.equal(store.has(BACKGROUND_SYNC_LOCK_KEY), true);
  assert.equal(store.has(STARTUP_SYNC_LOCK_KEY), true);
  assert.equal(store.has(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY), true);
  assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), true);
  assert.equal(store.has(PENDING_AUTO_SYNC_KEY), true);
  assert.equal(store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY), true);
  const runtimeState = hooks.getBackgroundAutoSyncRuntimeStateForTest();
  assert.equal(runtimeState.hasPendingBackgroundSync, true);
  assert.equal(runtimeState.hasLocalRetryTimer, true);
  assert.equal(runtimeState.isBackgroundAutoSyncInProgress, true);
  assert.equal(runtimeState.isInitialSyncInProgress, true);
  assert.equal(runtimeState.backgroundSyncRetryAttempts, 7);
  assert.equal(runtimeState.manualSyncLockHeartbeatActive, true);
  assert.equal(runtimeState.backgroundSyncLockHeartbeatActive, true);
  assert.equal(runtimeState.startupSyncLockHeartbeatActive, true);
  assert.equal(runtimeState.foregroundFollowUpSyncLockHeartbeatActive, true);
  hooks.seedSyncRuntimeStateForManualOverrideTest({});
};

const testInitialSetupPreemptionPreservesForeignManualLock = async () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  const foreignManualLock = {
    owner: "other-manual-tab",
    timestamp: now,
  };
  const foreignGlobalLock = {
    owner: "other-manual-tab",
    mode: "manual",
    timestamp: now,
    ttlMs: 3 * 60 * 1000,
  };
  store.set(MANUAL_SYNC_LOCK_KEY, foreignManualLock);
  store.set(GLOBAL_SYNC_LOCK_KEY, foreignGlobalLock);

  const acquired = await hooks.acquireManualSyncLock({
    preemptActiveSync: true,
    preemptScope: "automatic_only",
    operation: "initial_setup_manual_sync",
  });

  assert.equal(acquired, false);
  assert.deepEqual(store.get(MANUAL_SYNC_LOCK_KEY), foreignManualLock);
  assert.deepEqual(store.get(GLOBAL_SYNC_LOCK_KEY), foreignGlobalLock);
};

const testInitialSetupPreservesForeignAutomaticLocks = async () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  store.set(BACKGROUND_SYNC_LOCK_KEY, {
    owner: "other-background-tab",
    timestamp: now,
  });
  store.set(STARTUP_SYNC_LOCK_KEY, {
    owner: "other-startup-tab",
    timestamp: now,
  });
  store.set(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY, {
    owner: "other-foreground-tab",
    timestamp: now,
  });
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-background-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 45 * 1000,
  });

  const acquired = await hooks.acquireManualSyncLock({
    preemptActiveSync: true,
    preemptScope: "automatic_only",
    operation: "initial_setup_manual_sync",
  });

  assert.equal(acquired, false);
  assert.equal(store.get(BACKGROUND_SYNC_LOCK_KEY)?.owner, "other-background-tab");
  assert.equal(store.get(STARTUP_SYNC_LOCK_KEY)?.owner, "other-startup-tab");
  assert.equal(
    store.get(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY)?.owner,
    "other-foreground-tab"
  );
  assert.equal(store.get(GLOBAL_SYNC_LOCK_KEY)?.owner, "other-background-tab");
  assert.equal(store.has(MANUAL_SYNC_LOCK_KEY), false);
};

const testManualOverrideCancelsRemoteRetryBackoff = async () => {
  const { hooks, sandbox } = createHarness();
  let requestCount = 0;

  sandbox.GM_xmlhttpRequest = (options) => {
    requestCount += 1;
    setTimeout(() => {
      options.onload({
        status: 500,
        responseText: "server error",
      });
    }, 0);
    return {
      abort: () => {
        if (typeof options.onabort === "function") {
          options.onabort();
        }
      },
    };
  };

  await assert.rejects(
    hooks.runRemoteRequestWithRetry(
      {
        method: "GET",
        url: "https://example.invalid/s1plus-test",
      },
      {
        retryBaseDelayMs: 0,
        retryJitterMs: 0,
        sleep: async () => {
          hooks.cancelActiveRemoteSyncRequests("force_pull");
        },
      }
    ),
    (error) =>
      error?.code === "REMOTE_SYNC_CANCELLED" &&
      error?.cancelReason === "force_pull"
  );
  assert.equal(
    requestCount,
    1,
    "manual override during retry backoff must not allow a stale retry request."
  );
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

const testStartupCompletionPolicyRunsBeforeLockRelease = async () => {
  const { hooks, store } = createHarness();
  let lockHeld = false;
  let cooldownSeenAtRelease = null;
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
      cooldownSeenAtRelease = store.get(STARTUP_AUTO_SYNC_LAST_TS_KEY) || 0;
      lockHeld = false;
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    completionPolicy: {
      refreshStartupAutoSyncCooldown: true,
    },
    onAfterRelease: () => {
      assert.equal(lockHeld, false);
      calls.push("onAfterRelease");
    },
    performAutoSync: async () => {
      calls.push("perform");
      return { status: "success", action: "pulled" };
    },
  });

  assert.ok(cooldownSeenAtRelease > 0,
    "启动同步 cooldown 必须在锁释放前由 completion policy 持久化。");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
    "perform",
    "hb:stop",
    "release",
    "onAfterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pulled",
  });
};

const testStartupCompletionPolicyRunsOnSkipBeforeLockRelease = async () => {
  const { hooks, store } = createHarness();
  let lockHeld = false;
  let deferredExistsAtRelease = null;
  let cooldownSeenAtRelease = null;
  const calls = [];
  store.set(DEFERRED_STARTUP_SYNC_KEY, {
    date: "2026-07-11",
    requestedAt: Date.now(),
  });

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      lockHeld = true;
      return true;
    },
    startStartupSyncLockHeartbeat: () => { calls.push("hb:start"); },
    stopStartupSyncLockHeartbeat: () => { calls.push("hb:stop"); },
    releaseStartupSyncLock: () => {
      deferredExistsAtRelease = store.has(DEFERRED_STARTUP_SYNC_KEY);
      cooldownSeenAtRelease = store.get(STARTUP_AUTO_SYNC_LAST_TS_KEY) || 0;
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
    completionPolicy: {
      dailyDate: "2026-07-11",
      shouldResumeDeferredStartupSync: true,
      refreshStartupAutoSyncCooldown: true,
    },
    performAutoSync: async () => {
      calls.push("perform");
      throw new Error("beforePerform 已跳过, 不应到达 perform");
    },
  });

  assert.equal(deferredExistsAtRelease, false,
    "skip 路径必须在释放锁前清除已完成的 deferred startup 请求。");
  assert.ok(cooldownSeenAtRelease > 0,
    "skip 路径必须在释放锁前刷新启动同步 cooldown。");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
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

const testStartupReadProgressOnlyLocalDeltaAutoMerges = () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const localDataObject = {
    contentHash: "local-read-progress",
    baseContentHash: "same-core",
    lastUpdated: 200,
    data: {
      settings: { foo: true },
      read_progress: {
        123: { page: "1", lastReadFloor: "20", timestamp: 200 },
      },
    },
  };
  const remoteDataObject = {
    contentHash: "baseline",
    baseContentHash: "same-core",
    lastUpdated: 100,
    data: {
      settings: { foo: true },
      read_progress: {
        123: { page: "1", lastReadFloor: "10", timestamp: 100 },
      },
    },
  };

  const classification = hooks.classifyLocalSyncDelta({
    localDataObject,
    remoteDataObject,
  });
  assert.equal(classification.kind, "read_progress_only_changed");
  assert.equal(classification.strictReadProgressOnly, true);

  const startupDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "startup",
    localDeltaClassification: classification,
  });
  const backgroundDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "background",
    localDeltaClassification: classification,
  });

  assert.equal(startupDecision.action, "merge_read_progress");
  assert.equal(startupDecision.reason, "startup_read_progress_only_changed");
  assert.equal(startupDecision.localChangeKind, "read_progress_only_changed");
  assert.equal(backgroundDecision.action, "push");
};

const testStartupCoreLocalDeltaStillPauses = () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const localDataObject = {
    contentHash: "local-core",
    baseContentHash: "changed-core",
    lastUpdated: 200,
    data: {
      settings: { foo: false },
      read_progress: {},
    },
  };
  const remoteDataObject = {
    contentHash: "baseline",
    baseContentHash: "same-core",
    lastUpdated: 100,
    data: {
      settings: { foo: true },
      read_progress: {},
    },
  };

  const classification = hooks.classifyLocalSyncDelta({
    localDataObject,
    remoteDataObject,
  });
  const startupDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "startup",
    localDeltaClassification: classification,
  });

  assert.equal(classification.kind, "core_changed");
  assert.equal(startupDecision.action, "skip_push_on_startup");
};

const testPulledNormalizedBaselineComparesLocalAndRemoteSides = () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "local-normalized-after-pull",
    localContentHash: "local-normalized-after-pull",
    remoteContentHash: "remote-original-before-normalization",
    remoteUpdatedAt: "2026-06-27T13:24:01Z",
  });

  const importedLocalDataObject = {
    contentHash: "local-normalized-after-pull",
    baseContentHash: "local-normalized-base",
    lastUpdated: 200,
    data: {
      settings: { foo: true, migratedDefault: true },
      read_progress: {},
    },
  };
  const unchangedRemoteDataObject = {
    contentHash: "remote-original-before-normalization",
    baseContentHash: "remote-original-base",
    lastUpdated: 100,
    data: {
      settings: { foo: true },
      read_progress: {},
    },
  };

  const cleanDecision = hooks.decideSyncActionByVersion({
    localDataObject: importedLocalDataObject,
    remoteDataObject: unchangedRemoteDataObject,
    remoteUpdatedAt: "2026-06-27T13:24:01Z",
    syncMode: "startup",
  });
  assert.equal(cleanDecision.action, "no_change");
  assert.equal(cleanDecision.reason, "hash_equal_since_baseline");

  const baselineAfterNoChange = hooks.buildSyncBaselineStateForDataPair({
    localDataObject: importedLocalDataObject,
    remoteDataObject: unchangedRemoteDataObject,
    remoteUpdatedAt: "2026-06-27T13:24:01Z",
  });
  hooks.setSyncBaselineState(baselineAfterNoChange);
  const foregroundRetryDecision = hooks.decideSyncActionByVersion({
    localDataObject: importedLocalDataObject,
    remoteDataObject: unchangedRemoteDataObject,
    remoteUpdatedAt: "2026-06-27T13:24:01Z",
    syncMode: "foreground_followup",
  });
  assert.equal(foregroundRetryDecision.action, "no_change");
  assert.equal(
    foregroundRetryDecision.reason,
    "hash_equal_since_baseline",
    "启动 no-change 成功后不能把 remoteContentHash 压扁成本地哈希，否则前台二次确认会重复拉取。"
  );

  const localChangedDecision = hooks.decideSyncActionByVersion({
    localDataObject: {
      ...importedLocalDataObject,
      contentHash: "local-edited-after-pull",
      baseContentHash: "local-edited-base",
    },
    remoteDataObject: unchangedRemoteDataObject,
    remoteUpdatedAt: "2026-06-27T13:24:01Z",
    syncMode: "startup",
  });
  assert.equal(localChangedDecision.action, "skip_push_on_startup");

  const remoteChangedDecision = hooks.decideSyncActionByVersion({
    localDataObject: importedLocalDataObject,
    remoteDataObject: {
      ...unchangedRemoteDataObject,
      contentHash: "remote-changed-after-pull",
      baseContentHash: "remote-changed-base",
    },
    remoteUpdatedAt: "2026-06-27T14:00:00Z",
    syncMode: "startup",
  });
  assert.equal(remoteChangedDecision.action, "pull");
};

const testAutoSyncCompletionLogMessageIsSpecific = () => {
  const { hooks } = createHarness();

  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "success",
      result: { status: "success", action: "no_change" },
    }),
    "S1 Plus (Sync): 同步检查完成：成功（本地与远程一致，无需同步）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "success",
      result: { status: "success", action: "pushed" },
    }),
    "S1 Plus (Sync): 同步检查完成：成功（已推送本地数据到云端）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "failure",
      result: { status: "failure", error: "GitHub API请求失败" },
    }),
    "S1 Plus (Sync): 同步检查完成：失败（GitHub API请求失败）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "conflict",
      result: { status: "conflict", reason: "remote_changed_before_push" },
    }),
    "S1 Plus (Sync): 同步检查完成：冲突（推送前检测到云端版本变化，已暂停自动同步）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "lock_lost",
      result: {
        status: "skipped",
        reason: "lock_lost",
        stage: "push_latest_local_data:after",
      },
    }),
    "S1 Plus (Sync): 同步检查完成：已中止（同步锁失效，阶段：推送最新本地数据 / 执行后）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "自动拉取检查",
      outcome: "success",
      result: { status: "unchanged", reason: "remote_already_synced" },
    }),
    "S1 Plus (Sync): 自动拉取检查完成：无变化（云端版本与本地已同步版本一致）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "强制推送",
      outcome: "success",
      result: { status: "success", action: "force_push" },
    }),
    "S1 Plus (Sync): 强制推送完成：成功（已强制推送本地数据到云端）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "自动拉取检查",
      outcome: "changed",
      result: {
        status: "changed",
        reason: "remote_changed",
        syncRequestResult: {
          status: "blocked",
          reason: "read_progress_pending_write",
        },
      },
    }),
    "S1 Plus (Sync): 自动拉取检查完成：发现变化（后续同步已暂缓：阅读进度仍有待写入内容）。"
  );
};

const testSyncTraceEventsAreShownInDiagnostics = () => {
  const { hooks } = createHarness();
  hooks.resetSyncDiagnostics();

  hooks.recordSyncTraceEvent("auto_sync_decision", {
    scope: "auto_sync",
    status: "running",
    message: "同步决策完成",
    details: {
      action: "push",
      reason: "local_newer",
    },
    logToConsole: false,
    timestamp: 1778774439486,
  });

  const diagnostics = hooks.getSyncDiagnostics();
  assert.equal(diagnostics.lastSyncTraceScope, "auto_sync");
  assert.equal(diagnostics.lastSyncTracePhase, "auto_sync_decision");
  assert.equal(diagnostics.lastSyncTraceStatus, "running");
  assert.match(diagnostics.lastSyncTraceSummary, /同步决策完成/);
  assert.equal(diagnostics.syncTraceEvents.length, 1);
  assert.match(
    hooks.buildSyncDiagnosticsSummary(),
    /同步过程 1: .*同步决策完成/
  );
};

const testSyncTraceDetailsUseChineseLabels = () => {
  const { hooks } = createHarness();
  hooks.resetSyncDiagnostics();

  hooks.recordSyncTraceEvent("foreground_probe_followup_result", {
    scope: "foreground_probe",
    status: "changed",
    message: "前台补同步返回",
    details: {
      triggerSource: "foreground_resume",
      reason: "remote_probe_changed:pageshow",
      remoteChangeKind: "external_remote_change",
      refreshPlan: {
        policy: "reload_now",
        pageType: "generic",
        shouldReload: true,
      },
      snapshotResyncResult: {
        didSync: true,
        changedKeys: ["read_progress"],
        applyMode: "immediate",
      },
      until: 1778777843938,
    },
    logToConsole: false,
    timestamp: 1778774439486,
  });

  const diagnostics = hooks.getSyncDiagnostics();
  assert.match(diagnostics.lastSyncTraceSummary, /触发源=回到前台检查/);
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /原因=云端版本变化：页面显示或从缓存恢复/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /云端变化归因=其他设备或会话写入/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /刷新计划=策略=立即刷新，页面=普通页面，刷新=是/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /本地快照收敛=已收敛=是，变更键=1，应用=立即应用/
  );
  assert.doesNotMatch(
    diagnostics.lastSyncTraceSummary,
    /foreground_resume|external_remote_change|reload_now|generic|immediate/
  );
};

const testPhase3CallSitesUseDedicatedHelpers = () => {
  expectMatch(
    /name: "start debug log collector"[\s\S]*?if \(isDebugConsolePersistentlyVisible\(\)\)\s*\{\s*startLogCollector\(\)/m,
    "调试日志收集器未在 document-start 按面板可见性条件启动。"
  );
  expectMatch(
    /const checkRemoteFreshnessOnForeground = async[\s\S]*?scopeLabel: "自动拉取检查"/m,
    "自动拉取检查未接入统一完成日志。"
  );
  expectMatch(
    /const handleManualSync = async[\s\S]*?scopeLabel: "手动同步"/m,
    "手动同步未接入统一完成日志。"
  );
  expectMatch(
    /const handleManualSync = async[\s\S]*?acquireManualSyncLock\(\{[\s\S]*?preemptActiveSync:\s*isInitialSetup[\s\S]*?preemptScope:\s*isInitialSetup\s*\?\s*SYNC_PREEMPT_SCOPE_AUTOMATIC_ONLY/m,
    "首次设置同步应声明 automatic-only intent，但仍必须服从执行锁互斥。"
  );
  expectMatch(
    /const noteManualSuccess = \([\s\S]*?settlePendingForegroundRemoteSyncRequestIfCovered\([\s\S]*?pendingForegroundRemoteSyncAtStart/m,
    "普通手动同步成功后必须按启动时捕获的 foreground intent generation 结算。"
  );
  expectMatch(
    /const handleForcePush = async[\s\S]*?scopeLabel: "强制推送"/m,
    "强制推送未接入统一完成日志。"
  );
  expectMatch(
    /const handleForcePull = async[\s\S]*?scopeLabel: "强制拉取"/m,
    "强制拉取未接入统一完成日志。"
  );
  expectMatch(
    /const requestForegroundRemoteSyncCheck = async[\s\S]*?runForegroundFollowUpAutoSyncCheckWithIndicator\(\{/m,
    "前台 follow-up sync 入口未切到专用 foreground_followup helper。"
  );
  expectMatch(
    /LOG_COLLAPSED_MESSAGE_MAX_LENGTH\s*=\s*180/,
    "调试控制台长日志没有默认折叠长度。"
  );
  expectMatch(
    /data-s1p-debug-action="toggle-expand-logs"/,
    "调试控制台缺少展开全部/收起全部按钮。"
  );
  expectMatch(
    /s1p-debug-console-expand-line/,
    "调试控制台缺少单条日志展开按钮。"
  );
};

(async () => {
  await testRuntimeReusesStartupExecutionPath();
  await testForegroundFollowUpUsesDedicatedExecutionMode();
  await testForegroundFollowUpUsesShortDedicatedLock();
  await testRunningSyncReleasesBeforeResultHandling();
  await testRunningSyncKeepsLockReleasedWhenResultHandlingFails();
  await testRunningSyncContinuesResultHandlingWhenAfterReleaseFails();
  await testRunningSyncContinuesResultHandlingWhenHeartbeatStopFails();
  await testRunningSyncReleasesLockWhenHeartbeatStartFails();
  await testBackgroundIterationReleasesPersistedLocksBeforePendingResult();
  await testBackgroundResultPolicyWritesConflictPauseAfterLockRelease();
  await testRunningSyncModeProfilesPreserveLocksAndTtls();
  await testExpiredOwnedModeLockCanBeReacquired();
  await testValidOtherModeLockBlocksNonPreemptiveAcquire();
  await testOwnershipVerificationFailureRollsBackOwnedModeLock();
  await testLockUnavailableCallbackFailurePropagatesWithoutStartingSync();
  await testAcquireFailurePropagatesWithoutStartingSync();
  await testManualOverridePreservesActiveSyncLocksAndPendingWork();
  await testInitialSetupPreemptionPreservesForeignManualLock();
  await testInitialSetupPreservesForeignAutomaticLocks();
  await testManualOverrideCancelsRemoteRetryBackoff();
  await testBeforePerformCanShortCircuitSafely();
  await testLockUnavailableSkipsWithoutHeartbeat();
  await testStartupCompletionPolicyRunsBeforeLockRelease();
  await testStartupCompletionPolicyRunsOnSkipBeforeLockRelease();
  testShouldClearDeferredStartupSyncOnResult();
  testDecisionSplitsStartupBackgroundAndForegroundFollowUp();
  testStartupReadProgressOnlyLocalDeltaAutoMerges();
  testStartupCoreLocalDeltaStillPauses();
  testPulledNormalizedBaselineComparesLocalAndRemoteSides();
  testAutoSyncCompletionLogMessageIsSpecific();
  testSyncTraceEventsAreShownInDiagnostics();
  testSyncTraceDetailsUseChineseLabels();
  testPhase3CallSitesUseDedicatedHelpers();

  console.log("[safe-sync-execution] Phase 3 sync execution layering verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
