#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const DEBOUNCE_STATE_KEY = "s1p_background_sync_debounce_state";
const FOREGROUND_PENDING_KEY = "s1p_pending_foreground_remote_sync_request";
const PENDING_KEY = "s1p_pending_auto_sync_request";
const LAST_MODIFIED_KEY = "s1p_last_modified";
const LAST_DIRTY_PROVENANCE_KEY = "s1p_last_local_dirty_provenance";
const GLOBAL_SYNC_LOCK_KEY = "s1p_sync_global_lock";
const MANUAL_SYNC_LOCK_KEY = "s1p_manual_sync_lock";
const BACKGROUND_SYNC_LOCK_KEY = "s1p_background_sync_lock";
const STARTUP_SYNC_LOCK_KEY = "s1p_startup_sync_lock";
const FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY = "s1p_foreground_followup_sync_lock";
const READ_PROGRESS_DELAY_MS = 20 * 1000;
const GENERAL_DELAY_MS = 5 * 1000;
const OWNER_LEASE_MS = 30 * 1000;
const MAX_WAIT_MS = 60 * 1000;
const FOLLOW_UP_MS = 600;

const readySettings = Object.freeze({
  syncRemoteEnabled: true,
  syncAutoEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncDeviceId: "device-a",
});

const createSpy = () => {
  const calls = [];
  return {
    calls,
    timer: (delayMs, context = {}, callback = null) => {
      calls.push({ delayMs, context: toPlainObject(context), callback });
      return `timer-${calls.length}`;
    },
  };
};

const createScenario = ({ now = 1_000_000 } = {}) => {
  const runtime = createBaseHarness({
    hookErrorMessage:
      "S1Plus.js did not expose the Pending Dirty Scheduler factory.",
  });
  assert.equal(typeof runtime.hooks.createPendingDirtyScheduler, "function");
  const clock = { now };
  const makeScheduler = ({
    tabId,
    settings = readySettings,
    ownerTimers = createSpy(),
    recoveryTimers = createSpy(),
    triggers = [],
    followUps = [],
    fallbacks = [],
  }) => {
    const scheduler = runtime.hooks.createPendingDirtyScheduler({
      clock: () => clock.now,
      tabId: () => tabId,
      settings: () => settings,
      scheduleTimer: ownerTimers.timer,
      scheduleRecoveryTimer: recoveryTimers.timer,
      triggerRemoteSyncPush: (reason, context) => {
        triggers.push({ reason, context: toPlainObject(context) });
      },
      scheduleFollowUp: (delayMs, context) => {
        followUps.push({ delayMs, context: toPlainObject(context) });
        return true;
      },
      scheduleFallback: (delayMs, reason) => {
        fallbacks.push({ delayMs, reason });
      },
    });
    [
      "queue",
      "recover",
      "recoverPending",
      "runDue",
      "flush",
      "complete",
      "handoff",
      "retry",
      "reset",
      "inspect",
    ].forEach((method) => assert.equal(typeof scheduler[method], "function"));
    return {
      scheduler,
      ownerTimers,
      recoveryTimers,
      triggers,
      followUps,
      fallbacks,
    };
  };
  return { ...runtime, clock, makeScheduler };
};

const testQueuedMergesDirtyWithoutExposingOwnerMechanics = () => {
  const { clock, makeScheduler } = createScenario();
  const tabA = makeScheduler({ tabId: "tab-a" });
  const tabB = makeScheduler({ tabId: "tab-b" });

  tabA.scheduler.queue({
    source: "read_progress",
    lastModified: 101,
    threadId: "101",
  });
  clock.now += 1000;
  tabB.scheduler.queue({ source: "general", lastModified: 102 });
  clock.now += 1000;
  tabB.scheduler.queue({
    source: "read_progress",
    lastModified: 103,
    threadId: "103",
  });

  const snapshot = toPlainObject(tabA.scheduler.inspect());
  assert.equal(snapshot.state.generation, 3);
  assert.equal(snapshot.state.ownerTabId, "tab-a");
  assert.equal(snapshot.state.dueAt, 1_000_000 + 1000 + GENERAL_DELAY_MS);
  assert.equal(snapshot.state.maxWaitUntil, 1_000_000 + MAX_WAIT_MS);
  assert.equal(snapshot.state.maxLastModified, 103);
  assert.deepEqual(snapshot.state.sources, { read_progress: 2, general: 1 });
  assert.deepEqual(snapshot.state.threadIds, ["101", "103"]);
  assert.equal(snapshot.pending.maxLastModified, 103);
  assert.equal(tabA.ownerTimers.calls.length, 1);
  assert.equal(tabB.ownerTimers.calls.length, 0);
};

const testQueuedReadProgressStopsAtMaxWait = () => {
  const { clock, makeScheduler } = createScenario({ now: 2_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 201 });
  clock.now += MAX_WAIT_MS - 1000;
  tabA.scheduler.queue({ source: "read_progress", lastModified: 202 });

  const state = tabA.scheduler.inspect().state;
  assert.equal(state.dueAt, 2_000_000 + MAX_WAIT_MS);
  assert.equal(state.maxWaitUntil, 2_000_000 + MAX_WAIT_MS);
};

const testHandoffAndRecoveryUseBoundClockAndTimerAdapter = () => {
  const { clock, makeScheduler } = createScenario({ now: 3_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  const tabB = makeScheduler({ tabId: "tab-b" });
  tabA.scheduler.queue({ source: "general", lastModified: 301 });

  const watching = tabB.scheduler.recover();
  assert.equal(watching.reason, "owner_lease_watch");
  assert.equal(tabB.recoveryTimers.calls.length, 1);

  clock.now += OWNER_LEASE_MS + 1;
  const recovered = tabB.scheduler.recover();
  assert.equal(recovered.reason, "owner_recovered");
  assert.equal(tabB.scheduler.inspect().state.ownerTabId, "tab-b");

  assert.deepEqual(toPlainObject(tabB.scheduler.handoff()), {
    status: "released",
    reason: "owner_handoff",
  });
  assert.equal(tabA.scheduler.inspect().state.ownerTabId, "");
};

const testHandoffStopsNonOwnerRecoveryWatch = () => {
  const { makeScheduler } = createScenario({ now: 3_500_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  const tabB = makeScheduler({ tabId: "tab-b" });
  tabA.scheduler.queue({ source: "general", lastModified: 351 });

  assert.equal(tabB.scheduler.recover().reason, "owner_lease_watch");
  assert.equal(tabB.scheduler.inspect().runtime.hasOwnerRecoveryTimer, true);

  assert.deepEqual(toPlainObject(tabB.scheduler.handoff()), {
    status: "skipped",
    reason: "owner_release_failed",
  });
  assert.equal(tabB.scheduler.inspect().runtime.hasOwnerRecoveryTimer, false);
  assert.equal(tabB.scheduler.inspect().state.ownerTabId, "tab-a");
};

const testDueConsumesStateBeforeTrigger = () => {
  const { clock, makeScheduler } = createScenario({ now: 4_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 401 });
  clock.now += GENERAL_DELAY_MS;
  const result = tabA.scheduler.runDue();

  assert.equal(result.status, "triggered");
  assert.equal(tabA.triggers.length, 1);
  assert.equal(tabA.scheduler.inspect().state, null);
  assert.equal(tabA.triggers[0].context.debounceGeneration, 1);
};

const testDueDefersWhileRunningSyncOwnsLock = () => {
  const { clock, makeScheduler, store } = createScenario({ now: 5_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 501 });
  clock.now += GENERAL_DELAY_MS;
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "running-tab",
    mode: "background",
    timestamp: clock.now,
    ttlMs: 45 * 1000,
  });

  const result = tabA.scheduler.runDue();
  assert.equal(result.reason, "sync_lock_active");
  assert.equal(tabA.triggers.length, 0);
  assert.equal(tabA.scheduler.inspect().state.dueAt, clock.now + 1000);
};

const testLockBlockedReschedulesAggregateWithOwnerEvidence = () => {
  const { clock, makeScheduler, hooks, store } = createScenario({
    now: 5_500_000,
  });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 551 });
  clock.now += GENERAL_DELAY_MS;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    store.set(GLOBAL_SYNC_LOCK_KEY, {
      owner: "running-tab",
      mode: "background",
      timestamp: clock.now,
      ttlMs: 45 * 1000,
      token: "running-token",
      operationId: "running-operation",
      acquiredAt: clock.now - 12_000,
      stage: "remote_fetch",
    });
    tabA.scheduler.runDue();
    clock.now += 1000;
  }

  const reschedules = hooks
    .s1pBuildDiagnosticExport()
    .events.filter((entry) => entry.event === "sync.shared_scheduler_rescheduled");
  assert.equal(reschedules.length, 1, "持续占锁重试应聚合为一条诊断记录");
  assert.ok(reschedules[0].repeatCount >= 2);
  assert.equal(reschedules[0].details.lockOperationId, "running-operation");
  assert.equal(reschedules[0].details.lockStage, "remote_fetch");
  assert.ok(reschedules[0].details.lockRemainingMs > 0);
};

const testCoveredCompletionClearsPendingAndSharedState = () => {
  const { makeScheduler } = createScenario({ now: 6_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({
    source: "read_progress",
    lastModified: 601,
    threadId: "601",
  });

  const result = tabA.scheduler.complete({
    status: "success",
    coveredLastModified: 601,
  });
  assert.equal(result.pendingCleanup.status, "cleared");
  assert.equal(result.sharedDebounceCleanup.status, "cleared");
  assert.equal(tabA.scheduler.inspect().pending, null);
  assert.equal(tabA.scheduler.inspect().state, null);
};

const testHashEqualCompletionSettlesWithoutFollowUp = () => {
  const { makeScheduler } = createScenario({ now: 6_500_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({
    source: "read_progress",
    lastModified: 651,
    threadId: "651",
  });

  const result = tabA.scheduler.complete({
    status: "success",
    action: "no_change",
    reason: "hash_equal",
    coveredLastModified: 651,
    coveredLocalLastUpdated: 651,
  });

  assert.equal(result.pendingCleanup.status, "cleared");
  assert.equal(result.sharedDebounceCleanup.status, "cleared");
  assert.equal(tabA.followUps.length, 0);
  assert.equal(tabA.scheduler.inspect().pending, null);
  assert.equal(tabA.scheduler.inspect().state, null);
};

const testConcurrentPendingCleanupDoesNotCreateFalseFollowUp = () => {
  const { makeScheduler, sandbox, store } = createScenario({ now: 6_700_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 671 });

  const originalGetValue = sandbox.GM_getValue;
  let pendingReads = 0;
  sandbox.GM_getValue = (key, defaultValue) => {
    const value = originalGetValue(key, defaultValue);
    if (key === PENDING_KEY && value && ++pendingReads === 3) {
      store.delete(PENDING_KEY);
      return defaultValue;
    }
    return value;
  };
  let result;
  try {
    result = tabA.scheduler.complete({
      status: "success",
      action: "no_change",
      reason: "hash_equal",
      coveredLastModified: 671,
      coveredLocalLastUpdated: 671,
    });
  } finally {
    sandbox.GM_getValue = originalGetValue;
  }

  assert.equal(result.pendingCleanup.status, "cleared");
  assert.equal(tabA.followUps.length, 0);
  assert.equal(tabA.scheduler.inspect().pending, null);
  assert.equal(tabA.scheduler.inspect().state, null);
};

const testConcurrentSharedCleanupDoesNotCreateFalseFollowUp = () => {
  const { makeScheduler, sandbox, store } = createScenario({ now: 6_800_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 681 });

  const originalGetValue = sandbox.GM_getValue;
  let stateReads = 0;
  sandbox.GM_getValue = (key, defaultValue) => {
    const value = originalGetValue(key, defaultValue);
    if (key === DEBOUNCE_STATE_KEY && value && ++stateReads === 3) {
      store.delete(DEBOUNCE_STATE_KEY);
      return defaultValue;
    }
    return value;
  };
  let result;
  try {
    result = tabA.scheduler.complete({
      status: "success",
      action: "no_change",
      reason: "hash_equal",
      coveredLastModified: 681,
      coveredLocalLastUpdated: 681,
    });
  } finally {
    sandbox.GM_getValue = originalGetValue;
  }

  assert.equal(result.sharedDebounceCleanup.status, "cleared");
  assert.equal(tabA.followUps.length, 0);
  assert.equal(tabA.scheduler.inspect().pending, null);
  assert.equal(tabA.scheduler.inspect().state, null);
};

const testNewerDirtyIsRetainedWithOneFollowUp = () => {
  const { clock, makeScheduler } = createScenario({ now: 7_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 701 });
  clock.now += 1000;
  tabA.scheduler.queue({ source: "read_progress", lastModified: 702 });

  const result = tabA.scheduler.complete({
    status: "success",
    action: "no_change",
    reason: "hash_equal",
    coveredLastModified: 701,
    coveredLocalLastUpdated: 701,
  });
  assert.equal(result.pendingCleanup.status, "retained");
  assert.equal(result.sharedDebounceCleanup.status, "retained");
  assert.equal(tabA.scheduler.inspect().pending.maxLastModified, 702);
  assert.equal(tabA.scheduler.inspect().state.maxLastModified, 702);
  assert.equal(tabA.followUps.length, 1);
  assert.equal(tabA.followUps[0].delayMs, FOLLOW_UP_MS);
};

const testPendingRecoveryWatchesExistingSchedulerOwner = () => {
  const { makeScheduler } = createScenario({ now: 8_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  const tabB = makeScheduler({ tabId: "tab-b" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 801 });

  const coverage = tabB.scheduler.recoverPending();
  assert.equal(coverage.covered, true);
  assert.equal(coverage.reason, "covered_by_shared_debounce");
  assert.equal(tabB.recoveryTimers.calls.length, 1);
};

const testRetrySelectsSharedThenLocalFallbackOnWriteLoss = () => {
  const { makeScheduler, sandbox, store } = createScenario({ now: 9_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });

  const shared = tabA.scheduler.retry({ delayMs: 1200 });
  assert.equal(shared.strategy, "shared");
  assert.equal(tabA.ownerTimers.calls[0].delayMs, 1200);

  tabA.scheduler.reset();
  const originalSetValue = sandbox.GM_setValue;
  sandbox.GM_setValue = (key, value) => {
    originalSetValue(key, value);
    if (key === DEBOUNCE_STATE_KEY) {
      store.delete(key);
    }
  };
  let local;
  try {
    local = tabA.scheduler.retry({ delayMs: 1500 });
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  assert.equal(local.strategy, "local");
  assert.equal(local.sharedResult.reason, "scheduler_state_write_lost");
  assert.deepEqual(tabA.fallbacks, [
    { delayMs: 1500, reason: "background_retry" },
  ]);
};

const testSchedulerRequiresRetryFallbackAdapter = () => {
  const { hooks } = createScenario({ now: 9_500_000 });

  assert.throws(
    () =>
      hooks.createPendingDirtyScheduler({
        clock: () => 9_500_000,
        tabId: () => "tab-a",
        settings: () => readySettings,
      }),
    /scheduleFallback adapter/
  );
};

const testRetryReportsBlockedStrategyWithoutLocalFallback = () => {
  const { makeScheduler } = createScenario({ now: 9_600_000 });
  const disabled = makeScheduler({
    tabId: "tab-a",
    settings: { ...readySettings, syncAutoEnabled: false },
  });

  const result = disabled.scheduler.retry({ delayMs: 1200 });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "sync_not_ready");
  assert.equal(result.strategy, "blocked");
  assert.equal(disabled.fallbacks.length, 0);
};

const testHiddenFlushDoesNotStealLiveOwnerButRecoversExpiredOwner = () => {
  const { clock, makeScheduler } = createScenario({ now: 10_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  const tabB = makeScheduler({ tabId: "tab-b" });
  tabA.scheduler.queue({ source: "read_progress", lastModified: 1001 });

  const blocked = tabB.scheduler.flush();
  assert.equal(blocked.reason, "owned_by_active_other_tab");
  clock.now += OWNER_LEASE_MS + 1;
  const recovered = tabB.scheduler.flush();
  assert.equal(recovered.status, "triggered");
  assert.equal(tabB.triggers.length, 1);
  assert.equal(tabB.scheduler.inspect().state, null);
};

const testQueueRetriesConcurrentStorageWrite = () => {
  const { makeScheduler, sandbox } = createScenario({ now: 11_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  const originalSetValue = sandbox.GM_setValue;
  let intercepted = false;
  sandbox.GM_setValue = (key, value) => {
    originalSetValue(key, value);
    if (key !== DEBOUNCE_STATE_KEY || intercepted) {
      return;
    }
    intercepted = true;
    originalSetValue(key, {
      ...value,
      ownerTabId: "tab-b",
      sources: { general: 1 },
      maxLastModified: 1100,
    });
  };
  let result;
  try {
    result = tabA.scheduler.queue({
      source: "read_progress",
      lastModified: 1101,
      threadId: "1101",
    });
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  assert.equal(result.retryCount, 1);
  assert.equal(tabA.scheduler.inspect().state.maxLastModified, 1101);
  assert.deepEqual(toPlainObject(tabA.scheduler.inspect().state.sources), {
    general: 1,
    read_progress: 1,
  });
};

const testCleanupRecoversDirtyWrittenDuringDeleteRace = () => {
  const { makeScheduler, sandbox, store, clock } = createScenario({
    now: 12_000_000,
  });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 1201 });
  const originalDeleteValue = sandbox.GM_deleteValue;
  let injected = false;
  sandbox.GM_deleteValue = (key) => {
    if (key === PENDING_KEY && !injected) {
      injected = true;
      clock.now += 1;
      store.set(LAST_MODIFIED_KEY, 1202);
      store.set(LAST_DIRTY_PROVENANCE_KEY, {
        source: "read_progress",
        lastModified: 1202,
        createdAt: clock.now,
        triggerSync: true,
        tabId: "tab-a",
        threadId: "1202",
      });
      store.set(PENDING_KEY, {
        version: 1,
        source: "read_progress",
        lastModified: 1202,
        maxLastModified: 1202,
        createdAt: clock.now,
        firstDirtyAt: clock.now,
        lastDirtyAt: clock.now,
        sources: { read_progress: 1 },
        threadIds: ["1202"],
      });
    }
    originalDeleteValue(key);
  };
  let result;
  try {
    result = tabA.scheduler.complete({
      status: "success",
      coveredLastModified: 1201,
    });
  } finally {
    sandbox.GM_deleteValue = originalDeleteValue;
  }

  assert.equal(result.concurrentDirtyRecovery.status, "recovered");
  assert.equal(tabA.scheduler.inspect().pending.maxLastModified, 1202);
  assert.equal(tabA.scheduler.inspect().pending.source, "read_progress");
  assert.deepEqual(toPlainObject(tabA.scheduler.inspect().pending.sources), {
    read_progress: 1,
  });
  assert.deepEqual(toPlainObject(tabA.scheduler.inspect().pending.threadIds), [
    "1202",
  ]);
  assert.equal(tabA.followUps.length, 1);
};

const testCleanupRecoversSharedDirtyWrittenDuringDeleteRace = () => {
  const { makeScheduler, sandbox, store, clock } = createScenario({
    now: 12_500_000,
  });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 1251 });
  const originalDeleteValue = sandbox.GM_deleteValue;
  let injected = false;
  sandbox.GM_deleteValue = (key) => {
    if (key === DEBOUNCE_STATE_KEY && !injected) {
      injected = true;
      clock.now += 1;
      store.set(LAST_MODIFIED_KEY, 1252);
      store.set(DEBOUNCE_STATE_KEY, {
        version: 1,
        generation: 2,
        ownerTabId: "tab-b",
        ownerLeaseUntil: clock.now + OWNER_LEASE_MS,
        dueAt: clock.now + GENERAL_DELAY_MS,
        maxWaitUntil: clock.now + MAX_WAIT_MS,
        firstDirtyAt: clock.now,
        lastDirtyAt: clock.now,
        maxLastModified: 1252,
        sources: { general: 1 },
        threadIds: [],
        reason: "debounced_local_change",
        dueSource: "general",
      });
    }
    originalDeleteValue(key);
  };
  let result;
  try {
    result = tabA.scheduler.complete({
      status: "success",
      coveredLastModified: 1251,
    });
  } finally {
    sandbox.GM_deleteValue = originalDeleteValue;
  }

  assert.equal(result.concurrentDirtyRecovery.status, "recovered");
  assert.equal(tabA.scheduler.inspect().pending.maxLastModified, 1252);
  assert.equal(tabA.followUps.length, 1);
};

const testBlockedQueueClearsSchedulerState = () => {
  const { makeScheduler } = createScenario({ now: 13_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 1301 });
  const disabled = makeScheduler({
    tabId: "tab-a",
    settings: { ...readySettings, syncAutoEnabled: false },
  });
  const result = disabled.scheduler.queue({
    source: "general",
    lastModified: 1302,
  });

  assert.equal(result.reason, "sync_not_ready");
  assert.equal(disabled.scheduler.inspect().state, null);
};

const testLifecycleAdapterUsesSchedulerAfterFinalizingDirty = async () => {
  const { makeScheduler, hooks, sandbox } = createScenario({ now: 14_000_000 });
  const tabA = makeScheduler({ tabId: "tab-a" });
  sandbox.document.visibilityState = "hidden";
  const unregisterFinalizer = hooks.registerSyncLifecycleLocalMutationFinalizer("phase2_finalize", () => {
    tabA.scheduler.queue({ source: "read_progress", lastModified: 1401 });
  });

  let hidden;
  try {
    hidden = await hooks.s1pSyncSystem.handleLifecycle(
      "visibilitychange",
      null,
      {
        now: 14_000_000,
        tabId: "tab-a",
        settingsSnapshot: readySettings,
        triggerRemoteSyncPush: (reason, context) => {
          tabA.triggers.push({ reason, context: toPlainObject(context) });
        },
      }
    );
  } finally {
    unregisterFinalizer();
  }
  assert.equal(hidden.checkpointResult.schedulerResult.status, "triggered");
  assert.equal(tabA.triggers.length, 1);
  assert.equal(tabA.scheduler.inspect().state, null);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tabA.triggers.length, 1);
};

const testPagehideFinalizesAndHandsOffWithoutTriggeringSync = async () => {
  const now = Date.now();
  const { makeScheduler, hooks, sandbox, store } = createScenario({
    now,
  });
  const valueChangeListeners = [];
  const pendingValueChangeNotifications = [];
  const originalSetValue = sandbox.GM_setValue;
  sandbox.GM_addValueChangeListener = (key, callback) => {
    valueChangeListeners.push({ key, callback });
    return valueChangeListeners.length;
  };
  sandbox.GM_setValue = (key, value) => {
    const oldValue = store.get(key);
    originalSetValue(key, value);
    valueChangeListeners
      .filter((listener) => listener.key === key)
      .forEach((listener) => {
        pendingValueChangeNotifications.push(() =>
          listener.callback(key, oldValue, value, false)
        );
      });
  };
  const flushValueChangeNotifications = () => {
    while (pendingValueChangeNotifications.length > 0) {
      pendingValueChangeNotifications.shift()();
    }
  };
  const lifecycleAdapter = hooks.s1pCreateSyncLifecycleAdapter({
    scheduleMicrotask: (callback) => callback(),
  });
  const syncSystem = hooks.s1pCreateSyncSystemFacade({ lifecycleAdapter });
  syncSystem.initialize();
  assert.equal(valueChangeListeners.length, 8);
  assert.deepEqual(
    valueChangeListeners.map((listener) => listener.key).sort(),
    [
      DEBOUNCE_STATE_KEY,
      FOREGROUND_PENDING_KEY,
      GLOBAL_SYNC_LOCK_KEY,
      MANUAL_SYNC_LOCK_KEY,
      BACKGROUND_SYNC_LOCK_KEY,
      STARTUP_SYNC_LOCK_KEY,
      FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY,
      "s1p_settings",
    ].sort()
  );
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 1501 });
  flushValueChangeNotifications();
  const unregisterFinalizer = hooks.registerSyncLifecycleLocalMutationFinalizer(
    "phase3_pagehide_finalize",
    () => {
      tabA.scheduler.queue({
        source: "read_progress",
        lastModified: 1502,
        threadId: "1502",
      });
    }
  );

  let result;
  try {
    result = await syncSystem.handleLifecycle(
      "pagehide",
      { persisted: false },
      {
        now,
        tabId: "tab-a",
        settingsSnapshot: readySettings,
        triggerRemoteSyncPush: (reason, context) => {
          tabA.triggers.push({ reason, context: toPlainObject(context) });
        },
      }
    );
  } finally {
    unregisterFinalizer();
  }
  const handedOffState = store.get(DEBOUNCE_STATE_KEY);
  assert.equal(handedOffState.ownerTabId, "");
  pendingValueChangeNotifications.length = 0;
  await Promise.resolve();
  valueChangeListeners
    .find((listener) => listener.key === DEBOUNCE_STATE_KEY)
    .callback(
    DEBOUNCE_STATE_KEY,
    null,
    handedOffState,
    false
  );

  assert.equal(result.checkpointResult.schedulerResult.reason, "lifecycle_unload_handoff");
  assert.equal(result.checkpointResult.handoffResult.status, "released");
  assert.equal(tabA.triggers.length, 0);
  assert.equal(tabA.scheduler.inspect().state?.ownerTabId || "", "");
  assert.equal(tabA.scheduler.inspect().pending.maxLastModified, 1502);
  assert.equal(syncSystem.dispose().status, "disposed");
};

const testPagehideCancelsUnverifiedRunningSyncLock = async () => {
  const { hooks, store } = createScenario({ now: Date.now() });
  const lifecycleAdapter = hooks.s1pCreateSyncLifecycleAdapter({
    runCheckpoint: () => ({ status: "completed" }),
    scheduleMicrotask: () => {},
    schedulePostUnloadRecovery: () => {},
  });

  const acquirePromise = hooks.acquireModeSyncLock("background", {
    operationId: "s1p_sync_test_pagehide_acquire",
    returnAuthority: true,
  });
  await Promise.resolve();
  assert.ok(
    store.get(BACKGROUND_SYNC_LOCK_KEY),
    "测试必须在锁归属校验窗口内观察到已写入的后台锁。"
  );

  await lifecycleAdapter.handle("pagehide", { persisted: false });
  const authority = await acquirePromise;

  assert.equal(
    authority,
    null,
    "页面卸载时尚未完成归属校验的后台锁不能继续进入 Running Sync。"
  );
  assert.equal(store.has(BACKGROUND_SYNC_LOCK_KEY), false);
  assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), false);
  const diagnosticExport = hooks.s1pBuildDiagnosticExport();
  const lockEvents = diagnosticExport.events.filter(
    (entry) => entry.operationId === "s1p_sync_test_pagehide_acquire"
  );
  assert.ok(
    lockEvents.some((entry) => entry.event === "lock.acquisition_started"),
    "临时锁获取必须留下可追踪的开始证据。"
  );
  assert.ok(
    lockEvents.some((entry) => entry.event === "lock.acquisition_canceled"),
    "页面离开时必须留下临时锁取消证据。"
  );
  assert.ok(
    lockEvents.some((entry) => entry.event === "lock.released"),
    "临时锁取消后必须留下实际释放证据。"
  );
  const operationSummary = diagnosticExport.operations.find(
    (operation) => operation.operationId === "s1p_sync_test_pagehide_acquire"
  );
  assert.equal(operationSummary.terminalEvent, "lock.released");
  assert.equal(
    operationSummary.terminalReason,
    "lifecycle_unload_before_transaction"
  );
  assert.equal(operationSummary.terminalEvidence, "explicit_owner_release");
};

const testPagehideCancelsVerifiedLockBeforeTransactionStarts = async () => {
  const { hooks, store } = createScenario({ now: Date.now() });
  const authority = await hooks.acquireModeSyncLock("background", {
    operationId: "s1p_sync_test_pagehide_before_transaction",
    returnAuthority: true,
  });
  assert.ok(authority);
  assert.ok(store.get(BACKGROUND_SYNC_LOCK_KEY));
  const lifecycleAdapter = hooks.s1pCreateSyncLifecycleAdapter({
    runCheckpoint: () => ({ status: "completed" }),
    scheduleMicrotask: () => {},
    schedulePostUnloadRecovery: () => {},
  });
  await lifecycleAdapter.handle("pagehide", { persisted: false });
  assert.equal(store.has(BACKGROUND_SYNC_LOCK_KEY), false);
  assert.equal(store.has(GLOBAL_SYNC_LOCK_KEY), false);
  const diagnosticExport = hooks.s1pBuildDiagnosticExport();
  const lockEvents = diagnosticExport.events.filter(
    (entry) => entry.operationId === "s1p_sync_test_pagehide_before_transaction"
  );
  assert.ok(
    lockEvents.some(
      (entry) =>
        entry.event === "lock.acquisition_canceled" &&
        entry.reason === "lifecycle_unload_before_transaction"
    )
  );
};

const testHandoffFenceOnlySuppressesMatchingGeneration = () => {
  const { hooks } = createScenario({ now: 15_500_000 });
  const fence = hooks.s1pCreateSchedulerOwnerHandoffFence();
  fence.begin(5);

  assert.equal(
    fence.shouldIgnore({ generation: 5, ownerTabId: "" }),
    true
  );
  assert.equal(
    fence.shouldIgnore({ generation: 6, ownerTabId: "" }),
    false
  );
  assert.equal(
    fence.shouldIgnore({ generation: 5, ownerTabId: "" }),
    false
  );

  fence.begin(7);
  assert.equal(
    fence.shouldIgnore(
      { generation: 8, ownerTabId: "tab-b" },
      { pageUnloading: true }
    ),
    true
  );
  assert.equal(
    fence.shouldIgnore({ generation: 7, ownerTabId: "" }),
    true
  );
  fence.cancel();
  assert.equal(
    fence.shouldIgnore({ generation: 7, ownerTabId: "" }),
    false
  );
};

const testCanceledBeforeUnloadRecoversSoleSchedulerOwner = async () => {
  const now = Date.now();
  const { makeScheduler, hooks } = createScenario({ now });
  const tabA = makeScheduler({ tabId: "tab-a" });
  tabA.scheduler.queue({ source: "general", lastModified: 1601 });
  let recoveryTask = null;
  const lifecycleAdapter = hooks.s1pCreateSyncLifecycleAdapter({
    schedulePostUnloadRecovery: (callback) => {
      recoveryTask = callback;
    },
    recoverAfterCanceledUnload: () => tabA.scheduler.recover(),
  });
  const syncSystem = hooks.s1pCreateSyncSystemFacade({ lifecycleAdapter });
  syncSystem.initialize();

  const result = await syncSystem.handleLifecycle(
    "beforeunload",
    { defaultPrevented: true },
    {
      now,
      tabId: "tab-a",
      settingsSnapshot: readySettings,
    }
  );

  assert.equal(result.checkpointResult.handoffResult.status, "released");
  assert.equal(tabA.scheduler.inspect().state.ownerTabId, "");
  assert.equal(typeof recoveryTask, "function");
  recoveryTask();
  assert.equal(tabA.scheduler.inspect().state.ownerTabId, "tab-a");
  assert.equal(tabA.triggers.length, 0);
  assert.equal(syncSystem.dispose().status, "disposed");
};

const main = async () => {
  testQueuedMergesDirtyWithoutExposingOwnerMechanics();
  testQueuedReadProgressStopsAtMaxWait();
  testHandoffAndRecoveryUseBoundClockAndTimerAdapter();
  testHandoffStopsNonOwnerRecoveryWatch();
  testDueConsumesStateBeforeTrigger();
  testDueDefersWhileRunningSyncOwnsLock();
  testLockBlockedReschedulesAggregateWithOwnerEvidence();
  testCoveredCompletionClearsPendingAndSharedState();
  testHashEqualCompletionSettlesWithoutFollowUp();
  testConcurrentPendingCleanupDoesNotCreateFalseFollowUp();
  testConcurrentSharedCleanupDoesNotCreateFalseFollowUp();
  testNewerDirtyIsRetainedWithOneFollowUp();
  testPendingRecoveryWatchesExistingSchedulerOwner();
  testRetrySelectsSharedThenLocalFallbackOnWriteLoss();
  testSchedulerRequiresRetryFallbackAdapter();
  testRetryReportsBlockedStrategyWithoutLocalFallback();
  testHiddenFlushDoesNotStealLiveOwnerButRecoversExpiredOwner();
  testQueueRetriesConcurrentStorageWrite();
  testCleanupRecoversDirtyWrittenDuringDeleteRace();
  testCleanupRecoversSharedDirtyWrittenDuringDeleteRace();
  testBlockedQueueClearsSchedulerState();
  await testLifecycleAdapterUsesSchedulerAfterFinalizingDirty();
  await testPagehideFinalizesAndHandsOffWithoutTriggeringSync();
  await testPagehideCancelsUnverifiedRunningSyncLock();
  await testPagehideCancelsVerifiedLockBeforeTransactionStarts();
  testHandoffFenceOnlySuppressesMatchingGeneration();
  await testCanceledBeforeUnloadRecoversSoleSchedulerOwner();
  console.log(
    "[background-sync-shared-debounce] Pending Dirty Scheduler scenarios passed."
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
