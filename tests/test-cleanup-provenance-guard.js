#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, sourceCode } = require("./s1plus-test-helpers");

const createReadProgressRecord = (page, floor, timestamp) => ({
  page: String(page),
  lastReadFloor: String(floor),
  timestamp,
});

const createDataObject = (readProgress, baseContentHash, contentHash, lastUpdated) => ({
  data: {
    read_progress: readProgress,
  },
  baseContentHash,
  contentHash,
  lastUpdated,
});

const buildCleanupScenario = async (hooks) => {
  const beforeProgress = {
    200: createReadProgressRecord(3, 88, 1760000000000),
    300: createReadProgressRecord(1, 12, 1760000100000),
  };
  const afterProgress = {
    300: createReadProgressRecord(1, 12, 1760000100000),
  };
  const cleanupInfo = await hooks.buildPendingCleanupInfo({
    source: "manual_group_delete",
    cleanupModeAtCreation: "manual",
    createdAt: 1760000200000,
    deletedCount: 1,
    threadIds: ["200"],
    initiatedFromThreadId: "200",
    beforeProgress,
    afterProgress,
  });

  return {
    cleanupInfo,
    beforeProgress,
    afterProgress,
    localDataObject: createDataObject(
      afterProgress,
      "shared-base-hash",
      "local-after-cleanup",
      1760000300000
    ),
    remoteDataObject: createDataObject(
      beforeProgress,
      "shared-base-hash",
      "remote-before-cleanup",
      1760000150000
    ),
    versionDecision: {
      action: "push",
      localNewer: true,
    },
  };
};

const testPhase7CleanupDiagnosticCodesWired = () => {
  assert.match(
    sourceCode,
    /syncResultCode:\s*"cleanup_shortcut_rejected"/m,
    "Phase 7 未将 cleanup shortcut reject 结果码写入诊断。"
  );
  assert.match(
    sourceCode,
    /normalizedAction === "cleanup_shortcut_push"[\s\S]*?return "cleanup_shortcut_applied";/m,
    "Phase 7 未将 cleanup shortcut apply 结果码写入诊断。"
  );
};

const testCleanupShortcutAllowsMatchingCleanupDiff = async () => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 5 cleanup 测试钩子。",
  });
  const scenario = await buildCleanupScenario(hooks);

  const result = await hooks.evaluateCleanupSyncShortcut({
    pendingCleanupInfo: scenario.cleanupInfo,
    localDataObject: scenario.localDataObject,
    remoteDataObject: scenario.remoteDataObject,
    versionDecision: scenario.versionDecision,
    currentThreadId: "200",
    activeConflictPause: null,
    now: 1760000500000,
  });

  assert.equal(result.allowed, true, "严格 guard 命中时应允许 cleanup shortcut。");
  assert.equal(result.reason, "cleanup_shortcut_allowed");
};

const testCleanupShortcutBlocksUnrelatedThreadContext = async () => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 5 cleanup 测试钩子。",
  });
  const scenario = await buildCleanupScenario(hooks);

  const result = await hooks.evaluateCleanupSyncShortcut({
    pendingCleanupInfo: scenario.cleanupInfo,
    localDataObject: scenario.localDataObject,
    remoteDataObject: scenario.remoteDataObject,
    versionDecision: scenario.versionDecision,
    currentThreadId: "999",
    activeConflictPause: null,
    now: 1760000500000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cleanup_unrelated_to_current_thread");
};

const testCleanupShortcutBlocksWhenConflictPauseIsActive = async () => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 5 cleanup 测试钩子。",
  });
  const scenario = await buildCleanupScenario(hooks);

  const result = await hooks.evaluateCleanupSyncShortcut({
    pendingCleanupInfo: scenario.cleanupInfo,
    localDataObject: scenario.localDataObject,
    remoteDataObject: scenario.remoteDataObject,
    versionDecision: scenario.versionDecision,
    currentThreadId: "200",
    activeConflictPause: {
      paused: true,
      reason: "local_changed_during_sync",
      timestamp: 1760000400000,
    },
    now: 1760000500000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "active_conflict_pause");
};

const testCleanupShortcutBlocksWhenLocalProgressMovedAgain = async () => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 5 cleanup 测试钩子。",
  });
  const scenario = await buildCleanupScenario(hooks);
  const changedAgainProgress = {
    ...scenario.afterProgress,
    400: createReadProgressRecord(2, 18, 1760000500000),
  };

  const result = await hooks.evaluateCleanupSyncShortcut({
    pendingCleanupInfo: scenario.cleanupInfo,
    localDataObject: createDataObject(
      changedAgainProgress,
      "shared-base-hash",
      "local-after-cleanup-and-reading",
      1760000600000
    ),
    remoteDataObject: scenario.remoteDataObject,
    versionDecision: scenario.versionDecision,
    currentThreadId: "",
    activeConflictPause: null,
    now: 1760000500000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cleanup_local_basis_mismatch");
};

const testManualCleanupNoticeDoesNotPretendToBeAutoCleanup = async () => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 5 cleanup 测试钩子。",
  });
  const scenario = await buildCleanupScenario(hooks);

  const html = hooks.createSyncComparisonHtml(
    {
      ...scenario.localDataObject,
      lastUpdated: 1760000300000,
    },
    {
      ...scenario.remoteDataObject,
      lastUpdated: 1760000150000,
    },
    true,
    scenario.cleanupInfo,
    scenario.versionDecision
  );

  assert.match(html, /手动删除了 <strong>1<\/strong> 条阅读记录/);
  assert.doesNotMatch(html, /自动清理了 <strong>1<\/strong> 条陈旧的阅读记录/);
};

const run = async () => {
  testPhase7CleanupDiagnosticCodesWired();
  await testCleanupShortcutAllowsMatchingCleanupDiff();
  await testCleanupShortcutBlocksUnrelatedThreadContext();
  await testCleanupShortcutBlocksWhenConflictPauseIsActive();
  await testCleanupShortcutBlocksWhenLocalProgressMovedAgain();
  await testManualCleanupNoticeDoesNotPretendToBeAutoCleanup();
  console.log("[cleanup-provenance-guard] Phase 5 cleanup provenance guard verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
