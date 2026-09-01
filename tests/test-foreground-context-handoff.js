#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHarness = (options = {}) =>
  createBaseHarness({
    ...options,
    hookErrorMessage: "未能从 S1Plus.js 暴露前台上下文交接测试钩子。",
  });

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};
const PENDING_FOREGROUND_REMOTE_SYNC_KEY =
  "s1p_pending_foreground_remote_sync_request";
const SYNC_RUNTIME_TAB_LINEAGE_KEY = "s1p_sync_runtime_tab_lineage_id";

const testPendingForegroundIntentSurvivesActiveLock = async () => {
  const { hooks, store, sandbox } = createHarness();
  const now = 1760001000000;
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now,
  });

  assert.equal(pending.remoteUpdatedAt, "2026-08-27T05:25:29Z");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId
  );

  store.set("s1p_sync_global_lock", {
    owner: "old-context",
    mode: "foreground_followup",
    timestamp: now,
    ttlMs: 45 * 1000,
  });

  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };

  let recoveryCallCount = 0;
  const recovery = hooks.recoverPendingForegroundRemoteSyncIfNeeded({
    now: now + 1000,
    settingsSnapshot: enabledSettings,
    requestForegroundRemoteSyncCheck: async () => {
      recoveryCallCount += 1;
      return { status: "success", action: "pulled" };
    },
  });

  assert.equal(recovery.status, "scheduled");
  assert.equal(recovery.reason, "foreground_recovery_waiting_for_lock");
  const recoveryTimer = timers.find(({ delayMs }) => delayMs >= 44 * 1000);
  assert.ok(recoveryTimer, "应为遗留同步锁安排到期后的恢复任务。");
  assert.deepEqual(
    toPlainObject(hooks.getAutoSyncRuntimePendingDisplayState(now + 1000)),
    {
      hasPending: true,
      source: "foreground_resume",
      reason: "foreground_remote_update_pending",
      operation: "sync",
      sources: {},
    }
  );
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId,
    "旧上下文持锁时，前台远端待处理意图不能被新页面吞掉。"
  );

  store.delete("s1p_sync_global_lock");
  const recoveryWithRequest = hooks.recoverPendingForegroundRemoteSyncIfNeeded({
    now: now + 46000,
    settingsSnapshot: enabledSettings,
  });
  assert.equal(recoveryWithRequest.status, "already_scheduled");
  await recoveryTimer.callback();
  assert.equal(recoveryCallCount, 1);
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
};

const testForegroundProbePersistsAndSettlesIntent = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-08-27T05:20:00Z",
  });

  let pendingDuringFollowup = null;
  const result = await hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: 1760001100000,
      settingsSnapshot: enabledSettings,
      fetchRemoteData: async () => ({
        meta: { updatedAt: "2026-08-27T05:25:29Z" },
      }),
      requestForegroundRemoteSyncCheck: async () => {
        pendingDuringFollowup = hooks.getPendingForegroundRemoteSyncRequest();
        return { status: "success", action: "pulled" };
      },
    },
  });

  assert.equal(result.status, "changed");
  assert.equal(pendingDuringFollowup.remoteUpdatedAt, "2026-08-27T05:25:29Z");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest(),
    null,
    "follow-up 成功完成后，前台远端待处理意图应被原子清理。"
  );
};

const testCrossContextPendingSignalWakesExistingPage = () => {
  const { hooks, sandbox, store } = createHarness();
  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      ...enabledSettings,
      syncDeviceId: "device-a",
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );

  const listeners = [];
  sandbox.GM_addValueChangeListener = (key, callback) => {
    listeners.push({ key, callback });
    return `listener-${listeners.length}`;
  };
  sandbox.GM_removeValueChangeListener = () => {};
  const timers = [];
  const fakeSetTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  sandbox.setTimeout = fakeSetTimeout;
  sandbox.window.setTimeout = fakeSetTimeout;

  const binding = hooks.s1pBindForegroundRemoteSyncPendingChangeHook();
  assert.equal(binding.status, "bound");
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  const pendingFromOldContext = {
    ...pending,
    sourceContextId: "old-context",
    sourceTabId: "old-tab",
  };
  store.set(PENDING_FOREGROUND_REMOTE_SYNC_KEY, pendingFromOldContext);

  listeners[0].callback(
    PENDING_FOREGROUND_REMOTE_SYNC_KEY,
    null,
    pendingFromOldContext,
    false
  );

  assert.equal(timers.at(-1).delayMs, 600);
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId,
    "即使 userscript manager 误报 cross-context 标志，现存页面也应接管外部前台远端待处理意图。"
  );
  const projectedState = toPlainObject(
    hooks.s1pSyncSystem.readState({ surface: "navbar" })
  );
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(projectedState),
    "sync",
    "跨上下文 remote awareness 在 canonical full-sync decision 前必须保持中性。"
  );

  binding.dispose();
  hooks.clearForegroundRemoteSyncRecovery();
  assert.equal(store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY), true);
};

const testOlderContextCannotClearNewerRemoteIntent = () => {
  const { hooks } = createHarness();
  const oldRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  const newRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "visibility_visible",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:26:20Z",
    now: 1760001060000,
  });

  const clearResult = hooks.clearPendingForegroundRemoteSyncRequest(
    oldRequest,
    "old_context_finished"
  );
  assert.equal(clearResult.status, "retained");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newRequest.requestId
  );
};

const testSameTimestampObservationCreatesANewIntentGeneration = () => {
  const { hooks } = createHarness();
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const oldRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt,
    now: 1760001000000,
  });
  const newRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "visibility_visible",
    triggerSource: "foreground_resume",
    remoteUpdatedAt,
    now: 1760001001000,
  });

  assert.notEqual(
    newRequest.requestId,
    oldRequest.requestId,
    "每次远端观测都必须有独立 intent generation，不能把时间戳当作版本身份。"
  );
  const clearResult = hooks.clearPendingForegroundRemoteSyncRequest(
    oldRequest,
    "old_context_finished"
  );
  assert.equal(clearResult.status, "retained");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newRequest.requestId
  );
};

const testConcurrentClearRecoversSameTimestampIntentGeneration = () => {
  const { hooks, sandbox, store } = createHarness();
  const oldRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  const newerRequest = {
    ...oldRequest,
    requestId: "new-context-request",
    lastSeenAt: 1760001060000,
    sourceContextId: "new-context",
  };
  hooks.setLastRemoteProbeInfo({
    lastObservedRemoteUpdatedAt: newerRequest.remoteUpdatedAt,
    lastObservedAt: newerRequest.lastSeenAt,
  });

  let injectedConcurrentWrite = false;
  sandbox.GM_deleteValue = (key) => {
    if (key === PENDING_FOREGROUND_REMOTE_SYNC_KEY && !injectedConcurrentWrite) {
      injectedConcurrentWrite = true;
      store.set(key, newerRequest);
    }
    store.delete(key);
  };

  const clearResult = hooks.clearPendingForegroundRemoteSyncRequest(
    oldRequest,
    "old_context_finished"
  );
  assert.equal(clearResult.status, "retained");
  const recoveredRequest = hooks.getPendingForegroundRemoteSyncRequest();
  assert.equal(recoveredRequest.remoteUpdatedAt, newerRequest.remoteUpdatedAt);
  assert.notEqual(
    recoveredRequest.requestId,
    oldRequest.requestId,
    "旧上下文的 read-delete 窗口不得吞掉同一 updated_at 的新版观测代次。"
  );
};

const testForegroundRetryCannotClearIntentCreatedDuringItsRun = async () => {
  const { hooks, sandbox } = createHarness();
  const oldRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  let newerRequest = null;

  hooks.scheduleForegroundRemoteSyncRetry("remote_probe_changed:pageshow", {
    expectedPendingRequest: oldRequest,
    requestForegroundRemoteSyncCheck: async () => {
      newerRequest = hooks.markPendingForegroundRemoteSyncRequest({
        reason: "visibility_visible",
        remoteUpdatedAt: "2026-08-27T05:26:20Z",
        now: 1760001060000,
      });
      return { status: "success", action: "pulled" };
    },
    syncResultPhasePolicy: {
      handle: async () => ({ refreshPlan: null, retryResult: null }),
    },
    maybeShowForegroundProbeFeedback: () => {},
  });
  const retryTimer = timers.find(({ delayMs }) => delayMs === 1200);
  assert.ok(retryTimer);
  await retryTimer.callback();

  assert.notEqual(newerRequest.requestId, oldRequest.requestId);
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newerRequest.requestId,
    "补偿重试只能结算启动前看到的请求，不能清掉执行期间出现的新版意图。"
  );
  assert.ok(hooks.getForegroundRemoteSyncRecoveryRemainingMs() > 0);
  hooks.clearForegroundRemoteSyncRecovery();
};

const testChangedIntentRetryStopsWhenItsPendingGenerationIsGone = async () => {
  const { hooks, sandbox } = createHarness();
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  let requestCount = 0;

  hooks.scheduleForegroundRemoteSyncRetry("remote_probe_changed:pageshow", {
    expectedPendingRequest: pending,
    requestForegroundRemoteSyncCheck: async () => {
      requestCount += 1;
      return { status: "success", action: "pulled" };
    },
    syncResultPhasePolicy: {
      handle: async () => ({ refreshPlan: null, retryResult: null }),
    },
    maybeShowForegroundProbeFeedback: () => {},
  });
  const retryTimer = timers.find(({ delayMs }) => delayMs === 1200);
  assert.ok(retryTimer);
  hooks.clearPendingForegroundRemoteSyncRequest(pending, "other_owner_finished");
  await retryTimer.callback();

  assert.equal(
    requestCount,
    0,
    "changed-intent retry 只能消费它捕获的 pending generation。"
  );
};

const testTimestampEqualityAloneDoesNotCoverADurableIntent = () => {
  const { hooks, sandbox } = createHarness();
  const now = 1760001000000;
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt,
    now,
  });
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt,
  });
  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };

  const recovery = hooks.recoverPendingForegroundRemoteSyncIfNeeded({
    now: now + 1,
    settingsSnapshot: enabledSettings,
  });

  assert.equal(recovery.status, "scheduled");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId,
    "相同 updated_at 不能证明 baseline 覆盖了这次具体观测。"
  );
  assert.ok(timers.some(({ delayMs }) => delayMs === 600));
  hooks.clearForegroundRemoteSyncRecovery();
};

const testBaselineSettlementIsBoundToTheCapturedIntent = () => {
  const { hooks } = createHarness();
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const captured = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt,
    now: 1760001000000,
  });
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt,
  });
  const cleared = hooks.settlePendingForegroundRemoteSyncRequestIfCovered(
    captured,
    "manual_sync_success"
  );
  assert.equal(cleared.status, "cleared");
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);

  const older = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt,
    now: 1760001001000,
  });
  const newer = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "visibility_visible",
    remoteUpdatedAt,
    now: 1760001002000,
  });
  const retained = hooks.settlePendingForegroundRemoteSyncRequestIfCovered(
    older,
    "manual_sync_success"
  );
  assert.equal(retained.status, "retained");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newer.requestId
  );
};

const testForegroundFailureRetainsDurableIntent = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-08-27T05:20:00Z",
  });

  const result = await hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: 1760001100000,
      settingsSnapshot: enabledSettings,
      fetchRemoteData: async () => ({
        meta: { updatedAt: "2026-08-27T05:25:29Z" },
      }),
      requestForegroundRemoteSyncCheck: async () => ({
        status: "failure",
        error: "transient timeout",
      }),
      syncResultPhasePolicy: {
        handle: async () => ({ retryResult: null }),
      },
    },
  });

  assert.equal(result.syncRequestResult.status, "failure");
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().remoteUpdatedAt,
    "2026-08-27T05:25:29Z",
    "已确认的云端更新不能因一次 follow-up 失败而丢失。"
  );
};

const testDurableForegroundIntentDoesNotAgeIntoIdle = () => {
  const { hooks } = createHarness();
  const now = 1760001000000;
  hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now,
  });

  assert.deepEqual(
    toPlainObject(
      hooks.getAutoSyncRuntimePendingDisplayState(now + 30 * 60 * 1000)
    ),
    {
      hasPending: true,
      source: "foreground_resume",
      reason: "foreground_remote_update_pending",
      operation: "sync",
      sources: {},
    },
    "未完成的持久化远端更新不能仅因时间流逝而显示为待机。"
  );
};

const runDisabledForegroundPendingCancellationCase = (settingKey) => {
  const { hooks, sandbox, store } = createHarness();
  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      ...enabledSettings,
      syncAutoEnabled: false,
      syncDeviceId: "device-a",
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );

  const timers = [];
  const clearedTimerIds = [];
  const fakeSetTimeout = (callback, delayMs) => {
    const timerId = timers.length + 1;
    timers.push({ callback, delayMs, timerId });
    return timerId;
  };
  sandbox.setTimeout = fakeSetTimeout;
  sandbox.window.setTimeout = fakeSetTimeout;
  sandbox.clearTimeout = (timerId) => {
    clearedTimerIds.push(timerId);
  };
  sandbox.window.clearTimeout = sandbox.clearTimeout;

  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  hooks.scheduleForegroundRemoteSyncRecovery(pending, {
    now: 1760001000000,
    requestForegroundRemoteSyncCheck: async () => {
      throw new Error("disabled foreground recovery must not run");
    },
  });

  assert.deepEqual(
    toPlainObject(
      hooks.getAutoSyncRuntimePendingDisplayState(1760001000000)
    ),
    {
      hasPending: true,
      source: "foreground_resume",
      reason: "foreground_remote_update_pending",
      operation: "sync",
      sources: {},
    }
  );

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      [settingKey]: false,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );

  assert.equal(
    store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY),
    false,
    `${settingKey}=false 时必须删除 durable foreground pending intent。`
  );
  assert.equal(
    hooks.getForegroundRemoteSyncRecoveryRemainingMs(),
    0,
    `${settingKey}=false 时必须取消 foreground recovery timer。`
  );
  assert.equal(clearedTimerIds.length, 1);
  const displayAfterCancellation = toPlainObject(
    hooks.getAutoSyncRuntimePendingDisplayState()
  );
  assert.equal(displayAfterCancellation.hasPending, false);
  assert.notEqual(displayAfterCancellation.source, "foreground_resume");
  assert.notEqual(displayAfterCancellation.operation, "pull");

  hooks.markPendingForegroundRemoteSyncRequest({
    reason: "stale_context_after_setting_change",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:26:29Z",
    now: 1760001060000,
  });
  let recoveryRequestCount = 0;
  const recoveryResult = hooks.recoverPendingForegroundRemoteSyncIfNeeded({
    requestForegroundRemoteSyncCheck: async () => {
      recoveryRequestCount += 1;
      return { status: "success", action: "pulled" };
    },
  });
  assert.equal(recoveryResult.status, "cleared");
  assert.equal(store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY), false);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(recoveryRequestCount, 0);

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      [settingKey]: true,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest(),
    null,
    `${settingKey} 重新启用时不得 resurrect 关闭前的旧 intent。`
  );
  assert.equal(
    hooks.recoverPendingForegroundRemoteSyncIfNeeded().reason,
    "no_pending_foreground_remote_sync"
  );
};

const testDisablingForegroundCheckCancelsDurablePendingIntent = () => {
  runDisabledForegroundPendingCancellationCase(
    "syncCheckOnReturnToForeground"
  );
};

const testDisablingRemoteSyncCancelsDurablePendingIntent = () => {
  runDisabledForegroundPendingCancellationCase("syncRemoteEnabled");
};

const runInFlightForegroundCancellationCase = async ({
  disabledSettingKey = "syncCheckOnReturnToForeground",
  reenableBeforeCompletion = false,
  shouldRejectOldRequest = false,
} = {}) => {
  const { hooks, sandbox, store } = createHarness();
  const settings = {
    ...hooks.getSettings(),
    ...enabledSettings,
    syncAutoEnabled: false,
    syncPerLoadCheckEnabled: false,
    syncDeviceId: "device-a",
  };
  hooks.saveSettings(settings, {
    suppressSyncTrigger: true,
    forceWrite: true,
  });
  assert.equal(hooks.getSettings().syncCheckOnReturnToForeground, true);
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-08-27T05:20:00Z",
  });

  const timers = [];
  const clearedTimerIds = [];
  const fakeSetTimeout = (callback, delayMs) => {
    const timerId = timers.length + 1;
    timers.push({ callback, delayMs, timerId });
    return timerId;
  };
  sandbox.setTimeout = fakeSetTimeout;
  sandbox.window.setTimeout = fakeSetTimeout;
  sandbox.clearTimeout = (timerId) => {
    clearedTimerIds.push(timerId);
  };
  sandbox.window.clearTimeout = sandbox.clearTimeout;

  let resolveOldRequest;
  let rejectOldRequest;
  let foregroundRequestStartedResolve;
  const foregroundRequestStarted = new Promise((resolve) => {
    foregroundRequestStartedResolve = resolve;
  });
  let foregroundRequestCount = 0;
  const oldRequest = new Promise((resolve, reject) => {
    resolveOldRequest = resolve;
    rejectOldRequest = reject;
  });
  const oldProbePromise = hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: 1760001100000,
      settingsSnapshot: settings,
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => ({
        meta: { updatedAt: "2026-08-27T05:25:29Z" },
      }),
      requestForegroundRemoteSyncCheckOverrides: {
        acquireForegroundFollowUpSyncLock: async () => true,
        startForegroundFollowUpSyncLockHeartbeat: () => {},
        stopForegroundFollowUpSyncLockHeartbeat: () => {},
        releaseForegroundFollowUpSyncLock: () => {},
        performAutoSync: async () => {
          foregroundRequestCount += 1;
          foregroundRequestStartedResolve();
          return oldRequest;
        },
      },
    },
  });

  await Promise.race([foregroundRequestStarted, wait(100)]);
  assert.equal(foregroundRequestCount, 1, "旧 foreground request 必须保持 in-flight。");

  const pending = hooks.getPendingForegroundRemoteSyncRequest();
  assert.ok(pending, "in-flight foreground request 必须先拥有 durable pending intent。");
  assert.deepEqual(
    toPlainObject(hooks.getAutoSyncRuntimePendingDisplayState()),
    {
      hasPending: true,
      source: "foreground_resume",
      reason: "foreground_remote_update_pending",
      operation: "sync",
      sources: {},
    }
  );
  const recovery = hooks.scheduleForegroundRemoteSyncRecovery(pending, {
    now: 1760001100000,
  });
  assert.equal(recovery.status, "scheduled");
  const retry = hooks.scheduleForegroundRemoteSyncRetry("in_flight_foreground_retry", {
    preferredDelayMs: 1800,
  });
  assert.equal(retry.status, "scheduled");

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      [disabledSettingKey]: false,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );

  assert.equal(
    store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY),
    false,
    "禁用 foreground check 时，in-flight request 的 durable pending 必须立即删除。"
  );
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(), 0);
  assert.ok(
    clearedTimerIds.length >= 2,
    "禁用 foreground check 时必须清理 recovery 与 retry timer。"
  );
  assert.equal(
    hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false,
    "禁用 foreground check 后 indicator 不能继续显示 pending。"
  );

  if (reenableBeforeCompletion) {
    hooks.saveSettings(
      {
        ...hooks.getSettings(),
        [disabledSettingKey]: true,
        syncPerLoadCheckEnabled: false,
      },
      { suppressSyncTrigger: true, forceWrite: true }
    );
  }

  if (shouldRejectOldRequest) {
    rejectOldRequest(new Error("old foreground request rejected"));
  } else {
    resolveOldRequest({
      status: "failure",
      error: "old foreground request failed after setting cancellation",
    });
  }
  await oldProbePromise;

  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(), 0);
  assert.equal(foregroundRequestCount, 1);
  assert.equal(
    hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false,
    "旧 completion 不得把 indicator 恢复到 pending/retrying。"
  );
};

const testInFlightForegroundFailureCannotResurrectAfterDisable = async () => {
  await runInFlightForegroundCancellationCase();
};

const testInFlightForegroundCompletionCannotCrossReenabledEpoch = async () => {
  await runInFlightForegroundCancellationCase({
    reenableBeforeCompletion: true,
  });
};

const testRejectedInFlightForegroundRequestCannotResurrectAfterDisable = async () => {
  await runInFlightForegroundCancellationCase({
    shouldRejectOldRequest: true,
  });
};

const testInFlightForegroundFailureCannotResurrectAfterRemoteSyncDisable = async () => {
  await runInFlightForegroundCancellationCase({
    disabledSettingKey: "syncRemoteEnabled",
    reenableBeforeCompletion: true,
  });
};

const runForegroundEntrySingleFlightOwnerCase = async (oldRequestResult) => {
  const { hooks, sandbox, store } = createHarness();
  const settings = {
    ...hooks.getSettings(),
    ...enabledSettings,
    syncAutoEnabled: false,
    syncPerLoadCheckEnabled: false,
    syncDeviceId: "device-a",
  };
  hooks.saveSettings(settings, {
    suppressSyncTrigger: true,
    forceWrite: true,
  });
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-08-27T05:20:00Z",
  });

  const timers = [];
  const clearedTimerIds = [];
  const fakeSetTimeout = (callback, delayMs) => {
    const timerId = timers.length + 1;
    timers.push({ callback, delayMs, timerId });
    return timerId;
  };
  sandbox.setTimeout = fakeSetTimeout;
  sandbox.window.setTimeout = fakeSetTimeout;
  sandbox.clearTimeout = (timerId) => {
    clearedTimerIds.push(timerId);
  };
  sandbox.window.clearTimeout = sandbox.clearTimeout;

  let resolveOldRequest;
  let foregroundRequestCount = 0;
  let oldProbeStartedResolve;
  const oldProbeStarted = new Promise((resolve) => {
    oldProbeStartedResolve = resolve;
  });
  const oldRequest = new Promise((resolve) => {
    resolveOldRequest = resolve;
  });
  let oldPolicyCalls = 0;
  const oldProbePromise = hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: 1760001100000,
      settingsSnapshot: settings,
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => ({
        meta: { updatedAt: "2026-08-27T05:25:29Z" },
      }),
      syncResultPhasePolicy: {
        handle: async () => {
          oldPolicyCalls += 1;
          return { refreshPlan: null, retryResult: null };
        },
      },
      requestForegroundRemoteSyncCheckOverrides: {
        acquireForegroundFollowUpSyncLock: async () => true,
        startForegroundFollowUpSyncLockHeartbeat: () => {},
        stopForegroundFollowUpSyncLockHeartbeat: () => {},
        releaseForegroundFollowUpSyncLock: () => {},
        performAutoSync: async () => {
          foregroundRequestCount += 1;
          oldProbeStartedResolve();
          return oldRequest;
        },
      },
    },
  });

  await Promise.race([oldProbeStarted, wait(100)]);
  assert.equal(foregroundRequestCount, 1);
  const oldPending = hooks.getPendingForegroundRemoteSyncRequest();
  assert.ok(oldPending);
  const oldRequestId = oldPending.requestId;

  hooks.scheduleForegroundRemoteSyncRecovery(oldPending, {
    now: 1760001100000,
  });
  hooks.scheduleForegroundRemoteSyncRetry("owner_replacement_probe", {
    preferredDelayMs: 1800,
  });

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      syncCheckOnReturnToForeground: false,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );
  assert.equal(store.has(PENDING_FOREGROUND_REMOTE_SYNC_KEY), false);
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(), 0);
  assert.ok(clearedTimerIds.length >= 2);

  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      syncCheckOnReturnToForeground: true,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );

  let newMetadataRequestCount = 0;
  let newFollowUpRequestCount = 0;
  let newPolicyCalls = 0;
  const newProbePromise = hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: 1760001105000,
      settingsSnapshot: hooks.getSettings(),
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => {
        newMetadataRequestCount += 1;
        return { meta: { updatedAt: "2026-08-27T05:26:29Z" } };
      },
      syncResultPhasePolicy: {
        handle: async () => {
          newPolicyCalls += 1;
          return { refreshPlan: null, retryResult: null };
        },
      },
      requestForegroundRemoteSyncCheckOverrides: {
        acquireForegroundFollowUpSyncLock: async () => true,
        startForegroundFollowUpSyncLockHeartbeat: () => {},
        stopForegroundFollowUpSyncLockHeartbeat: () => {},
        releaseForegroundFollowUpSyncLock: () => {},
        performAutoSync: async () => {
          newFollowUpRequestCount += 1;
          return { status: "success", action: "pulled" };
        },
      },
    },
  });
  const newProbeResult = await newProbePromise;

  assert.deepEqual(toPlainObject(newProbeResult), {
    status: "skipped",
    reason: "probe_in_flight",
  });
  assert.equal(newMetadataRequestCount, 0);
  assert.equal(newFollowUpRequestCount, 0);
  assert.equal(newPolicyCalls, 0);
  assert.equal(foregroundRequestCount, 1);
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(), 0);
  assert.equal(
    hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false
  );

  resolveOldRequest(oldRequestResult);
  const oldProbeResult = await oldProbePromise;
  assert.equal(oldProbeResult.reason, "foreground_sync_request_cancelled");
  assert.equal(oldPolicyCalls, 0);
  assert.equal(foregroundRequestCount, 1);
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(), 0);
  assert.equal(
    hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false
  );
  assert.equal(
    oldRequestId,
    oldPending.requestId,
    "旧请求 owner 必须在 disable 前被明确记录。"
  );
};

const testForegroundEntryCannotReplaceCancelledInFlightOwner = async () => {
  await runForegroundEntrySingleFlightOwnerCase({
    status: "success",
    action: "pulled",
  });
  await runForegroundEntrySingleFlightOwnerCase({
    status: "failure",
    retryable: true,
    error: "transient timeout",
  });
};

const testRecoveryConsumesForegroundResultPhase = async () => {
  const { hooks, sandbox } = createHarness();
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: Date.now(),
  });
  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  const policyCalls = [];

  hooks.scheduleForegroundRemoteSyncRecovery(pending, {
    requestForegroundRemoteSyncCheck: async () => ({
      status: "success",
      action: "pulled",
    }),
    syncResultPhasePolicy: {
      handle: async (result, options) => {
        policyCalls.push({ result, options });
        return { refreshPlan: null, retryResult: null };
      },
    },
  });
  const recoveryTimer = timers.find(({ delayMs }) => delayMs === 600);
  assert.ok(recoveryTimer);
  await recoveryTimer.callback();

  assert.equal(policyCalls.length, 1);
  assert.equal(policyCalls[0].options.source, "foreground");
  assert.equal(
    policyCalls[0].options.refreshOptions.reason,
    "foreground_recovery:pageshow"
  );
  assert.equal(hooks.getPendingForegroundRemoteSyncRequest(), null);
};

const testRecoveryInFlightResultKeepsADeferredAttempt = async () => {
  const { hooks, sandbox } = createHarness();
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: Date.now(),
  });
  const timers = [];
  sandbox.setTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };

  hooks.scheduleForegroundRemoteSyncRecovery(pending, {
    requestForegroundRemoteSyncCheck: async () => ({
      status: "skipped",
      reason: "foreground_sync_in_flight",
    }),
  });
  const recoveryTimer = timers.find(({ delayMs }) => delayMs === 600);
  assert.ok(recoveryTimer);
  await recoveryTimer.callback();

  assert.equal(Boolean(hooks.getPendingForegroundRemoteSyncRequest()), true);
  assert.ok(
    hooks.getForegroundRemoteSyncRetryRemainingMs() > 0 ||
      hooks.getForegroundRemoteSyncRecoveryRemainingMs() > 0,
    "撞上当前 Running Sync 后必须保留一个可执行的后续尝试。"
  );
};

const testRecoverySupportDisposeCancelsRecoveryTimer = () => {
  const { hooks, sandbox } = createHarness();
  sandbox.setTimeout = () => 1;
  const support = hooks.s1pInitializePendingAutoSyncRecoverySupport({
    bindActivityHooks: () => ({ dispose: () => ({ status: "unbound" }) }),
    bindForegroundPendingChange: () => ({
      dispose: () => ({ status: "unbound" }),
    }),
    syncPolling: () => ({ status: "skipped" }),
    stopPolling: () => ({ status: "stopped" }),
  });
  const now = Date.now();
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now,
  });
  hooks.scheduleForegroundRemoteSyncRecovery(pending, { now });
  hooks.scheduleForegroundRemoteSyncRetry("remote_probe_changed:pageshow", {
    expectedPendingRequest: pending,
  });

  assert.ok(hooks.getForegroundRemoteSyncRecoveryRemainingMs(now) > 0);
  assert.ok(hooks.getForegroundRemoteSyncRetryRemainingMs(now) > 0);

  support.dispose();

  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(now), 0);
  assert.equal(hooks.getForegroundRemoteSyncRetryRemainingMs(now), 0);
};

const testRuntimeContextKeepsStableTabLineageAcrossReload = () => {
  const first = createHarness({ includeSessionStorage: true });
  const firstContext = first.hooks.getSyncRuntimeContextInfo();
  assert.equal(
    first.sessionStore.get(SYNC_RUNTIME_TAB_LINEAGE_KEY),
    firstContext.tabId
  );

  const second = createHarness({
    includeSessionStorage: true,
    sessionStorageEntries: [
      [SYNC_RUNTIME_TAB_LINEAGE_KEY, firstContext.tabId],
    ],
  });
  const secondContext = second.hooks.getSyncRuntimeContextInfo();
  assert.equal(secondContext.tabId, firstContext.tabId);
  assert.notEqual(secondContext.contextId, firstContext.contextId);
  assert.notEqual(secondContext.runtimeId, firstContext.runtimeId);
};

const testSyncTraceIncludesRuntimeContext = () => {
  const { hooks } = createHarness();
  const context = hooks.getSyncRuntimeContextInfo();
  const summary = hooks.recordSyncTraceEvent("context_test", {
    logToConsole: false,
    details: { reason: "test" },
  });

  assert.ok(context.contextId);
  assert.ok(context.tabId);
  assert.ok(context.runtimeId);
  assert.equal(context.path, "/2b/");
  assert.match(summary, new RegExp(`context=${context.contextId}`));
  assert.match(summary, new RegExp(`tab=${context.tabId}`));
  assert.match(summary, new RegExp(`runtime=${context.runtimeId}`));
  assert.match(summary, /path=\/2b\//);
  assert.match(summary, /frame=top/);
};

const testCollectedS1pLogsIncludeRuntimeContext = () => {
  const { hooks, sandbox } = createBaseHarness({
    includeSessionStorage: true,
    hookErrorMessage: "未能从 S1Plus.js 暴露日志上下文测试钩子。",
  });
  hooks.stopLogCollector();
  const originalConsole = sandbox.console;
  const calls = [];
  sandbox.console = {
    log: (...args) => calls.push(args),
    warn: (...args) => calls.push(args),
    error: (...args) => calls.push(args),
    debug: (...args) => calls.push(args),
  };
  hooks.startLogCollector();
  sandbox.console.log("S1 Plus: foreground follow-up started");

  const message = hooks.getDebugLogCollectorStateForTest().logBuffer[0].message;
  assert.match(message, /S1 Plus: foreground follow-up started/);
  assert.match(message, /context=/);
  assert.match(message, /path=\/2b\//);

  hooks.stopLogCollector();
  sandbox.console = originalConsole;
};

(async () => {
  await testPendingForegroundIntentSurvivesActiveLock();
  await testForegroundProbePersistsAndSettlesIntent();
  testCrossContextPendingSignalWakesExistingPage();
  testOlderContextCannotClearNewerRemoteIntent();
  testSameTimestampObservationCreatesANewIntentGeneration();
  testConcurrentClearRecoversSameTimestampIntentGeneration();
  await testForegroundRetryCannotClearIntentCreatedDuringItsRun();
  await testChangedIntentRetryStopsWhenItsPendingGenerationIsGone();
  testTimestampEqualityAloneDoesNotCoverADurableIntent();
  testBaselineSettlementIsBoundToTheCapturedIntent();
  await testForegroundFailureRetainsDurableIntent();
  testDurableForegroundIntentDoesNotAgeIntoIdle();
  testDisablingForegroundCheckCancelsDurablePendingIntent();
  testDisablingRemoteSyncCancelsDurablePendingIntent();
  await testInFlightForegroundFailureCannotResurrectAfterDisable();
  await testInFlightForegroundCompletionCannotCrossReenabledEpoch();
  await testRejectedInFlightForegroundRequestCannotResurrectAfterDisable();
  await testInFlightForegroundFailureCannotResurrectAfterRemoteSyncDisable();
  await testForegroundEntryCannotReplaceCancelledInFlightOwner();
  await testRecoveryConsumesForegroundResultPhase();
  await testRecoveryInFlightResultKeepsADeferredAttempt();
  testRecoverySupportDisposeCancelsRecoveryTimer();
  testRuntimeContextKeepsStableTabLineageAcrossReload();
  testSyncTraceIncludesRuntimeContext();
  testCollectedS1pLogsIncludeRuntimeContext();
  console.log(
    "[foreground-context-handoff] Foreground context handoff and trace context verified."
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
