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
const PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX =
  PENDING_FOREGROUND_REMOTE_SYNC_KEY + ":record:";
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

const testNonRetryableForegroundSoftBlockStopsRecoveryLoop = async () => {
  const { hooks, sandbox } = createHarness();
  const now = 1760001200000;
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now,
  });
  const timers = [];
  const fakeSetTimeout = (callback, delayMs) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  sandbox.setTimeout = fakeSetTimeout;
  sandbox.window.setTimeout = fakeSetTimeout;
  let requestCount = 0;

  const recovery = hooks.scheduleForegroundRemoteSyncRecovery(pending, {
    now,
    requestForegroundRemoteSyncCheck: async () => {
      requestCount += 1;
      return {
        status: "blocked",
        blockLevel: "soft",
        blockScope: "tab",
        reason: "local_changed_with_remote_timestamp_drift",
        action: "skip_push_on_foreground_followup",
      };
    },
    syncResultPhasePolicy: {
      handle: async () => ({ refreshPlan: null, retryResult: null }),
    },
  });
  assert.equal(recovery.status, "scheduled");
  const recoveryTimer = timers.find(({ delayMs }) => delayMs === 600);
  assert.ok(recoveryTimer, "前台待处理应先安排一次恢复执行。");

  await recoveryTimer.callback();

  const blockedPending = hooks.getPendingForegroundRemoteSyncRequest();
  assert.equal(requestCount, 1);
  assert.equal(blockedPending.lastResultStatus, "blocked");
  assert.equal(
    blockedPending.lastResultReason,
    "local_changed_with_remote_timestamp_drift"
  );
  assert.equal(blockedPending.lastResultBlockLevel, "soft");
  assert.equal(
    hooks.getForegroundRemoteSyncRecoveryRemainingMs(),
    0,
    "不可重试的 soft block 完成后不得再次安排 600ms 恢复循环。"
  );
  assert.equal(
    hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false,
    "已进入等待新事实的 soft block 不应继续显示待处理波浪。"
  );

  const timerCountAfterBlock = timers.length;
  const suppressedRecovery = hooks.recoverPendingForegroundRemoteSyncIfNeeded({
    now: now + 1000,
    settingsSnapshot: enabledSettings,
    requestForegroundRemoteSyncCheck: async () => {
      requestCount += 1;
      return { status: "success", action: "pulled" };
    },
  });
  assert.equal(suppressedRecovery.status, "blocked");
  assert.equal(
    suppressedRecovery.reason,
    "foreground_soft_block_waiting_for_change"
  );
  assert.equal(requestCount, 1, "重复恢复不得再次执行 follow-up 请求。");
  assert.equal(
    timers.length,
    timerCountAfterBlock,
    "重复恢复不得重新创建后台计时器。"
  );

  const repeatedProbe = await hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      now: now + 2000,
      settingsSnapshot: enabledSettings,
      acquireRemoteProbeLock: async () => true,
      releaseRemoteProbeLockValue: () => {},
      fetchRemoteData: async () => ({
        meta: { updatedAt: "2026-08-27T05:25:29Z" },
      }),
      requestForegroundRemoteSyncCheck: async () => {
        requestCount += 1;
        return { status: "success", action: "pulled" };
      },
    },
  });
  assert.equal(repeatedProbe.status, "blocked");
  assert.equal(repeatedProbe.reason, "foreground_soft_block_waiting_for_change");
  assert.equal(
    repeatedProbe.syncRequestResult.action,
    "probe_soft_block_suppressed",
    "同一云端版本的重复探测应复用现有 soft block。"
  );
  assert.equal(requestCount, 1, "重复探测不得再次启动完整 follow-up。");

  hooks.s1pSyncSystem.recordLocalMutation("read_progress", {
    triggerSync: false,
  });
  const reopenedPending = hooks.getPendingForegroundRemoteSyncRequest();
  assert.equal(
    reopenedPending.lastResultStatus,
    "",
    "新本地事实应解除 durable soft block。"
  );
  assert.equal(reopenedPending.lastResultReason, "");
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

  const recoveryTimers = timers.filter(({ callback }) =>
    !["s1pFlushSyncTrace", "s1pPersistLogs"].includes(callback.name));
  assert.equal(recoveryTimers.at(-1).delayMs, 600);
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

const testForegroundSettlementCannotOverwriteRequestRegisteredDuringWrite = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const oldRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt,
    now: 1760001000000,
  });
  let newerRequest = null;
  let injected = false;
  const originalSetValue = first.sandbox.GM_setValue;
  first.sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      value?.requestId === oldRequest.requestId &&
      value?.lastResultStatus === "blocked"
    ) {
      injected = true;
      newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
        reason: "visibility_visible",
        triggerSource: "foreground_resume",
        remoteUpdatedAt,
        now: 1760001000000,
      });
    }
    originalSetValue(key, value);
  };

  first.hooks.settlePendingForegroundRemoteSyncRequest(oldRequest, {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_with_remote_timestamp_drift",
    action: "skip_push_on_foreground_followup",
  });

  assert.equal(injected, true, "必须命中结算写入前的跨上下文交错窗口。");
  assert.ok(newerRequest);
  const current = first.hooks.getPendingForegroundRemoteSyncRequest();
  assert.equal(current.requestId, newerRequest.requestId);
  assert.equal(current.remoteUpdatedAt, remoteUpdatedAt);
  assert.equal(
    first.hooks.isTerminalForegroundRemoteSyncSoftBlock(current),
    false,
    "R1 的 soft block 不能成为 R2 的恢复阻断依据。"
  );
};

const testLateRegistrationCannotRewindCurrentObservation = () => {
  for (const remoteUpdatedAt of [
    "2026-08-27T05:25:29Z",
    "2026-08-27T05:26:20Z",
  ]) {
    const sharedStore = new Map();
    const first = createHarness({ sharedStore });
    const second = createHarness({ sharedStore });
    const originalSetValue = first.sandbox.GM_setValue;
    let injected = false;
    let newerRequest = null;
    first.sandbox.GM_setValue = (key, value) => {
      if (
        !injected &&
        String(key).startsWith(PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX) &&
        value?.lastResultStatus === ""
      ) {
        originalSetValue(key, value);
        injected = true;
        newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
          reason: "visibility_visible",
          triggerSource: "foreground_resume",
          remoteUpdatedAt,
          now: 1760001000000,
        });
        return;
      }
      originalSetValue(key, value);
    };

    const olderRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
      reason: "pageshow",
      triggerSource: "foreground_resume",
      remoteUpdatedAt,
      now: 1760001000000,
    });

    assert.equal(injected, true, "必须命中 record 已写入、marker 尚未写入的窗口。");
    assert.ok(newerRequest);
    assert.notEqual(newerRequest.requestId, olderRequest.requestId);

    const currentBeforeSettlement = first.hooks.getPendingForegroundRemoteSyncRequest();
    assert.equal(
      currentBeforeSettlement.requestId,
      newerRequest.requestId,
      "迟到的旧 registration 不能把 current 退回 R1。"
    );
    assert.equal(currentBeforeSettlement.remoteUpdatedAt, remoteUpdatedAt);

    const timers = [];
    first.sandbox.setTimeout = (callback, delayMs) => {
      timers.push({ callback, delayMs });
      return timers.length;
    };
    first.sandbox.window.setTimeout = first.sandbox.setTimeout;
    first.hooks.settlePendingForegroundRemoteSyncRequest(olderRequest, {
      status: "blocked",
      blockLevel: "soft",
      reason: "local_changed_with_remote_timestamp_drift",
      action: "skip_push_on_foreground_followup",
    });

    const currentAfterSettlement = first.hooks.getPendingForegroundRemoteSyncRequest();
    assert.equal(currentAfterSettlement.requestId, newerRequest.requestId);
    assert.equal(
      first.hooks.isTerminalForegroundRemoteSyncSoftBlock(currentAfterSettlement),
      false,
      "R1 的 soft block 不能成为 R2 的恢复阻断依据。"
    );
    const recovery = first.hooks.recoverPendingForegroundRemoteSyncIfNeeded({
      now: 1760001000001,
      settingsSnapshot: enabledSettings,
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "pulled",
      }),
    });
    assert.equal(recovery.status, "scheduled");
    assert.equal(recovery.requestId, newerRequest.requestId);
    first.hooks.clearForegroundRemoteSyncRecovery();
    assert.equal(timers.length > 0, true);
  }
};

const prepareForegroundCancellationSettings = (hooks) => {
  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      ...enabledSettings,
      syncAutoEnabled: false,
      syncDeviceId: "device-a",
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );
};

const cancelForegroundPendingThroughSettings = (hooks, settingKey) => {
  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      [settingKey]: false,
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );
  hooks.saveSettings(
    {
      ...hooks.getSettings(),
      [settingKey]: true,
      syncRemoteEnabled: true,
      syncCheckOnReturnToForeground: true,
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat-token",
    },
    { suppressSyncTrigger: true, forceWrite: true }
  );
};

const testCancelledForegroundRequestCannotBeResurrectedByLateWrites = () => {
  for (const settingKey of [
    "syncCheckOnReturnToForeground",
    "syncRemoteEnabled",
  ]) {
    for (const operation of ["attempt", "settlement", "soft_block_clear"]) {
      const sharedStore = new Map();
      const first = createHarness({ sharedStore });
      const second = createHarness({ sharedStore });
      const fresh = createHarness({ sharedStore });
      prepareForegroundCancellationSettings(second.hooks);
      const olderRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
        reason: "pageshow",
        triggerSource: "foreground_resume",
        remoteUpdatedAt: "2026-08-27T05:25:29Z",
        now: 1760001000000,
      });
      if (operation === "soft_block_clear") {
        first.hooks.settlePendingForegroundRemoteSyncRequest(olderRequest, {
          status: "blocked",
          blockLevel: "soft",
          reason: "local_changed_with_remote_timestamp_drift",
          action: "skip_push_on_foreground_followup",
        });
      }

      let injected = false;
      const originalSetValue = first.sandbox.GM_setValue;
      first.sandbox.GM_setValue = (key, value) => {
        const matchesLateWrite =
          String(key).startsWith(PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX) &&
          value?.requestId === olderRequest.requestId &&
          (operation === "attempt"
            ? value?.lastResultStatus === "running"
            : operation === "settlement"
              ? value?.lastResultStatus === "blocked"
              : value?.lastResultStatus === "");
        if (!injected && matchesLateWrite) {
          injected = true;
          cancelForegroundPendingThroughSettings(second.hooks, settingKey);
        }
        originalSetValue(key, value);
      };

      if (operation === "attempt") {
        first.hooks.markPendingForegroundRemoteSyncAttempt(olderRequest);
      } else if (operation === "settlement") {
        first.hooks.settlePendingForegroundRemoteSyncRequest(olderRequest, {
          status: "blocked",
          blockLevel: "soft",
          reason: "local_changed_with_remote_timestamp_drift",
          action: "skip_push_on_foreground_followup",
        });
      } else {
        first.hooks.clearPendingForegroundRemoteSyncSoftBlock("local_mutation");
      }

      assert.equal(injected, true, "必须命中取消完成后、旧 continuation 写回前的窗口。");
      assert.equal(
        fresh.hooks.getPendingForegroundRemoteSyncRequest(),
        null,
        `${settingKey}/${operation} 的迟到写入不能复活已取消的 R1。`
      );
      const recovery = fresh.hooks.recoverPendingForegroundRemoteSyncIfNeeded({
        settingsSnapshot: enabledSettings,
        requestForegroundRemoteSyncCheck: async () => ({
          status: "success",
          action: "pulled",
        }),
      });
      assert.equal(recovery.reason, "no_pending_foreground_remote_sync");
    }
  }
};

const testCancelledForegroundRequestKeepsConcurrentNewRegistration = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  prepareForegroundCancellationSettings(second.hooks);
  const olderRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  let newerRequest = null;
  let injected = false;
  const originalSetValue = first.sandbox.GM_setValue;
  first.sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      String(key).startsWith(PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX) &&
      value?.requestId === olderRequest.requestId &&
      value?.lastResultStatus === "blocked"
    ) {
      injected = true;
      cancelForegroundPendingThroughSettings(
        second.hooks,
        "syncRemoteEnabled"
      );
      newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
        remoteUpdatedAt: "2026-08-27T05:26:20Z",
        now: 1760001000000,
      });
    }
    originalSetValue(key, value);
  };

  first.hooks.settlePendingForegroundRemoteSyncRequest(olderRequest, {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_with_remote_timestamp_drift",
    action: "skip_push_on_foreground_followup",
  });

  assert.equal(injected, true);
  assert.ok(newerRequest);
  const current = first.hooks.getPendingForegroundRemoteSyncRequest();
  assert.equal(current.requestId, newerRequest.requestId);
  assert.equal(current.remoteUpdatedAt, newerRequest.remoteUpdatedAt);
};

const testCompletedForegroundRequestCannotBeResurrectedByLateSettlement = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  const fresh = createHarness({ sharedStore });
  const completedRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  let injected = false;
  const originalSetValue = first.sandbox.GM_setValue;
  first.sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      String(key).startsWith(PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX) &&
      value?.requestId === completedRequest.requestId &&
      value?.lastResultStatus === "blocked"
    ) {
      injected = true;
      second.hooks.clearPendingForegroundRemoteSyncRequest(
        completedRequest,
        "completed"
      );
    }
    originalSetValue(key, value);
  };

  first.hooks.settlePendingForegroundRemoteSyncRequest(completedRequest, {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_with_remote_timestamp_drift",
    action: "skip_push_on_foreground_followup",
  });

  assert.equal(injected, true);
  assert.equal(
    fresh.hooks.getPendingForegroundRemoteSyncRequest(),
    null,
    "正常完成终态也必须拒绝迟到的同请求失败结果。"
  );
};

const testSameRemoteUpdatedAtAfterSoftBlockCreatesANewRequest = () => {
  const { hooks } = createHarness();
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const oldRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt,
    now: 1760001000000,
  });
  hooks.settlePendingForegroundRemoteSyncRequest(oldRequest, {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_with_remote_timestamp_drift",
    action: "skip_push_on_foreground_followup",
  });

  const newerRequest = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "visibility_visible",
    triggerSource: "foreground_resume",
    remoteUpdatedAt,
    now: 1760001000000,
  });

  assert.notEqual(
    newerRequest.requestId,
    oldRequest.requestId,
    "同一 remoteUpdatedAt 下的新观测仍必须创建独立 requestId。"
  );
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newerRequest.requestId
  );
};

const testForegroundRecordRetentionAndClearDoNotResurrectHistory = () => {
  const now = 1760001000000;
  const { hooks, store } = createHarness({
    gmEntries: [
      [
        PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX +
          encodeURIComponent("expired-request"),
        {
          requestId: "expired-request",
          remoteUpdatedAt: "2026-08-27T05:20:00Z",
          createdAt: now - 8 * 24 * 60 * 60 * 1000,
          lastSeenAt: now - 8 * 24 * 60 * 60 * 1000,
        },
      ],
    ],
  });
  const current = hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now,
  });

  assert.equal(
    store.has(
      PENDING_FOREGROUND_REMOTE_SYNC_RECORD_KEY_PREFIX +
        encodeURIComponent("expired-request")
    ),
    false,
    "过期 request record 必须在新注册时按 bounded retention 清理。"
  );
  assert.equal(
    hooks.clearPendingForegroundRemoteSyncRequest(current).status,
    "cleared"
  );
  assert.equal(
    hooks.getPendingForegroundRemoteSyncRequest(),
    null,
    "清理当前代次后不能从旧历史 record 重新生成待处理请求。"
  );
};

const testForegroundAttemptCannotOverwriteRequestRegisteredDuringWrite = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  const remoteUpdatedAt = "2026-08-27T05:25:29Z";
  const oldRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt,
    now: 1760001000000,
  });
  let newerRequest = null;
  let injected = false;
  const originalSetValue = first.sandbox.GM_setValue;
  first.sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      value?.requestId === oldRequest.requestId &&
      value?.lastResultStatus === "running"
    ) {
      injected = true;
      newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
        remoteUpdatedAt,
        now: 1760001000000,
      });
    }
    originalSetValue(key, value);
  };

  first.hooks.markPendingForegroundRemoteSyncAttempt(oldRequest);

  assert.equal(injected, true, "必须命中 attempt 写入前的跨上下文交错窗口。");
  assert.equal(
    first.hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newerRequest.requestId
  );
};

const testForegroundClearCannotDeleteRequestRegisteredDuringWrite = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  const oldRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  let newerRequest = null;
  let injected = false;
  const originalDeleteValue = first.sandbox.GM_deleteValue;
  first.sandbox.GM_deleteValue = (key) => {
    if (
      !injected &&
      (key === PENDING_FOREGROUND_REMOTE_SYNC_KEY ||
        String(key).includes(oldRequest.requestId))
    ) {
      injected = true;
      newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
        remoteUpdatedAt: "2026-08-27T05:26:20Z",
        now: 1760001000000,
      });
    }
    originalDeleteValue(key);
  };

  first.hooks.clearPendingForegroundRemoteSyncRequest(
    oldRequest,
    "old_context_finished"
  );

  assert.equal(injected, true, "必须命中 clear 删除前的跨上下文交错窗口。");
  assert.equal(
    first.hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newerRequest.requestId
  );
};

const testForegroundSoftBlockClearCannotOverwriteRequestRegisteredDuringWrite = () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });
  const oldRequest = first.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-08-27T05:25:29Z",
    now: 1760001000000,
  });
  first.hooks.settlePendingForegroundRemoteSyncRequest(oldRequest, {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_with_remote_timestamp_drift",
    action: "skip_push_on_foreground_followup",
  });
  let newerRequest = null;
  let injected = false;
  const originalSetValue = first.sandbox.GM_setValue;
  first.sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      value?.requestId === oldRequest.requestId &&
      value?.lastResultStatus === ""
    ) {
      injected = true;
      newerRequest = second.hooks.markPendingForegroundRemoteSyncRequest({
        remoteUpdatedAt: "2026-08-27T05:26:20Z",
        now: 1760001000000,
      });
    }
    originalSetValue(key, value);
  };

  first.hooks.clearPendingForegroundRemoteSyncSoftBlock("local_mutation");

  assert.equal(injected, true, "必须命中 soft block 清除写入前的交错窗口。");
  assert.equal(
    first.hooks.getPendingForegroundRemoteSyncRequest().requestId,
    newerRequest.requestId
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
  await testNonRetryableForegroundSoftBlockStopsRecoveryLoop();
  testCrossContextPendingSignalWakesExistingPage();
  testOlderContextCannotClearNewerRemoteIntent();
  testSameTimestampObservationCreatesANewIntentGeneration();
  testConcurrentClearRecoversSameTimestampIntentGeneration();
  testForegroundSettlementCannotOverwriteRequestRegisteredDuringWrite();
  testLateRegistrationCannotRewindCurrentObservation();
  testCancelledForegroundRequestCannotBeResurrectedByLateWrites();
  testCancelledForegroundRequestKeepsConcurrentNewRegistration();
  testCompletedForegroundRequestCannotBeResurrectedByLateSettlement();
  testSameRemoteUpdatedAtAfterSoftBlockCreatesANewRequest();
  testForegroundRecordRetentionAndClearDoNotResurrectHistory();
  testForegroundAttemptCannotOverwriteRequestRegisteredDuringWrite();
  testForegroundClearCannotDeleteRequestRegisteredDuringWrite();
  testForegroundSoftBlockClearCannotOverwriteRequestRegisteredDuringWrite();
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
