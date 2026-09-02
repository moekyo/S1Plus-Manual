#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const MANUAL_SYNC_INTENT_KEY = "s1p_pending_manual_sync_intent";

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露手动同步意图测试钩子。",
  });

const createCoordinator = (hooks, options = {}) => {
  let activeExecution = options.activeExecution === true;
  let syncEnabled = options.syncEnabled !== false;
  let now = options.now || Date.now();
  const confirmations = [];
  const executions = [];
  const indicatorUpdates = [];
  const dismissCalls = [];
  const ownerRecoveryTasks = [];

  const coordinator = hooks.s1pCreateManualSyncIntentCoordinator({
    ownerId: options.ownerId || "tab-a",
    sourceContextId: options.sourceContextId || options.ownerId || "context-a",
    now: () => now,
    isSyncEnabled: () => syncEnabled,
    hasActiveExecution: () => activeExecution,
    onQueued: (intent) => indicatorUpdates.push({ type: "queued", intent }),
    setIndicatorPending: (intent) =>
      indicatorUpdates.push({ type: "pending", intent }),
    refreshDisplay: () => indicatorUpdates.push({ type: "refresh" }),
    scheduleOwnerRecovery: (delayMs, callback, context) => {
      const task = {
        delayMs,
        callback,
        context: toPlainObject(context),
        cancelled: false,
      };
      ownerRecoveryTasks.push(task);
      return {
        cancel: () => {
          task.cancelled = true;
        },
      };
    },
    execute: async (direction, intent) => {
      executions.push({ direction, intent: toPlainObject(intent) });
      return { status: "success", action: `manual_${direction}` };
    },
    showConfirmation: (intent, actions) => {
      confirmations.push({ intent: toPlainObject(intent), actions });
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
    ownerRecoveryTasks,
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

const readIntent = (store) => toPlainObject(store.get(MANUAL_SYNC_INTENT_KEY));

const testImmediateManualOperationDoesNotConfirm = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: false });

  const result = await runtime.coordinator.request("push");

  assert.equal(result.status, "success");
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "push");
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
};

const testBusyManualOperationIsDurableAndProjectsDirection = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  const result = await runtime.coordinator.request("push");
  const intent = readIntent(store);
  const projected = toPlainObject(
    hooks.s1pSyncSystem.readState({ surface: "navbar" })
  );

  assert.equal(result.status, "queued");
  assert.equal(intent.direction, "push");
  assert.equal(intent.phase, "queued_waiting_for_execution_boundary");
  assert.equal(projected.displayPhase, "pending");
  assert.equal(projected.displayOperation, "push");
  assert.equal(projected.displaySource, "manual_sync");
  assert.equal(hooks.getAutoSyncIndicatorTitle(projected), "自动同步：推送待执行");
  assert.match(
    hooks.getAutoSyncIndicatorTooltip(projected),
    /当前同步完成后将再次确认/
  );
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(store.has("s1p_sync_global_lock"), false);
};

const testBoundaryShowsConfirmationWithoutExecutionLock = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  const boundaryResult = await runtime.coordinator.reconcile("lock_released");
  const intent = readIntent(store);

  assert.equal(boundaryResult.phase, "awaiting_confirmation");
  assert.equal(intent.phase, "awaiting_confirmation");
  assert.equal(runtime.confirmations.length, 1);
  assert.equal(store.has("s1p_sync_global_lock"), false);
  assert.equal(store.has("s1p_manual_sync_lock"), false);
};

const testInternalDismissDoesNotCancelRequeuedIntent = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  runtime.setActiveExecution(true);
  const result = await runtime.coordinator.reconcile("execution_restarted");

  assert.equal(result.phase, "queued_waiting_for_execution_boundary");
  assert.equal(readIntent(store).phase, "queued_waiting_for_execution_boundary");
  assert.equal(runtime.dismissCalls.length, 1);
  assert.equal(runtime.dismissCalls[0].invokeDismiss, false);
};

const testConfirmationExecutesLatestStateAndSettlesExactIntent = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  const confirmation = runtime.confirmations[0];
  const result = await confirmation.actions.onConfirm();

  assert.equal(result.status, "success");
  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "push");
  assert.equal(
    runtime.executions[0].intent.requestId,
    confirmation.intent.requestId
  );
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
};

const testCancelDoesNotDeleteUnrelatedPendingDirty = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });
  store.set("s1p_pending_auto_sync_request", {
    version: 1,
    source: "read_progress",
    lastModified: 100,
    createdAt: 100,
  });

  await runtime.coordinator.request("pull");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  await runtime.confirmations[0].actions.onCancel();

  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
  assert.equal(store.has("s1p_pending_auto_sync_request"), true);
  assert.equal(runtime.executions.length, 0);
};

const testLatestDirectionSupersedesOlderGeneration = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  const firstIntent = readIntent(store);
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const firstConfirmation = runtime.confirmations[0];

  await runtime.coordinator.request("pull");
  const secondIntent = readIntent(store);
  assert.notEqual(secondIntent.requestId, firstIntent.requestId);
  assert.equal(secondIntent.direction, "pull");
  assert.equal(runtime.confirmations.length, 2);

  await firstConfirmation.actions.onCancel();
  assert.equal(readIntent(store).requestId, secondIntent.requestId);
  await runtime.confirmations[1].actions.onConfirm();

  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "pull");
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
};

const testOneConfirmationOwnerAcrossContexts = async () => {
  const { hooks, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
  });

  await first.coordinator.request("pull");
  first.setActiveExecution(false);
  second.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  await second.coordinator.reconcile("cross_context_intent");

  assert.equal(first.confirmations.length + second.confirmations.length, 1);
  assert.equal(readIntent(store).phase, "awaiting_confirmation");
};

const testConfirmationOwnerTeardownAndLeaseRecovery = async () => {
  const { hooks, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
  });

  await first.coordinator.request("pull");
  first.setActiveExecution(false);
  second.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  await second.coordinator.reconcile("foreign_owner");

  assert.equal(second.confirmations.length, 0);
  assert.equal(second.ownerRecoveryTasks.length, 1);
  assert.equal(second.ownerRecoveryTasks[0].cancelled, false);

  const ownerExpiresAt = readIntent(store).confirmationOwnerExpiresAt;
  second.setNow(ownerExpiresAt + 51);
  await second.ownerRecoveryTasks[0].callback();
  await second.coordinator.reconcile("owner_expired");

  assert.equal(second.confirmations.length, 1);
  assert.equal(readIntent(store).confirmationOwnerId, "tab-b");
  await first.coordinator.reconcile("owner_replaced");
  assert.equal(first.dismissCalls[0].invokeDismiss, false);
};

const testSettingsDisableCancelsPriorityGate = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, { activeExecution: true });

  await runtime.coordinator.request("push");
  runtime.setSyncEnabled(false);
  await runtime.coordinator.reconcile("settings_disabled");

  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const run = async () => {
  await testImmediateManualOperationDoesNotConfirm();
  await testBusyManualOperationIsDurableAndProjectsDirection();
  await testBoundaryShowsConfirmationWithoutExecutionLock();
  await testInternalDismissDoesNotCancelRequeuedIntent();
  await testConfirmationExecutesLatestStateAndSettlesExactIntent();
  await testCancelDoesNotDeleteUnrelatedPendingDirty();
  await testLatestDirectionSupersedesOlderGeneration();
  await testOneConfirmationOwnerAcrossContexts();
  await testConfirmationOwnerTeardownAndLeaseRecovery();
  await testSettingsDisableCancelsPriorityGate();
  console.log("[manual-sync-intent-priority] manual priority lifecycle verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
