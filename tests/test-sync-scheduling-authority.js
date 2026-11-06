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
  // 代数是单调递增标记（含时间下限），只断言“推进过”，不假设具体数值。
  const firstGeneration = readGeneration(harness);
  assert.ok(firstGeneration >= 1, "内容写入必须推进代数");
  writeProgress(harness, 11);
  assert.ok(
    readGeneration(harness) > firstGeneration,
    "再次写入必须单调推进代数"
  );
  writeProgress(harness, 10);

  harness.store.set(LAST_MODIFIED_KEY, 5000);
  const baseline = writeBaseline(harness, "h1");
  assert.equal(
    baseline.localContentGeneration,
    readGeneration(harness),
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

const testIntermediateBaselineUsesFingerprintInsteadOfConservativeDirty = () => {
  // 中间版本写过的基线：有业务指纹、没有代数。
  // 调度层必须用指纹（内容权威）而不是保守判脏，否则显示与调度会不一致。
  const harness = createHarness();
  writeProgress(harness, 10);
  writeBaseline(harness, "h1");
  const patched = { ...harness.store.get("s1p_sync_baseline_state") };
  delete patched.localContentGeneration;
  harness.store.set("s1p_sync_baseline_state", patched);

  const cleanState = harness.hooks.isLocalContentDirtySinceBaseline();
  assert.equal(cleanState.known, true, "有指纹时内容事实可得");
  assert.equal(cleanState.authority, "fingerprint");
  assert.equal(
    cleanState.dirty,
    false,
    "内容等于基线时不得保守判脏（会与显示层不一致）"
  );

  writeProgress(harness, 14);
  const dirtyState = harness.hooks.isLocalContentDirtySinceBaseline();
  assert.equal(dirtyState.dirty, true, "内容变化后指纹必须判脏");
  assert.equal(dirtyState.authority, "fingerprint");
  assert.deepStrictEqual(
    [
      harness.hooks.deriveSyncNeed().push.needed,
      dirtyState.dirty,
    ],
    [true, true],
    "显示层与调度层必须一致"
  );
};

const testBaselineBindsToSyncedSnapshotGeneration = () => {
  // 同步期间发生写入时：基线必须绑定“被同步内容”的代数，而不是写基线时的实时代数。
  const harness = createHarness();
  const baseline = {
    contentHash: "h",
    localContentHash: "h",
    remoteContentHash: "h",
    remoteUpdatedAt: "2026-01-01T00:00:00Z",
  };
  const bound = harness.hooks.bindBaselineContentGeneration(baseline, 3);
  assert.equal(
    bound.localContentGeneration,
    3,
    "基线必须记录被同步内容所属代数"
  );
  assert.equal(
    baseline.localContentGeneration,
    undefined,
    "不得就地修改调用方对象"
  );

  // 未捕获覆盖代数时保持原样（由调用方决定，不在此处猜）
  assert.equal(
    harness.hooks.bindBaselineContentGeneration(baseline, 0),
    baseline
  );

  // 端到端语义：绑定到旧代数后，同步期间的新内容仍判脏
  writeProgress(harness, 10);
  const syncedGeneration = readGeneration(harness);
  harness.hooks.setSyncBaselineState(
    harness.hooks.bindBaselineContentGeneration(baseline, syncedGeneration)
  );
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    false,
    "刚同步完应判干净"
  );

  writeProgress(harness, 12);
  assert.equal(
    harness.hooks.isLocalContentDirtySinceBaseline().dirty,
    true,
    "同步期间的新写入必须判脏（不得被基线误记为已覆盖）"
  );
};

const testImportBasedActionsDoNotBindExportGeneration = () => {
  // 拉取/合并类动作的基线描述“导入后的内容”，不能绑定导出前的代数，
  // 否则每次成功拉取后都会立刻判脏。
  const harness = createHarness();
  const excluded = ["pulled", "force_pulled", "merged_read_progress"];
  excluded.forEach((action) => {
    assert.equal(
      harness.hooks.isImportBasedSyncAction(action),
      true,
      `${action} 必须被识别为导入类动作`
    );
  });
  ["pushed", "pushed_initial", "no_change"].forEach((action) => {
    assert.equal(
      harness.hooks.isImportBasedSyncAction(action),
      false,
      `${action} 不属于导入类动作`
    );
  });
};

const testCoveredGenerationIsCapturedBeforeSnapshotExport = () => {
  // exportLocalDataObject 内部有 await（哈希）：等它返回再抓代数会让
  // “覆盖代数”比被推送的内容更新，形成 false-clean。必须先抓后导出。
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "S1Plus.js"),
    "utf8"
  );
  const captureIndex = source.indexOf("captureCoveredContentGeneration();");
  const exportIndex = source.indexOf('"export_local_data",');
  assert.ok(captureIndex > 0 && exportIndex > 0);
  assert.ok(
    captureIndex < exportIndex,
    "自动同步必须在导出快照之前抓取覆盖代数"
  );

  // 手动同步：每处抓取都必须紧邻其后的 exportLocalDataObject 之前。
  const manualMarker = "captureManualCoveredContentGeneration();";
  const exportMarker = "exportLocalDataObject()";
  let from = 0;
  let checked = 0;
  while (true) {
    const captureIndex = source.indexOf(manualMarker, from);
    if (captureIndex < 0) break;
    const exportAfter = source.indexOf(exportMarker, captureIndex);
    assert.ok(exportAfter > captureIndex, "手动抓取后必须紧跟一次导出");
    assert.ok(
      exportAfter - captureIndex < 400,
      "手动同步必须在导出快照之前抓取覆盖代数"
    );
    checked += 1;
    from = captureIndex + manualMarker.length;
  }
  assert.ok(checked >= 3, `手动同步应有至少 3 处抓取，实际 ${checked}`);
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

// ------------------------------------------------------- 结构性强制（生产唯一入口）

const testCommitSyncedBaselineRequiresGeneration = () => {
  const harness = createHarness();
  const baseline = {
    contentHash: "h",
    localContentHash: "h",
    remoteContentHash: "h",
    remoteUpdatedAt: "2026-01-01T00:00:00Z",
  };
  assert.throws(
    () => harness.hooks.commitSyncedBaseline({ syncBaseline: baseline }),
    /缺少覆盖内容代数/,
    "缺省覆盖代数必须抛错（不得默默用此刻代数认证当前内容）"
  );
  assert.throws(
    () =>
      harness.hooks.commitSyncedBaseline({
        syncBaseline: baseline,
        coveredContentGeneration: 0,
      }),
    /覆盖内容代数无效/,
    "代数域为 [1, ∞)，0 必须被拒绝"
  );
  assert.throws(
    () => harness.hooks.commitSyncedBaseline({ coveredContentGeneration: 3 }),
    /需要基线对象/,
    "缺基线对象必须抛错"
  );

  const written = harness.hooks.commitSyncedBaseline({
    syncBaseline: baseline,
    coveredContentGeneration: 7,
    reason: "unit_test",
  });
  assert.equal(written.localContentGeneration, 7);
  assert.equal(harness.hooks.getSyncBaselineState().localContentGeneration, 7);
};

const testGenerationStaysMonotonicAcrossWriters = () => {
  const first = createHarness();
  const second = createHarness({ sharedStore: first.store });
  const seen = [];
  for (let index = 0; index < 5; index += 1) {
    writeProgress(index % 2 === 0 ? first : second, 10 + index);
    seen.push(readGeneration(first));
  }
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(
      seen[index] > seen[index - 1],
      `共享存储上的连续写入必须严格递增（第 ${index} 次: ${seen[index - 1]} -> ${seen[index]}）`
    );
  }
};

// ------------------------------------------------------- 覆盖判定的保守性

const testCoverageSyncSideWithoutGenerationRetainsPending = () => {
  // MAJOR-2：待同步请求带代数，但本次同步没有代数证据 → 无法证明被覆盖，
  // 必须保留（不得退回时间戳断言“已覆盖”）。
  const harness = createHarness();
  writeProgress(harness, 10);
  const dirtyGeneration = readGeneration(harness);
  seedPendingWithGeneration(harness, 100, dirtyGeneration);
  const retained = harness.hooks.clearPendingAutoSyncRequestIfCovered(9999, {
    coveredContentGeneration: 0,
  });
  assert.equal(
    retained.status,
    "retained",
    "同步侧缺代数时必须保守保留待同步请求"
  );
  assert.equal(harness.store.has(PENDING_AUTO_SYNC_KEY), true);
};

const testCoverageSyncSideWithoutGenerationRetainsSharedDebounce = () => {
  const harness = createHarness();
  const now = Date.now();
  writeProgress(harness, 10);
  const stateGeneration = readGeneration(harness);
  harness.store.set("s1p_background_sync_debounce_state", {
    version: 1,
    generation: 7,
    contentGeneration: stateGeneration,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 1000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: 100,
    sources: { read_progress: 1 },
    threadIds: ["123456"],
    reason: "debounced_read_progress",
  });
  const retained = harness.hooks.clearSharedBackgroundSyncDebounceIfCovered({
    generation: 7,
    coveredLastModified: 9999,
    coveredContentGeneration: 0,
  });
  assert.equal(
    retained.status,
    "retained",
    "同步侧缺代数时不得凭时间戳清掉共享调度状态"
  );
  assert.equal(harness.store.has("s1p_background_sync_debounce_state"), true);
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
    localContentGeneration: harness.hooks.getLocalContentGeneration(),
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
  testIntermediateBaselineUsesFingerprintInsteadOfConservativeDirty();
  testBaselineBindsToSyncedSnapshotGeneration();
  testImportBasedActionsDoNotBindExportGeneration();
  testCoveredGenerationIsCapturedBeforeSnapshotExport();
  testCoveredCleanupUsesContentGeneration();
  testCoveredCleanupRetainsWhenGenerationMissing();
  testCommitSyncedBaselineRequiresGeneration();
  testGenerationStaysMonotonicAcrossWriters();
  testCoverageSyncSideWithoutGenerationRetainsPending();
  testCoverageSyncSideWithoutGenerationRetainsSharedDebounce();
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
