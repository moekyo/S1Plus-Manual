#!/usr/bin/env node
"use strict";

// [ARCH-INV-6] 唯一的静态契约检查文件：本文件是唯一白名单，
// 新增/绕过不变量必须修改这里，因此是一次评审可见的行为。
//
// 能力边界（如实声明，避免过度声称）：
// - 本文件是“存在性/形状/顺序”的绊线（tripwire），不是语义证明：
//   它能拦住“结构消失/文本改动/计数漂移”，但拦不住把守卫短路成 `if (false)`、
//   用别名/解构绕过计数、或在被扫描切片之外重新引入旧权威。
// - 真正由结构保证的是：内容写入漏斗（commitWrite → invalidateLocalDataHashCache）、
//   冻结的方向槽位、brand WeakSet、以及 persistAutoSyncIndicatorState 拒绝 RUNNING 的运行时守卫。
// - 语义正确性由行为测试（test-sync-*-authority/derived-need/running-not-persisted）兜底，
//   无法被文本契约覆盖的残余风险列在 PENDING_INVARIANTS 中。

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
  // 8 → 11：单值展示政策收敛为 resolveSyncIndicatorDisplaySelection 后，
  // running_lock / running_min_visible / running_write_in_flight 三个内存运行态
  // 改为对象字面量表达（仍是内存态，不落盘）。
  runningPhaseMarkers: 11,
  // 待推送水印/pending 键的读取点总数（新增即声明）。
  pendingKeyReferences: 6,
  // 本地内容代数的唯一递增点（invalidateLocalDataHashCache 内部）。
  contentGenerationBumpSites: 1,
});

// 尚未落地的不变量：显式记录，不允许静默通过。
// 尚未落地/无法用文本契约真正强制的不变量：显式记录，避免过度声称。
const PENDING_INVARIANTS = Object.freeze([
  {
    id: "INV-1-atomicity-residual",
    reason:
      "GM 无原子 CAS：代数递增用 max(已读+1, now)+回读重试逼近，但同一毫秒内两个标签页" +
      "仍可能算出相同的值，回读无法区分（后果是两份不同内容共享一个代数）。",
    removalCriterion: "改用具备原子递增语义的存储或跨标签页写锁后移除。",
  },
  {
    id: "INV-3-importLocalData-entry-reachable",
    reason:
      "导入原语本身已不可再取（工厂在闭包内创建、原语一次性注入），但 importLocalData " +
      "仍是模块级入口；单文件单作用域下无法让它物理不可达。",
    removalCriterion:
      "把 importLocalData 及其调用者移入独立闭包/模块，使只有边界可达后移除。",
  },
  {
    id: "INV-3-origin-declarative",
    reason:
      "origin 是声明式参数（拦截缺省、显式化意图），不是能力凭证；" +
      "真正的远端校验边界仍是 applyRemoteSnapshotToLocal 的 brand 检查。",
    removalCriterion:
      "把导入原语改为只能接收品牌化快照（或跨作用域不可伪造的令牌）后移除。",
  },
  {
    id: "INV-1-force-push-provenance-behavioral",
    reason:
      "force_push 的“先抓代数再导出”已有静态顺序断言，但没有像 asSuccessResult 那样的" +
      "performAutoSync 行为测试（该入口未暴露为测试钩子）。",
    removalCriterion: "为 handleForcePush 提供可注入的传输层并补行为测试后移除。",
  },
]);

// 迁移期兼容：旧基线没有业务指纹时，仅“显示层”回退到水印判断。
// 调度层（清洁门禁 / 待同步回收）已改为对缺失代数保守判脏，
// 因此这条回退只剩视觉影响，不会再造成 false-clean 丢推送。
const LEGACY_FALLBACK = Object.freeze({
  id: "INV-1-legacy-fallback",
  // 注意：显示层与调度层都会在“内容事实不可得”时使用旧基线的兜底，
  // 调度层的具体做法是“缺代数但可用指纹 → 指纹权威；都缺 → 保守判脏”。
  scope: "display_and_scheduling_conservative",
  appliesWhen:
    "基线缺少 localBaseFingerprint/localProgressFingerprint 或缺少 localContentGeneration（旧版本写入）",
  removalCriterion:
    "所有被支持的旧版本至少完成一次同步后删除显示层水印回退分支；" +
    "调度层不依赖该分支，删除它不影响推送正确性。",
});

const countOccurrences = (needle) => source.split(needle).length - 1;
const countOccurrencesIn = (text, needle) => String(text).split(needle).length - 1;

// 严格切片：**两端锚点都必须存在**，且结束锚点必须在开始锚点之后。
// 早期版本在找不到结束锚点时静默返回“文件剩余全部”，
// 会让断言在 97 万字符的窗口里随便命中，等于失效。
const sliceBetween = (startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `未找到结构锚点（开始）：${startNeedle}`);
  if (!endNeedle) {
    return source.slice(start);
  }
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(
    end,
    -1,
    `未找到结构锚点（结束）：${endNeedle}（开始锚点：${startNeedle}）`
  );
  assert.ok(
    end > start,
    `结束锚点必须位于开始锚点之后：${endNeedle} @ ${end} vs ${startNeedle} @ ${start}`
  );
  return source.slice(start, end);
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
  // 三值内容判定：指纹优先 → 内容代数 → 只有“内容事实不可得”才允许存活兜底。
  assert.match(
    pendingDisplayBlock,
    /const resolveContentDirtyForDisplay = \(\) => \{/,
    "INV-1：显示层必须有唯一的内容判定解析器。"
  );
  assert.match(
    pendingDisplayBlock,
    /syncNeed\.available === true[\s\S]{0,400}authority: "fingerprint"/,
    "INV-1：指纹可用时必须用指纹作为内容权威。"
  );
  assert.match(
    pendingDisplayBlock,
    /if \(generationDirtyState\.known === true\) \{[\s\S]{0,600}?authority: "generation"/,
    "INV-1：指纹不可用但有代数时必须用代数作为内容权威（含 known 守卫）。"
  );
  assert.match(
    pendingDisplayBlock,
    /dirty: null,[\s\S]{0,200}content_truth_unavailable/,
    "INV-1：内容事实不可得必须是显式的第三态，而不是默认退回时间戳。"
  );
  assert.match(
    pendingDisplayBlock,
    /contentDirtyState\.dirty === true[\s\S]{0,600}contentDirtyState\.dirty === false/,
    "INV-1：三值判定必须先处理 true/false，剩余才是迁移兜底。"
  );
  const derivedIndex = pendingDisplayBlock.indexOf("resolveContentDirtyForDisplay");
  const watermarkIndex = pendingDisplayBlock.indexOf(
    "isAutoSyncIndicatorPendingTimestampFresh("
  );
  assert.ok(
    watermarkIndex === -1 || derivedIndex < watermarkIndex,
    "INV-1：内容判定必须在存活兜底之前。"
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
    /hasExplicitFingerprint[\s\S]{0,2400}fingerprintSource: explicitFingerprintPair \? "snapshot" : "live"/,
    "INV-1：基线必须补齐单侧指纹，并记录指纹来源（snapshot/live）。"
  );

  assert.equal(
    countOccurrences("PENDING_AUTO_SYNC_KEY"),
    MANIFEST.pendingKeyReferences,
    "INV-1：PENDING_AUTO_SYNC_KEY 出现次数变化，必须在 MANIFEST.pendingKeyReferences 中显式声明。"
  );

  // 调度层：本地内容代数是“是否需要同步”的唯一权威。
  const generationAccessorBlock = sliceBetween(
    "const getLocalContentGeneration = () =>",
    "const invalidateLocalDataHashCache = () => {"
  );
  assert.match(
    generationAccessorBlock,
    /LOCAL_CONTENT_GENERATION_KEY/,
    "INV-1：必须存在本地内容代数的读取出口。"
  );
  assert.equal(
    countOccurrences("bumpLocalContentGeneration()"),
    MANIFEST.contentGenerationBumpSites + 1,
    "INV-1：代数递增只允许“定义处 1 次 + 唯一写入检查点 N 次”；" +
      "新增递增点必须在 MANIFEST.contentGenerationBumpSites 中显式声明。"
  );
  assert.match(
    sliceBetween(
      "const invalidateLocalDataHashCache = () => {",
      "const SYNC_DIAGNOSTICS_DEFAULT = Object.freeze({"
    ),
    /bumpLocalContentGeneration\(\)/,
    "INV-1：内容/设置写入必须经过唯一检查点推进代数（不依赖调用方打点）。"
  );

  const dirtyPredicateBlock = sliceBetween(
    "const isLocalContentDirtySinceBaseline = () => {",
    "const getSyncDeltaSourceNames = (sources = {}) =>"
  );
  assert.match(
    dirtyPredicateBlock,
    /dirty: true,\s*known: false,\s*authority: "unknown",\s*reason: "baseline_generation_missing"/,
    "INV-1：旧基线缺代数且无指纹时必须保守判脏（禁止 false-clean）。"
  );
  // 中间版本基线（有指纹无代数）必须用指纹，避免显示/调度不一致。
  assert.match(
    dirtyPredicateBlock,
    /if \(!Number\.isFinite\(rawBaselineGeneration\)\) \{[\s\S]{0,600}?fingerprintNeed\.available === true[\s\S]{0,200}?authority: "fingerprint"/,
    "INV-1：缺代数但有业务指纹时，调度层必须回落到指纹权威。"
  );

  // 清洁门禁：不得再用“两次独立时间比较”作为权威。
  const cleanFenceBlock = sliceBetween(
    "const shouldSkipAutoSyncDueToCleanState = ({",
    "const mergeBackgroundSyncDebounceSources = (state, source) =>"
  );
  assert.match(
    cleanFenceBlock,
    /isLocalContentDirtySinceBaseline\(\)/,
    "INV-1：清洁门禁必须消费内容代数额判定。"
  );
  assert.doesNotMatch(
    cleanFenceBlock,
    /lastLocalMutationTs\s*>\s*lastSuccessfulSyncTs/,
    "INV-1：清洁门禁不得回到“本地改动时间 > 上次同步时间”的水印权威。"
  );

  // 待同步回收：不得用时间戳比较直接丢弃请求。
  const recoveryBlock = sliceBetween(
    "const recoverPendingBackgroundAutoSyncIfNeeded = () => {",
    "const recoverPendingAutoSyncIfNeeded = (options = {}) =>"
  );
  assert.match(
    recoveryBlock,
    /isLocalContentDirtySinceBaseline\(\)/,
    "INV-1：待同步回收必须消费内容代数额判定。"
  );
  assert.doesNotMatch(
    recoveryBlock,
    /effectiveLastModified\s*<=\s*lastSyncTs\s*\)\s*\{\s*clearPendingAutoSyncRequest/,
    "INV-1：待同步回收不得用时间戳比较直接清除待同步请求（会静默丢推送）。"
  );

  // 覆盖清理：待同步请求的覆盖判定必须按内容代数，时间戳仅作旧记录迁移。
  const coveredCleanupBlock = sliceBetween(
    "const isPendingRequestCoveredBySync = (",
    "const isSharedDebounceStateCoveredBySync = ("
  );
  assert.match(
    coveredCleanupBlock,
    /pending\?\.dirtyGeneration !== null &&\s*[\s\S]{0,80}?pending\?\.dirtyGeneration !== undefined/,
    "INV-1：待同步请求的覆盖判定必须显式守卫“代数存在”，" +
      "缺失时不能假装有代数（代数域为 [1, ∞)，0 表示缺失）。"
  );
  // 待同步请求带代数、同步侧没有代数证据时必须保守保留，不得退回时间戳断言已覆盖。
  assert.match(
    coveredCleanupBlock,
    /if \(!coveredHasGeneration\) \{\s*return false;\s*\}/,
    "INV-1：同步侧缺代数时覆盖判定必须保守返回“未覆盖”。"
  );
  assert.match(
    coveredCleanupBlock,
    /coveredContentGeneration/,
    "INV-1：覆盖判定必须使用本次同步覆盖的内容代数。"
  );
  const sharedCoveredBlock = sliceBetween(
    "const isSharedDebounceStateCoveredBySync = (",
    "const clearSharedBackgroundSyncDebounceIfCovered = ({"
  );
  assert.match(
    sharedCoveredBlock,
    /state\.contentGeneration !== null &&\s*[\s\S]{0,80}?state\.contentGeneration !== undefined/,
    "INV-1：共享调度的覆盖判定必须显式守卫“代数存在”，缺失时退回时间戳。"
  );
  assert.match(
    sharedCoveredBlock,
    /if \(!coveredHasGeneration\) \{\s*return false;\s*\}/,
    "INV-1：同步侧缺代数时共享调度覆盖判定必须保守返回“未覆盖”。"
  );

  // 导入类基线必须在“再导出之前”抓取代数（buildImportedSyncBaselineState 内部有 await）。
  assert.match(
    sliceBetween(
      "const buildImportedSyncBaselineState = async ({",
      "const sleep = (ms) =>"
    ),
    /const coveredContentGeneration = getLocalContentGeneration\(\);[\s\S]{0,400}?await exportLocalDataObject/,
    "INV-1：导入类基线必须在再导出之前抓取代数。"
  );

  // 强制推送成功后必须写基线（否则“成功同步 ⇒ 干净”不成立）。
  const forcePushBlock = sliceBetween(
    "const handleForcePush = async (",
    "const handleForcePull = async ("
  );
  assert.match(
    forcePushBlock,
    /commitSyncedBaseline\(\{[\s\S]{0,400}?coveredContentGeneration/,
    "INV-1：强制推送成功后必须经 commitSyncedBaseline 写覆盖代数。"
  );
  // 抓取代数必须早于导出（导出内部有 await；晚抓会把导出期间的写入吸收成已同步）。
  {
    const captureAt = forcePushBlock.indexOf(
      "const forcePushCoveredContentGeneration = getLocalContentGeneration();"
    );
    const exportAt = forcePushBlock.indexOf("await exportLocalDataObject()");
    assert.ok(
      captureAt >= 0 && exportAt >= 0 && captureAt < exportAt,
      "INV-1：force_push 必须在导出快照之前抓取覆盖代数" +
        `（capture@${captureAt}, export@${exportAt}）。`
    );
  }
  assert.match(
    sliceBetween(
      "const markPendingAutoSyncRequest = (",
      "const clearPendingAutoSyncRequest = () => {"
    ),
    /getLocalContentGeneration\(\)/,
    "INV-1：登记待同步请求时必须记录内容代数。"
  );
  assert.match(
    sliceBetween(
      "const requestSharedBackgroundSyncDebounce = (",
      "const handleSharedBackgroundSyncDebounceStateChange = ("
    ),
    /contentGeneration:[\s\S]{0,300}getLocalContentGeneration\(\)/,
    "INV-1：登记共享调度时必须记录内容代数。"
  );

  // [ARCH-INV-1] 生产环境只有一条基线写入路径：commitSyncedBaseline（覆盖代数必填）。
  // 全文件只允许两处：定义处 1 次 + commitSyncedBaseline 内部 1 次。
  // 任何新增的直写都会让计数变成 3+，从而被拦下。
  // 只允许一处：commitSyncedBaseline 内部（定义写作 `const setSyncBaselineState = (`，
  // 不含 `setSyncBaselineState(` 子串）。新增直写会让计数变成 2+。
  assert.equal(
    countOccurrences("setSyncBaselineState("),
    1,
    "INV-1：生产代码不得直接调用 setSyncBaselineState，" +
      "必须经 commitSyncedBaseline（覆盖代数必填）。"
  );
  const commitBlock = sliceBetween(
    "const commitSyncedBaseline = ({",
    "const isLocalContentDirtySinceBaseline = () => {"
  );
  assert.match(
    commitBlock,
    /coveredContentGeneration === null \|\|\s*coveredContentGeneration === undefined[\s\S]{0,200}?throw new TypeError/,
    "INV-1：commitSyncedBaseline 必须拒绝缺省覆盖代数（缺省即抛错）。"
  );
  assert.match(
    commitBlock,
    /Math\.floor\(parsedGeneration\)/,
    "INV-1：commitSyncedBaseline 必须把覆盖代数写进基线。"
  );
  assert.match(
    commitBlock,
    /parsedGeneration < 1/,
    "INV-1：代数域为 [1, ∞)，commitSyncedBaseline 必须拒绝 <1 的值。"
  );
  // asSuccessResult / 强制推送 / 强制拉取 / 手动同步 都必须走强制入口。
  const commitCallSites = countOccurrences("commitSyncedBaseline({");
  assert.ok(
    commitCallSites >= 4,
    `INV-1：至少 4 处生产基线写入必须经 commitSyncedBaseline，实际 ${commitCallSites} 处。`
  );
  assert.match(
    sliceBetween(
      "const asSuccessResult = (action, syncBaseline = null, extraResult = null) => {",
      "const asConflictResult = (reason, extraDiagnosticsContext = {}) => {"
    ),
    /commitSyncedBaseline\(\{[\s\S]{0,300}?coveredContentGeneration/,
    "INV-1：asSuccessResult 写基线必须经 commitSyncedBaseline 并提供覆盖代数。"
  );

  // 代数递增：单调下限 + 回读校验（GM 无原子 CAS 的兜底）。
  const bumpBlock = sliceBetween(
    "const bumpLocalContentGeneration = () => {",
    "const invalidateLocalDataHashCache = () => {"
  );
  assert.match(
    bumpBlock,
    /Math\.max\(lastSeen \+ 1, Date\.now\(\)\)/,
    "INV-1：代数递增必须取单调下限 max(已读+1, now)，避免并发下算出同一个值。"
  );
  assert.match(
    bumpBlock,
    /GM_getValue\(LOCAL_CONTENT_GENERATION_KEY[\s\S]{0,200}?readBack >= nextGeneration/,
    "INV-1：代数递增必须回读校验，被并发覆盖时继续递增。"
  );

  // 导入来源：同步数据入口必须声明来源（缺省/未知一律抛错）。
  assert.match(
    sliceBetween(
      "const SYNC_IMPORT_ORIGINS = Object.freeze({",
      "const importFromSync = ("
    ),
    /VALIDATED_REMOTE_SNAPSHOT[\s\S]{0,200}?MERGED_PAYLOAD[\s\S]{0,200}?USER_JSON_IMPORT/,
    "INV-3：importFromSync 必须声明三种合法来源枚举。"
  );
  assert.match(
    sliceBetween(
      "const importFromSync = (",
      "const publishDefinitionRefresh = ("
    ),
    /if \(!isKnownSyncImportOrigin\(origin\)\) \{[\s\S]{0,200}?throw new TypeError/,
    "INV-3：importFromSync 必须拒绝缺省/未知来源。"
  );
  assert.match(
    sliceBetween(
      "const importLocalData = ((importPayloadPrivate) => (jsonStr, options = {}) => {",
      "const buildSyncBaselineStateForDataPair"
    ),
    /if \(!isKnownLocalImportOrigin\(origin\)\) \{[\s\S]{0,200}?throw new TypeError/,
    "INV-3：importLocalData 必须拒绝缺省/未知来源。"
  );
  // 导入原语：工厂在闭包内创建，原语一次性注入 importLocalData，之后不可再取。
  const importBoundaryBlock = sliceBetween(
    "const s1pSyncImportBoundary = (() => {",
    "const s1pCoreBusinessData = s1pSyncImportBoundary.publicFacade;"
  );
  assert.match(
    importBoundaryBlock,
    /const facade = s1pCreateCoreBusinessData\(/,
    "INV-3：core 工厂必须在隔离闭包内创建（原始门面不得成为模块级绑定）。"
  );
  assert.match(
    importBoundaryBlock,
    /const \{\s*importFromSync: importPayload,\s*\.\.\.publicFacade\s*\} = facade;/,
    "INV-3：必须用剩余属性剥离 importFromSync（而不是整体展开）。"
  );
  assert.match(
    importBoundaryBlock,
    /takeImportPayload: \(\) => \{[\s\S]{0,200}?remainingImportPayload = null;/,
    "INV-3：导入原语必须一次性取用（取用后置空）。"
  );
  assert.doesNotMatch(
    source,
    /importPayload:\s*importPayload/,
    "INV-3：不得把导入原语作为闭包返回对象的属性长期暴露。"
  );
  assert.equal(
    countOccurrences("importPayloadPrivate("),
    1,
    "INV-3：注入的私有原语只允许在 importLocalData 内调用一次。"
  );
  assert.equal(
    countOccurrences("s1pCoreBusinessData.importFromSync"),
    0,
    "INV-3：生产代码不得通过公开门面调用导入原语。"
  );


  // 合并式拉取：基线写入后必须推进代数，否则收敛推送会被门禁判干净。
  const mergePullBlock = sliceBetween(
    "if (pullApplyResult.mergedReadProgressChanged) {",
    "return pullResult;"
  );
  assert.match(
    mergePullBlock,
    /bumpLocalContentGeneration\(\)/,
    "INV-4：合并式拉取写入基线后必须推进代数，保持“本地领先云端”为脏。"
  );
  assert.equal(typeof LEGACY_FALLBACK.removalCriterion, "string");
  assert.ok(LEGACY_FALLBACK.removalCriterion.length > 0);
  assert.match(
    pendingDisplayBlock,
    /hasRegisteredSyncEvent[\s\S]{0,900}contentDirtyState\.dirty === true/,
    "INV-1：内容判定必须与“已登记同步事件”合取。"
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
    /importLocalData\(jsonStr, \{[\s\S]{0,120}?LOCAL_IMPORT_ORIGIN_USER_JSON/,
    "INV-3：第二个调用点必须是已声明来源的手动文本恢复入口。"
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
  assert.ok(
    PENDING_INVARIANTS.length > 0,
    "PENDING_INVARIANTS 必须显式列出尚未强制/无法文本强制的不变量，避免过度声称。"
  );
  PENDING_INVARIANTS.forEach((item) => {
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0);
    assert.equal(typeof item.reason, "string");
    assert.ok(item.reason.length > 0);
    assert.equal(typeof item.removalCriterion, "string");
    assert.ok(item.removalCriterion.length > 0);
  });
};

// [ARCH-INV-6] 全局反绕过绊线（不是语义证明，但显著提高绕过成本）：
// 1) 源码中不得出现“死分支惯用法”——静态断言只能看文本，
//    而 `if (false)` / `&& false` 能把任意被检查的文本变成死代码；
// 2) 关键函数不得被别名/间接调用窃取——标识符出现次数必须等于声明+合法调用。
const checkNoDeadBranchIdioms = () => {
  assert.doesNotMatch(
    source,
    /\bif\s*\(\s*(?:false|0|null|undefined|!1)\b/,
    "INV-6：源码中不允许出现 `if (false/0/null/undefined/!1 ...)` 死分支（会让静态断言失效）。"
  );
  assert.doesNotMatch(
    source,
    /&&\s*false\s*\)/,
    "INV-6：源码中不允许出现 `&& false` 死条件。"
  );
  assert.doesNotMatch(
    source,
    /\bwhile\s*\(\s*(?:false|0)\b/,
    "INV-6：源码中不允许出现永远不执行的 while 死循环守卫。"
  );
  assert.doesNotMatch(
    source,
    /\b(?:const|let|var)\s+\w+Alias\s*=\s*(?:setSyncBaselineState|bumpLocalContentGeneration|importFromSync|commitSyncedBaseline)/,
    "INV-6：关键写入函数不得被赋值给别名（绕过标识符计数）。"
  );
  // [ARCH-INV-1] 基线写入原语封装在独立闭包：不得作为模块级标识符出现在闭包之外，
  // 因此“外部代码别名/间接调用”在语法上不可能发生（这是物理隔离，不是文本约定）。
  const baselineBoundaryBlock = sliceBetween(
    "const syncBaselineBoundary = (() => {",
    "const commitSyncedBaseline = syncBaselineBoundary.commitSyncedBaseline;"
  );
  // 用“全文件总数 == 闭包内数”判断外部出现次数，避免切片尾部包含模块作用域。
  const totalPrimitiveRefs = countOccurrences("setSyncBaselineState");
  const boundaryPrimitiveRefs = countOccurrencesIn(
    baselineBoundaryBlock,
    "setSyncBaselineState"
  );
  assert.ok(
    boundaryPrimitiveRefs >= 2,
    "INV-1：闭包内必须至少有“定义 + 测试模式导出”两处原语引用。"
  );
  assert.equal(
    totalPrimitiveRefs,
    boundaryPrimitiveRefs,
    `INV-1：原语引用不得出现在闭包外（全文件 ${totalPrimitiveRefs} 处，` +
      `闭包内 ${boundaryPrimitiveRefs} 处）。`
  );
  assert.match(
    baselineBoundaryBlock,
    /const setSyncBaselineState = \(\{/,
    "INV-1：原语必须定义在闭包内部（不是模块级）。"
  );
  // 闭包返回对象只允许两个键：commitSyncedBaseline（必选）+ 测试模式的 ForTest。
  const boundaryReturnBlock = sliceBetween(
    "return Object.freeze({\n      commitSyncedBaseline",
    "  const commitSyncedBaseline = syncBaselineBoundary.commitSyncedBaseline;"
  );
  const normalizedBoundaryReturn = boundaryReturnBlock
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  assert.ok(
    normalizedBoundaryReturn.includes(
      "return Object.freeze({ commitSyncedBaseline, ...(IS_S1P_TEST_MODE ? { setSyncBaselineStateForTest: setSyncBaselineState } : {}), });"
    ),
    "INV-1：闭包返回对象必须是“commitSyncedBaseline + 仅测试模式的 " +
      "setSyncBaselineStateForTest”这一精确形状（多出任何键都可能是原语泄漏）：" +
      normalizedBoundaryReturn.slice(0, 200)
  );
  // 归一化后除该测试键外不应再出现任何属性定义（防止额外导出）。
  const boundaryPropDefs = (
    normalizedBoundaryReturn.match(/[A-Za-z_$][\w$]*\s*:/g) || []
  )
    .map((item) => item.replace(/\s*:$/, "").trim())
    .filter((name) => name !== "setSyncBaselineStateForTest");
  assert.deepEqual(
    boundaryPropDefs,
    [],
    `INV-1：闭包返回对象出现了额外属性：${boundaryPropDefs.join(", ")}`
  );
  // 基线键只能被写一次，且必须发生在闭包内。
  assert.equal(
    countOccurrences("GM_setValue(SYNC_BASELINE_STATE_KEY"),
    1,
    "INV-1：基线键只允许在闭包内写一次；新增直写会在检查器之外引入无代数基线。"
  );
  assert.equal(
    countOccurrencesIn(baselineBoundaryBlock, "GM_setValue(SYNC_BASELINE_STATE_KEY"),
    1,
    "INV-1：唯一基线写入点必须在隔离闭包内部。"
  );
  // 声明 1 + 内容写入检查点 1 + 合并式拉取收敛 1 = 3；新增调用必须在这里显式声明。
  assert.equal(
    countOccurrences("bumpLocalContentGeneration"),
    3,
    "INV-6：bumpLocalContentGeneration 只允许三处（声明 + 写入检查点 + 合并拉取）。"
  );
};

const run = () => {
  const checks = [
    ["INV-6 反绕过绊线（死分支/别名/标识符计数）", checkNoDeadBranchIdioms],
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
