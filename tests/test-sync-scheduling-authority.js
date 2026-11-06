#!/usr/bin/env node
"use strict";

// [ARCH-INV-1] 调度层权威：清洁门禁与待同步回收只能依据“内容代数是否等于基线代数”，
// 不得再用“本地改动时间 vs 上次同步时间”这类两次独立时间比较。
// 这些用例在修复前都会失败（false-clean / 静默丢推送）。

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = (options = {}) =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露调度权威测试钩子。",
    ...options,
  });

const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
const GENERATION_KEY = "s1p_local_content_generation";
const LAST_MODIFIED_KEY = "s1p_last_modified";
const LAST_SYNC_KEY = "s1p_last_sync_timestamp";

const makeProgress = (floor) => ({
  123456: {
    postId: "70000001",
    page: "1",
    lastReadFloor: String(floor),
    timestamp: 1700000000000,
  },
});

const writeProgress = (harness, floor) => {
  harness.hooks.s1pCoreBusinessData.write("readProgress", makeProgress(floor));
};

const readGeneration = (harness) =>
  Number(harness.store.get(GENERATION_KEY)) || 0;

const writeBaseline = (harness, tag, extra = {}) => {
  harness.hooks.setSyncBaselineState({
    contentHash: tag,
    localContentHash: tag,
    remoteContentHash: tag,
    remoteUpdatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
  return harness.hooks.getSyncBaselineState();
};

const readFence = (harness, now = 10000) =>
  harness.hooks.shouldSkipAutoSyncDueToCleanState({
    direction: "push",
    triggerSource: "background_push",
    reason: "read_progress",
    now,
  });

const enableSync = (harness) => {
  harness.hooks.saveSettings(
    Object.assign(harness.hooks.getSettings(), {
      syncRemoteEnabled: true,
      syncAutoEnabled: true,
      syncDeviceId: "dev-local",
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat-token",
    })
  );
};

const seedPending = (harness, lastModified) => {
  harness.store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "read_progress",
    lastModified,
    maxLastModified: lastModified,
    createdAt: lastModified,
    firstDirtyAt: lastModified,
    lastDirtyAt: lastModified,
    sources: { read_progress: 1 },
    threadIds: ["123456"],
  });
};

// ---------------------------------------------------------------- 代数生命周期

const testGenerationLifecycle = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  assert.equal(readGeneration(harness), 1, "内容写入必须推进代数");

  harness.store.set(LAST_MODIFIED_KEY, 5000);
  const baseline = writeBaseline(harness, "h1");
  assert.equal(
    baseline.localContentGeneration,
    1,
    "基线必须记录写入时刻的代数"
  );
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    false,
    "基线写入后立即判干净"
  );

  writeProgress(harness, 12);
  const dirtyState = harness.hooks.isLocalContentDirtySinceBaseline();
  assert.equal(dirtyState.dirty, true, "再次写入内容后必须判脏");
  assert.equal(dirtyState.reason, "local_content_changed_since_baseline");

  writeBaseline(harness, "h2");
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    false,
    "重新建立基线后必须回到干净"
  );
};

const testBaselineHonorsExplicitGeneration = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  writeProgress(harness, 12);
  writeProgress(harness, 14);
  const current = readGeneration(harness);

  // 合并式拉取用“更早的代数”代表云端内容，使“本地领先云端”仍然成立。
  harness.hooks.setSyncBaselineState({
    contentHash: "merged",
    localContentHash: "merged",
    remoteContentHash: "merged",
    remoteUpdatedAt: "2026-01-01T00:00:00Z",
    localContentGeneration: current - 1,
  });
  assert.equal(
    harness.hooks.getSyncBaselineState().localContentGeneration,
    current - 1,
    "基线必须接受显式代数"
  );
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    true,
    "基线代数落后于当前内容时必须判脏（合并拉取的收敛信号）"
  );

  harness.hooks.setSyncBaselineState({
    contentHash: "caught-up",
    localContentHash: "caught-up",
    remoteContentHash: "caught-up",
    remoteUpdatedAt: "2026-01-01T00:00:01Z",
    localContentGeneration: current,
  });
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    false,
    "基线追平当前代数后必须回到干净"
  );
};

const testGenerationIsSharedAcrossTabs = () => {
  const first = createHarness();
  writeProgress(first, 10);
  writeBaseline(first, "h1");
  const generationBefore = readGeneration(first);

  // 另一个标签页共享同一份 GM 存储：内容写入同样推进共享代数。
  const second = createHarness({ sharedStore: first.store });
  writeProgress(second, 14);
  assert.ok(
    readGeneration(second) > generationBefore,
    "共享存储上的内容写入必须推进同一份代数"
  );
  assert.equal(
    second.hooks.isLocalContentDirtySinceBaseline().dirty,
    true,
    "另一个标签页写入内容后，本页也必须判脏"
  );
};

// ---------------------------------------------------------------- 清洁门禁

const testGateSkipsOnlyWhenContentMatchesBaseline = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  writeBaseline(harness, "h1");
  harness.store.set(LAST_SYNC_KEY, 9000);

  const cleanFence = readFence(harness);
  assert.equal(cleanFence.skip, true, "内容等于基线时门禁应跳过冗余推送");
  assert.equal(cleanFence.reason, "clean_state_fence");
};

const testGateDoesNotSkipWhenContentDirtyButWatermarkStale = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  writeBaseline(harness, "h1");
  harness.store.set(LAST_SYNC_KEY, 9000);

  // 内容真实前进，但水印停留在旧值（模拟漏打点/受抑制写入）。
  writeProgress(harness, 12);
  harness.store.set(LAST_MODIFIED_KEY, 5000);

  const fence = readFence(harness);
  assert.equal(
    fence.skip,
    false,
    "内容确实脏时不得因为水印落后而跳过推送（false-clean）"
  );
  assert.equal(fence.reason, "local_content_changed_since_baseline");
};

const testGateTreatsLegacyBaselineAsDirty = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  // 旧版本写入的基线：只有哈希，没有代数。
  harness.store.set("s1p_sync_baseline_state", {
    contentHash: "legacy-hash",
    localContentHash: "legacy-hash",
    remoteContentHash: "legacy-hash",
    remoteUpdatedAt: "2025-01-01T00:00:00Z",
    savedAt: 1000,
  });
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  harness.store.set(LAST_SYNC_KEY, 9000);

  const fence = readFence(harness);
  assert.equal(
    fence.skip,
    false,
    "旧基线缺代数时必须保守判脏，绝不 false-clean"
  );
  assert.equal(fence.reason, "baseline_generation_missing");
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().known,
    false
  );
};

// ------------------------------------------------------------ 待同步回收

const testRecoveryKeepsPendingWhenContentDirty = () => {
  const harness = createHarness();
  enableSync(harness);
  writeProgress(harness, 10);
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  writeBaseline(harness, "h1");
  harness.store.set(LAST_SYNC_KEY, 9000);

  writeProgress(harness, 12);
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  seedPending(harness, 5000);

  const recovery = harness.hooks.recoverPendingBackgroundAutoSyncIfNeeded();
  assert.notEqual(
    recovery.status,
    "cleared",
    "内容确实脏时不得用时间戳比较清除待同步请求"
  );
  assert.equal(
    harness.store.has(PENDING_AUTO_SYNC_KEY),
    true,
    "待同步请求必须保留，否则推送被静默丢弃"
  );
};

const testRecoveryClearsPendingWhenContentMatchesBaseline = () => {
  const harness = createHarness();
  enableSync(harness);
  writeProgress(harness, 10);
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  writeBaseline(harness, "h1");
  harness.store.set(LAST_SYNC_KEY, 9000);
  seedPending(harness, 5000);

  const recovery = harness.hooks.recoverPendingBackgroundAutoSyncIfNeeded();
  assert.equal(recovery.status, "cleared");
  assert.equal(recovery.reason, "already_synced");
  assert.equal(
    harness.store.has(PENDING_AUTO_SYNC_KEY),
    false,
    "内容已等于基线时可以安全清除冗余待同步请求"
  );
};

const testRecoveryKeepsPendingForLegacyBaseline = () => {
  const harness = createHarness();
  enableSync(harness);
  writeProgress(harness, 10);
  harness.store.set("s1p_sync_baseline_state", {
    contentHash: "legacy-hash",
    localContentHash: "legacy-hash",
    remoteContentHash: "legacy-hash",
    remoteUpdatedAt: "2025-01-01T00:00:00Z",
    savedAt: 1000,
  });
  harness.store.set(LAST_MODIFIED_KEY, 5000);
  harness.store.set(LAST_SYNC_KEY, 9000);
  seedPending(harness, 5000);

  const recovery = harness.hooks.recoverPendingBackgroundAutoSyncIfNeeded();
  assert.notEqual(recovery.status, "cleared");
  assert.equal(
    harness.store.has(PENDING_AUTO_SYNC_KEY),
    true,
    "旧基线缺代数时必须保守保留待同步请求"
  );
};

// ------------------------------------------------------- 覆盖清理按内容代数

const readPending = (harness) =>
  harness.hooks.getAutoSyncRuntimePendingDisplayState && harness.store.get(PENDING_AUTO_SYNC_KEY);

const seedPendingWithGeneration = (harness, lastModified, dirtyGeneration) => {
  harness.store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "read_progress",
    lastModified,
    maxLastModified: lastModified,
    createdAt: lastModified,
    firstDirtyAt: lastModified,
    lastDirtyAt: lastModified,
    sources: { read_progress: 1 },
    threadIds: ["123456"],
    dirtyGeneration,
  });
};

const testCoveredCleanupUsesContentGeneration = () => {
  const harness = createHarness();
  writeProgress(harness, 10);
  writeProgress(harness, 12);
  const dirtyGeneration = readGeneration(harness);
  seedPendingWithGeneration(harness, 5000, dirtyGeneration);
  assert.ok(harness.store.get(PENDING_AUTO_SYNC_KEY), "前置：待同步请求存在");

  // 覆盖代数不足（同步只覆盖到更早的内容）→ 必须保留
  const retained = harness.hooks.clearPendingAutoSyncRequestIfCovered(9999, {
    coveredContentGeneration: dirtyGeneration - 1,
  });
  assert.equal(
    retained.status,
    "retained",
    "同步覆盖的内容代数不足时必须保留待同步请求"
  );
  assert.equal(harness.store.has(PENDING_AUTO_SYNC_KEY), true);

  // 覆盖代数充足 → 清除
  const cleared = harness.hooks.clearPendingAutoSyncRequestIfCovered(1, {
    coveredContentGeneration: dirtyGeneration,
  });
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.reason, "covered");
  assert.equal(harness.store.has(PENDING_AUTO_SYNC_KEY), false);
};

const testCoveredCleanupRetainsWhenGenerationMissing = () => {
  const harness = createHarness();
  // 旧版待同步记录：没有 dirtyGeneration 字段
  seedPending(harness, 5000);
  const legacyPending = { ...harness.store.get(PENDING_AUTO_SYNC_KEY) };
  delete legacyPending.dirtyGeneration;
  harness.store.set(PENDING_AUTO_SYNC_KEY, legacyPending);
  const retained = harness.hooks.clearPendingAutoSyncRequestIfCovered(1, {
    coveredContentGeneration: 10,
  });
  assert.equal(
    retained.status,
    "retained",
    "旧记录缺代数时不得凭时间戳断言已被覆盖"
  );
  assert.equal(harness.store.has(PENDING_AUTO_SYNC_KEY), true);
};

// ------------------------------------------------------- 显示层三值内容判定

const testDisplayUsesGenerationWhenFingerprintUnavailable = () => {
  const harness = createHarness();
  const now = Date.now();
  // 基线有代数、无业务指纹（例如指纹计算失败的降级场景）
  harness.store.set("s1p_sync_baseline_state", {
    contentHash: "g",
    localContentHash: "g",
    remoteContentHash: "g",
    remoteUpdatedAt: "2025-01-01T00:00:00Z",
    savedAt: 2,
    localContentGeneration: readGeneration(harness),
  });
  seedPending(harness, now);
  assert.equal(
    harness.hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false,
    "内容代数等于基线时不得显示待推送（内容权威优先于存活兜底）"
  );

  writeProgress(harness, 20);
  seedPending(harness, now);
  assert.equal(
    harness.hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    true,
    "内容代数偏离基线时必须显示待推送"
  );
};

const testDisplayFallsBackOnlyWhenContentTruthUnavailable = () => {
  const harness = createHarness();
  const now = Date.now();
  harness.store.set("s1p_sync_baseline_state", {
    contentHash: "legacy",
    localContentHash: "legacy",
    remoteContentHash: "legacy",
    remoteUpdatedAt: "2025-01-01T00:00:00Z",
    savedAt: 1,
  });
  seedPending(harness, now);
  assert.equal(
    harness.hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    true,
    "内容事实不可得时只保留存活兜底（迁移期）"
  );

  // 过期记录仍不应显示（存活兜底自带新鲜度）
  harness.store.set(PENDING_AUTO_SYNC_KEY, {
    ...harness.store.get(PENDING_AUTO_SYNC_KEY),
    lastModified: now - 120000,
    maxLastModified: now - 120000,
    createdAt: now - 120000,
    firstDirtyAt: now - 120000,
    lastDirtyAt: now - 120000,
  });
  assert.equal(
    harness.hooks.getAutoSyncRuntimePendingDisplayState().hasPending,
    false,
    "过期记录不得因兜底而长期显示待推送"
  );
};

const run = () => {
  testGenerationLifecycle();
  testBaselineHonorsExplicitGeneration();
  testGenerationIsSharedAcrossTabs();
  testGateSkipsOnlyWhenContentMatchesBaseline();
  testGateDoesNotSkipWhenContentDirtyButWatermarkStale();
  testGateTreatsLegacyBaselineAsDirty();
  testRecoveryKeepsPendingWhenContentDirty();
  testRecoveryClearsPendingWhenContentMatchesBaseline();
  testRecoveryKeepsPendingForLegacyBaseline();
  testCoveredCleanupUsesContentGeneration();
  testCoveredCleanupRetainsWhenGenerationMissing();
  testDisplayUsesGenerationWhenFingerprintUnavailable();
  testDisplayFallsBackOnlyWhenContentTruthUnavailable();
  console.log(
    "[sync-scheduling-authority] INV-1 scheduling authority verified (gate + recovery + legacy)."
  );
  // 脏状态下“保留待同步请求”会顺带排入真实后台同步（含重试链）与网络请求，
  // 本用例只断言调度决策，不等待这些副作用，因此断言完成后直接结束进程。
  process.exit(0);
};

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
