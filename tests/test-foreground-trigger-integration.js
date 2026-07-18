#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");

const createHarness = () => {
  return createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 3 生命周期 adapter。",
  });
};

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const requestInitialForeground = (hooks, options = {}) =>
  hooks.s1pSyncSystem.requestSync({
    kind: "initial_foreground",
    options,
  });

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener: (name, handler) => {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
    },
    removeEventListener: (name, handler) => {
      const handlers = listeners.get(name) || [];
      listeners.set(
        name,
        handlers.filter((candidate) => candidate !== handler)
      );
    },
    listenerCount: (name) => (listeners.get(name) || []).length,
  };
};

const testLifecycleAdapterBindsSingleEntryPerEvent = () => {
  const { hooks } = createHarness();
  assert.equal(typeof hooks.s1pCreateSyncLifecycleAdapter, "function");
  assert.equal(typeof hooks.s1pSyncSystem?.handleLifecycle, "function");

  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  const initializationCalls = [];
  const cleanupCalls = [];
  const adapter = hooks.s1pCreateSyncLifecycleAdapter({
    windowTarget,
    documentTarget,
    bindSharedStateChange: () => {
      initializationCalls.push("shared_state");
      return {
        status: "bound",
        dispose: () => {
          cleanupCalls.push("shared_state");
        },
      };
    },
    initializeForegroundSupport: () => {
      initializationCalls.push("foreground_support");
      return {
        status: "initialized",
        dispose: () => {
          cleanupCalls.push("foreground_support");
        },
      };
    },
  });

  assert.equal(adapter.bind().status, "bound");
  assert.equal(adapter.bind().reason, "already_bound");
  assert.equal(windowTarget.listenerCount("pageshow"), 1);
  assert.equal(windowTarget.listenerCount("pagehide"), 1);
  assert.equal(windowTarget.listenerCount("beforeunload"), 1);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 1);
  assert.deepEqual(initializationCalls, [
    "foreground_support",
    "shared_state",
  ]);
  assert.equal(adapter.unbind().status, "unbound");
  assert.equal(adapter.unbind().reason, "already_unbound");
  assert.equal(windowTarget.listenerCount("pageshow"), 0);
  assert.equal(windowTarget.listenerCount("pagehide"), 0);
  assert.equal(windowTarget.listenerCount("beforeunload"), 0);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
  assert.deepEqual(cleanupCalls, ["shared_state", "foreground_support"]);

  assert.equal(adapter.bind().status, "bound");
  assert.equal(windowTarget.listenerCount("pageshow"), 1);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 1);
};

const testLifecycleAdapterBindCanRetryAfterInitializationFailure = () => {
  const { hooks } = createHarness();
  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  let initializationAttempts = 0;
  const adapter = hooks.s1pCreateSyncLifecycleAdapter({
    windowTarget,
    documentTarget,
    bindSharedStateChange: () => {},
    initializeForegroundSupport: () => {
      initializationAttempts += 1;
      if (initializationAttempts === 1) {
        throw new Error("foreground initialization failed");
      }
    },
  });

  assert.throws(() => adapter.bind(), /foreground initialization failed/);
  assert.equal(adapter.bind().status, "bound");
  assert.equal(windowTarget.listenerCount("pageshow"), 1);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 1);
};

const testLifecycleAdaptersShareOneGmStateListenerLease = () => {
  const { sandbox, hooks } = createHarness();
  let addCount = 0;
  let removeCount = 0;
  sandbox.GM_addValueChangeListener = () => {
    addCount += 1;
    return `listener-${addCount}`;
  };
  sandbox.GM_removeValueChangeListener = () => {
    removeCount += 1;
  };
  const createAdapter = () =>
    hooks.s1pCreateSyncLifecycleAdapter({
      windowTarget: createEventTarget(),
      documentTarget: createEventTarget(),
      initializeForegroundSupport: () => {},
    });
  const first = createAdapter();
  const second = createAdapter();

  first.bind();
  second.bind();
  assert.equal(addCount, 1);
  first.unbind();
  assert.equal(removeCount, 0);
  second.unbind();
  assert.equal(removeCount, 1);

  const third = createAdapter();
  third.bind();
  assert.equal(addCount, 2);
  third.unbind();
  assert.equal(removeCount, 2);
};

const testForegroundRecoverySupportInitializesAndDisposesInIsolation = () => {
  const { hooks } = createHarness();
  assert.equal(
    typeof hooks.s1pInitializePendingAutoSyncRecoverySupport,
    "function"
  );
  const calls = [];
  const support = hooks.s1pInitializePendingAutoSyncRecoverySupport({
    bindActivityHooks: () => {
      calls.push("activity:bind");
      return {
        status: "bound",
        dispose: () => {
          calls.push("activity:unbind");
        },
      };
    },
    syncPolling: ({ resetActivity }) => {
      calls.push(`polling:sync:${resetActivity}`);
    },
    stopPolling: () => {
      calls.push("polling:stop");
    },
  });

  assert.equal(support.status, "initialized");
  assert.deepEqual(calls, ["activity:bind", "polling:sync:true"]);
  assert.equal(support.dispose().status, "disposed");
  assert.equal(support.dispose().reason, "already_disposed");
  assert.deepEqual(calls, [
    "activity:bind",
    "polling:sync:true",
    "polling:stop",
    "activity:unbind",
  ]);
};

const testLifecycleAdapterSequencesEveryBrowserPhase = async () => {
  const { hooks } = createHarness();
  let visibilityState = "hidden";
  let calls = [];
  const adapter = hooks.s1pCreateSyncLifecycleAdapter({
    getVisibilityState: () => visibilityState,
    setSchedulerPageUnloading: (value) => {
      calls.push(`unloading:${value}`);
    },
    clearHiddenFlush: () => {
      calls.push("hidden_flush:clear");
    },
    runCheckpoint: (reason, { phase }) => {
      calls.push(`checkpoint:${phase}:${reason}`);
      return { status: "completed", phase };
    },
    handleVisibilityRecovery: async () => {
      calls.push("foreground:visible");
      return { status: "unchanged" };
    },
    handlePageShowRecovery: async (event) => {
      calls.push(`foreground:pageshow:${event.persisted}`);
      return { status: "unchanged" };
    },
    syncVisiblePolling: ({ resetActivity }) => {
      calls.push(`polling:sync:${resetActivity}`);
    },
    stopVisiblePolling: () => {
      calls.push("polling:stop");
    },
    scheduleMicrotask: (callback) => {
      calls.push("unload:settle");
      callback();
    },
    schedulePostUnloadRecovery: (callback) => {
      calls.push("unload:recovery_task");
      callback();
    },
    recoverAfterCanceledUnload: () => {
      calls.push("scheduler:recover_after_canceled_unload");
    },
  });

  const hidden = await adapter.handle("visibilitychange");
  assert.equal(hidden.phase, "hidden");
  assert.deepEqual(calls, [
    "checkpoint:hidden:visibility_hidden",
    "polling:stop",
  ]);

  calls = [];
  visibilityState = "visible";
  const visible = await adapter.handle("visibilitychange");
  assert.equal(visible.phase, "visible");
  assert.equal(visible.foregroundResult.status, "unchanged");
  assert.deepEqual(calls, [
    "unloading:false",
    "hidden_flush:clear",
    "checkpoint:visible:visibility_visible",
    "foreground:visible",
    "polling:sync:true",
  ]);

  calls = [];
  const pageshow = await adapter.handle("pageshow", { persisted: true });
  assert.equal(pageshow.phase, "pageshow");
  assert.deepEqual(calls, [
    "unloading:false",
    "hidden_flush:clear",
    "checkpoint:pageshow:pageshow",
    "foreground:pageshow:true",
    "polling:sync:true",
  ]);

  for (const phase of ["pagehide", "beforeunload"]) {
    calls = [];
    const unloaded = await adapter.handle(phase, { persisted: false });
    assert.equal(unloaded.phase, phase);
    assert.equal(unloaded.foregroundResult, null);
    assert.deepEqual(calls, [
      "unloading:true",
      `checkpoint:${phase}:${phase}`,
      "unload:settle",
      "unloading:false",
      ...(phase === "beforeunload"
        ? [
            "unload:recovery_task",
            "scheduler:recover_after_canceled_unload",
          ]
        : []),
    ]);
  }
};

const testLifecycleAdapterUsesDefaultMicrotaskScheduling = async () => {
  const queuedMicrotasks = [];
  const firstHarness = createHarness();
  firstHarness.sandbox.queueMicrotask = (callback) => {
    queuedMicrotasks.push(callback);
  };
  const unloadingStates = [];
  const firstAdapter = firstHarness.hooks.s1pCreateSyncLifecycleAdapter({
    setSchedulerPageUnloading: (value) => {
      unloadingStates.push(value);
    },
    runCheckpoint: () => ({ status: "completed" }),
  });

  const pagehideResult = firstAdapter.handle("pagehide");
  assert.deepEqual(unloadingStates, [true]);
  assert.equal(queuedMicrotasks.length, 1);
  queuedMicrotasks[0]();
  await pagehideResult;
  assert.deepEqual(unloadingStates, [true, false]);

  const secondHarness = createHarness();
  secondHarness.sandbox.queueMicrotask = undefined;
  const fallbackStates = [];
  const secondAdapter = secondHarness.hooks.s1pCreateSyncLifecycleAdapter({
    setSchedulerPageUnloading: (value) => {
      fallbackStates.push(value);
    },
    runCheckpoint: () => ({ status: "completed" }),
  });
  await secondAdapter.handle("pagehide");
  assert.deepEqual(fallbackStates, [true, false]);
};

const testPostUnloadRecoveryRequiresCurrentVisibleTransition = async () => {
  const { hooks } = createHarness();
  let visibilityState = "hidden";
  let recoveryTask = null;
  let recoveryCount = 0;
  const adapter = hooks.s1pCreateSyncLifecycleAdapter({
    getVisibilityState: () => visibilityState,
    runCheckpoint: () => ({ status: "completed" }),
    scheduleMicrotask: (callback) => callback(),
    schedulePostUnloadRecovery: (callback) => {
      recoveryTask = callback;
    },
    recoverAfterCanceledUnload: () => {
      recoveryCount += 1;
      return { status: "scheduled" };
    },
    handlePageShowRecovery: async () => ({ status: "unchanged" }),
  });

  await adapter.handle("beforeunload");
  recoveryTask();
  assert.equal(recoveryCount, 0);

  visibilityState = "visible";
  await adapter.handle("beforeunload");
  const staleRecoveryTask = recoveryTask;
  await adapter.handle("pageshow", { persisted: true });
  staleRecoveryTask();
  assert.equal(recoveryCount, 0);

  await adapter.handle("beforeunload");
  recoveryTask();
  assert.equal(recoveryCount, 1);
};

const testUnbindInvalidatesPendingUnloadCallbacks = async () => {
  const { hooks } = createHarness();
  const microtasks = [];
  const recoveryTasks = [];
  const unloadingStates = [];
  let recoveryCount = 0;
  const adapter = hooks.s1pCreateSyncLifecycleAdapter({
    windowTarget: createEventTarget(),
    documentTarget: createEventTarget(),
    getVisibilityState: () => "visible",
    setSchedulerPageUnloading: (value) => {
      unloadingStates.push(value);
    },
    clearHiddenFlush: () => {},
    runCheckpoint: () => ({ status: "completed" }),
    scheduleMicrotask: (callback) => {
      microtasks.push(callback);
    },
    schedulePostUnloadRecovery: (callback) => {
      recoveryTasks.push(callback);
    },
    recoverAfterCanceledUnload: () => {
      recoveryCount += 1;
    },
    initializeForegroundSupport: () => {},
    bindSharedStateChange: () => {},
  });
  adapter.bind();

  const beforeUnloadResult = adapter.handle("beforeunload");
  assert.deepEqual(unloadingStates, [true]);
  assert.equal(adapter.unbind().status, "unbound");
  assert.deepEqual(unloadingStates, [true, false]);
  microtasks.forEach((callback) => callback());
  recoveryTasks.forEach((callback) => callback());
  await beforeUnloadResult;

  assert.deepEqual(unloadingStates, [true, false]);
  assert.equal(recoveryCount, 0);
};

const testVisibilityChangeTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.s1pSyncSystem.handleLifecycle(
    "visibilitychange",
    null,
    {
      syncCoreDataFromStorageSnapshotIfNeeded: () => {
        calls.push("resync");
        return { didSync: true, changedKinds: ["readProgress"] };
      },
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("recover");
        return { status: "skipped", reason: "no_pending_auto_sync" };
      },
      checkRemoteFreshnessOnForeground: async (reason) => {
        calls.push(`probe:${reason}`);
        return { status: "unchanged", reason: "remote_already_synced" };
      },
    }
  );

  assert.deepStrictEqual(calls, ["resync", "recover", "probe:foreground_resume"]);
  assert.strictEqual(result.foregroundResult.status, "unchanged");
};

const testHiddenVisibilityChangeDoesNothing = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "hidden";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.s1pSyncSystem.handleLifecycle(
    "visibilitychange",
    null,
    {
      recoverPendingAutoSyncIfNeeded: () => {
        recoverCount += 1;
      },
      checkRemoteFreshnessOnForeground: async () => {
        probeCount += 1;
        return { status: "unchanged" };
      },
    }
  );

  assert.strictEqual(recoverCount, 0);
  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result.phase, "hidden");
  assert.strictEqual(result.foregroundResult, null);
};

const testPersistedPageShowTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.s1pSyncSystem.handleLifecycle(
    "pageshow",
    { persisted: true },
    {
      syncCoreDataFromStorageSnapshotIfNeeded: () => {
        calls.push("resync");
        return { didSync: true, changedKinds: ["readProgress"] };
      },
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("recover");
        return { status: "skipped", reason: "no_pending_auto_sync" };
      },
      checkRemoteFreshnessOnForeground: async (reason) => {
        calls.push(`probe:${reason}`);
        return { status: "changed", reason: "remote_changed" };
      },
    }
  );

  assert.deepStrictEqual(calls, ["resync", "recover", "probe:foreground_resume"]);
  assert.strictEqual(result.foregroundResult.status, "changed");
};

const testNonPersistedPageShowKeepsRecoveryOnly = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.s1pSyncSystem.handleLifecycle(
    "pageshow",
    { persisted: false },
    {
      recoverPendingAutoSyncIfNeeded: () => {
        recoverCount += 1;
      },
      checkRemoteFreshnessOnForeground: async () => {
        probeCount += 1;
        return { status: "changed" };
      },
    }
  );

  assert.strictEqual(recoverCount, 1);
  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result.foregroundResult.status, "skipped");
  assert.strictEqual(result.foregroundResult.reason, "pageshow_not_persisted");
};

const testVisibilityChangeWaitsForPendingRecovery = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.s1pSyncSystem.handleLifecycle(
    "visibilitychange",
    null,
    {
      syncCoreDataFromStorageSnapshotIfNeeded: () => {
        calls.push("resync");
        return { didSync: true, changedKinds: ["readProgress"] };
      },
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("recover");
        return { status: "scheduled", reason: "pending_recovery", delayMs: 600 };
      },
      checkRemoteFreshnessOnForeground: async () => {
        calls.push("probe");
        return { status: "unchanged" };
      },
    }
  );

  assert.deepStrictEqual(calls, ["resync", "recover"]);
  assert.strictEqual(result.foregroundResult.status, "skipped");
  assert.strictEqual(result.foregroundResult.reason, "pending_recovery_settle");
};

const testInitialVisibleProbeTriggersForegroundCheck = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await requestInitialForeground(hooks, {
    settingsSnapshot: enabledSettings,
    triggerForegroundRemoteFreshnessProbe: async (reason) => {
      calls.push(reason);
      return {
        refreshPlan: {
          reloadSchedule: {
            status: "scheduled",
          },
        },
      };
    },
  });

  assert.deepStrictEqual(calls, ["page_load_visible"]);
  assert.strictEqual(result, true);
};

const testHiddenInitialVisibleProbeStaysIdle = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "hidden";
  let probeCount = 0;

  const result = await requestInitialForeground(hooks, {
    settingsSnapshot: enabledSettings,
    triggerForegroundRemoteFreshnessProbe: async () => {
      probeCount += 1;
      return {
        refreshPlan: {
          reloadSchedule: {
            status: "scheduled",
          },
        },
      };
    },
  });

  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result, false);
};

const main = async () => {
  testLifecycleAdapterBindsSingleEntryPerEvent();
  testLifecycleAdapterBindCanRetryAfterInitializationFailure();
  testLifecycleAdaptersShareOneGmStateListenerLease();
  testForegroundRecoverySupportInitializesAndDisposesInIsolation();
  await testLifecycleAdapterSequencesEveryBrowserPhase();
  await testLifecycleAdapterUsesDefaultMicrotaskScheduling();
  await testPostUnloadRecoveryRequiresCurrentVisibleTransition();
  await testUnbindInvalidatesPendingUnloadCallbacks();
  await testVisibilityChangeTriggersRecoveryAndProbe();
  await testHiddenVisibilityChangeDoesNothing();
  await testPersistedPageShowTriggersRecoveryAndProbe();
  await testNonPersistedPageShowKeepsRecoveryOnly();
  await testVisibilityChangeWaitsForPendingRecovery();
  await testInitialVisibleProbeTriggersForegroundCheck();
  await testHiddenInitialVisibleProbeStaysIdle();
  console.log(
    "[foreground-trigger-integration] Phase 3 lifecycle adapter verified."
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
