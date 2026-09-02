#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const MANUAL_SYNC_INTENT_KEY = "s1p_pending_manual_sync_intent";
const MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX =
  `${MANUAL_SYNC_INTENT_KEY}:`;

const getIntentRecordKey = (eventId) =>
  `${MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX}${encodeURIComponent(eventId)}`;

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
  const executionAuthorityReleases = [];
  let decisionAuthorityCounter = 0;
  let executionAuthorityCounter = 0;

  const coordinatorOptions = {
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
    beforeDecisionAuthority: options.beforeDecisionAuthority,
    withDecisionAuthority:
      options.withDecisionAuthority ||
      options.decisionAuthority ||
      ((run) =>
        run({
          token: `test-decision:${
            options.ownerId || "tab-a"
          }:${++decisionAuthorityCounter}`,
        })),
    acquireExecutionAuthority:
      options.acquireExecutionAuthority ||
      (async () => ({
        mode: "manual",
        ownerId: options.ownerId || "tab-a",
        token: `test-execution:${
          options.ownerId || "tab-a"
        }:${++executionAuthorityCounter}`,
        timestamp: now,
        ttlMs: 180_000,
      })),
    releaseExecutionAuthority:
      options.releaseExecutionAuthority ||
      (async (authority) => {
        executionAuthorityReleases.push(toPlainObject(authority));
      }),
    execute: async (direction, intent, executeOptions = {}) => {
      if (typeof options.beforeExecute === "function") {
        await options.beforeExecute({
          direction,
          intent: toPlainObject(intent),
          executionAuthority: toPlainObject(
            executeOptions.manualExecutionAuthority || null
          ),
        });
      }
      if (options.executeGate) {
        await options.executeGate;
      }
      executions.push({
        direction,
        intent: toPlainObject(intent),
        executionAuthority: toPlainObject(
          executeOptions.manualExecutionAuthority || null
        ),
      });
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
  };
  if (options.useProductionDecisionAuthority === true) {
    delete coordinatorOptions.withDecisionAuthority;
  }
  const coordinator = hooks.s1pCreateManualSyncIntentCoordinator(
    coordinatorOptions
  );

  return {
    coordinator,
    confirmations,
    executions,
    indicatorUpdates,
    dismissCalls,
    ownerRecoveryTasks,
    executionAuthorityReleases,
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

const createDeferred = () => {
  let resolve;
  const promise = new Promise((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

const createSerializedDecisionAuthority = () => {
  let tail = Promise.resolve();
  let commitSequence = 0;
  return (run) => {
    const next = tail
      .catch(() => {})
      .then(() =>
        run({ token: `test-serialized-decision:${++commitSequence}` })
      );
    tail = next.catch(() => {});
    return next;
  };
};

const createFakeWebLocks = () => {
  let tail = Promise.resolve();
  let requestCount = 0;
  return {
    get requestCount() {
      return requestCount;
    },
    request(name, options, callback) {
      assert.equal(name, "s1p_manual_sync_intent_decision");
      assert.equal(options.mode, "exclusive");
      requestCount += 1;
      const next = tail
        .catch(() => {})
        .then(() => callback());
      tail = next.catch(() => {});
      return next;
    },
  };
};

const readIntent = (store) => toPlainObject(store.get(MANUAL_SYNC_INTENT_KEY));

const getJournalRecords = (store) =>
  Array.from(store.entries())
    .filter(([key]) => String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX))
    .map(([, value]) => value)
    .filter((value) => value && typeof value === "object");

const findJournalRecord = (store, predicate) =>
  getJournalRecords(store).find(predicate) || null;

const createTransitionRecord = (parent, overrides = {}) => {
  const transitionAt =
    Number(overrides.transitionAt) || Number(parent.transitionAt) || 1;
  const eventId = overrides.eventId || `test-transition:${transitionAt}`;
  const transitionKind = overrides.transitionKind || "state";
  const terminal = overrides.terminal === true;
  return {
    ...parent,
    ...overrides,
    version: 2,
    recordType: "transition",
    eventId,
    parentEventId: parent.eventId,
    expectedHeadEventId: parent.eventId,
    sequence: parent.sequence + 1,
    terminal,
    transitionKind,
    transitionSourceContextId:
      overrides.transitionSourceContextId || "context-test",
    transitionAt,
  };
};

const writeTransitionRecord = (setValue, record) => {
  setValue(getIntentRecordKey(record.eventId), record);
  return record;
};

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

const testOldOwnerCallbacksCannotActAfterSameGenerationTakeover = async () => {
  const { hooks, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  second.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  const oldConfirmation = first.confirmations[0];
  const ownerExpiresAt = readIntent(store).confirmationOwnerExpiresAt;

  second.setNow(ownerExpiresAt + 51);
  await second.coordinator.reconcile("owner_expired");

  const takenOver = readIntent(store);
  assert.equal(second.confirmations.length, 1);
  assert.equal(takenOver.requestId, oldConfirmation.intent.requestId);
  assert.equal(takenOver.confirmationOwnerId, "tab-b");
  assert.notEqual(
    takenOver.confirmationOwnerToken,
    oldConfirmation.intent.confirmationOwnerToken
  );

  const cancelResult = await oldConfirmation.actions.onCancel();
  const confirmResult = await oldConfirmation.actions.onConfirm();
  assert.equal(cancelResult.reason, "stale_manual_intent");
  assert.equal(confirmResult.reason, "stale_manual_intent");
  assert.equal(readIntent(store).requestId, oldConfirmation.intent.requestId);
  assert.equal(first.executions.length, 0);
};

const testOwnerTokenTakeoverRemountsTheConfirmation = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const oldConfirmation = runtime.confirmations[0];
  const ownerExpiresAt = readIntent(store).confirmationOwnerExpiresAt;

  runtime.setNow(ownerExpiresAt + 51);
  await runtime.coordinator.reconcile("owner_expired");

  const latest = readIntent(store);
  assert.equal(runtime.confirmations.length, 2);
  assert.equal(runtime.dismissCalls[0].invokeDismiss, false);
  assert.notEqual(
    latest.confirmationOwnerToken,
    oldConfirmation.intent.confirmationOwnerToken
  );
  const staleResult = await oldConfirmation.actions.onCancel();
  assert.equal(staleResult.reason, "stale_manual_intent");
  assert.equal(readIntent(store).requestId, oldConfirmation.intent.requestId);
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

const testStaleDeleteCannotRemoveNewerIntent = async () => {
  const { hooks, sandbox } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  const firstIntent = first.coordinator.readIntent();
  const originalDeleteValue = sandbox.GM_deleteValue;
  let injected = false;
  let injectedRequest = null;
  sandbox.GM_deleteValue = (key) => {
    if (key === MANUAL_SYNC_INTENT_KEY && !injected) {
      injected = true;
      injectedRequest = second.coordinator.request("pull");
    }
    return originalDeleteValue(key);
  };

  let result;
  try {
    result = await first.coordinator.cancel(firstIntent);
    await injectedRequest;
  } finally {
    sandbox.GM_deleteValue = originalDeleteValue;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(latest.direction, "pull");
  assert.notEqual(latest.requestId, firstIntent.requestId);
};

const testStalePersistCannotOverwriteNewerIntent = async () => {
  const { hooks, sandbox } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  second.setActiveExecution(true);
  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  let injectedRequest = null;
  sandbox.GM_setValue = (key, value) => {
    if (
      (key === MANUAL_SYNC_INTENT_KEY ||
        String(key).startsWith(`${MANUAL_SYNC_INTENT_KEY}:`)) &&
      !injected
    ) {
      injected = true;
      injectedRequest = second.coordinator.request("pull");
    }
    return originalSetValue(key, value);
  };

  let result;
  try {
    result = await first.coordinator.reconcile("lock_released");
    await injectedRequest;
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(latest.direction, "pull");
  assert.equal(latest.requestId.startsWith("context-b_"), true);
};

const testConfirmationOwnerClaimUsesOneDeterministicWinner = async () => {
  const { hooks, sandbox } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  second.setActiveExecution(false);

  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      (key === MANUAL_SYNC_INTENT_KEY ||
        String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX)) &&
      value?.phase === "awaiting_confirmation"
    ) {
      injected = true;
      const competingOwner = {
        ...value,
        recordType: value.recordType || undefined,
        eventId: "transition:context-b:1000000:1:owner-b",
        confirmationOwnerId: "tab-b",
        confirmationOwnerToken: "owner-token-b",
        confirmationOwnerClaimedAt: 1_000_000,
        transitionKind: "confirmation_owner_claim",
        transitionSourceContextId: "context-b",
        transitionAt: 1_000_000,
      };
      if (String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX)) {
        originalSetValue(
          getIntentRecordKey(competingOwner.eventId),
          {
            ...competingOwner,
            recordType: "transition",
            parentEventId: value.parentEventId,
            sequence: value.sequence,
          }
        );
      } else {
        originalSetValue(key, competingOwner);
      }
    }
    return originalSetValue(key, value);
  };

  try {
    await first.coordinator.reconcile("lock_released");
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }
  await second.coordinator.reconcile("competing_owner_claim");

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(first.confirmations.length, 0);
  assert.equal(second.confirmations.length, 1);
  assert.equal(latest.confirmationOwnerId, "tab-b");
  assert.equal(latest.confirmationOwnerToken, "owner-token-b");
};

const testOldOwnerTeardownCannotMutateNewerDirection = async () => {
  const { hooks, sandbox } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  second.setActiveExecution(true);
  await first.coordinator.reconcile("lock_released");

  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  let injectedRequest = null;
  sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      (key === MANUAL_SYNC_INTENT_KEY ||
        String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX))
    ) {
      injected = true;
      injectedRequest = second.coordinator.request("pull");
    }
    return originalSetValue(key, value);
  };

  try {
    await first.coordinator.handleLifecycle("pagehide");
    await injectedRequest;
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(latest.direction, "pull");
  assert.equal(latest.requestId.startsWith("context-b_"), true);
  await first.confirmations[0].actions.onCancel();
  assert.equal(first.coordinator.readIntent().requestId, latest.requestId);
};

const testOldConfirmationCannotExecuteAfterNewDirection = async () => {
  const { hooks, sandbox } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  second.setActiveExecution(true);

  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  let injectedRequest = null;
  sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      (key === MANUAL_SYNC_INTENT_KEY ||
        String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX)) &&
      value?.phase === "executing"
    ) {
      injected = true;
      injectedRequest = second.coordinator.request("pull");
    }
    return originalSetValue(key, value);
  };

  let result;
  try {
    result = await first.confirmations[0].actions.onConfirm();
    await injectedRequest;
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(first.executions.length, 0);
  assert.equal(latest.direction, "pull");
};

const testStaleOwnerReleaseCannotRebaseOntoNewerHead = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  const initial = readIntent(store);
  const head = findJournalRecord(
    store,
    (record) =>
      record.recordType === "transition" &&
      record.transitionKind === "confirmation_owner_claim" &&
      record.confirmationOwnerId === "tab-a"
  );
  const ownerExpiresAt = initial.confirmationOwnerExpiresAt;
  const originalListValues = sandbox.GM_listValues;
  const originalSetValue = sandbox.GM_setValue;
  let listCalls = 0;
  let injected = false;
  sandbox.GM_listValues = () => {
    listCalls += 1;
    if (listCalls === 2 && !injected) {
      injected = true;
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(head, {
          eventId: "transition:context-b:takeover-after-release-read",
          phase: "awaiting_confirmation",
          confirmationOwnerId: "tab-b",
          confirmationOwnerToken: "owner-token-b",
          confirmationOwnerExpiresAt: ownerExpiresAt + 10_000,
          confirmationOwnerClaimedAt: ownerExpiresAt + 1,
          transitionKind: "confirmation_owner_claim",
          transitionSourceContextId: "context-b",
          transitionAt: ownerExpiresAt + 1,
          expectedConfirmationOwnerToken: initial.confirmationOwnerToken,
        })
      );
    }
    return originalListValues();
  };

  try {
    await runtime.coordinator.handleLifecycle("pagehide");
  } finally {
    sandbox.GM_listValues = originalListValues;
  }

  const latest = runtime.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(latest.direction, "push");
  assert.equal(latest.confirmationOwnerId, "tab-b");
  assert.equal(latest.confirmationOwnerToken, "owner-token-b");
  assert.equal(
    getJournalRecords(store).some(
      (record) => record.transitionKind === "confirmation_owner_release"
    ),
    false
  );
};

const testStaleConfirmCannotRebaseExecutingTransitionOntoNewerHead = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  const initial = readIntent(store);
  const head = findJournalRecord(
    store,
    (record) =>
      record.recordType === "transition" &&
      record.transitionKind === "confirmation_owner_claim" &&
      record.confirmationOwnerId === "tab-a"
  );
  const ownerExpiresAt = initial.confirmationOwnerExpiresAt;
  const originalListValues = sandbox.GM_listValues;
  const originalSetValue = sandbox.GM_setValue;
  let listCalls = 0;
  let injected = false;
  sandbox.GM_listValues = () => {
    listCalls += 1;
    if (listCalls === 2 && !injected) {
      injected = true;
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(head, {
          eventId: "transition:context-b:takeover-before-confirm-append",
          phase: "awaiting_confirmation",
          confirmationOwnerId: "tab-b",
          confirmationOwnerToken: "owner-token-b",
          confirmationOwnerExpiresAt: ownerExpiresAt + 10_000,
          confirmationOwnerClaimedAt: ownerExpiresAt + 1,
          transitionKind: "confirmation_owner_claim",
          transitionSourceContextId: "context-b",
          transitionAt: ownerExpiresAt + 1,
          expectedConfirmationOwnerToken: initial.confirmationOwnerToken,
        })
      );
    }
    return originalListValues();
  };

  let result;
  try {
    result = await runtime.confirmations[0].actions.onConfirm();
  } finally {
    sandbox.GM_listValues = originalListValues;
  }

  const latest = runtime.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(runtime.executions.length, 0);
  assert.equal(latest.direction, "push");
  assert.equal(latest.phase, "awaiting_confirmation");
  assert.equal(latest.confirmationOwnerId, "tab-b");
  assert.equal(latest.confirmationOwnerToken, "owner-token-b");
  assert.equal(
    getJournalRecords(store).some(
      (record) => record.transitionKind === "executing"
    ),
    false
  );
};

const testStaleOwnerClaimCannotRegressExecutingHead = async () => {
  const { hooks, sandbox, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  const initialHead = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  const originalListValues = sandbox.GM_listValues;
  const originalSetValue = sandbox.GM_setValue;
  let listCalls = 0;
  let injected = false;
  sandbox.GM_listValues = () => {
    listCalls += 1;
    if (listCalls === 2 && !injected) {
      injected = true;
      const ownerTokenA = "owner-token-a";
      const ownerClaim = writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(initialHead, {
          eventId: "transition:context-a:claim-before-stale-recovery",
          phase: "awaiting_confirmation",
          confirmationOwnerId: "tab-a",
          confirmationOwnerToken: ownerTokenA,
          confirmationOwnerExpiresAt: 1_020_000,
          confirmationOwnerClaimedAt: 1_000_000,
          transitionKind: "confirmation_owner_claim",
          transitionSourceContextId: "context-a",
          transitionAt: 1_000_000,
          expectedConfirmationOwnerToken: "",
        })
      );
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(ownerClaim, {
          eventId: "transition:context-a:executing-before-stale-recovery",
          phase: "executing",
          confirmationOwnerId: "",
          confirmationOwnerToken: "",
          confirmationOwnerExpiresAt: 0,
          confirmationOwnerClaimedAt: 0,
          executionOwnerId: "tab-a",
          executionStartedAt: 1_000_001,
          executionExpiresAt: 1_030_001,
          transitionKind: "executing",
          transitionSourceContextId: "context-a",
          transitionAt: 1_000_001,
          expectedConfirmationOwnerToken: ownerTokenA,
        })
      );
    }
    return originalListValues();
  };

  let result;
  try {
    result = await second.coordinator.reconcile("stale_owner_claim");
  } finally {
    sandbox.GM_listValues = originalListValues;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(latest.phase, "executing");
  assert.equal(latest.executionOwnerId, "tab-a");
  assert.equal(second.confirmations.length, 0);
};

const testStaleRequeueCannotResurrectTerminalHead = async () => {
  const { hooks, sandbox, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  const initial = readIntent(store);
  const head = findJournalRecord(
    store,
    (record) =>
      record.recordType === "transition" &&
      record.transitionKind === "confirmation_owner_claim" &&
      record.confirmationOwnerId === "tab-a"
  );
  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX) &&
      value?.transitionKind === "queued"
    ) {
      injected = true;
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(head, {
          eventId: "transition:context-a:terminal-before-stale-requeue",
          phase: "awaiting_confirmation",
          confirmationOwnerId: initial.confirmationOwnerId,
          confirmationOwnerToken: initial.confirmationOwnerToken,
          confirmationOwnerExpiresAt: initial.confirmationOwnerExpiresAt,
          confirmationOwnerClaimedAt: initial.confirmationOwnerClaimedAt,
          terminal: true,
          transitionKind: "settle",
          transitionSourceContextId: "context-a",
          transitionAt: Number(value.transitionAt) - 1,
          expectedConfirmationOwnerToken: initial.confirmationOwnerToken,
        })
      );
    }
    return originalSetValue(key, value);
  };

  let result;
  try {
    result = await second.coordinator.reconcile("execution_boundary_busy");
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  const latest = first.coordinator.readIntent();
  assert.equal(injected, true);
  assert.equal(result.reason, "stale_manual_intent");
  assert.equal(latest, null);
  assert.equal(second.confirmations.length, 0);
  assert.equal(second.executions.length, 0);
};

const testCanonicalUserConfirmBeatsValidLateOwnerTakeoverSibling = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  const initial = readIntent(store);
  const head = findJournalRecord(
    store,
    (record) =>
      record.recordType === "transition" &&
      record.transitionKind === "confirmation_owner_claim" &&
      record.confirmationOwnerId === "tab-a"
  );
  const ownerExpiresAt = initial.confirmationOwnerExpiresAt;
  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  sandbox.GM_setValue = (key, value) => {
    if (
      !injected &&
      String(key).startsWith(MANUAL_SYNC_INTENT_RECORD_KEY_PREFIX) &&
      value?.transitionKind === "executing"
    ) {
      injected = true;
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(head, {
          eventId: "transition:context-b:late-valid-owner-takeover",
          phase: "awaiting_confirmation",
          confirmationOwnerId: "tab-b",
          confirmationOwnerToken: "owner-token-b",
          confirmationOwnerExpiresAt: ownerExpiresAt + 10_000,
          confirmationOwnerClaimedAt: ownerExpiresAt + 1,
          transitionKind: "confirmation_owner_claim",
          transitionSourceContextId: "context-b",
          transitionAt: ownerExpiresAt + 1,
          expectedConfirmationOwnerToken: initial.confirmationOwnerToken,
        })
      );
    }
    return originalSetValue(key, value);
  };

  let result;
  try {
    result = await runtime.confirmations[0].actions.onConfirm();
  } finally {
    sandbox.GM_setValue = originalSetValue;
  }

  assert.equal(injected, true);
  assert.equal(result.status, "success");
  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "push");
  assert.equal(runtime.coordinator.readIntent(), null);
};

const testExecutingDecisionCannotBeOverriddenByLateTerminalSibling = async () => {
  const { hooks, sandbox, store } = createHarness();
  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
    beforeExecute: () => {
      if (injected) {
        return;
      }
      injected = true;
      const executing = findJournalRecord(
        store,
        (record) => record.transitionKind === "executing"
      );
      assert.ok(executing);
      const parent = findJournalRecord(
        store,
        (record) => record.eventId === executing.parentEventId
      );
      assert.ok(parent);
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(parent, {
          eventId: "transition:context-b:late-terminal-after-executing",
          phase: parent.phase,
          confirmationOwnerId: parent.confirmationOwnerId,
          confirmationOwnerToken: parent.confirmationOwnerToken,
          confirmationOwnerExpiresAt: parent.confirmationOwnerExpiresAt,
          confirmationOwnerClaimedAt: parent.confirmationOwnerClaimedAt,
          terminal: true,
          transitionKind: "settle",
          transitionSourceContextId: "context-b",
          transitionAt: Number(executing.transitionAt) + 1,
          expectedConfirmationOwnerToken: parent.confirmationOwnerToken,
          decisionCommitKind: "",
          decisionCommitToken: "",
        })
      );
      const canonicalBeforeSideEffect = runtime.coordinator.readIntent();
      assert.equal(canonicalBeforeSideEffect.phase, "executing");
    },
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const result = await runtime.confirmations[0].actions.onConfirm();

  sandbox.GM_setValue = originalSetValue;
  assert.equal(injected, true);
  assert.equal(result.status, "success");
  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "push");
};

const testExecutingFirstStaleCancelCannotOverrideCommittedExecution = async () => {
  const { hooks, store } = createHarness();
  const authority = createSerializedDecisionAuthority();
  const cancelReady = createDeferred();
  const cancelRelease = createDeferred();
  const executionStarted = createDeferred();
  const executionRelease = createDeferred();
  let pauseCancel = true;
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    withDecisionAuthority: authority,
    executeGate: executionRelease.promise,
    beforeExecute: () => executionStarted.resolve(),
  });
  const second = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-a",
    sourceContextId: "context-b",
    withDecisionAuthority: authority,
    beforeDecisionAuthority: ({ operation }) => {
      if (operation === "terminal" && pauseCancel) {
        pauseCancel = false;
        cancelReady.resolve();
        return cancelRelease.promise;
      }
      return undefined;
    },
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  const oldConfirmation = first.confirmations[0];
  const staleCancel = second.coordinator.cancel(oldConfirmation.intent);
  await cancelReady.promise;

  const confirmPromise = oldConfirmation.actions.onConfirm();
  await executionStarted.promise;
  cancelRelease.resolve();
  const cancelResult = await staleCancel;

  assert.equal(cancelResult.reason, "stale_manual_intent");
  assert.equal(runtimeStatePhase(store), "executing");
  assert.equal(first.executions.length, 0);

  executionRelease.resolve();
  const confirmResult = await confirmPromise;
  assert.equal(confirmResult.status, "success");
  assert.equal(first.executions.length, 1);
  assert.equal(first.executions[0].executionAuthority.token.startsWith("test-execution:"), true);
  assert.equal(first.coordinator.readIntent(), null);
};

const testTerminalFirstStaleConfirmCannotOverrideCommittedTerminal = async () => {
  const { hooks, store } = createHarness();
  const authority = createSerializedDecisionAuthority();
  const confirmReady = createDeferred();
  const confirmRelease = createDeferred();
  let pauseConfirm = true;
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    withDecisionAuthority: authority,
    beforeDecisionAuthority: ({ operation }) => {
      if (operation === "executing" && pauseConfirm) {
        pauseConfirm = false;
        confirmReady.resolve();
        return confirmRelease.promise;
      }
      return undefined;
    },
  });
  const second = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-a",
    sourceContextId: "context-b",
    withDecisionAuthority: authority,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  const oldConfirmation = first.confirmations[0];
  const staleConfirm = oldConfirmation.actions.onConfirm();
  await confirmReady.promise;

  const cancelResult = await second.coordinator.cancel(oldConfirmation.intent);
  assert.equal(cancelResult.status, "cancelled");
  confirmRelease.resolve();
  const confirmResult = await staleConfirm;

  assert.equal(confirmResult.reason, "stale_manual_intent");
  assert.equal(first.executions.length, 0);
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
  assert.equal(first.coordinator.readIntent(), null);
};

const testBusyBeforeIrreversibleExecutionCommitRequeuesWithoutSideEffect = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    acquireExecutionAuthority: async () => null,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const result = await runtime.confirmations[0].actions.onConfirm();

  assert.equal(result.status, "queued");
  assert.equal(result.reason, "execution_boundary_busy");
  assert.equal(runtime.executions.length, 0);
  assert.equal(runtime.coordinator.readIntent().phase, "queued_waiting_for_execution_boundary");
  assert.equal(
    getJournalRecords(store).some((record) => record.transitionKind === "executing"),
    false
  );
};

const testSettingsDisableDuringCommittedExecutionDoesNotCancelIt = async () => {
  const { hooks, store } = createHarness();
  const executionStarted = createDeferred();
  const executionRelease = createDeferred();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    executeGate: executionRelease.promise,
    beforeExecute: () => executionStarted.resolve(),
  });
  const observer = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    syncEnabled: false,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  const confirmPromise = runtime.confirmations[0].actions.onConfirm();
  await executionStarted.promise;

  const disabledResult = await observer.coordinator.reconcile("settings_disabled");
  assert.equal(disabledResult.status, "executing");
  assert.equal(runtime.coordinator.readIntent().phase, "executing");
  assert.equal(
    getJournalRecords(store).some(
      (record) => record.terminal && record.decisionCommitKind === "terminal"
    ),
    false
  );

  executionRelease.resolve();
  const result = await confirmPromise;
  assert.equal(result.status, "success");
  assert.equal(runtime.coordinator.readIntent(), null);
};

const testConfirmationOwnerClaimIsSerializedAcrossContexts = async () => {
  const { hooks, store } = createHarness();
  const authority = createSerializedDecisionAuthority();
  const firstClaimReady = createDeferred();
  const firstClaimRelease = createDeferred();
  let pauseFirstClaim = true;
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    withDecisionAuthority: authority,
    beforeDecisionAuthority: ({ operation }) => {
      if (operation === "confirmation_owner_claim" && pauseFirstClaim) {
        pauseFirstClaim = false;
        firstClaimReady.resolve();
        return firstClaimRelease.promise;
      }
      return undefined;
    },
  });
  const second = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    withDecisionAuthority: authority,
  });

  await first.coordinator.request("pull");
  first.setActiveExecution(false);
  second.setActiveExecution(false);
  const firstReconcile = first.coordinator.reconcile("lock_released");
  await firstClaimReady.promise;
  const secondReconcile = second.coordinator.reconcile("cross_context_claim");
  await secondReconcile;
  firstClaimRelease.resolve();
  await firstReconcile;

  assert.equal(first.confirmations.length, 0);
  assert.equal(second.confirmations.length, 1);
  assert.equal(readIntent(store).confirmationOwnerId, "tab-b");
  assert.equal(first.coordinator.readIntent().confirmationOwnerId, "tab-b");
};

const testSimultaneousExplicitRequestsUseSerializedAuthoritySequence = async () => {
  const { hooks, store } = createHarness();
  const authority = createSerializedDecisionAuthority();
  const firstRequestReady = createDeferred();
  const firstRequestRelease = createDeferred();
  let pauseFirstRequest = true;
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
    withDecisionAuthority: authority,
    beforeDecisionAuthority: ({ operation }) => {
      if (operation === "request" && pauseFirstRequest) {
        pauseFirstRequest = false;
        firstRequestReady.resolve();
        return firstRequestRelease.promise;
      }
      return undefined;
    },
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
    withDecisionAuthority: authority,
  });

  const firstRequest = first.coordinator.request("push");
  await firstRequestReady.promise;
  const secondRequest = await second.coordinator.request("pull");
  firstRequestRelease.resolve();
  await firstRequest;

  const latest = first.coordinator.readIntent();
  assert.equal(secondRequest.status, "queued");
  assert.equal(latest.direction, "push");
  assert.equal(latest.generation, 2);
  assert.equal(latest.requestId.startsWith("context-a_"), true);
  assert.equal(
    getJournalRecords(store).filter((record) => record.recordType === "request").length,
    2
  );
};

const testProductionDecisionAuthorityUsesWebLocks = async () => {
  const { hooks, sandbox, store } = createHarness();
  const locks = createFakeWebLocks();
  sandbox.navigator.locks = locks;
  sandbox.window.navigator.locks = locks;
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    useProductionDecisionAuthority: true,
  });

  const result = await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  assert.equal(result.status, "queued");
  assert.equal(runtime.confirmations.length, 1);
  assert.equal(locks.requestCount >= 2, true);
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), true);
};

const testProductionDecisionAuthorityFailsClosedWithoutWebLocks = async () => {
  const { hooks, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    useProductionDecisionAuthority: true,
  });

  const result = await runtime.coordinator.request("push");

  assert.equal(result.status, "failure");
  assert.equal(result.reason, "manual_intent_persist_failed");
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(
    getJournalRecords(store).some((record) => record.recordType === "request"),
    false
  );
};

const testAmbiguousIrreversibleDecisionBlocksRecoveryAndScheduling = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");

  const parent = findJournalRecord(
    store,
    (record) =>
      record.transitionKind === "confirmation_owner_claim" &&
      record.confirmationOwnerId === "tab-a"
  );
  assert.ok(parent);
  const originalSetValue = sandbox.GM_setValue;
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(parent, {
      eventId: "transition:context-a:committed-executing",
      phase: "executing",
      confirmationOwnerId: "",
      confirmationOwnerToken: "",
      confirmationOwnerExpiresAt: 0,
      confirmationOwnerClaimedAt: 0,
      executionOwnerId: "tab-a",
      executionStartedAt: 1_000_001,
      executionExpiresAt: 1_180_001,
      transitionKind: "executing",
      transitionSourceContextId: "context-a",
      expectedConfirmationOwnerToken: parent.confirmationOwnerToken,
      decisionCommitKind: "executing",
      decisionCommitToken: "decision-a",
      executionAuthorityToken: "execution-a",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(parent, {
      eventId: "transition:context-b:committed-terminal",
      phase: "awaiting_confirmation",
      terminal: true,
      transitionKind: "settle",
      transitionSourceContextId: "context-b",
      expectedConfirmationOwnerToken: parent.confirmationOwnerToken,
      decisionCommitKind: "terminal",
      decisionCommitToken: "decision-b",
    })
  );

  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), true);
  const reconcileResult = await runtime.coordinator.reconcile(
    "ambiguous_irreversible_decision"
  );
  assert.equal(reconcileResult.status, "blocked");
  assert.equal(reconcileResult.reason, "manual_intent_ambiguous");
  const requestResult = await runtime.coordinator.request("pull");
  assert.equal(requestResult.status, "failure");
  assert.equal(requestResult.reason, "manual_intent_ambiguous");
  assert.equal(runtime.executions.length, 0);
};

const runtimeStatePhase = (store) => {
  const state = getJournalRecords(store)
    .filter((record) => record.transitionKind === "executing")
    .sort((left, right) => right.sequence - left.sequence)[0];
  return state?.phase || "";
};

const testLateAncestorSiblingCannotDethroneExecutingBranch = async () => {
  const { hooks, sandbox, store } = createHarness();
  const originalSetValue = sandbox.GM_setValue;
  let injected = false;
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
    beforeExecute: () => {
      if (injected) {
        return;
      }
      injected = true;
      const root = findJournalRecord(
        store,
        (record) => record.recordType === "request"
      );
      writeTransitionRecord(
        originalSetValue,
        createTransitionRecord(root, {
          eventId: "transition:context-b:late-ancestor-owner-claim",
          phase: "awaiting_confirmation",
          confirmationOwnerId: "tab-b",
          confirmationOwnerToken: "owner-token-b",
          confirmationOwnerExpiresAt: 3_000_000,
          confirmationOwnerClaimedAt: 2_000_000,
          transitionKind: "confirmation_owner_claim",
          transitionSourceContextId: "context-b",
          transitionAt: 2_000_000,
          expectedConfirmationOwnerToken: "",
        })
      );
      const canonicalBeforeSideEffect = runtime.coordinator.readIntent();
      assert.equal(canonicalBeforeSideEffect.phase, "executing");
      assert.equal(canonicalBeforeSideEffect.executionOwnerId, "tab-a");
    },
  });

  await runtime.coordinator.request("push");
  runtime.setActiveExecution(false);
  await runtime.coordinator.reconcile("lock_released");
  assert.equal(runtime.confirmations.length, 1);

  const result = await runtime.confirmations[0].actions.onConfirm();

  assert.equal(injected, true);
  assert.equal(result.status, "success");
  assert.equal(runtime.executions.length, 1);
  assert.equal(runtime.executions[0].direction, "push");
  assert.equal(runtime.confirmations.length, 1);
  assert.equal(runtime.coordinator.readIntent(), null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
};

const testLateAncestorSiblingCannotResurrectTerminalBranch = async () => {
  const { hooks, sandbox, store } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: false,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 4_000_000,
  });

  await first.coordinator.request("push");
  first.setActiveExecution(false);
  await first.coordinator.reconcile("lock_released");
  const root = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  await first.confirmations[0].actions.onCancel();
  assert.equal(first.coordinator.readIntent(), null);

  const originalSetValue = sandbox.GM_setValue;
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-b:late-ancestor-after-terminal",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-b",
      confirmationOwnerToken: "owner-token-b",
      confirmationOwnerExpiresAt: 3_000_000,
      confirmationOwnerClaimedAt: 2_000_000,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-b",
      transitionAt: 2_000_000,
      expectedConfirmationOwnerToken: "",
    })
  );

  const result = await second.coordinator.reconcile(
    "late_ancestor_after_terminal"
  );

  assert.equal(result.status, "idle");
  assert.equal(second.confirmations.length, 0);
  assert.equal(second.coordinator.readIntent(), null);
  assert.equal(second.coordinator.isPriorityGateActive(), false);
  assert.equal(
    getJournalRecords(store).some(
      (record) => record.terminal && record.transitionKind === "settle"
    ),
    true
  );
};

const testExecutingDescendantBeatsQueuedAncestorSibling = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  const root = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  const originalSetValue = sandbox.GM_setValue;
  const ownerA = writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-a:owner-a-for-executing-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-a",
      confirmationOwnerToken: "owner-token-a",
      confirmationOwnerExpiresAt: 2_000_000,
      confirmationOwnerClaimedAt: 1_000_010,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-a",
      transitionAt: 1_000_010,
      expectedConfirmationOwnerToken: "",
    })
  );
  const ownerB = writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-b:owner-b-for-queued-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-b",
      confirmationOwnerToken: "owner-token-b",
      confirmationOwnerExpiresAt: 2_000_000,
      confirmationOwnerClaimedAt: 1_000_020,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-b",
      transitionAt: 1_000_020,
      expectedConfirmationOwnerToken: "",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(ownerA, {
      eventId: "transition:context-a:executing-descendant",
      phase: "executing",
      confirmationOwnerId: "",
      confirmationOwnerToken: "",
      confirmationOwnerExpiresAt: 0,
      confirmationOwnerClaimedAt: 0,
      executionOwnerId: "tab-a",
      executionStartedAt: 1_000_030,
      executionExpiresAt: 3_000_030,
      transitionKind: "executing",
      transitionSourceContextId: "context-a",
      transitionAt: 1_000_030,
      expectedConfirmationOwnerToken: "owner-token-a",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(ownerB, {
      eventId: "transition:context-b:queued-descendant",
      phase: "queued",
      confirmationOwnerId: "",
      confirmationOwnerToken: "",
      confirmationOwnerExpiresAt: 0,
      confirmationOwnerClaimedAt: 0,
      executionOwnerId: "",
      executionStartedAt: 0,
      executionExpiresAt: 0,
      transitionKind: "queued",
      transitionSourceContextId: "context-b",
      transitionAt: 1_000_040,
      expectedConfirmationOwnerToken: "owner-token-b",
    })
  );

  const latest = runtime.coordinator.readIntent();

  assert.equal(latest.phase, "executing");
  assert.equal(latest.executionOwnerId, "tab-a");
};

const testTerminalDescendantBeatsExecutingSiblingBranch = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  const root = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  const originalSetValue = sandbox.GM_setValue;
  const ownerA = writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-a:owner-a-for-terminal-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-a",
      confirmationOwnerToken: "owner-token-a",
      confirmationOwnerExpiresAt: 2_000_000,
      confirmationOwnerClaimedAt: 1_000_010,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-a",
      transitionAt: 1_000_010,
      expectedConfirmationOwnerToken: "",
    })
  );
  const ownerB = writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-b:owner-b-for-executing-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-b",
      confirmationOwnerToken: "owner-token-b",
      confirmationOwnerExpiresAt: 2_000_000,
      confirmationOwnerClaimedAt: 1_000_020,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-b",
      transitionAt: 1_000_020,
      expectedConfirmationOwnerToken: "",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(ownerA, {
      eventId: "transition:context-a:terminal-descendant",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-a",
      confirmationOwnerToken: "owner-token-a",
      terminal: true,
      transitionKind: "settle",
      transitionSourceContextId: "context-a",
      transitionAt: 1_000_030,
      expectedConfirmationOwnerToken: "owner-token-a",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(ownerB, {
      eventId: "transition:context-b:executing-descendant",
      phase: "executing",
      confirmationOwnerId: "",
      confirmationOwnerToken: "",
      confirmationOwnerExpiresAt: 0,
      confirmationOwnerClaimedAt: 0,
      executionOwnerId: "tab-b",
      executionStartedAt: 1_000_040,
      executionExpiresAt: 3_000_040,
      transitionKind: "executing",
      transitionSourceContextId: "context-b",
      transitionAt: 1_000_040,
      expectedConfirmationOwnerToken: "owner-token-b",
    })
  );

  const latest = runtime.coordinator.readIntent();

  assert.equal(latest, null);
  assert.equal(runtime.coordinator.isPriorityGateActive(), false);
  assert.equal(runtime.confirmations.length, 0);
};

const testInvalidFutureDescendantCannotElevateBranchAuthority = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  const root = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  const originalSetValue = sandbox.GM_setValue;
  const ownerA = writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-a:expired-owner-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-a",
      confirmationOwnerToken: "owner-token-a",
      confirmationOwnerExpiresAt: 1_000_015,
      confirmationOwnerClaimedAt: 1_000_010,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-a",
      transitionAt: 1_000_010,
      expectedConfirmationOwnerToken: "",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(root, {
      eventId: "transition:context-b:valid-owner-branch",
      phase: "awaiting_confirmation",
      confirmationOwnerId: "tab-b",
      confirmationOwnerToken: "owner-token-b",
      confirmationOwnerExpiresAt: 2_000_000,
      confirmationOwnerClaimedAt: 1_000_020,
      transitionKind: "confirmation_owner_claim",
      transitionSourceContextId: "context-b",
      transitionAt: 1_000_020,
      expectedConfirmationOwnerToken: "",
    })
  );
  writeTransitionRecord(
    originalSetValue,
    createTransitionRecord(ownerA, {
      eventId: "transition:context-a:invalid-expired-executing",
      phase: "executing",
      confirmationOwnerId: "",
      confirmationOwnerToken: "",
      confirmationOwnerExpiresAt: 0,
      confirmationOwnerClaimedAt: 0,
      executionOwnerId: "tab-a",
      executionStartedAt: 2_000_000,
      executionExpiresAt: 3_000_000,
      transitionKind: "executing",
      transitionSourceContextId: "context-a",
      transitionAt: 2_000_000,
      expectedConfirmationOwnerToken: "owner-token-a",
    })
  );

  const latest = runtime.coordinator.readIntent();

  assert.equal(latest.phase, "awaiting_confirmation");
  assert.equal(latest.confirmationOwnerId, "tab-b");
  assert.equal(latest.confirmationOwnerToken, "owner-token-b");
};

const testJournalPruneRetainsRootWhileDescendantIsActive = async () => {
  const { hooks, sandbox, store } = createHarness();
  const runtime = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });

  await runtime.coordinator.request("push");
  const root = findJournalRecord(
    store,
    (record) => record.recordType === "request"
  );
  const child = createTransitionRecord(root, {
    eventId: "transition:context-a:recent-descendant-for-prune",
    phase: "awaiting_confirmation",
    confirmationOwnerId: "tab-a",
    confirmationOwnerToken: "owner-token-a",
    confirmationOwnerExpiresAt: 2_500_000,
    confirmationOwnerClaimedAt: 1_999_000,
    transitionKind: "confirmation_owner_claim",
    transitionSourceContextId: "context-a",
    transitionAt: 1_999_000,
    expectedConfirmationOwnerToken: "",
  });
  const rootKey = getIntentRecordKey(root.eventId);
  const childKey = getIntentRecordKey(child.eventId);
  sandbox.GM_setValue(childKey, child);
  const retainedCount = hooks.pruneManualSyncIntentRecordsForTest(2_000_000);
  assert.equal(retainedCount, 0);
  assert.equal(store.has(rootKey), true);
  assert.equal(store.has(childKey), true);
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), true);

  const prunedCount = hooks.pruneManualSyncIntentRecordsForTest(4_000_000);
  assert.equal(prunedCount, 3);
  assert.equal(store.has(rootKey), false);
  assert.equal(store.has(childKey), false);
  assert.equal(store.has(MANUAL_SYNC_INTENT_KEY), false);
};

const testExplicitRequestOrderingUsesSerializedCommitOrder = async () => {
  const { hooks } = createHarness();
  const first = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-a",
    sourceContextId: "context-a",
    now: 1_000_000,
  });
  const second = createCoordinator(hooks, {
    activeExecution: true,
    ownerId: "tab-b",
    sourceContextId: "context-b",
    now: 1_000_000,
  });

  // context-a commits after context-b under the shared decision authority;
  // the monotonic authority sequence, rather than source or wall-clock time,
  // makes the later committed request authoritative.
  await second.coordinator.request("pull");
  const laterInvocation = await first.coordinator.request("push");
  const latest = first.coordinator.readIntent();

  assert.equal(latest.direction, "push");
  assert.equal(latest.requestId.startsWith("context-a_"), true);
  assert.notEqual(laterInvocation.reason, "manual_intent_persist_failed");
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
  await testOldOwnerCallbacksCannotActAfterSameGenerationTakeover();
  await testOwnerTokenTakeoverRemountsTheConfirmation();
  await testSettingsDisableCancelsPriorityGate();
  await testStaleDeleteCannotRemoveNewerIntent();
  await testStalePersistCannotOverwriteNewerIntent();
  await testConfirmationOwnerClaimUsesOneDeterministicWinner();
  await testOldOwnerTeardownCannotMutateNewerDirection();
  await testOldConfirmationCannotExecuteAfterNewDirection();
  await testStaleOwnerReleaseCannotRebaseOntoNewerHead();
  await testStaleConfirmCannotRebaseExecutingTransitionOntoNewerHead();
  await testStaleOwnerClaimCannotRegressExecutingHead();
  await testStaleRequeueCannotResurrectTerminalHead();
  await testCanonicalUserConfirmBeatsValidLateOwnerTakeoverSibling();
  await testExecutingDecisionCannotBeOverriddenByLateTerminalSibling();
  await testExecutingFirstStaleCancelCannotOverrideCommittedExecution();
  await testTerminalFirstStaleConfirmCannotOverrideCommittedTerminal();
  await testBusyBeforeIrreversibleExecutionCommitRequeuesWithoutSideEffect();
  await testSettingsDisableDuringCommittedExecutionDoesNotCancelIt();
  await testConfirmationOwnerClaimIsSerializedAcrossContexts();
  await testSimultaneousExplicitRequestsUseSerializedAuthoritySequence();
  await testProductionDecisionAuthorityUsesWebLocks();
  await testProductionDecisionAuthorityFailsClosedWithoutWebLocks();
  await testAmbiguousIrreversibleDecisionBlocksRecoveryAndScheduling();
  await testLateAncestorSiblingCannotDethroneExecutingBranch();
  await testLateAncestorSiblingCannotResurrectTerminalBranch();
  await testExecutingDescendantBeatsQueuedAncestorSibling();
  await testTerminalDescendantBeatsExecutingSiblingBranch();
  await testInvalidFutureDescendantCannotElevateBranchAuthority();
  await testJournalPruneRetainsRootWhileDescendantIsActive();
  await testExplicitRequestOrderingUsesSerializedCommitOrder();
  console.log("[manual-sync-intent-priority] manual priority lifecycle verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
