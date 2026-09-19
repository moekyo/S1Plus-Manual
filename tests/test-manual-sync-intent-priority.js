#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const LEGACY_KEY = "s1p_pending_manual_sync_intent";
const LEGACY_RECORD_PREFIX = LEGACY_KEY + ":";
const PENDING_DIRTY_KEY = "s1p_pending_auto_sync_request";

const createHarness = (options = {}) =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露手动同步意图测试钩子。",
    ...options,
  });

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createManualTimerAdapters = () => {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout: (callback, delayMs) => {
      const id = ++nextId;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
};

const getLatestPendingProjection = (runtime) =>
  [...runtime.indicatorUpdates]
    .reverse()
    .find((update) => update.type === "pending")?.intent || null;

const createCoordinator = (hooks, options = {}) => {
  let activeExecution = options.activeExecution === true;
  let syncEnabled = options.syncEnabled !== false;
  let now = options.now || 1_000_000;
  const confirmations = [];
  const executions = [];
  const indicatorUpdates = [];
  const dismissCalls = [];
  const messages = [];
  const schedulerResumptions = [];

  const coordinator = hooks.s1pCreateManualSyncIntentCoordinator({
    ...options.timerAdapters,
    now: () => now,
    isSyncEnabled: () => syncEnabled,
    hasActiveExecution: () => activeExecution,
    onQueued: () => indicatorUpdates.push({ type: "queued" }),
    setIndicatorPending: (intent) =>
      indicatorUpdates.push({
        type: "pending",
        intent: toPlainObject(intent),
      }),
    refreshDisplay: (reason) => indicatorUpdates.push({ type: "refresh", reason }),
    resumeAutomaticScheduling: (reason) => {
      schedulerResumptions.push(reason);
      return { status: "recovered" };
    },
    showMessage: (message) => messages.push(message),
    execute: async (direction, intent) => {
      executions.push({
        direction,
        intent: intent ? toPlainObject(intent) : null,
      });
      if (typeof options.execute === "function") {
        return options.execute(direction, intent);
      }
      return { status: "success", action: "manual_" + direction };
    },
    showConfirmation: (intent, actions) => {
      const confirmation = {
        intent: toPlainObject(intent),
        actions,
      };
      confirmations.push(confirmation);
      return {
        s1p_api: {
          dismiss: (dismissOptions = {}) => {
            dismissCalls.push(dismissOptions);
            if (dismissOptions.invokeDismiss !== false) {
              actions.onDismiss();
            }
          },
        },
      };
    },
  });

  return {
    coordinator,
    confirmations,
    executions,
    indicatorUpdates,
    dismissCalls,
    messages,
    schedulerResumptions,
    setActiveExecution: (value) => {
      activeExecution = value === true;
    },
    setSyncEnabled: (value) => {
      syncEnabled = value === true;
    },
    setNow: (value) => {
      now = value;
    },
  };
};

const readProjectedNavbarState = (hooks) =>
  toPlainObject(hooks.s1pSyncSystem.readState({ surface: "navbar" }));

const testImmediateManualPushAndPullDoNotConfirm = async () => {
  for (const direction of ["push", "pull"]) {
    const { hooks, store } = createHarness();
    const runtime = createCoordinator(hooks, { activeExecution: false });

    const result = await runtime.coordinator.request(direction);

    assert.equal(result.status, "success");
    assert.equal(runtime.confirmations.length, 0);
    assert.equal(runtime.executions.length, 1);
    assert.equal(runtime.executions[0].direction, direction);
    assert.equal(store.has(LEGACY_KEY), false);
  }
};

const testBusyManualPushProjectsPageLocalPending = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  const result = await runtime.coordinator.request("push");
  const intent = runtime.coordinator.readIntent();
  const projected = getLatestPendingProjection(runtime);

  assert.equal(result.status, "queued");
  assert.equal(result.phase, "waiting_for_execution_boundary");
  assert.deepEqual(toPlainObject(intent), {
    version: 1,
    direction: "push",
    createdAt: 1_000_000,
    phase: "waiting_for_execution_boundary",
  });
  assert.equal(projected.direction, "push");
  assert.equal(projected.phase, "waiting_for_execution_boundary");
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(
    Array.from(store.keys()).some((key) =>
      String(key).startsWith(LEGACY_RECORD_PREFIX)
    ),
    false
  );
};

const testBusyManualPullProjectsPageLocalPending = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  const result = await runtime.coordinator.request("pull");
  const projected = getLatestPendingProjection(runtime);

  assert.equal(result.status, "queued");
  assert.equal(result.direction, "pull");
  assert.equal(runtime.coordinator.readIntent().direction, "pull");
  assert.equal(projected.direction, "pull");
  assert.equal(projected.phase, "waiting_for_execution_boundary");
};

const testExecutionBoundaryShowsConfirmationWithoutExecutionLock = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  const boundaryResult = await runtime.coordinator.reconcile("lock_released");
  const intent = runtime.coordinator.readIntent();

  assert.equal(boundaryResult.status, "awaiting_confirmation");
  assert.equal(boundaryResult.phase, "awaiting_confirmation");
  assert.equal(intent.phase, "awaiting_confirmation");
  assert.equal(runtime.confirmations.length, 1);
  assert.equal(runtime.coordinator.isPriorityGateActive(), true);
};

const testConfirmationCallsExistingForceDirectionAndSettles = async () => {
  for (const direction of ["push", "pull"]) {
    const { hooks } = createHarness();
    const runtime = createCoordinator(hooks, { activeExecution: true });

    await runtime.coordinator.request(direction);
    runtime.setActiveExecution(false);
    await runtime.coordinator.reconcile("lock_released");

    const result = await runtime.confirmations[0].actions.onConfirm();

    assert.equal(result.status, "success");
    assert.equal(runtime.executions.length, 1);
    assert.equal(runtime.executions[0].direction, direction);
    assert.equal(runtime.executions[0].intent.direction, direction);
    assert.equal(runtime.coordinator.readIntent(), null);
    assert.equal(runtime.coordinator.isPriorityGateActive(), false);
    assert.ok(runtime.schedulerResumptions.length >= 1);
  }
};

const testCancelClearsOnlyLocalPending = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });
  store.set(PENDING_DIRTY_KEY, {
    version: 1,
    source: "read_progress",
    lastModified: 100,
    createdAt: 100,
  });

  await runtime.coordinator.request("pull");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const result = await runtime.confirmations[0].actions.onCancel();

  assert.equal(result.status, "cancelled");
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(store.has(PENDING_DIRTY_KEY), true);
  assert.equal(runtime.executions.length, 0);
};

const testConfirmationBoundaryRaceRequeuesUntilNextBoundary = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const confirmation = runtime.confirmations[0];

  runtime.setActiveExecution(true);
  const raced = await confirmation.actions.onConfirm();

  assert.equal(raced.status, "queued");
  assert.equal(raced.reason, "execution_boundary_busy");
  assert.equal(
    runtime.coordinator.readIntent().phase,
    "waiting_for_execution_boundary"
  );
  assert.equal(runtime.executions.length, 0);

  runtime.setActiveExecution(false);
  const recovered = await runtime.coordinator.reconcile("next_boundary");
  assert.equal(recovered.status, "awaiting_confirmation");
  assert.equal(runtime.confirmations.length, 2);
};

const testExecutionResultBoundaryRaceRequeuesWithoutPreemption = async () => {
  const { hooks } = createHarness();
  let executeCount = 0;
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    execute: async () => {
      executeCount += 1;
      return executeCount === 1
        ? { status: "skipped", reason: "manual_sync_busy" }
        : { status: "success", action: "manual_push" };
    },
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const firstConfirmation = runtime.confirmations[0];
  const raced = await firstConfirmation.actions.onConfirm();

  assert.equal(raced.status, "queued");
  assert.equal(
    runtime.coordinator.readIntent().phase,
    "waiting_for_execution_boundary"
  );
  assert.equal(runtime.executions.length, 1);

  await runtime.coordinator.reconcile("next_boundary");
  const result = await runtime.confirmations[1].actions.onConfirm();
  assert.equal(result.status, "success");
  assert.equal(runtime.coordinator.readIntent(), null);
};

const testBusyContinuationCannotRestoreAnEarlierDirection = async () => {
  for (const [olderDirection, newerDirection] of [
    ["push", "pull"],
    ["pull", "push"],
  ]) {
    const { hooks } = createHarness();
    const deferred = createDeferred();
    let runtime;
    runtime = createCoordinator(hooks, {
      activeExecution: false,
      execute: async (direction) => {
        if (direction === olderDirection) {
          runtime.setActiveExecution(true);
          return deferred.promise;
        }
        return { status: "success", action: "manual_" + direction };
      },
    });

    const olderRequest = runtime.coordinator.request(olderDirection);
    const newerRequest = runtime.coordinator.request(newerDirection);
    await newerRequest;
    assert.equal(
      runtime.coordinator.readIntent().direction,
      newerDirection,
      "较新的请求必须在旧执行返回前取得 page-local intent 所有权。"
    );

    deferred.resolve({ status: "skipped", reason: "manual_sync_busy" });
    await olderRequest;

    assert.equal(
      runtime.coordinator.readIntent().direction,
      newerDirection,
      `${olderDirection} 的 busy 回退不得覆盖后来的 ${newerDirection}。`
    );
    runtime.setActiveExecution(false);
    const reconciled = await runtime.coordinator.reconcile("lock_released");
    assert.equal(reconciled.status, "awaiting_confirmation");
    assert.equal(
      runtime.confirmations.at(-1).intent.direction,
      newerDirection
    );
  }
};

const testSameMillisecondRequestsUseSequenceForBusyContinuation = async () => {
  const { hooks } = createHarness();
  const deferred = createDeferred();
  let runtime;
  runtime = createCoordinator(hooks, {
    activeExecution: false,
    now: 2_000_000,
    execute: async () => {
      runtime.setActiveExecution(true);
      return deferred.promise;
    },
  });

  const olderRequest = runtime.coordinator.request("push");
  const newerRequest = runtime.coordinator.request("push");
  await newerRequest;
  deferred.resolve({ status: "skipped", reason: "manual_sync_busy" });
  await olderRequest;

  assert.equal(runtime.coordinator.readIntent().direction, "push");
  assert.equal(
    runtime.messages.length,
    1,
    "同毫秒同方向请求也必须让旧 continuation 失去副作用权限。"
  );
};

const testOlderSuccessFailureAndThrowDoNotTouchNewerPending = async () => {
  for (const outcome of [
    { status: "success", action: "manual_push" },
    { status: "failure", reason: "remote_timeout" },
    new Error("manual execution failed"),
  ]) {
    const { hooks } = createHarness();
    const deferred = createDeferred();
    let runtime;
    runtime = createCoordinator(hooks, {
      activeExecution: false,
      execute: async () => {
        runtime.setActiveExecution(true);
        return deferred.promise;
      },
    });

    const olderRequest = runtime.coordinator.request("push");
    const newerRequest = runtime.coordinator.request("pull");
    await newerRequest;
    if (outcome instanceof Error) {
      deferred.reject(outcome);
      await assert.rejects(olderRequest, /manual execution failed/);
    } else {
      deferred.resolve(outcome);
      await olderRequest;
    }
    assert.equal(runtime.coordinator.readIntent().direction, "pull");
  }
};

const testLatestDirectionWinsWithinOnePageAndOldModalIsStale = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    now: 2_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const oldConfirmation = runtime.confirmations[0];

  runtime.setNow(2_000_001);
  const replacement = await runtime.coordinator.request("pull");
  const current = runtime.coordinator.readIntent();

  assert.equal(replacement.status, "awaiting_confirmation");
  assert.equal(current.direction, "pull");
  assert.equal(runtime.confirmations.length, 2);
  assert.deepEqual(
    toPlainObject(await oldConfirmation.actions.onConfirm()),
    {
      status: "skipped",
      reason: "stale_manual_intent",
    }
  );
  assert.equal(runtime.executions.length, 0);
  const result = await runtime.confirmations[1].actions.onConfirm();
  assert.equal(result.status, "success");
  assert.equal(result.action, "manual_pull");
};

const flushMicrotasks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

const testQueuedConfirmationChecksLatestRequestBeforeExecuting = async () => {
  for (const [olderDirection, newerDirection] of [
    ["push", "pull"],
    ["pull", "push"],
    ["push", "push"],
  ]) {
    const { hooks } = createHarness();
    const runtime = createCoordinator(hooks, {
      activeExecution: true,
      now: 3_000_000,
    });

    await runtime.coordinator.request(olderDirection);
    runtime.setActiveExecution(false);
    await runtime.coordinator.reconcile("lock_released");
    const oldConfirmation = runtime.confirmations[0];

    const oldConfirmationPromise = oldConfirmation.actions.onConfirm();
    const newerRequestPromise = runtime.coordinator.request(newerDirection);
    const [oldResult, newerResult] = await Promise.all([
      oldConfirmationPromise,
      newerRequestPromise,
    ]);

    assert.deepEqual(toPlainObject(oldResult), {
      status: "skipped",
      reason: "stale_manual_intent",
    });
    assert.equal(newerResult.status, "awaiting_confirmation");
    assert.equal(
      runtime.executions.length,
      0,
      "新请求进入后，尚未开始的旧确认任务不得调用 executor。"
    );
    assert.equal(runtime.coordinator.readIntent().direction, newerDirection);
  }
};

const testStaleConfirmationCancelCannotClearNewerIntent = async () => {
  for (const callbackName of ["onCancel", "onDismiss"]) {
    const { hooks } = createHarness();
    const runtime = createCoordinator(hooks, {
      activeExecution: true,
      now: 3_000_000,
    });

    await runtime.coordinator.request("push");
    runtime.setActiveExecution(false);
    await runtime.coordinator.reconcile("lock_released");
    const oldConfirmation = runtime.confirmations[0];
    const oldCallbackPromise = oldConfirmation.actions[callbackName]();
    const newerRequestPromise = runtime.coordinator.request("pull");
    const [oldResult, newerResult] = await Promise.all([
      oldCallbackPromise,
      newerRequestPromise,
    ]);

    assert.deepEqual(toPlainObject(oldResult), {
      status: "skipped",
      reason: "stale_manual_intent",
    });
    assert.equal(newerResult.status, "awaiting_confirmation");
    assert.equal(runtime.coordinator.readIntent().direction, "pull");
    assert.equal(runtime.coordinator.isPriorityGateActive(), true);
  }
};

const testConfirmedExecutionDoesNotBlockNewIntentRegistration = async () => {
  const outcomes = [
    { status: "success", action: "manual_push" },
    { status: "failure", reason: "remote_timeout" },
    { status: "skipped", reason: "manual_sync_busy" },
    new Error("manual execution failed"),
  ];
  for (const [olderDirection, newerDirection] of [
    ["push", "pull"],
    ["pull", "push"],
    ["push", "push"],
  ]) {
    for (const outcome of outcomes) {
      const { hooks } = createHarness();
      const deferred = createDeferred();
      let runtime;
      let oldExecutionStarted = false;
      let resolveStarted;
      const started = new Promise((resolve) => {
        resolveStarted = resolve;
      });
      runtime = createCoordinator(hooks, {
        activeExecution: true,
        now: 4_000_000,
        execute: async () => {
          if (!oldExecutionStarted) {
            oldExecutionStarted = true;
            runtime.setActiveExecution(true);
            resolveStarted();
            return deferred.promise;
          }
          runtime.setActiveExecution(false);
          return { status: "success", action: "manual_" + newerDirection };
        },
      });

      await runtime.coordinator.request(olderDirection);
      runtime.setActiveExecution(false);
      await runtime.coordinator.reconcile("lock_released");
      const oldConfirmationPromise = runtime.confirmations[0].actions.onConfirm();
      await started;

      let newerRequestSettled = false;
      const newerRequestPromise = runtime.coordinator
        .request(newerDirection)
        .then((result) => {
          newerRequestSettled = true;
          return result;
        });
      await flushMicrotasks();

      assert.equal(
        newerRequestSettled,
        true,
        "网络执行未结束时，新方向也必须先完成 page-local intent 登记。"
      );
      const pending = runtime.coordinator.readIntent();
      assert.equal(pending.direction, newerDirection);
      assert.equal(
        getLatestPendingProjection(runtime).direction,
        newerDirection,
        "指示器必须立即反映后来登记的方向。"
      );
      assert.equal(runtime.executions.length, 1);

      runtime.setActiveExecution(false);
      if (outcome instanceof Error) {
        deferred.reject(outcome);
      } else {
        deferred.resolve(outcome);
      }
      await oldConfirmationPromise;
      await newerRequestPromise;

      assert.equal(
        runtime.coordinator.readIntent().direction,
        newerDirection,
        "旧网络结果不得清除或覆盖后来 pending。"
      );

      const boundary = await runtime.coordinator.reconcile("next_boundary");
      assert.equal(boundary.status, "awaiting_confirmation");
      const newerResult = await runtime.confirmations.at(-1).actions.onConfirm();
      assert.equal(newerResult.status, "success");
      assert.equal(runtime.executions.length, 2);
      assert.equal(runtime.coordinator.readIntent(), null);
    }
  }
};

const testUnbindDuringConfirmedExecutionReleasesNewLifecycleQueue = async () => {
  const { hooks } = createHarness();
  const deferred = createDeferred();
  let runtime;
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  let oldExecutionStarted = false;
  runtime = createCoordinator(hooks, {
    activeExecution: true,
    now: 5_000_000,
    execute: async () => {
      if (!oldExecutionStarted) {
        oldExecutionStarted = true;
        runtime.setActiveExecution(true);
        resolveStarted();
        return deferred.promise;
      }
      return { status: "success", action: "manual_pull" };
    },
  });

  runtime.coordinator.bind();
  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const oldConfirmationPromise = runtime.confirmations[0].actions.onConfirm();
  await started;

  runtime.coordinator.unbind();
  runtime.coordinator.bind();
  let newerRequestSettled = false;
  const newerRequestPromise = runtime.coordinator
    .request("pull")
    .then((result) => {
      newerRequestSettled = true;
      return result;
    });
  await flushMicrotasks(32);

  assert.equal(
    newerRequestSettled,
    true,
    "旧生命周期的网络 Promise 不得占住重新 bind 后的意图队列。"
  );
  assert.equal(runtime.coordinator.readIntent().direction, "pull");

  runtime.setActiveExecution(false);
  deferred.resolve({ status: "success", action: "manual_push" });
  await oldConfirmationPromise;
  await newerRequestPromise;
  assert.equal(runtime.coordinator.readIntent().direction, "pull");

  await runtime.coordinator.reconcile("new_lifecycle_boundary");
  const result = await runtime.confirmations.at(-1).actions.onConfirm();
  assert.equal(result.status, "success");
  assert.equal(runtime.executions.length, 2);
  assert.equal(runtime.coordinator.readIntent(), null);
};

const testReloadDoesNotRestorePageLocalPending = async () => {
  const first = createHarness();
  const firstRuntime = createCoordinator(first.hooks, { activeExecution: true });

  await firstRuntime.coordinator.request("push");
  assert.equal(firstRuntime.coordinator.readIntent().direction, "push");
  firstRuntime.coordinator.handleLifecycle("pagehide");

  const second = createHarness();
  const secondRuntime = createCoordinator(second.hooks, {
    activeExecution: false,
  });

  assert.equal(secondRuntime.coordinator.readIntent(), null);
  assert.equal(secondRuntime.confirmations.length, 0);
  assert.equal(secondRuntime.coordinator.isPriorityGateActive(), false);
};

const testIndependentCoordinatorsDoNotSharePageLocalPending = async () => {
  const { hooks } = createHarness();
  const first = createCoordinator(hooks, { activeExecution: true });
  const second = createCoordinator(hooks, { activeExecution: true });

  await first.coordinator.request("push");
  assert.equal(first.coordinator.readIntent().direction, "push");
  assert.equal(second.coordinator.readIntent(), null);
  assert.equal(second.coordinator.isPriorityGateActive(), false);

  await second.coordinator.request("pull");
  assert.equal(first.coordinator.readIntent().direction, "push");
  assert.equal(second.coordinator.readIntent().direction, "pull");

  await first.coordinator.cancel(first.coordinator.readIntent());
  assert.equal(first.coordinator.readIntent(), null);
  assert.equal(second.coordinator.readIntent().direction, "pull");
};

const testNoSessionStorageDependency = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  assert.equal(sandbox.window.sessionStorage, undefined);
  await runtime.coordinator.request("push");

  assert.equal(runtime.coordinator.readIntent().direction, "push");
  assert.equal(store.has(LEGACY_KEY), false);
};

const testNoManualJournalOrDecisionLockIsNeeded = async () => {
  const { hooks, store, sandbox } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("pull");

  assert.equal(sandbox.navigator.locks, undefined);
  assert.equal(store.has("s1p_manual_sync_intent_decision"), false);
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(
    Array.from(store.keys()).some((key) =>
      String(key).startsWith(LEGACY_RECORD_PREFIX)
    ),
    false
  );
};

const testLegacyManualJournalIsObsoletedWithoutTouchingOtherSyncState = () => {
  const unrelatedPendingDirty = {
    version: 1,
    source: "read_progress",
    lastModified: 900,
  };
  const { hooks, store } = createHarness({
    gmEntries: [
      [LEGACY_KEY, { direction: "push" }],
      [LEGACY_RECORD_PREFIX + "old-record", { direction: "pull" }],
      [PENDING_DIRTY_KEY, unrelatedPendingDirty],
      ["s1p_sync_global_lock", { owner: "foreign", mode: "background" }],
    ],
  });

  assert.equal(typeof hooks.cleanupLegacyManualSyncIntentState, "function");
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(store.has(LEGACY_RECORD_PREFIX + "old-record"), false);
  assert.deepEqual(store.get(PENDING_DIRTY_KEY), unrelatedPendingDirty);
  assert.deepEqual(store.get("s1p_sync_global_lock"), {
    owner: "foreign",
    mode: "background",
  });
};

const testSettingsDisableClearsOnlyLocalIntent = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });
  store.set(PENDING_DIRTY_KEY, { lastModified: 10 });

  await runtime.coordinator.request("push");
  runtime.setSyncEnabled(false);
  const result = await runtime.coordinator.reconcile("settings_disabled");

  assert.equal(result.status, "cancelled");
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(store.has(PENDING_DIRTY_KEY), true);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const testLocalPriorityGateOnlyBlocksThisCoordinator = async () => {
  const { hooks } = createHarness();
  const first = createCoordinator(hooks, { activeExecution: true });
  const second = createCoordinator(hooks, { activeExecution: false });

  await first.coordinator.request("push");

  assert.equal(first.coordinator.isPriorityGateActive(), true);
  assert.equal(second.coordinator.isPriorityGateActive(), false);
};

const testExplicitUnbindClearsPageLocalIntent = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  runtime.coordinator.bind();
  await runtime.coordinator.request("push");
  assert.equal(runtime.coordinator.isPriorityGateActive(), true);

  runtime.coordinator.unbind();
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const testUnbindClearsPageLocalIntentEvenWhenNotBound = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("pull");
  assert.equal(runtime.coordinator.unbind().reason, "already_unbound");
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const testUnbindInvalidatesInFlightContinuationAndTimerFinally = async () => {
  const { hooks } = createHarness();
  const deferred = createDeferred();
  const timerAdapters = createManualTimerAdapters();
  let runtime;
  runtime = createCoordinator(hooks, {
    activeExecution: false,
    timerAdapters,
    execute: async () => {
      runtime.setActiveExecution(true);
      return deferred.promise;
    },
  });
  runtime.coordinator.bind();
  const request = runtime.coordinator.request("push");

  runtime.coordinator.unbind();
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
  assert.equal(timerAdapters.timers.size, 0);

  deferred.resolve({ status: "skipped", reason: "manual_sync_busy" });
  await request;
  await Promise.resolve();

  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
  assert.equal(
    timerAdapters.timers.size,
    0,
    "旧 reconcile/finally 不得在 unbind 后重新安排唤醒 timer。"
  );
};

const testQueuedTaskCannotRecreateStateAfterUnbind = async () => {
  const { hooks } = createHarness();
  const timerAdapters = createManualTimerAdapters();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    timerAdapters,
  });

  const request = runtime.coordinator.request("push");
  runtime.coordinator.unbind();
  await request;

  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
  assert.equal(timerAdapters.timers.size, 0);
};

const testRebindCannotAdmitOldContinuation = async () => {
  const { hooks } = createHarness();
  const deferred = createDeferred();
  const timerAdapters = createManualTimerAdapters();
  let runtime;
  runtime = createCoordinator(hooks, {
    activeExecution: false,
    timerAdapters,
    execute: async () => {
      runtime.setActiveExecution(true);
      return deferred.promise;
    },
  });
  runtime.coordinator.bind();
  const request = runtime.coordinator.request("push");
  runtime.coordinator.unbind();
  runtime.coordinator.bind();

  deferred.resolve({ status: "skipped", reason: "manual_sync_busy" });
  await request;
  await Promise.resolve();

  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
  assert.equal(timerAdapters.timers.size, 0);
};

const testConfirmationCallbackCannotRunAfterUnbind = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });
  runtime.coordinator.bind();
  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const confirmation = runtime.confirmations[0];

  runtime.coordinator.unbind();
  const result = await confirmation.actions.onConfirm();

  assert.deepEqual(toPlainObject(result), {
    status: "skipped",
    reason: "stale_manual_intent",
  });
  assert.equal(runtime.executions.length, 0);
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const testCrossTabExecutionLockStillRemainsShared = async () => {
  const sharedStore = new Map();
  const first = createHarness({ sharedStore });
  const second = createHarness({ sharedStore });

  const firstLock = await first.hooks.acquireManualSyncLock({
    preemptActiveSync: false,
    operation: "test_first",
  });
  const secondLock = await second.hooks.acquireManualSyncLock({
    preemptActiveSync: false,
    operation: "test_second",
  });

  assert.equal(firstLock, true);
  assert.equal(secondLock, false);
  sharedStore.delete("s1p_manual_sync_lock");
  sharedStore.delete("s1p_sync_global_lock");
};

const testLocalStaleTimeoutClearsPendingWithoutTimer = async () => {
  const { hooks } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setNow(1_000_000 + 30 * 60 * 1000 + 1);
  const result = await runtime.coordinator.reconcile("stale_check");

  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(runtime.coordinator.readIntent(), null);
};

const testNeutralForegroundProbeRemainsNeutral = () => {
  const { hooks } = createHarness();
  const now = Date.now();
  const pending = hooks.markPendingForegroundRemoteSyncRequest({
    reason: "pageshow",
    triggerSource: "foreground_resume",
    remoteUpdatedAt: "2026-09-01T20:05:44Z",
    now,
  });
  const pendingState = toPlainObject(
    hooks.getAutoSyncRuntimePendingDisplayState(now)
  );

  assert.equal(pendingState.operation, "sync");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(readProjectedNavbarState(hooks)),
    "sync"
  );
  hooks.clearPendingForegroundRemoteSyncRequest(pending, "test_cleanup");
};

const run = async () => {
  await testSilentExpiryWakesManualIntent();
  await testImmediateManualPushAndPullDoNotConfirm();
  await testBusyManualPushProjectsPageLocalPending();
  await testBusyManualPullProjectsPageLocalPending();
  await testExecutionBoundaryShowsConfirmationWithoutExecutionLock();
  await testConfirmationCallsExistingForceDirectionAndSettles();
  await testCancelClearsOnlyLocalPending();
  await testConfirmationBoundaryRaceRequeuesUntilNextBoundary();
  await testExecutionResultBoundaryRaceRequeuesWithoutPreemption();
  await testBusyContinuationCannotRestoreAnEarlierDirection();
  await testSameMillisecondRequestsUseSequenceForBusyContinuation();
  await testOlderSuccessFailureAndThrowDoNotTouchNewerPending();
  await testLatestDirectionWinsWithinOnePageAndOldModalIsStale();
  await testQueuedConfirmationChecksLatestRequestBeforeExecuting();
  await testStaleConfirmationCancelCannotClearNewerIntent();
  await testConfirmedExecutionDoesNotBlockNewIntentRegistration();
  await testUnbindDuringConfirmedExecutionReleasesNewLifecycleQueue();
  await testReloadDoesNotRestorePageLocalPending();
  await testIndependentCoordinatorsDoNotSharePageLocalPending();
  await testNoSessionStorageDependency();
  await testNoManualJournalOrDecisionLockIsNeeded();
  testLegacyManualJournalIsObsoletedWithoutTouchingOtherSyncState();
  await testSettingsDisableClearsOnlyLocalIntent();
  await testLocalPriorityGateOnlyBlocksThisCoordinator();
  await testExplicitUnbindClearsPageLocalIntent();
  await testUnbindClearsPageLocalIntentEvenWhenNotBound();
  await testUnbindInvalidatesInFlightContinuationAndTimerFinally();
  await testQueuedTaskCannotRecreateStateAfterUnbind();
  await testRebindCannotAdmitOldContinuation();
  await testConfirmationCallbackCannotRunAfterUnbind();
  await testCrossTabExecutionLockStillRemainsShared();
  await testLocalStaleTimeoutClearsPendingWithoutTimer();
  testNeutralForegroundProbeRemainsNeutral();
  console.log("[manual-sync-intent-priority] page-local manual priority verified.");
};

const testSilentExpiryWakesManualIntent = async () => {
  for (const direction of ["push", "pull"]) {
    const { hooks } = createHarness();
    let now = 1_000_000;
    let expiresAt = now + 4300;
    let nextId = 0;
    const timers = new Map();
    const runtime = createCoordinator(hooks, {
      activeExecution: true,
      timerAdapters: {
        getActiveLock: () => expiresAt > now ? { expiresAt } : null,
        setTimeout: (callback, delay) => {
          const id = ++nextId;
          timers.set(id, { callback, at: now + delay });
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
    });
    const advance = async (target) => {
      now = target;
      runtime.setNow(now);
      runtime.setActiveExecution(expiresAt > now);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          await timer.callback();
        }
      }
    };
    await runtime.coordinator.request(direction);
    assert.equal(timers.size, 1, "排队必须有独立唤醒，锁自然过期不会触发 GM 通知");
    // Owner renews without delivering a storage notification.
    expiresAt += 5000;
    await advance(1_004_400);
    assert.equal(runtime.confirmations.length, 0, "续租不能被强行抢占");
    assert.equal(timers.size, 1);
    await advance(1_009_400);
    assert.equal(runtime.confirmations.length, 1, "无点击/焦点/storage 事件也应弹出确认");
    assert.equal(runtime.executions.length, 0);
    await runtime.coordinator.reconcile("duplicate_checkpoint");
    assert.equal(runtime.confirmations.length, 1);
    await runtime.confirmations[0].actions.onCancel();
    assert.equal(timers.size, 0);
    runtime.setActiveExecution(true);
    expiresAt = now + 1000;
    await runtime.coordinator.request(direction);
    runtime.coordinator.handleLifecycle("pagehide");
    assert.equal(timers.size, 0, "离开页面必须取消计时器");
    await advance(now + 2000);
    await runtime.coordinator.handleLifecycle("pageshow");
    assert.equal(runtime.confirmations.length, 2, "BFCache 返回后恢复检查");
    runtime.coordinator.unbind();
    assert.equal(timers.size, 0);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
