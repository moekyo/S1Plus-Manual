#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

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
      operation: "pull",
      sources: {},
    }
  );
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId,
    "旧上下文持锁时，待拉取意图不能被新页面吞掉。"
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
    "follow-up 成功完成后，待拉取意图应被原子清理。"
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
    true
  );

  assert.equal(timers.at(-1).delayMs, 600);
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    pending.requestId,
    "现存页面收到跨上下文通知后，应保留并接管待拉取意图。"
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

const testConcurrentClearRecoversLatestObservedRemoteIntent = () => {
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
    remoteUpdatedAt: "2026-08-27T05:26:20Z",
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
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().remoteUpdatedAt,
    newerRequest.remoteUpdatedAt,
    "旧上下文的 read-delete 窗口不得吞掉刚观测到的新版云端意图。"
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
      operation: "pull",
      sources: {},
    },
    "未完成的持久化远端更新不能仅因时间流逝而显示为待机。"
  );
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

  support.dispose();

  assert.equal(hooks.getForegroundRemoteSyncRecoveryRemainingMs(now), 0);
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
  testConcurrentClearRecoversLatestObservedRemoteIntent();
  await testForegroundRetryCannotClearIntentCreatedDuringItsRun();
  await testForegroundFailureRetainsDurableIntent();
  testDurableForegroundIntentDoesNotAgeIntoIdle();
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
