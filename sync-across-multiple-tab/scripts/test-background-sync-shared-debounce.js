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

const REQUIRED_SHARED_DEBOUNCE_HOOKS = [
  "normalizeBackgroundSyncDebounceState",
  "getBackgroundSyncDebounceState",
  "setBackgroundSyncDebounceState",
  "clearBackgroundSyncDebounceState",
  "requestSharedBackgroundSyncDebounce",
  "tryAcquireBackgroundSyncDebounceOwner",
  "refreshBackgroundSyncDebounceOwnerLease",
  "releaseBackgroundSyncDebounceOwner",
  "scheduleSharedBackgroundSyncDebounceTimer",
  "clearSharedBackgroundSyncDebounceTimer",
  "handleSharedBackgroundSyncDebounceDue",
  "clearPendingAutoSyncRequestIfCovered",
  "clearSharedBackgroundSyncDebounceIfCovered",
  "getBackgroundSyncDebounceRuntimeStateForTest",
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
    constants.BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS >= 300 &&
      constants.BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS <= 1500,
    "follow-up settle should stay in the short 300ms-1500ms window."
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

const main = () => {
  testReadProgressDirtyMergesIntoSingleSharedState();
  testSourceSpecificSettleWindows();
  testGeneralDueAtIsNotDelayedByReadProgress();
  testReadProgressTrailingDebounceStopsAtMaxWait();
  testOnlyOwnerSchedulesTimerAndValidLeasePreventsSteal();
  testExpiredOwnerLeaseAllowsTakeover();
  testOwnerDueReReadsStateAndSkipsStaleGeneration();
  testOwnerDueConsumesSharedStateBeforeTrigger();
  testCoveredSuccessClearsPendingAndSharedState();
  testNewerDirtyRetainsPendingAndSchedulesShortFollowUp();
  testDisabledOrBlockedStatesClearSchedulerState();
  testOwnerReleaseLeavesPendingRecoverableAndAllowsTakeover();
  testRuntimeStateDoesNotExposeLegacyPerTabTimerAsSharedOwner();
  testLockActiveReschedulePersistsDueAt();
  testSharedDebounceWriteRetriesWhenVerificationLosesRequest();

  console.log("[background-sync-shared-debounce] Shared debounce scheduler checks passed.");
};

main();
