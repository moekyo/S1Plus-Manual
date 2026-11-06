#!/usr/bin/env node
"use strict";

// [ARCH-INV-1/3/4] 性质测试：同步需求由“本地业务快照 vs 基线业务快照”派生；
// 远端快照只能经唯一应用边界进入；合并式拉取必须显式产出回写需求；
// 同步引擎与指示器共用同一份派生，不再有第二套时间戳/哈希权威。

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露同步派生需求测试钩子。",
  });

const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY =
  "s1p_background_sync_debounce_state";
const LAST_LOCAL_MODIFIED_KEY = "s1p_last_modified";
const NAVBAR_SURFACE = "navbar";

const IDLE_STATE = Object.freeze({
  phase: "idle",
  timestamp: 0,
  token: "",
  source: "",
  reason: "",
  operation: "",
  lastResolvedPhase: "idle",
  lastResolvedTimestamp: 0,
  lastResolvedSource: "",
  lastResolvedReason: "",
});

const makeProgressRecord = ({
  postId = "70000001",
  page = "1",
  floor = "12",
  timestamp = 1700000000000,
  saveReason = "user_interaction",
} = {}) => ({
  postId,
  page,
  lastReadFloor: floor,
  timestamp,
  provenance: {
    sourceTabId: "s1p_tab_test",
    threadId: "123456",
    page,
    saveReason,
    documentVisibilityState: "visible",
    hadConfirmedVisiblePost: true,
    createdAt: timestamp,
    initiatedWhileHidden: false,
    saveKind: "real_reading",
  },
});

const seedReadProgress = (harness, progress) => {
  const { hooks, sandbox } = harness;
  sandbox.GM_setValue("s1p_read_progress", progress);
  hooks.s1pCoreBusinessData.syncFromStorage({
    kinds: ["readProgress"],
    applyImmediately: true,
  });
  assert.deepStrictEqual(
    toPlainObject(hooks.getReadProgress()),
    progress,
    "阅读进度应当被核心数据模块同步"
  );
};

const bumpLocalModified = (sandbox, surrogate) => {
  sandbox.GM_setValue(LAST_LOCAL_MODIFIED_KEY, surrogate);
};

const registerPendingSyncEvent = (harness, now, source = "read_progress") => {
  harness.sandbox.GM_setValue(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source,
    lastModified: now,
    maxLastModified: now,
    createdAt: now,
    firstDirtyAt: now,
    lastDirtyAt: now,
    sources: { [source]: 1 },
    threadIds: ["123456"],
  });
};

const setBaselineFromLive = (harness, hash = "hash-baseline") => {
  harness.hooks.setSyncBaselineState({
    contentHash: hash,
    localContentHash: hash,
    remoteContentHash: hash,
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  return harness.hooks.getSyncBaselineState();
};

const readNavbarProjection = (harness, state = IDLE_STATE) =>
  toPlainObject(
    harness.hooks.s1pSyncSystem.readState({
      surface: NAVBAR_SURFACE,
      state,
      allowCache: false,
    })
  );

// ---------------------------------------------------------------- INV-1 显示层

const testNoBaselineIsUnavailableNotPending = () => {
  const harness = createHarness();
  const need = harness.hooks.deriveSyncNeed();
  assert.equal(need.available, false, "无基线指纹时派生需求不可用");
  assert.equal(need.push.needed, false, "不可用时不得凭空判出待推送");
  assert.equal(need.reason, "baseline_fingerprint_missing");
};

const testCleanContentAfterBaselineHasNoPending = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord() });
  bumpLocalModified(harness.sandbox, 5000);
  const baseline = setBaselineFromLive(harness);
  assert.equal(typeof baseline.localBaseFingerprint, "string");
  assert.notEqual(baseline.localBaseFingerprint, "");

  const need = harness.hooks.deriveSyncNeed();
  assert.equal(need.available, true);
  assert.equal(need.push.needed, false, "内容等于基线时不得待推送");
  assert.equal(readNavbarProjection(harness).displayPhase, "idle");
};

const testNewerWatermarkWithEqualContentIsNotPending = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord() });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);

  const now = Date.now();
  bumpLocalModified(harness.sandbox, now + 60000);
  registerPendingSyncEvent(harness, now + 60000);
  harness.sandbox.GM_setValue(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 9,
    ownerTabId: "tab-other",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 1000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now + 60000,
    sources: { read_progress: 1 },
    threadIds: ["123456"],
    reason: "debounced_read_progress",
  });

  const need = harness.hooks.deriveSyncNeed({ now });
  assert.equal(need.available, true);
  assert.equal(
    need.push.needed,
    false,
    "水印/调度状态不得单独把业务内容相同的本地判成脏"
  );
  assert.equal(
    readNavbarProjection(harness).displayPhase,
    "idle",
    "内容等于基线时即使有新鲜调度状态也不得显示待推送"
  );
};

const testReadProgressAdvanceIsPending = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "10" }) });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);

  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 9000);
  registerPendingSyncEvent(harness, 9000);

  const need = harness.hooks.deriveSyncNeed();
  assert.equal(need.available, true);
  assert.equal(need.push.needed, true, "阅读进度前进属于真实本地变更");
  assert.equal(need.push.reason, "local_read_progress_changed");
  assert.deepStrictEqual(toPlainObject(need.push.sources), {
    read_progress: 1,
  });

  const projection = readNavbarProjection(harness);
  assert.equal(projection.displayPhase, "pending");
  assert.equal(projection.displayOperation, "push");
  assert.equal(
    harness.hooks.getAutoSyncIndicatorTitle(projection),
    "自动同步：阅读进度待推送"
  );
};

const testContentDiffWithoutRegisteredEventStaysIdle = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "10" }) });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);

  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 9000);

  assert.equal(
    harness.hooks.deriveSyncNeed().push.needed,
    true,
    "内容差异本身仍由派生需求如实表达"
  );
  assert.equal(
    readNavbarProjection(harness).displayPhase,
    "idle",
    "未登记同步事件的内容差异不得显示为待推送"
  );

  registerPendingSyncEvent(harness, 9000);
  assert.equal(
    readNavbarProjection(harness).displayPhase,
    "pending",
    "登记同步事件后，同一内容差异必须显示待推送"
  );
};

const testSameFloorProvenanceRewriteIsNotPending = () => {
  const harness = createHarness();
  seedReadProgress(harness, {
    123456: makeProgressRecord({ floor: "12", timestamp: 1700000000000 }),
  });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);

  seedReadProgress(harness, {
    123456: makeProgressRecord({
      floor: "12",
      timestamp: 1700000000000,
      saveReason: "visibility_hidden_flush",
    }),
  });
  bumpLocalModified(harness.sandbox, 12000);

  assert.equal(
    harness.hooks.deriveSyncNeed().push.needed,
    false,
    "同楼层重写不得因为 provenance 变化而被判成脏"
  );
};

const testDerivedNeedIsFrozenDirectionalStructure = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord() });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);
  const need = harness.hooks.deriveSyncNeed();
  assert.equal(Object.isFrozen(need), true, "派生需求必须是冻结结构");
  assert.equal(Object.isFrozen(need.push), true);
  assert.equal(Object.isFrozen(need.pull), true);
  assert.equal(Object.isFrozen(need.push.sources), true);
  assert.equal(need.pull.needed, false);
  assert.equal(need.pull.reason, "requires_remote_probe");
};

const testFingerprintProjectionIgnoresVolatileFields = () => {
  const harness = createHarness();
  const first = harness.hooks.buildSyncBusinessFingerprintPair({
    read_progress: {
      1: {
        postId: "10",
        page: "1",
        lastReadFloor: "3",
        timestamp: 1,
        provenance: { createdAt: 1 },
      },
    },
    threads: { 1: { id: 1 } },
  });
  const second = harness.hooks.buildSyncBusinessFingerprintPair({
    read_progress: {
      1: {
        postId: "10",
        page: "1",
        lastReadFloor: "3",
        timestamp: 999,
        provenance: { createdAt: 999 },
      },
    },
    threads: { 1: { id: 1 } },
  });
  assert.equal(first.progressFingerprint, second.progressFingerprint);
  assert.equal(first.baseFingerprint, second.baseFingerprint);

  const advanced = harness.hooks.buildSyncBusinessFingerprintPair({
    read_progress: { 1: { postId: "10", page: "1", lastReadFloor: "4" } },
    threads: { 1: { id: 1 } },
  });
  assert.notEqual(first.progressFingerprint, advanced.progressFingerprint);
};

const testBaselineFingerprintSourceIsRecorded = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord() });
  bumpLocalModified(harness.sandbox, 5000);
  const liveBaseline = setBaselineFromLive(harness);
  assert.equal(
    liveBaseline.fingerprintSource,
    "live",
    "仅传哈希的基线只能作为显示参考，不能作引擎权威"
  );

  const snapshotBaseline = harness.hooks.buildSyncBaselineStateForDataPair({
    localDataObject: { contentHash: "h", data: { settings: {} } },
    remoteDataObject: { contentHash: "h", data: { settings: {} } },
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  harness.hooks.setSyncBaselineState(snapshotBaseline);
  assert.equal(
    harness.hooks.getSyncBaselineState().fingerprintSource,
    "snapshot",
    "由真实快照对产出的基线必须标记为 snapshot 权威"
  );
};

const testPartialFingerprintIsCompleted = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord() });
  bumpLocalModified(harness.sandbox, 5000);
  harness.hooks.setSyncBaselineState({
    contentHash: "partial",
    localContentHash: "partial",
    remoteContentHash: "partial",
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    localBaseFingerprint: "only-base",
  });
  const baseline = harness.hooks.getSyncBaselineState();
  assert.notEqual(
    baseline.localProgressFingerprint,
    "",
    "只给一侧指纹时必须补齐另一侧，避免永久待推送"
  );
};

// ------------------------------------------------- INV-3/INV-4 边界与引擎权威

const buildFlatRemoteGist = (localData, progress) => ({
  ...JSON.parse(JSON.stringify(localData)),
  settings: localData.settings,
  read_progress: progress,
});

const testApplyBoundaryRejectsUnbrandedSnapshot = () => {
  const harness = createHarness();
  assert.throws(
    () =>
      harness.hooks.applyRemoteSnapshotToLocal({
        remoteDataObject: { full: { data: {}, version: 5.0 } },
        origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_OVERWRITE,
      }),
    /必须来自 migrateAndValidateRemoteData/,
    "未经过校验的原始快照必须被边界拒绝"
  );
};

const testApplyBoundaryRejectsUnbrandedMergedPayload = () => {
  const harness = createHarness();
  assert.throws(
    () =>
      harness.hooks.applyRemoteSnapshotToLocal({
        origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_MERGED_PAYLOAD,
        mergedPayload: { data: {}, version: 5.0 },
      }),
    /合并载荷必须由 buildMergedReadProgressPayload 产出/,
    "未 brand 的合并载荷同样必须被边界拒绝"
  );
};

const testPullMergeKeepsLocalReadProgress = async () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 5000);
  const localObject = await harness.hooks.exportLocalDataObject({
    useFreshSnapshot: true,
  });
  const remote = await harness.hooks.migrateAndValidateRemoteData(
    buildFlatRemoteGist(localObject.data, {
      123456: makeProgressRecord({ floor: "10" }),
    })
  );

  const first = harness.hooks.applyRemoteSnapshotToLocal({
    remoteDataObject: remote,
    origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_PULL_MERGE,
    localDataObject: localObject,
  });
  assert.equal(first.success, true);
  assert.equal(first.mergedReadProgressChanged, true);
  assert.equal(
    toPlainObject(harness.hooks.getReadProgress())["123456"].lastReadFloor,
    "12",
    "合并式拉取必须保留设备本地更靠后的阅读进度"
  );

  const appliedProgress = toPlainObject(harness.hooks.getReadProgress());
  harness.hooks.applyRemoteSnapshotToLocal({
    remoteDataObject: remote,
    origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_PULL_MERGE,
    localDataObject: localObject,
  });
  assert.deepStrictEqual(
    toPlainObject(harness.hooks.getReadProgress()),
    appliedProgress,
    "同一对快照重复应用必须幂等"
  );
};

const testOverwriteOriginStillOverwrites = async () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 5000);
  const localObject = await harness.hooks.exportLocalDataObject({
    useFreshSnapshot: true,
  });
  const remote = await harness.hooks.migrateAndValidateRemoteData(
    buildFlatRemoteGist(localObject.data, {
      123456: makeProgressRecord({ floor: "3" }),
    })
  );
  const result = harness.hooks.applyRemoteSnapshotToLocal({
    remoteDataObject: remote,
    origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_OVERWRITE,
  });
  assert.equal(result.success, true);
  assert.equal(result.mergedReadProgressChanged, false);
  assert.equal(
    toPlainObject(harness.hooks.getReadProgress())["123456"].lastReadFloor,
    "3",
    "强制拉取/覆盖语义必须保持不变"
  );
};

const testMergedPullProducesExplicitConvergenceNeed = async () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 5000);
  const localObject = await harness.hooks.exportLocalDataObject({
    useFreshSnapshot: true,
  });
  const remote = await harness.hooks.migrateAndValidateRemoteData(
    buildFlatRemoteGist(localObject.data, {
      123456: makeProgressRecord({ floor: "10" }),
    })
  );
  harness.hooks.applyRemoteSnapshotToLocal({
    remoteDataObject: remote,
    origin: harness.hooks.SYNC_REMOTE_APPLY_ORIGIN_PULL_MERGE,
    localDataObject: localObject,
  });
  harness.hooks.setSyncBaselineState(
    harness.hooks.buildSyncBaselineStateForDataPair({
      localDataObject: remote,
      remoteDataObject: remote,
      remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    })
  );

  const need = harness.hooks.deriveSyncNeed();
  assert.equal(need.available, true);
  assert.equal(
    need.authoritative,
    true,
    "来自真实快照对的基线指纹应可作为引擎权威"
  );
  assert.equal(
    need.push.needed,
    true,
    "合并式拉取后必须显式产出回写云端的收敛需求"
  );
  assert.equal(need.push.reason, "local_read_progress_changed");
  registerPendingSyncEvent(harness, Date.now());
  assert.equal(readNavbarProjection(harness).displayPhase, "pending");
  assert.equal(readNavbarProjection(harness).displayOperation, "push");
};

const testEngineConsumesSharedDerivation = async () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 5000);
  const localObject = await harness.hooks.exportLocalDataObject({
    useFreshSnapshot: true,
  });
  harness.hooks.setSyncBaselineState(
    harness.hooks.buildSyncBaselineStateForDataPair({
      localDataObject: localObject,
      remoteDataObject: localObject,
      remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    })
  );
  const remoteObject = { ...localObject };

  const provenanceOnlyLocal = {
    ...localObject,
    contentHash: "local-hash-with-newer-provenance",
    data: {
      ...localObject.data,
      read_progress: {
        123456: makeProgressRecord({
          floor: "12",
          timestamp: 1700000009999,
          saveReason: "visibility_hidden_flush",
        }),
      },
    },
  };
  const decision = harness.hooks.decideSyncActionByVersion({
    localDataObject: provenanceOnlyLocal,
    remoteDataObject: remoteObject,
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    syncMode: "background",
  });
  assert.equal(
    decision.action,
    "no_change",
    "引擎必须与显示共用内容派生，不能因易变字段产生推送"
  );

  const realContentChange = {
    ...localObject,
    contentHash: "local-hash-real-change",
    data: {
      ...localObject.data,
      settings: { ...localObject.data.settings, engineAuthorityProbe: true },
    },
  };
  const changeDecision = harness.hooks.decideSyncActionByVersion({
    localDataObject: realContentChange,
    remoteDataObject: remoteObject,
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    syncMode: "background",
  });
  assert.equal(
    changeDecision.action,
    "push",
    "业务内容真实变化时引擎仍必须推送"
  );
};

const testForegroundPendingSurvivesDirtyContent = () => {
  const harness = createHarness();
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "10" }) });
  bumpLocalModified(harness.sandbox, 5000);
  setBaselineFromLive(harness);
  seedReadProgress(harness, { 123456: makeProgressRecord({ floor: "12" }) });
  bumpLocalModified(harness.sandbox, 9000);
  assert.equal(
    harness.hooks.deriveSyncNeed().push.needed,
    true,
    "前置条件：本地内容确实已脏"
  );
  harness.hooks.markPendingForegroundRemoteSyncRequest({
    remoteUpdatedAt: "2026-01-02T00:00:00.000Z",
    reason: "remote_probe_changed",
    now: Date.now(),
  });
  const displayState = toPlainObject(
    harness.hooks.getAutoSyncRuntimePendingDisplayState()
  );
  assert.equal(
    displayState.hasPending,
    true,
    "有云端待处理事实时不得被内容脏状态遮蔽"
  );
  assert.equal(
    displayState.source,
    "foreground_resume",
    "应显示前台/云端方向，而不是本地推送方向"
  );
};

const runAsync = async () => {
  testNoBaselineIsUnavailableNotPending();
  testCleanContentAfterBaselineHasNoPending();
  testNewerWatermarkWithEqualContentIsNotPending();
  testReadProgressAdvanceIsPending();
  testContentDiffWithoutRegisteredEventStaysIdle();
  testSameFloorProvenanceRewriteIsNotPending();
  testDerivedNeedIsFrozenDirectionalStructure();
  testFingerprintProjectionIgnoresVolatileFields();
  testBaselineFingerprintSourceIsRecorded();
  testPartialFingerprintIsCompleted();
  testApplyBoundaryRejectsUnbrandedSnapshot();
  testApplyBoundaryRejectsUnbrandedMergedPayload();
  testForegroundPendingSurvivesDirtyContent();
  await testPullMergeKeepsLocalReadProgress();
  await testOverwriteOriginStillOverwrites();
  await testMergedPullProducesExplicitConvergenceNeed();
  await testEngineConsumesSharedDerivation();
  console.log(
    "[sync-derived-need] INV-1 display derivation, INV-3 boundary, INV-4 convergence and engine authority verified."
  );
};

runAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
