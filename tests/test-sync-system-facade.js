#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = (options = {}) =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 6 Sync System façade。",
    ...options,
  });

const readySyncSettings = Object.freeze({
  syncRemoteEnabled: true,
  syncAutoEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncDeviceId: "device-a",
});

const createLifecycleAdapter = (calls = []) => ({
  bind: () => {
    calls.push("lifecycle:bind");
    return { status: "bound" };
  },
  unbind: () => {
    calls.push("lifecycle:unbind");
    return { status: "unbound" };
  },
  handle: async () => ({ status: "completed" }),
});

const testFacadeOwnsInitializationAndLifecycle = async () => {
  const { hooks } = createHarness();
  const facade = hooks.s1pSyncSystem;

  assert.ok(Object.isFrozen(facade));
  const initialized = facade.initialize();
  assert.equal(initialized.status, "initialized");
  assert.equal(initialized.lifecycle.status, "bound");
  assert.ok(initialized.schedulerRecovery?.status);
  assert.ok(initialized.pendingRecovery?.status);

  assert.deepStrictEqual(toPlainObject(facade.initialize()), {
    status: "skipped",
    reason: "already_initialized",
  });

  const unsupportedLifecycle = await facade.handleLifecycle("unknown");
  assert.equal(unsupportedLifecycle.status, "skipped");
  assert.equal(unsupportedLifecycle.reason, "unsupported_lifecycle_event");

  const disposed = facade.dispose();
  assert.equal(disposed.status, "disposed");
  assert.equal(disposed.lifecycle.status, "unbound");
  assert.deepStrictEqual(toPlainObject(facade.dispose()), {
    status: "skipped",
    reason: "already_disposed",
  });

  assert.equal(facade.initialize().status, "initialized");
  assert.equal(facade.dispose().status, "disposed");
};

const testFacadeCanRecoverAfterDisposeUnbindFailure = () => {
  const { hooks } = createHarness();
  let shouldFailUnbind = true;
  const lifecycleAdapter = {
    bind: () => ({ status: "bound" }),
    unbind: () => {
      if (shouldFailUnbind) {
        throw new Error("unbind failed");
      }
      return { status: "unbound" };
    },
    handle: async () => ({ status: "completed" }),
  };
  const facade = hooks.s1pCreateSyncSystemFacade({
    lifecycleAdapter,
    pendingDirtyScheduler: {
      recover: () => ({ status: "recovered" }),
      handoff: () => ({ status: "released" }),
    },
    recoverPendingAutoSyncIfNeeded: () => ({ status: "recovered" }),
  });

  assert.equal(facade.initialize().status, "initialized");
  assert.throws(() => facade.dispose(), /unbind failed/);

  shouldFailUnbind = false;
  assert.equal(facade.initialize().status, "initialized");
  assert.equal(facade.dispose().status, "disposed");
};

const testFacadeRollsBackPartialInitializationAndCanRetry = () => {
  const { hooks } = createHarness();
  const createFacade = hooks.s1pCreateSyncSystemFacade;
  assert.equal(typeof createFacade, "function");

  {
    const calls = [];
    let shouldFail = true;
    const facade = createFacade({
      lifecycleAdapter: createLifecycleAdapter(calls),
      pendingDirtyScheduler: {
        recover: () => {
          calls.push("scheduler:recover");
          if (shouldFail) {
            throw new Error("scheduler recovery failed");
          }
          return { status: "recovered" };
        },
        handoff: () => {
          calls.push("scheduler:handoff");
          return { status: "released" };
        },
      },
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("pending:recover");
        return { status: "recovered" };
      },
    });

    assert.throws(() => facade.initialize(), /scheduler recovery failed/);
    assert.deepStrictEqual(calls, [
      "lifecycle:bind",
      "scheduler:recover",
      "scheduler:handoff",
      "lifecycle:unbind",
    ]);

    calls.length = 0;
    shouldFail = false;
    assert.equal(facade.initialize().status, "initialized");
    assert.deepStrictEqual(calls, [
      "lifecycle:bind",
      "scheduler:recover",
      "pending:recover",
    ]);
  }

  {
    const calls = [];
    const facade = createFacade({
      lifecycleAdapter: createLifecycleAdapter(calls),
      pendingDirtyScheduler: {
        recover: () => {
          calls.push("scheduler:recover");
          return { status: "recovered" };
        },
        handoff: () => {
          calls.push("scheduler:handoff");
          return { status: "released" };
        },
      },
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("pending:recover");
        throw new Error("pending recovery failed");
      },
    });

    assert.throws(() => facade.initialize(), /pending recovery failed/);
    assert.deepStrictEqual(calls, [
      "lifecycle:bind",
      "scheduler:recover",
      "pending:recover",
      "scheduler:handoff",
      "lifecycle:unbind",
    ]);
  }
};

const testFacadeRecordsLocalMutationThroughOneInterface = () => {
  const { hooks } = createHarness();
  const result = hooks.s1pSyncSystem.recordLocalMutation("general", {
    triggerSync: false,
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.source, "general");
  assert.equal(result.syncRequested, false);
  assert.ok(result.lastModified > 0);
};

const testFacadeQueuesReadyLocalMutation = () => {
  const { hooks, store } = createHarness();
  store.set("s1p_settings", readySyncSettings);

  try {
    const result = toPlainObject(
      hooks.s1pSyncSystem.recordLocalMutation("general", {
        triggerSync: true,
      })
    );
    assert.equal(result.status, "recorded");
    assert.equal(result.syncRequested, true);
    assert.equal(result.schedulerResult.status, "scheduled");
  } finally {
    hooks.preemptActiveSyncForManualOverride("facade_test_cleanup");
  }
};

const testFacadeReportsLocalMutationReadinessGuard = () => {
  const { hooks } = createHarness();
  const result = toPlainObject(
    hooks.s1pSyncSystem.recordLocalMutation("general", {
      triggerSync: true,
    })
  );

  assert.equal(result.status, "recorded");
  assert.equal(result.syncRequested, false);
  assert.equal(result.reason, "sync_not_ready");
};

const testFacadeRecordsTimestampOnlyMutationDuringRunningSync = () => {
  const { hooks } = createHarness();
  hooks.seedSyncRuntimeStateForManualOverrideTest({
    isInitialSyncInProgress: true,
  });

  const result = toPlainObject(
    hooks.s1pSyncSystem.recordLocalMutation("general", {
      triggerSync: false,
    })
  );

  assert.equal(result.status, "recorded");
  assert.equal(result.syncRequested, false);
  assert.equal("reason" in result, false);
  hooks.preemptActiveSyncForManualOverride("facade_test_cleanup");
};

const testFacadeDefersReadyMutationDuringRunningSync = () => {
  const { hooks, store } = createHarness();
  store.set("s1p_settings", readySyncSettings);
  hooks.seedSyncRuntimeStateForManualOverrideTest({
    isInitialSyncInProgress: true,
  });

  try {
    const result = toPlainObject(
      hooks.s1pSyncSystem.recordLocalMutation("read_progress", {
        triggerSync: true,
      })
    );
    assert.equal(result.status, "recorded");
    assert.equal(result.source, "read_progress");
    assert.equal(result.syncRequested, true);
    assert.equal(result.schedulerResult.status, "retained");
    assert.equal(result.schedulerResult.reason, "running_sync");
  } finally {
    hooks.preemptActiveSyncForManualOverride("facade_test_cleanup");
  }
};

const testFacadeReportsRunningSyncMutationReadinessGuard = () => {
  const { hooks } = createHarness();
  hooks.seedSyncRuntimeStateForManualOverrideTest({
    isInitialSyncInProgress: true,
  });

  const result = toPlainObject(
    hooks.s1pSyncSystem.recordLocalMutation("general", {
      triggerSync: true,
    })
  );

  assert.equal(result.status, "recorded");
  assert.equal(result.syncRequested, false);
  assert.equal(result.reason, "sync_not_ready");
  hooks.preemptActiveSyncForManualOverride("facade_test_cleanup");
};

const testFacadeRoutesSyncIntentsAndReadsProjectedState = async () => {
  const { hooks } = createHarness();
  const facade = hooks.s1pSyncSystem;

  const perLoadResult = await facade.requestSync({
    kind: "per_load",
    options: {
      settings: {
        syncPerLoadCheckEnabled: false,
        syncRemoteEnabled: false,
      },
    },
  });
  assert.equal(perLoadResult, false);

  const foregroundResult = await facade.requestSync({
    kind: "foreground_probe",
    reason: "pageshow",
    options: {
      settingsSnapshot: {
        syncRemoteEnabled: false,
        syncCheckOnReturnToForeground: false,
      },
    },
  });
  assert.equal(foregroundResult.status, "skipped");
  assert.equal(foregroundResult.reason, "disabled");

  assert.deepStrictEqual(
    toPlainObject(await facade.requestSync({ kind: "unknown" })),
    {
      status: "skipped",
      reason: "unsupported_sync_intent",
      kind: "unknown",
    }
  );

  const projected = toPlainObject(
    facade.readState({
      surface: "navbar",
      state: {
        phase: "success",
        source: "background_push",
        reason: "pushed",
        operation: "push",
        timestamp: Date.now(),
      },
    })
  );
  assert.equal(projected.displayPhase, "success");
};

const testProductionFacadeBackgroundPushUsesRuntimeGate = () => {
  const { hooks } = createHarness();
  hooks.seedSyncRuntimeStateForManualOverrideTest({
    hasPendingBackgroundSync: true,
  });

  hooks.s1pSyncSystem.requestSync({
    kind: "background_push",
    reason: "facade_integration",
  });

  assert.equal(
    hooks.getBackgroundAutoSyncRuntimeStateForTest().hasPendingBackgroundSync,
    false
  );
};

const testProductionFacadeManualSyncUsesRuntimeGate = async () => {
  const { hooks } = createHarness();
  const result = await hooks.s1pSyncSystem.requestSync({
    kind: "manual_sync",
    options: { suppressInitialMessage: true },
  });

  assert.equal(result, false);
  assert.equal(
    hooks.getBackgroundAutoSyncRuntimeStateForTest()
      .manualSyncLockHeartbeatActive,
    false
  );
};

const testProductionFacadeQueuesManualDirectionBehindForeignExecution = async () => {
  const { hooks, store } = createHarness();
  store.set("s1p_settings", readySyncSettings);
  store.set("s1p_sync_global_lock", {
    owner: "foreign-tab",
    mode: "background",
    timestamp: Date.now(),
    ttlMs: 45 * 1000,
  });

  const result = await hooks.s1pSyncSystem.requestSync({
    kind: "manual_push",
  });
  const coordinator = hooks.getDefaultManualSyncIntentCoordinator();
  const intent = toPlainObject(coordinator.readIntent());
  const projected = toPlainObject(
    hooks.s1pSyncSystem.readState({ surface: "navbar" })
  );

  assert.equal(result.status, "queued");
  assert.equal(result.phase, "waiting_for_execution_boundary");
  assert.equal(intent.direction, "push");
  assert.equal(intent.version, 1);
  assert.equal(store.has("s1p_pending_manual_sync_intent"), false);
  assert.equal(
    Array.from(store.keys()).some((key) =>
      String(key).startsWith("s1p_pending_manual_sync_intent:")
    ),
    false
  );
  assert.equal(projected.displayPhase, "pending");
  assert.equal(projected.displayOperation, "push");
  assert.equal(projected.displaySource, "manual_sync");
  assert.deepEqual(store.get("s1p_sync_global_lock"), {
    owner: "foreign-tab",
    mode: "background",
    timestamp: store.get("s1p_sync_global_lock").timestamp,
    ttlMs: 45 * 1000,
  });

  assert.equal((await coordinator.cancel(coordinator.readIntent())).status, "cancelled");
  assert.equal(coordinator.readIntent(), null);
  assert.notEqual(
    toPlainObject(hooks.s1pSyncSystem.readState({ surface: "navbar" }))
      .displaySource,
    "manual_sync"
  );
};

const testFacadePreservesEverySyncIntentContract = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const capture = (kind) => (...args) => {
    calls.push({ kind, args });
    return kind;
  };
  const facade = hooks.s1pCreateSyncSystemFacade({
    requestBackgroundPush: capture("background_push"),
    requestForegroundProbe: capture("foreground_probe"),
    requestDailyStartup: capture("daily_startup"),
    requestPerLoad: capture("per_load"),
    requestInitialForeground: capture("initial_foreground"),
    requestManualSync: capture("manual_sync"),
    requestManualPull: capture("manual_pull"),
    requestManualPush: capture("manual_push"),
    requestStartupFlow: capture("startup_flow"),
  });
  const runtime = { useSettingsSecondaryModal: true };

  assert.equal(
    facade.requestSync({ kind: "background_push", reason: "import" }),
    "background_push"
  );
  assert.equal(
    await facade.requestSync({
      kind: "foreground_probe",
      reason: "pageshow",
      options: { now: 10 },
    }),
    "foreground_probe"
  );
  assert.equal(
    await facade.requestSync({ kind: "daily_startup", options: { daily: 1 } }),
    "daily_startup"
  );
  assert.equal(
    await facade.requestSync({ kind: "per_load", options: { load: 1 } }),
    "per_load"
  );
  assert.equal(
    await facade.requestSync({
      kind: "initial_foreground",
      options: { visible: true },
    }),
    "initial_foreground"
  );
  assert.equal(
    await facade.requestSync({
      kind: "manual_sync",
      options: {
        suppressInitialMessage: true,
        isInitialSetup: true,
        runtime,
      },
    }),
    "manual_sync"
  );
  assert.equal(await facade.requestSync({ kind: "manual_pull" }), "manual_pull");
  assert.equal(await facade.requestSync({ kind: "manual_push" }), "manual_push");
  assert.equal(
    facade.requestSync({ kind: "startup_flow", options: { welcome: true } }),
    "startup_flow"
  );

  assert.strictEqual(calls[5].args[2], runtime);
  assert.deepStrictEqual(toPlainObject(calls), [
    { kind: "background_push", args: ["import"] },
    { kind: "foreground_probe", args: ["pageshow", { now: 10 }] },
    { kind: "daily_startup", args: [{ daily: 1 }] },
    { kind: "per_load", args: [{ load: 1 }] },
    { kind: "initial_foreground", args: [{ visible: true }] },
    { kind: "manual_sync", args: [true, true, runtime] },
    { kind: "manual_pull", args: [{}] },
    { kind: "manual_push", args: [{}] },
    { kind: "startup_flow", args: [{ welcome: true }] },
  ]);
};

const run = async () => {
  await testFacadeOwnsInitializationAndLifecycle();
  testFacadeCanRecoverAfterDisposeUnbindFailure();
  testFacadeRollsBackPartialInitializationAndCanRetry();
  testFacadeRecordsLocalMutationThroughOneInterface();
  testFacadeQueuesReadyLocalMutation();
  testFacadeReportsLocalMutationReadinessGuard();
  testFacadeRecordsTimestampOnlyMutationDuringRunningSync();
  testFacadeDefersReadyMutationDuringRunningSync();
  testFacadeReportsRunningSyncMutationReadinessGuard();
  await testFacadeRoutesSyncIntentsAndReadsProjectedState();
  testProductionFacadeBackgroundPushUsesRuntimeGate();
  await testProductionFacadeManualSyncUsesRuntimeGate();
  await testProductionFacadeQueuesManualDirectionBehindForeignExecution();
  await testFacadePreservesEverySyncIntentContract();
  console.log("[sync-system-facade] Phase 6 façade interface verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
