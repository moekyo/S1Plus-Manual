#!/usr/bin/env node
"use strict";

// [ARCH-INV-6] 唯一执行机制：把架构不变量固化为可执行的静态契约检查。
// 本文件是唯一白名单：新增/绕过不变量必须修改这里，因此是一次评审可见的行为。
//
// 检查的是“结构”而不是行为。清单式数字（MANIFEST）不是风格约定，而是
// “新增一个读取点/写入点就必须在这里显式声明”的强制声明点。

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "S1Plus.js"), "utf8");

// 显式清单：改动这些结构必须同步更新数字，否则检查失败。
const MANIFEST = Object.freeze({
  // 唯一远端应用边界 + 手动文本恢复入口（已声明例外）。
  importLocalDataCallSites: 2,
  // brand 的唯一写入点，必须分别位于校验函数与合并载荷生产者内部。
  remoteBrandAddSites: 1,
  mergedPayloadBrandAddSites: 1,
  // running 相位标记总数（常量/归一化/debug/内存运行态）。新增必须在此声明；
  // 若新增标记属于持久化写入，INV-5 检查会失败。
  runningPhaseMarkers: 8,
  // 待推送水印/pending 键的读取点总数（新增即声明）。
  pendingKeyReferences: 6,
});

// 尚未落地的不变量：显式记录，不允许静默通过。
const PENDING_INVARIANTS = Object.freeze([]);

// 迁移期兼容：旧基线没有业务指纹时，显示层会回退到水印判断。
// 这是有明确移除条件的临时路径，不是长期权威。
const LEGACY_FALLBACK = Object.freeze({
  id: "INV-1-legacy-fallback",
  appliesWhen: "基线缺少 localBaseFingerprint/localProgressFingerprint（旧版本写入）",
  removalCriterion: "所有被支持的旧版本至少完成一次同步后删除水印回退分支；" +
    "可由发布说明中的迁移窗口到期触发。",
});

const countOccurrences = (needle) => source.split(needle).length - 1;

const sliceBetween = (startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `未找到结构锚点：${startNeedle}`);
  const end = endNeedle ? source.indexOf(endNeedle, start) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
};

const checkInv1DerivedNeedAuthority = () => {
  const pendingDisplayBlock = sliceBetween(
    "const getAutoSyncRuntimePendingDisplayState = (now = Date.now()) => {",
    "const getAutoSyncRuntimeRunningDisplayState = ("
  );
  assert.match(
    pendingDisplayBlock,
    /hasRegisteredSyncEvent/,
    "INV-1：待推送必须要求“已登记同步事件”，否则受抑制写入会被误报。"
  );
  assert.match(
    pendingDisplayBlock,
    /deriveSyncNeed\(\{ now \}\)/,
    "INV-1：待推送显示必须消费派生需求。"
  );
  assert.match(
    pendingDisplayBlock,
    /syncNeed\.available === true/,
    "INV-1：派生不可用（旧基线）时才能回退水印，必须由 available 守卫。"
  );
  const derivedIndex = pendingDisplayBlock.indexOf("deriveSyncNeed(");
  const watermarkIndex = pendingDisplayBlock.indexOf(
    "isAutoSyncIndicatorPendingTimestampFresh("
  );
  assert.ok(
    watermarkIndex === -1 || derivedIndex < watermarkIndex,
    "INV-1：派生判定必须在水印兜底之前。"
  );

  // 引擎与显示共用同一份派生，消除第二套权威。
  const engineBlock = sliceBetween(
    "const decideSyncActionByVersion = ({",
    "const getSyncLockModeProfile = (mode) => {"
  );
  assert.match(
    engineBlock,
    /deriveSyncNeed\(\{ dataObject: localDataObject \}\)/,
    "INV-1：同步决策必须消费同一份派生，否则 contentHash/时间戳仍是第二套权威。"
  );
  assert.match(
    engineBlock,
    /localSyncNeed\.authoritative === true/,
    "INV-1：只有真实快照对产出的基线指纹才能作为引擎权威。"
  );

  // 指纹缓存与内容哈希缓存同寿命；缺失一侧指纹必须补齐。
  assert.match(
    sliceBetween(
      "const invalidateLocalDataHashCache = () => {",
      "const SYNC_DIAGNOSTICS_DEFAULT = Object.freeze({"
    ),
    /invalidateLocalSyncBusinessFingerprintCache\(\)/,
    "INV-1：业务指纹缓存必须随任何数据写入失效。"
  );
  assert.match(
    sliceBetween(
      "const setSyncBaselineState = ({",
      "const getSyncDeltaSourceNames = (sources = {}) =>"
    ),
    /hasExplicitFingerprint[\s\S]{0,1200}fingerprintSource: explicitFingerprintPair \? "snapshot" : "live"/,
    "INV-1：基线必须补齐单侧指纹，并记录指纹来源（snapshot/live）。"
  );

  assert.equal(
    countOccurrences("PENDING_AUTO_SYNC_KEY"),
    MANIFEST.pendingKeyReferences,
    "INV-1：PENDING_AUTO_SYNC_KEY 出现次数变化，必须在 MANIFEST.pendingKeyReferences 中显式声明。"
  );
  assert.equal(typeof LEGACY_FALLBACK.removalCriterion, "string");
  assert.ok(LEGACY_FALLBACK.removalCriterion.length > 0);
  assert.match(
    pendingDisplayBlock,
    /hasRegisteredSyncEvent[\s\S]{0,600}syncNeed\.available === true/,
    "INV-1：水印回退必须处于“派生不可用”分支之后，旧基线迁移路径不得成为主判定。"
  );
};

const checkInv2FrozenDirectionalStructure = () => {
  const needBlock = sliceBetween(
    "const deriveSyncNeed = ({ now = Date.now(), dataObject = null } = {}) => {",
    "const buildSyncBaselineStateForDataPair = ({"
  );
  // 锚定到槽位自身的对象字面量，避免跨槽位匹配造成“空转通过”。
  assert.match(
    needBlock,
    /pull: Object\.freeze\(\{\s*needed: false,\s*reason: "requires_remote_probe",\s*\}\)/,
    "INV-2：pull 槽位必须是 frozen 且当前取值为 needed:false/requires_remote_probe。"
  );
  assert.match(
    needBlock,
    /push: Object\.freeze\(\{\s*needed: pushNeeded,/,
    "INV-2：push 槽位必须是 frozen 且由同一派生结果驱动。"
  );
  assert.match(
    needBlock,
    /authoritative: fingerprintAuthority,/,
    "INV-2：派生结果必须携带权威级别（引擎只信任 snapshot 基线）。"
  );

  // 投影层：双向槽位必须是必填输出，而不是死数据。
  const projectionBlock = sliceBetween(
    "const projectSyncIndicatorState = (",
    "const resolveTitleSyncIndicatorProjectionPhase = ("
  );
  assert.match(
    projectionBlock,
    /buildSyncIndicatorDirectionalState\(\{/,
    "INV-2：投影必须通过唯一方向构建器产出槽位。"
  );
  assert.match(
    projectionBlock,
    /directional: directionalState/,
    "INV-2：投影结果必须携带 directional 槽位。"
  );
  const builderBlock = sliceBetween(
    "const buildSyncIndicatorDirectionalState = ({",
    "const projectSyncIndicatorState = ("
  );
  assert.match(
    builderBlock,
    /pull: buildSlot\(\{/,
    "INV-2：方向构建器必须产出 pull 槽位。"
  );
  assert.match(
    builderBlock,
    /push: buildSlot\(\{/,
    "INV-2：方向构建器必须产出 push 槽位。"
  );
  assert.match(
    builderBlock,
    /return Object\.freeze\(\{/,
    "INV-2：方向槽位容器必须是冻结结构。"
  );

  // 消费者：双槽位必须被渲染层与诊断层读取，否则不变量形同虚设。
  const titleBlock = sliceBetween(
    "const getAutoSyncIndicatorTitle = (stateInput = null) => {",
    "const getAutoSyncIndicatorTooltip = (stateInput = null) => {"
  );
  assert.match(
    titleBlock,
    /resolvedState\.directional/,
    "INV-2：标题必须消费方向槽位，不能只看单值 displayPhase。"
  );
  assert.match(
    titleBlock,
    /pullSlot[\s\S]{0,400}pushSlot|pushSlot[\s\S]{0,400}pullSlot/,
    "INV-2：标题必须同时使用 pull 与 push 两个槽位。"
  );

  const renderBlock = sliceBetween(
    "const renderNavbarAutoSyncIndicator = (",
    "const registerAutoSyncIndicatorDebugApi = () => {"
  );
  assert.match(
    renderBlock,
    /dataset\.syncPull/,
    "INV-2：导航栏必须把拉取方向暴露到 DOM。"
  );
  assert.match(
    renderBlock,
    /dataset\.syncPush/,
    "INV-2：导航栏必须把推送方向暴露到 DOM。"
  );

  const diagnosticsBlock = sliceBetween(
    "const buildSyncIndicatorDirectionalDiagnosticRow = () => {",
    "const buildSyncDiagnosticsSummary = () => {"
  );
  assert.match(
    diagnosticsBlock,
    /directional\.pull/,
    "INV-2：诊断快照必须列出拉取方向。"
  );
  assert.match(
    diagnosticsBlock,
    /directional\.push/,
    "INV-2：诊断快照必须列出推送方向。"
  );
};

const checkInv3SingleApplyBoundary = () => {
  assert.equal(
    countOccurrences("importLocalData("),
    MANIFEST.importLocalDataCallSites,
    "INV-3：importLocalData 只允许出现在唯一边界内部与手动文本恢复入口。"
  );
  assert.match(
    source,
    /importLocalData\(jsonStr\)/,
    "INV-3：第二个调用点必须是已声明的手动文本恢复入口。"
  );
  assert.match(
    source,
    /const applyRemoteSnapshotToLocal = \(\{/,
    "INV-3：缺少唯一远端应用边界。"
  );
  assert.match(
    source,
    /!isBrandedRemoteSyncSnapshot\(remoteDataObject\)[\s\S]{0,160}throw new TypeError/,
    "INV-3：边界必须拒绝未 brand 的远端快照。"
  );
  assert.match(
    source,
    /!isBrandedMergedSyncPayload\(mergedPayload\)[\s\S]{0,160}throw new TypeError/,
    "INV-3：边界必须拒绝未 brand 的合并载荷（否则 MERGED_PAYLOAD 可绕过校验）。"
  );
  assert.equal(
    countOccurrences("REMOTE_SYNC_SNAPSHOT_BRANDS.add("),
    MANIFEST.remoteBrandAddSites,
    "INV-3：远端 brand 只能有一个写入点（校验函数内部），否则可被任意伪造。"
  );
  assert.match(
    sliceBetween(
      "const migrateAndValidateRemoteData = async",
      "const getRemoteSyncExecutionSkipResult = (settingsSnapshot) => {"
    ),
    /REMOTE_SYNC_SNAPSHOT_BRANDS\.add\(brandedRemoteSnapshot\)/,
    "INV-3：远端 brand 必须在校验函数内部写入。"
  );
  assert.equal(
    countOccurrences("MERGED_SYNC_PAYLOAD_BRANDS.add("),
    MANIFEST.mergedPayloadBrandAddSites,
    "INV-3：合并载荷 brand 只能有一个写入点。"
  );
  assert.match(
    sliceBetween(
      "const brandMergedSyncPayload = (payload) => {",
      "const isBrandedMergedSyncPayload = (payload) =>"
    ),
    /MERGED_SYNC_PAYLOAD_BRANDS\.add\(payload\)/,
    "INV-3：合并载荷 brand 必须在唯一 brand 函数内写入。"
  );
  assert.equal(
    countOccurrences("brandMergedSyncPayload("),
    1,
    "INV-3：合并载荷 brand 函数只允许被唯一生产者调用一次。"
  );
  assert.match(
    sliceBetween(
      "const buildMergedReadProgressPayload = async (",
      "const buildComparableDataWithoutReadProgress = ("
    ),
    /payload: brandMergedSyncPayload\(mergedPayload\)/,
    "INV-3：合并载荷必须由唯一生产者打 brand。"
  );
  assert.match(
    source,
    /const remoteDataRecord = isObjectRecord\(remoteDataObject\?\.data\)/,
    "INV-3：合并式应用必须以校验产出的规范化 data 为准。"
  );
  assert.match(
    source,
    /success: false[\s\S]{0,400}unsupported_remote_shape/,
    "INV-3：载荷形状异常时必须拒绝应用，不得退回覆盖清空本地数据。"
  );
};

const checkInv4MergePullExplicitConvergence = () => {
  const pullBlock = sliceBetween(
    'message: "开始拉取并应用云端数据",',
    'case "merge_read_progress":'
  );
  assert.match(
    pullBlock,
    /SYNC_REMOTE_APPLY_ORIGIN_PULL_MERGE/,
    "INV-4：普通拉取必须走合并式应用边界。"
  );
  assert.match(
    pullBlock,
    /pullApplyResult\.mergedReadProgressChanged/,
    "INV-4：收敛推送必须由“合并后仍领先”这一结果驱动，而不是无条件触发。"
  );
  assert.match(
    pullBlock,
    /debouncedTriggerRemoteSyncPush\(\{[\s\S]{0,160}?source: "read_progress"/,
    "INV-4：收敛推送必须登记可跨刷新存活的持久化任务。"
  );
  assert.doesNotMatch(
    pullBlock,
    /requestBackgroundSyncRun\("merged_read_progress_outbound"/,
    "INV-4：收敛推送不得只依赖内存计时器（自动刷新会带走它）。"
  );
  assert.match(
    pullBlock,
    /pullApplyResult\.success !== true[\s\S]{0,1200}throw new Error/,
    "INV-4：应用失败必须中止，不得记录虚假的云端基线。"
  );
};

const checkInv5RunningStateNotPersisted = () => {
  assert.match(
    source,
    /let autoSyncIndicatorRuntimeRunningState = null;/,
    "INV-5：运行态必须是内存变量。"
  );
  assert.match(
    sliceBetween(
      "const getAutoSyncIndicatorState = () =>",
      "const backdateAutoSyncIndicatorRuntimeRunningForTest"
    ),
    /autoSyncIndicatorRuntimeRunningState \|\|\s*getPersistedAutoSyncIndicatorState\(\)/,
    "INV-5：状态读取必须先取内存运行态，再回退持久化结果。"
  );
  const persistCallPattern =
    /persistAutoSyncIndicatorState\(\{[\s\S]{0,200}?phase:\s*AUTO_SYNC_INDICATOR_PHASE_RUNNING/g;
  const violations = source.match(persistCallPattern) || [];
  assert.equal(
    violations.length,
    0,
    "INV-5：禁止把 RUNNING 相位写入持久化状态（会跨 reload 残留 ghost running）。"
  );
  assert.equal(
    countOccurrences("phase: AUTO_SYNC_INDICATOR_PHASE_RUNNING"),
    MANIFEST.runningPhaseMarkers,
    "INV-5：running 相位标记数量变化，必须在 MANIFEST.runningPhaseMarkers 中显式声明。"
  );
  assert.deepStrictEqual(
    PENDING_INVARIANTS.map((item) => item.id),
    [],
    "所有已声明不变量都已落地；新增待落地项必须更新 PENDING_INVARIANTS。"
  );
};

const run = () => {
  const checks = [
    ["INV-1 派生需求权威（显示 + 引擎）", checkInv1DerivedNeedAuthority],
    ["INV-2 双方向冻结结构", checkInv2FrozenDirectionalStructure],
    ["INV-3 唯一远端应用边界 + brand 唯一写入点", checkInv3SingleApplyBoundary],
    ["INV-4 合并拉取显式收敛", checkInv4MergePullExplicitConvergence],
    ["INV-5 运行态不持久化", checkInv5RunningStateNotPersisted],
  ];
  checks.forEach(([label, check]) => {
    check();
    console.log(`  ✓ ${label}`);
  });
  console.log(
    "[sync-architectural-invariants] Static contract check passed (INV-1..INV-5)."
  );
};

run();
