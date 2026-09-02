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
  await testImmediateManualPushAndPullDoNotConfirm();
  await testBusyManualPushProjectsPageLocalPending();
  await testBusyManualPullProjectsPageLocalPending();
  await testExecutionBoundaryShowsConfirmationWithoutExecutionLock();
  await testConfirmationCallsExistingForceDirectionAndSettles();
  await testCancelClearsOnlyLocalPending();
  await testConfirmationBoundaryRaceRequeuesUntilNextBoundary();
  await testExecutionResultBoundaryRaceRequeuesWithoutPreemption();
  await testLatestDirectionWinsWithinOnePageAndOldModalIsStale();
  await testReloadDoesNotRestorePageLocalPending();
  await testIndependentCoordinatorsDoNotSharePageLocalPending();
  await testNoSessionStorageDependency();
  await testNoManualJournalOrDecisionLockIsNeeded();
  testLegacyManualJournalIsObsoletedWithoutTouchingOtherSyncState();
  await testSettingsDisableClearsOnlyLocalIntent();
  await testLocalPriorityGateOnlyBlocksThisCoordinator();
  await testExplicitUnbindClearsPageLocalIntent();
  await testUnbindClearsPageLocalIntentEvenWhenNotBound();
  await testCrossTabExecutionLockStillRemainsShared();
  await testLocalStaleTimeoutClearsPendingWithoutTimer();
  testNeutralForegroundProbeRemainsNeutral();
  console.log("[manual-sync-intent-priority] page-local manual priority verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
