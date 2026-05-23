#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY =
  "s1p_background_sync_debounce_state";
const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
const READ_PROGRESS_SYNC_DEBOUNCE_MS = 20 * 1000;
const DEFAULT_SYNC_DEBOUNCE_MS = 5 * 1000;
const AUTO_SYNC_CLEAN_STATE_COOLDOWN_MS = 5 * 60 * 1000;

const REQUIRED_SHARED_DEBOUNCE_HOOKS = [
  "normalizeBackgroundSyncDebounceState",
  "getBackgroundSyncDebounceState",
  "setBackgroundSyncDebounceState",
  "clearBackgroundSyncDebounceState",
  "requestSharedBackgroundSyncDebounce",
  "queueBackgroundSyncRetryViaSharedScheduler",
  "scheduleBackgroundSyncRetry",
  "tryAcquireBackgroundSyncDebounceOwner",
  "refreshBackgroundSyncDebounceOwnerLease",
  "releaseBackgroundSyncDebounceOwner",
  "scheduleSharedBackgroundSyncDebounceTimer",
  "clearSharedBackgroundSyncDebounceTimer",
  "scheduleSharedBackgroundSyncDebounceOwnerRecoveryTimer",
  "recoverSharedBackgroundSyncDebounceOwnerIfNeeded",
  "flushSharedBackgroundSyncDebounceForHiddenPage",
  "queueSharedBackgroundSyncDebounceHiddenFlush",
  "handleSharedBackgroundSyncDebounceDue",
  "isBackgroundSyncDebounceStateCoveringPendingRequest",
  "getPendingAutoSyncSharedDebounceCoverage",
  "clearPendingAutoSyncRequestIfCovered",
  "clearSharedBackgroundSyncDebounceIfCovered",
  "getBackgroundSyncDebounceRuntimeStateForTest",
  "getBackgroundAutoSyncRuntimeStateForTest",
  "getBackgroundSyncDebounceTestConstants",
];

const readySyncSettings = Object.freeze({
  syncRemoteEnabled: true,
  syncAutoEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncDeviceId: "device-a",
});

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage:
      "S1Plus.js did not expose background shared debounce test hooks.",
  });

const getSharedDebounceApi = () => {
  const runtime = createHarness();
  const missingHooks = REQUIRED_SHARED_DEBOUNCE_HOOKS.filter(
    (hookName) => typeof runtime.hooks[hookName] !== "function"
  );

  assert.deepEqual(
    missingHooks,
    [],
    [
      "Shared debounce scheduler hooks are not implemented/exposed yet.",
      "This is the expected red state for Phase A before Phase B+ implementation.",
      `Missing hooks: ${missingHooks.join(", ")}`,
    ].join("\n")
  );

  const constants = runtime.hooks.getBackgroundSyncDebounceTestConstants();
  assert.equal(
    constants.BACKGROUND_SYNC_DEBOUNCE_STATE_KEY,
    BACKGROUND_SYNC_DEBOUNCE_STATE_KEY
  );
  assert.equal(
    constants.READ_PROGRESS_SYNC_DEBOUNCE_MS,
    READ_PROGRESS_SYNC_DEBOUNCE_MS
  );
  assert.equal(
    constants.DEFAULT_SYNC_DEBOUNCE_MS,
    DEFAULT_SYNC_DEBOUNCE_MS
  );
  assert.ok(
    constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS >=
      READ_PROGRESS_SYNC_DEBOUNCE_MS,
    "max wait must be at least one read-progress settle window."
  );
  assert.ok(
    constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS > 0,
    "owner lease must be positive."
  );
  assert.ok(
    constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_RECOVERY_GRACE_MS > 0 &&
      constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_RECOVERY_GRACE_MS <= 1000,
    "owner recovery grace should be a short handoff buffer."
  );
  assert.ok(
    constants.BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS >= 300 &&
      constants.BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS <= 1500,
    "follow-up settle should stay in the short 300ms-1500ms window."
  );
  assert.equal(
    constants.AUTO_SYNC_CLEAN_STATE_COOLDOWN_MS,
    AUTO_SYNC_CLEAN_STATE_COOLDOWN_MS,
    "clean-state fence cooldown should stay at the internal 5-minute window."
  );

  return {
    ...runtime,
    constants,
    getState: () =>
      toPlainObject(runtime.hooks.getBackgroundSyncDebounceState()),
    setState: (state) =>
      runtime.hooks.setBackgroundSyncDebounceState(state),
    clearState: () => runtime.hooks.clearBackgroundSyncDebounceState(),
    request: (request, options = {}) =>
      runtime.hooks.requestSharedBackgroundSyncDebounce(request, {
        settingsSnapshot: readySyncSettings,
        ...options,
      }),
  };
};

const createTimerSpy = () => {
  const calls = [];
  const scheduleTimer = (delayMs, context = {}) => {
    calls.push({ delayMs, context: toPlainObject(context) });
    return `timer-${calls.length}`;
  };
  return { calls, scheduleTimer };
};

const createRecoveryTimerSpy = () => {
  const calls = [];
  const scheduleRecoveryTimer = (delayMs, context = {}, callback = null) => {
    calls.push({ delayMs, context: toPlainObject(context), callback });
    return `recovery-timer-${calls.length}`;
  };
  return { calls, scheduleRecoveryTimer };
};

const seedSharedState = ({
  generation = 1,
  ownerTabId = "tab-a",
  ownerLeaseUntil,
  dueAt,
  maxWaitUntil,
  firstDirtyAt,
  lastDirtyAt,
  maxLastModified = 100,
  sources = { general: 1 },
  threadIds = [],
  reason = "debounced_local_change",
  dueSource = reason === "debounced_local_change" ? "general" : "read_progress",
} = {}) => ({
  version: 1,
  generation,
  ownerTabId,
  ownerLeaseUntil,
  dueAt,
  maxWaitUntil,
  firstDirtyAt,
  lastDirtyAt,
  maxLastModified,
  sources,
  threadIds,
  reason,
  dueSource,
});

const testReadProgressDirtyMergesIntoSingleSharedState = () => {
  const { constants, request, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 1_000_000;

  request(
    { source: "read_progress", lastModified: 101, threadId: "123" },
    { now, tabId: "tab-a", scheduleTimer: timers.scheduleTimer }
  );
  request(
    { source: "read_progress", lastModified: 102, threadId: "456" },
    {
      now: now + 5_000,
      tabId: "tab-a",
      scheduleTimer: timers.scheduleTimer,
    }
  );

  assert.deepEqual(getState(), {
    version: 1,
    generation: 2,
    ownerTabId: "tab-a",
    ownerLeaseUntil:
      now + 5_000 + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
    dueAt: now + 5_000 + READ_PROGRESS_SYNC_DEBOUNCE_MS,
    maxWaitUntil:
      now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
    firstDirtyAt: now,
    lastDirtyAt: now + 5_000,
    maxLastModified: 102,
    sources: { read_progress: 2 },
    threadIds: ["123", "456"],
    reason: "debounced_read_progress",
    dueSource: "read_progress",
  });
  assert.equal(
    timers.calls.length,
    2,
    "the owner tab should schedule the initial timer and reschedule trailing read-progress debounce."
  );
};

const testSourceSpecificSettleWindows = () => {
  const readProgressHarness = getSharedDebounceApi();
  const now = 2_000_000;
  readProgressHarness.request(
    { source: "read_progress", lastModified: 201, threadId: "123" },
    { now, tabId: "tab-a", scheduleTimer: createTimerSpy().scheduleTimer }
  );
  assert.equal(
    readProgressHarness.getState().dueAt,
    now + READ_PROGRESS_SYNC_DEBOUNCE_MS
  );
  assert.equal(
    readProgressHarness.getState().reason,
    "debounced_read_progress"
  );

  const generalHarness = getSharedDebounceApi();
  generalHarness.request(
    { source: "general", lastModified: 202 },
    { now, tabId: "tab-a", scheduleTimer: createTimerSpy().scheduleTimer }
  );
  assert.equal(generalHarness.getState().dueAt, now + DEFAULT_SYNC_DEBOUNCE_MS);
  assert.equal(generalHarness.getState().reason, "debounced_local_change");
};

const testForcedRetryUsesSharedSchedulerDueAt = () => {
  const { hooks, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 2_500_000;
  const result = hooks.queueBackgroundSyncRetryViaSharedScheduler(
    1200,
    "background_retry",
    {
      now,
      tabId: "tab-a",
      settingsSnapshot: readySyncSettings,
      scheduleTimer: timers.scheduleTimer,
    }
  );

  assert.equal(result.status, "scheduled");
  assert.equal(result.reason, "background_retry");
  assert.equal(result.isOwner, true);
  assert.equal(getState().dueAt, now + 1200);
  assert.equal(getState().reason, "background_retry");
  assert.equal(
    timers.calls[0].delayMs,
    1200,
    "background retry 应由 shared debounce owner 排 timer，而不是每个 tab 自己排 retry timer。"
  );
};

const testSharedRetryDoesNotKeepLocalDrainPending = () => {
  const { hooks, getState, sandbox, clearState } = getSharedDebounceApi();
  sandbox.GM_setValue("s1p_settings", readySyncSettings);
  sandbox.GM_setValue("s1p_last_modified", 2_600_001);

  hooks.scheduleBackgroundSyncRetry(1200);

  const runtimeState = hooks.getBackgroundAutoSyncRuntimeStateForTest();
  assert.equal(getState().reason, "background_retry");
  assert.equal(
    runtimeState.hasPendingBackgroundSync,
    false,
    "shared retry scheduling must not keep the current background drain loop pending."
  );
  assert.equal(
    runtimeState.hasLocalRetryTimer,
    false,
    "shared retry scheduling should not also arm a per-tab retry timer."
  );

  hooks.clearSharedBackgroundSyncDebounceTimer();
  clearState();
};

const testCleanStateFenceSkipsCoveredAutoPush = () => {
  const { hooks, store } = getSharedDebounceApi();
  const now = 7_000_000;
  store.set("s1p_last_sync_timestamp", now - 1000);
  store.set("s1p_last_modified", now - 2000);

  const cleanDecision = hooks.shouldSkipAutoSyncDueToCleanState({
    direction: "push",
    triggerSource: "background_push",
    reason: "background_retry",
    now,
  });
  assert.equal(cleanDecision.skip, true);
  assert.equal(cleanDecision.result.reason, "clean_state_fence");
  assert.equal(cleanDecision.result.direction, "push");

  store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "general",
    lastModified: now - 1500,
    maxLastModified: now - 1500,
    createdAt: now - 1500,
    firstDirtyAt: now - 1500,
    lastDirtyAt: now - 1500,
    sources: { general: 1 },
    threadIds: [],
  });
  const pendingDecision = hooks.shouldSkipAutoSyncDueToCleanState({
    direction: "push",
    triggerSource: "background_push",
    reason: "pending_recovery",
    now,
  });
  assert.equal(
    pendingDecision.skip,
    false,
    "pending auto-sync request exists 时不应被 clean-state fence 吞掉。"
  );

  store.delete(PENDING_AUTO_SYNC_KEY);
  store.set("s1p_last_modified", now + 1);
  const dirtyDecision = hooks.shouldSkipAutoSyncDueToCleanState({
    direction: "push",
    triggerSource: "background_push",
    reason: "local_change",
    now,
  });
  assert.equal(
    dirtyDecision.skip,
    false,
    "本地 last_modified 晚于上次成功同步时，自动 push 必须放行。"
  );
};

const testSharedDebounceDueClearsCoveredCleanState = () => {
  const { hooks, store, getState } = getSharedDebounceApi();
  const now = 8_000_000;
  store.set("s1p_last_sync_timestamp", now - 1000);
  store.set("s1p_last_modified", now - 2000);
  hooks.setBackgroundSyncDebounceState(
    seedSharedState({
      generation: 22,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + 10_000,
      dueAt: now - 1,
      maxWaitUntil: now + 30_000,
      firstDirtyAt: now - 5000,
      lastDirtyAt: now - 4000,
      maxLastModified: now - 2000,
    })
  );

  let triggerCount = 0;
  const result = hooks.handleSharedBackgroundSyncDebounceDue({
    now,
    tabId: "tab-a",
    expectedGeneration: 22,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
    },
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "clean_state_fence");
  assert.equal(triggerCount, 0, "covered debounce state 不应继续触发实际 push。");
  assert.equal(getState(), null, "covered debounce state 命中 fence 后应被清理。");
};

const testGeneralDueAtIsNotDelayedByReadProgress = () => {
  const { request, getState } = getSharedDebounceApi();
  const now = 3_000_000;

  request(
    { source: "general", lastModified: 301 },
    { now, tabId: "tab-a", scheduleTimer: createTimerSpy().scheduleTimer }
  );
  request(
    { source: "read_progress", lastModified: 302, threadId: "987" },
    {
      now: now + 1_000,
      tabId: "tab-b",
      scheduleTimer: createTimerSpy().scheduleTimer,
    }
  );

  const state = getState();
  assert.equal(state.dueAt, now + DEFAULT_SYNC_DEBOUNCE_MS);
  assert.equal(state.reason, "debounced_local_change");
  assert.deepEqual(state.sources, { general: 1, read_progress: 1 });
  assert.deepEqual(state.threadIds, ["987"]);
};

const testReadProgressTrailingDebounceStopsAtMaxWait = () => {
  const { constants, request, getState } = getSharedDebounceApi();
  const now = 4_000_000;
  const almostMaxWait = now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS - 2_000;

  request(
    { source: "read_progress", lastModified: 401, threadId: "1" },
    { now, tabId: "tab-a", scheduleTimer: createTimerSpy().scheduleTimer }
  );
  request(
    { source: "read_progress", lastModified: 402, threadId: "2" },
    {
      now: almostMaxWait,
      tabId: "tab-a",
      scheduleTimer: createTimerSpy().scheduleTimer,
    }
  );
  request(
    { source: "read_progress", lastModified: 403, threadId: "3" },
    {
      now: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS + 1_000,
      tabId: "tab-a",
      scheduleTimer: createTimerSpy().scheduleTimer,
    }
  );

  const state = getState();
  assert.equal(state.maxWaitUntil, now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS);
  assert.equal(state.dueAt, state.maxWaitUntil);
  assert.equal(state.generation, 3);
  assert.equal(state.maxLastModified, 403);
};

const testOnlyOwnerSchedulesTimerAndValidLeasePreventsSteal = () => {
  const { constants, request, getState } = getSharedDebounceApi();
  const ownerTimers = createTimerSpy();
  const nonOwnerTimers = createTimerSpy();
  const now = 5_000_000;

  request(
    { source: "read_progress", lastModified: 501, threadId: "1" },
    { now, tabId: "tab-a", scheduleTimer: ownerTimers.scheduleTimer }
  );
  request(
    { source: "read_progress", lastModified: 502, threadId: "2" },
    {
      now: now + 1_000,
      tabId: "tab-b",
      scheduleTimer: nonOwnerTimers.scheduleTimer,
    }
  );

  const state = getState();
  assert.equal(state.ownerTabId, "tab-a");
  assert.ok(
    state.ownerLeaseUntil >= now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS
  );
  assert.ok(ownerTimers.calls.length >= 1);
  assert.equal(
    nonOwnerTimers.calls.length,
    0,
    "a non-owner tab may update shared state, but must not start a local timer while the owner lease is valid."
  );
};

const testExpiredOwnerLeaseAllowsTakeover = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 6_000_000;
  setState(
    seedSharedState({
      generation: 7,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now - 1,
      dueAt: now + 1_000,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 10_000,
      lastDirtyAt: now - 10_000,
    })
  );

  const acquired = hooks.tryAcquireBackgroundSyncDebounceOwner(getState(), now, {
    tabId: "tab-b",
    settingsSnapshot: readySyncSettings,
    scheduleTimer: timers.scheduleTimer,
  });

  assert.equal(acquired, true);
  assert.equal(getState().ownerTabId, "tab-b");
  assert.equal(timers.calls.length, 1);
};

const testVisibleTabWatchesActiveOwnerLeaseForRecovery = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const recoveryTimers = createRecoveryTimerSpy();
  const now = 6_500_000;

  setState(
    seedSharedState({
      generation: 8,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 2_000,
      lastDirtyAt: now - 500,
      maxLastModified: 6501,
      sources: { read_progress: 1 },
      threadIds: ["6501"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );

  const result = hooks.recoverSharedBackgroundSyncDebounceOwnerIfNeeded(now, {
    tabId: "tab-b",
    settingsSnapshot: readySyncSettings,
    scheduleRecoveryTimer: recoveryTimers.scheduleRecoveryTimer,
  });

  assert.deepEqual(toPlainObject(result), {
    status: "scheduled",
    reason: "owner_lease_watch",
    currentOwnerTabId: "tab-a",
  });
  assert.equal(
    recoveryTimers.calls.length,
    1,
    "visible non-owner tabs should arm a lease-expiry recovery watch."
  );
  assert.equal(
    recoveryTimers.calls[0].delayMs,
    constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS +
      constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_RECOVERY_GRACE_MS
  );
  assert.equal(
    getState().ownerTabId,
    "tab-a",
    "watching the lease must not steal a still-valid owner immediately."
  );
};

const testOwnerLeaseRecoveryCallbackTakesOverAndRunsPastDueTimer = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const ownerTimers = createTimerSpy();
  const recoveryTimers = createRecoveryTimerSpy();
  const now = 6_800_000;

  setState(
    seedSharedState({
      generation: 9,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 2_000,
      lastDirtyAt: now - 500,
      maxLastModified: 6801,
      sources: { read_progress: 1 },
      threadIds: ["6801"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );

  hooks.recoverSharedBackgroundSyncDebounceOwnerIfNeeded(now, {
    tabId: "tab-b",
    settingsSnapshot: readySyncSettings,
    scheduleTimer: ownerTimers.scheduleTimer,
    scheduleRecoveryTimer: recoveryTimers.scheduleRecoveryTimer,
  });

  assert.equal(typeof recoveryTimers.calls[0].callback, "function");
  recoveryTimers.calls[0].callback();

  assert.equal(getState().ownerTabId, "tab-b");
  assert.equal(
    ownerTimers.calls.length,
    1,
    "the recovered owner should schedule the shared debounce timer."
  );
  assert.equal(
    ownerTimers.calls[0].delayMs,
    0,
    "a past-due shared debounce should run immediately after owner recovery."
  );
};

const testOwnerDueReReadsStateAndSkipsStaleGeneration = () => {
  const { constants, hooks, setState } = getSharedDebounceApi();
  const now = 7_000_000;
  let triggerCount = 0;

  setState(
    seedSharedState({
      generation: 2,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 10_000,
      lastDirtyAt: now - 1_000,
      maxLastModified: 702,
      sources: { read_progress: 2 },
      reason: "debounced_read_progress",
    })
  );

  const result = hooks.handleSharedBackgroundSyncDebounceDue({
    now,
    tabId: "tab-a",
    expectedGeneration: 1,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
    },
  });

  assert.equal(triggerCount, 0);
  assert.deepEqual(toPlainObject(result), {
    status: "skipped",
    reason: "stale_generation",
    currentGeneration: 2,
    expectedGeneration: 1,
  });
};

const testOwnerDueConsumesSharedStateBeforeTrigger = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const now = 7_500_000;
  let triggerCount = 0;
  let stateVisibleToTrigger = undefined;

  setState(
    seedSharedState({
      generation: 2,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 10_000,
      lastDirtyAt: now - 1_000,
      maxLastModified: 752,
      sources: { read_progress: 2 },
      reason: "debounced_read_progress",
    })
  );

  const result = hooks.handleSharedBackgroundSyncDebounceDue({
    now,
    tabId: "tab-a",
    expectedGeneration: 2,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
      stateVisibleToTrigger = getState();
    },
  });

  assert.equal(triggerCount, 1);
  assert.equal(stateVisibleToTrigger, null);
  assert.equal(getState(), null);
  assert.deepEqual(toPlainObject(result), {
    status: "triggered",
    reason: "debounced_read_progress",
    generation: 2,
    maxLastModified: 752,
  });
};

const testCoveredSuccessClearsPendingAndSharedState = () => {
  const { constants, hooks, store, setState, getState } = getSharedDebounceApi();
  const now = 8_000_000;
  const followUps = createTimerSpy();

  setState(
    seedSharedState({
      generation: 3,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 1_000,
      lastDirtyAt: now - 1_000,
      maxLastModified: 800,
      sources: { read_progress: 1 },
      reason: "debounced_read_progress",
    })
  );
  store.set(PENDING_AUTO_SYNC_KEY, {
    source: "read_progress",
    lastModified: 800,
    maxLastModified: 800,
    createdAt: now - 1_000,
  });

  hooks.clearPendingAutoSyncRequestIfCovered(800, {
    debounceGeneration: 3,
    scheduleFollowUp: followUps.scheduleTimer,
  });
  hooks.clearSharedBackgroundSyncDebounceIfCovered({
    generation: 3,
    coveredLastModified: 800,
    scheduleFollowUp: followUps.scheduleTimer,
  });

  assert.equal(store.has(PENDING_AUTO_SYNC_KEY), false);
  assert.equal(getState(), null);
  assert.equal(followUps.calls.length, 0);
};

const testNewerDirtyRetainsPendingAndSchedulesShortFollowUp = () => {
  const { constants, hooks, store, setState, getState } = getSharedDebounceApi();
  const now = 9_000_000;
  const followUps = createTimerSpy();

  setState(
    seedSharedState({
      generation: 4,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 2_000,
      lastDirtyAt: now - 500,
      maxLastModified: 901,
      sources: { read_progress: 2 },
      reason: "debounced_read_progress",
    })
  );
  store.set(PENDING_AUTO_SYNC_KEY, {
    source: "read_progress",
    lastModified: 901,
    maxLastModified: 901,
    createdAt: now - 500,
  });

  hooks.clearPendingAutoSyncRequestIfCovered(900, {
    debounceGeneration: 3,
    scheduleFollowUp: followUps.scheduleTimer,
  });
  hooks.clearSharedBackgroundSyncDebounceIfCovered({
    generation: 3,
    coveredLastModified: 900,
    scheduleFollowUp: followUps.scheduleTimer,
  });

  assert.equal(store.has(PENDING_AUTO_SYNC_KEY), true);
  assert.equal(getState().generation, 4);
  assert.ok(followUps.calls.length >= 1);
  assert.ok(
    followUps.calls.every(
      ({ delayMs }) => delayMs >= 300 && delayMs <= 1500
    )
  );
};

const testDisabledOrBlockedStatesClearSchedulerState = () => {
  const cases = [
    {
      name: "remote sync disabled",
      settingsSnapshot: { ...readySyncSettings, syncRemoteEnabled: false },
    },
    {
      name: "auto sync disabled",
      settingsSnapshot: { ...readySyncSettings, syncAutoEnabled: false },
    },
    {
      name: "missing gist id",
      settingsSnapshot: { ...readySyncSettings, syncRemoteGistId: "" },
    },
    {
      name: "missing PAT",
      settingsSnapshot: { ...readySyncSettings, syncRemotePat: "" },
    },
    {
      name: "missing device id",
      settingsSnapshot: { ...readySyncSettings, syncDeviceId: "" },
    },
    {
      name: "conflict pause",
      settingsSnapshot: readySyncSettings,
      conflictPauseState: { reason: "remote_changed_before_push" },
    },
  ];

  cases.forEach((testCase, index) => {
    const { constants, request, setState, getState } = getSharedDebounceApi();
    const now = 10_000_000 + index * 10_000;
    setState(
      seedSharedState({
        generation: 1,
        ownerTabId: "tab-a",
        ownerLeaseUntil:
          now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
        dueAt: now + DEFAULT_SYNC_DEBOUNCE_MS,
        maxWaitUntil:
          now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
        firstDirtyAt: now,
        lastDirtyAt: now,
      })
    );

    const result = request(
      { source: "general", lastModified: 1_000 + index },
      {
        now,
        tabId: "tab-a",
        settingsSnapshot: testCase.settingsSnapshot,
        conflictPauseState: testCase.conflictPauseState || null,
        scheduleTimer: createTimerSpy().scheduleTimer,
      }
    );

    assert.equal(
      getState(),
      null,
      `${testCase.name} should clear the shared debounce scheduler state.`
    );
    assert.equal(toPlainObject(result).status, "skipped");
  });
};

const testOwnerReleaseLeavesPendingRecoverableAndAllowsTakeover = () => {
  const { constants, hooks, store, setState, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 11_000_000;

  setState(
    seedSharedState({
      generation: 5,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now + 1_000,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 2_000,
      lastDirtyAt: now - 500,
      maxLastModified: 1101,
      sources: { read_progress: 1 },
      threadIds: ["42"],
      reason: "debounced_read_progress",
    })
  );
  store.set(PENDING_AUTO_SYNC_KEY, {
    source: "read_progress",
    lastModified: 1101,
    maxLastModified: 1101,
    createdAt: now - 500,
  });

  hooks.releaseBackgroundSyncDebounceOwner({ tabId: "tab-a", now });

  assert.equal(store.has(PENDING_AUTO_SYNC_KEY), true);
  assert.equal(getState().ownerTabId, "");

  const acquired = hooks.tryAcquireBackgroundSyncDebounceOwner(
    getState(),
    now + 1,
    {
      tabId: "tab-b",
      settingsSnapshot: readySyncSettings,
      scheduleTimer: timers.scheduleTimer,
    }
  );

  assert.equal(acquired, true);
  assert.equal(getState().ownerTabId, "tab-b");
  assert.equal(timers.calls.length, 1);
};

const testRuntimeStateDoesNotExposeLegacyPerTabTimerAsSharedOwner = () => {
  const { hooks } = getSharedDebounceApi();
  const runtimeState = toPlainObject(
    hooks.getBackgroundSyncDebounceRuntimeStateForTest()
  );

  assert.deepEqual(runtimeState, {
    hasOwnerTimer: false,
    ownerTimerDueAt: 0,
    ownerTimerGeneration: 0,
    ownerHeartbeatActive: false,
  });
};

const testLockActiveReschedulePersistsDueAt = () => {
  const { constants, hooks, store, setState, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 12_000_000;

  setState(
    seedSharedState({
      generation: 6,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 3_000,
      lastDirtyAt: now - 1_000,
      maxLastModified: 1201,
      sources: { read_progress: 1 },
      threadIds: ["1201"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );
  store.set("s1p_background_sync_lock", {
    owner: "other-tab",
    timestamp: now,
  });

  const result = hooks.handleSharedBackgroundSyncDebounceDue({
    now,
    tabId: "tab-a",
    expectedGeneration: 6,
    settingsSnapshot: readySyncSettings,
    scheduleTimer: timers.scheduleTimer,
    triggerRemoteSyncPush: () => {
      throw new Error("sync should be delayed while a lock is active");
    },
  });

  assert.deepEqual(toPlainObject(result), {
    status: "scheduled",
    reason: "sync_lock_active",
    delayMs: 1000,
  });
  assert.equal(getState().dueAt, now + 1000);
  assert.equal(
    getState().ownerLeaseUntil,
    now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS
  );
  assert.equal(timers.calls.length, 1);
  assert.equal(timers.calls[0].delayMs, 1000);
};

const testSharedDebounceWriteRetriesWhenVerificationLosesRequest = () => {
  const { request, getState, sandbox, store } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 13_000_000;
  const originalSetValue = sandbox.GM_setValue;
  let intercepted = false;

  sandbox.GM_setValue = (key, value) => {
    originalSetValue(key, value);
    if (key !== BACKGROUND_SYNC_DEBOUNCE_STATE_KEY || intercepted) {
      return;
    }
    intercepted = true;
    originalSetValue(
      key,
      seedSharedState({
        generation: value.generation,
        ownerTabId: "tab-b",
        ownerLeaseUntil: now + 20_000,
        dueAt: now + DEFAULT_SYNC_DEBOUNCE_MS,
        maxWaitUntil: now + 60_000,
        firstDirtyAt: now,
        lastDirtyAt: now,
        maxLastModified: 1300,
        sources: { general: 1 },
        threadIds: ["other-thread"],
        reason: "debounced_local_change",
        dueSource: "general",
      })
    );
  };

  let result;
  try {
    result = request(
      { source: "read_progress", lastModified: 1301, threadId: "1301" },
      { now, tabId: "tab-a", scheduleTimer: timers.scheduleTimer }
    );
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  const state = getState();
  assert.equal(toPlainObject(result).retryCount, 1);
  assert.equal(state.generation, 2);
  assert.equal(state.ownerTabId, "tab-b");
  assert.equal(state.maxLastModified, 1301);
  assert.deepEqual(state.sources, { general: 1, read_progress: 1 });
  assert.deepEqual(state.threadIds, ["other-thread", "1301"]);
  assert.equal(state.dueAt, now + DEFAULT_SYNC_DEBOUNCE_MS);
  assert.equal(state.dueSource, "general");
  assert.equal(timers.calls.length, 0);
  assert.equal(
    store.get(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY).threadIds.includes("1301"),
    true
  );
};

const testPendingRecoveryRecognizesCoveredSharedDebounce = () => {
  const { constants, hooks, setState } = getSharedDebounceApi();
  const now = 14_000_000;
  const state = seedSharedState({
    generation: 8,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
    dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
    maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: 1402,
    sources: { read_progress: 1, general: 1 },
    threadIds: ["1402"],
    reason: "debounced_read_progress",
    dueSource: "read_progress",
  });
  const pending = {
    source: "read_progress",
    sources: { read_progress: 1, general: 1 },
    lastModified: 1401,
    maxLastModified: 1402,
    createdAt: now,
    firstDirtyAt: now,
    lastDirtyAt: now,
    threadIds: ["1402"],
  };

  setState(state);

  assert.equal(
    hooks.isBackgroundSyncDebounceStateCoveringPendingRequest(state, pending),
    true,
    "shared debounce 覆盖 pending 的所有 source/thread/maxLastModified 时，应阻止 per-tab pending recovery。"
  );
  assert.deepEqual(
    toPlainObject(hooks.getPendingAutoSyncSharedDebounceCoverage(pending, now)),
    {
      covered: true,
      state,
      reason: "covered_by_shared_debounce",
    }
  );
};

const testHiddenOwnerFlushForcesPendingSchedulerBeforeTimerDue = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const now = 15_000_000;
  const dueAt = now + READ_PROGRESS_SYNC_DEBOUNCE_MS;
  let triggerCount = 0;
  let triggerReason = "";
  let schedulerContext = null;

  setState(
    seedSharedState({
      generation: 9,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 1000,
      lastDirtyAt: now,
      maxLastModified: 1501,
      sources: { read_progress: 1 },
      threadIds: ["1501"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );

  const result = hooks.flushSharedBackgroundSyncDebounceForHiddenPage({
    now,
    tabId: "tab-a",
    settingsSnapshot: readySyncSettings,
    triggerRemoteSyncPush: (reason, context) => {
      triggerCount += 1;
      triggerReason = reason;
      schedulerContext = toPlainObject(context);
    },
  });

  assert.equal(result.status, "triggered");
  assert.equal(triggerCount, 1);
  assert.equal(triggerReason, "debounced_read_progress");
  assert.equal(schedulerContext.scheduledDueAt, dueAt);
  assert.equal(schedulerContext.debounceGeneration, 9);
  assert.equal(schedulerContext.intendedMaxLastModified, 1501);
  assert.equal(getState(), null);
};

const testHiddenPageCanRecoverExpiredOwnerAndFlushImmediately = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const timers = createTimerSpy();
  const now = 16_000_000;
  let triggerCount = 0;

  setState(
    seedSharedState({
      generation: 10,
      ownerTabId: "closed-tab",
      ownerLeaseUntil: now - 1,
      dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 1000,
      lastDirtyAt: now,
      maxLastModified: 1601,
      sources: { read_progress: 1 },
      threadIds: ["1601"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );

  const result = hooks.flushSharedBackgroundSyncDebounceForHiddenPage({
    now,
    tabId: "tab-a",
    settingsSnapshot: readySyncSettings,
    scheduleTimer: timers.scheduleTimer,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
    },
  });

  assert.equal(result.status, "triggered");
  assert.equal(triggerCount, 1);
  assert.equal(
    timers.calls.length,
    1,
    "接管过期 owner 时会先登记本标签页 timer，再由隐藏页补发立即消费。"
  );
  assert.equal(getState(), null);
};

const testHiddenFlushDoesNotStealActiveOtherOwner = () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const now = 17_000_000;
  let triggerCount = 0;
  const state = seedSharedState({
    generation: 11,
    ownerTabId: "tab-b",
    ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
    dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
    maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
    firstDirtyAt: now - 1000,
    lastDirtyAt: now,
    maxLastModified: 1701,
    sources: { read_progress: 1 },
    threadIds: ["1701"],
    reason: "debounced_read_progress",
    dueSource: "read_progress",
  });

  setState(state);

  const result = hooks.flushSharedBackgroundSyncDebounceForHiddenPage({
    now,
    tabId: "tab-a",
    settingsSnapshot: readySyncSettings,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
    },
  });

  assert.deepEqual(toPlainObject(result), {
    status: "skipped",
    reason: "owned_by_active_other_tab",
    currentOwnerTabId: "tab-b",
  });
  assert.equal(triggerCount, 0);
  assert.deepEqual(getState(), state);
};

const testQueuedHiddenFlushRunsDeferredTask = async () => {
  const { constants, hooks, setState, getState } = getSharedDebounceApi();
  const now = 18_000_000;
  let triggerCount = 0;

  setState(
    seedSharedState({
      generation: 12,
      ownerTabId: "tab-a",
      ownerLeaseUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS,
      dueAt: now + READ_PROGRESS_SYNC_DEBOUNCE_MS,
      maxWaitUntil: now + constants.BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS,
      firstDirtyAt: now - 1000,
      lastDirtyAt: now,
      maxLastModified: 1801,
      sources: { read_progress: 1 },
      threadIds: ["1801"],
      reason: "debounced_read_progress",
      dueSource: "read_progress",
    })
  );

  hooks.queueSharedBackgroundSyncDebounceHiddenFlush("test_hidden_queue", {
    now,
    tabId: "tab-a",
    settingsSnapshot: readySyncSettings,
    triggerRemoteSyncPush: () => {
      triggerCount += 1;
    },
  });

  assert.equal(
    triggerCount,
    0,
    "hidden flush queue 应先让当前事件轮次完成，而不是同步执行。"
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(triggerCount, 1);
  assert.equal(getState(), null);
};

const main = async () => {
  testReadProgressDirtyMergesIntoSingleSharedState();
  testSourceSpecificSettleWindows();
  testForcedRetryUsesSharedSchedulerDueAt();
  testSharedRetryDoesNotKeepLocalDrainPending();
  testCleanStateFenceSkipsCoveredAutoPush();
  testSharedDebounceDueClearsCoveredCleanState();
  testGeneralDueAtIsNotDelayedByReadProgress();
  testReadProgressTrailingDebounceStopsAtMaxWait();
  testOnlyOwnerSchedulesTimerAndValidLeasePreventsSteal();
  testExpiredOwnerLeaseAllowsTakeover();
  testVisibleTabWatchesActiveOwnerLeaseForRecovery();
  testOwnerLeaseRecoveryCallbackTakesOverAndRunsPastDueTimer();
  testOwnerDueReReadsStateAndSkipsStaleGeneration();
  testOwnerDueConsumesSharedStateBeforeTrigger();
  testCoveredSuccessClearsPendingAndSharedState();
  testNewerDirtyRetainsPendingAndSchedulesShortFollowUp();
  testDisabledOrBlockedStatesClearSchedulerState();
  testOwnerReleaseLeavesPendingRecoverableAndAllowsTakeover();
  testRuntimeStateDoesNotExposeLegacyPerTabTimerAsSharedOwner();
  testLockActiveReschedulePersistsDueAt();
  testSharedDebounceWriteRetriesWhenVerificationLosesRequest();
  testPendingRecoveryRecognizesCoveredSharedDebounce();
  testHiddenOwnerFlushForcesPendingSchedulerBeforeTimerDue();
  testHiddenPageCanRecoverExpiredOwnerAndFlushImmediately();
  testHiddenFlushDoesNotStealActiveOtherOwner();
  await testQueuedHiddenFlushRunsDeferredTask();

  console.log("[background-sync-shared-debounce] Shared debounce scheduler checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
