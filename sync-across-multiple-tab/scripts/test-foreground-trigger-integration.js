#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
} = require("./s1plus-test-helpers");

const createHarness = () => {
  return createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 4 测试钩子。",
  });
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const testListenerWiring = () => {
  expectMatch(
    /window\.addEventListener\("pageshow",\s*\(event\)\s*=>\s*\{\s*void handlePendingAutoSyncRecoveryPageShow\(event\);/m,
    "pageshow 监听未复用统一的 Phase 4 触发处理函数。"
  );
  expectMatch(
    /document\.addEventListener\("visibilitychange",\s*\(\)\s*=>\s*\{\s*void handlePendingAutoSyncRecoveryVisibilityChange\(\);/m,
    "visibilitychange 监听未复用统一的 Phase 4 触发处理函数。"
  );
};

const testVisibilityChangeTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handlePendingAutoSyncRecoveryVisibilityChange({
    syncCoreDataFromStorageSnapshotIfNeeded: () => {
      calls.push("resync");
      return { didSync: true, changedKeys: ["s1p_read_progress"] };
    },
    recoverPendingAutoSyncIfNeeded: () => {
      calls.push("recover");
      return { status: "skipped", reason: "no_pending_auto_sync" };
    },
    checkRemoteFreshnessOnForeground: async (reason) => {
      calls.push(`probe:${reason}`);
      return { status: "unchanged", reason: "remote_already_synced" };
    },
  });

  assert.deepStrictEqual(calls, ["resync", "recover", "probe:foreground_resume"]);
  assert.strictEqual(result.status, "unchanged");
};

const testHiddenVisibilityChangeDoesNothing = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "hidden";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.handlePendingAutoSyncRecoveryVisibilityChange({
    recoverPendingAutoSyncIfNeeded: () => {
      recoverCount += 1;
    },
    checkRemoteFreshnessOnForeground: async () => {
      probeCount += 1;
      return { status: "unchanged" };
    },
  });

  assert.strictEqual(recoverCount, 0);
  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "document_hidden");
};

const testPersistedPageShowTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handlePendingAutoSyncRecoveryPageShow(
    { persisted: true },
    {
      syncCoreDataFromStorageSnapshotIfNeeded: () => {
        calls.push("resync");
        return { didSync: true, changedKeys: ["s1p_read_progress"] };
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
  assert.strictEqual(result.status, "changed");
};

const testNonPersistedPageShowKeepsRecoveryOnly = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.handlePendingAutoSyncRecoveryPageShow(
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
  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "pageshow_not_persisted");
};

const testVisibilityChangeWaitsForPendingRecovery = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handlePendingAutoSyncRecoveryVisibilityChange({
    syncCoreDataFromStorageSnapshotIfNeeded: () => {
      calls.push("resync");
      return { didSync: true, changedKeys: ["s1p_read_progress"] };
    },
    recoverPendingAutoSyncIfNeeded: () => {
      calls.push("recover");
      return { status: "scheduled", reason: "pending_recovery", delayMs: 600 };
    },
    checkRemoteFreshnessOnForeground: async () => {
      calls.push("probe");
      return { status: "unchanged" };
    },
  });

  assert.deepStrictEqual(calls, ["resync", "recover"]);
  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "pending_recovery_settle");
};

const testInitialVisibleProbeTriggersForegroundCheck = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handleInitialForegroundRemoteFreshnessCheck({
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

  const result = await hooks.handleInitialForegroundRemoteFreshnessCheck({
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
  testListenerWiring();
  await testVisibilityChangeTriggersRecoveryAndProbe();
  await testHiddenVisibilityChangeDoesNothing();
  await testPersistedPageShowTriggersRecoveryAndProbe();
  await testNonPersistedPageShowKeepsRecoveryOnly();
  await testVisibilityChangeWaitsForPendingRecovery();
  await testInitialVisibleProbeTriggersForegroundCheck();
  await testHiddenInitialVisibleProbeStaysIdle();
  console.log("[foreground-trigger-integration] Phase 4 trigger integration verified.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
