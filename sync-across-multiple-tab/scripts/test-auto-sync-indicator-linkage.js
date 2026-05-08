#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = () => {
  return createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露自动同步指示器测试钩子。",
  });
};

const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY =
  "s1p_background_sync_debounce_state";
const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const expectNoMatch = (pattern, message) => {
  assert.doesNotMatch(sourceCode, pattern, message);
};

const testIndicatorVisibilityCoversAllAutoPaths = () => {
  const { hooks } = createHarness();
  const baseSettings = {
    syncRemoteEnabled: true,
    syncShowAutoSyncIndicator: true,
    syncDailyFirstLoad: false,
    syncPerLoadCheckEnabled: false,
    syncCheckOnReturnToForeground: false,
    syncAutoEnabled: false,
  };

  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncDailyFirstLoad: true,
    }),
    true,
    "仅开启每日首次同步时，指示器仍应允许显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncPerLoadCheckEnabled: true,
    }),
    true,
    "仅开启每次加载检查时，指示器仍应允许显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncCheckOnReturnToForeground: true,
    }),
    true,
    "仅开启回到前台检查时，指示器仍应允许显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncAutoEnabled: true,
    }),
    true,
    "仅开启后台自动同步时，指示器仍应允许显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath(baseSettings),
    false,
    "所有自动路径都关闭时，指示器不应显示。"
  );
};

const testSourceAwareTitlesAndMappings = () => {
  const { hooks } = createHarness();

  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "pending",
      displaySource: "background",
    }),
    "自动同步：后台自动同步待推送"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "daily_startup",
    }),
    "自动同步：每日首次同步拉取中"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "foreground_followup",
    }),
    "自动同步：回到前台检查拉取中"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorDisplayKind({
      displayPhase: "running",
      displaySource: "foreground_resume",
      displayReason: "foreground_probe_in_flight",
    }),
    "probe",
    "前台 metadata 探测应使用独立的 probe 视觉状态。"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorDisplayKind({
      displayPhase: "running",
      displaySource: "background",
      displayReason: "sync_lock_active",
    }),
    "push",
    "后台自动同步默认应使用推送视觉状态。"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorDisplayKind({
      displayPhase: "running",
      displaySource: "background",
      displayReason: "pull",
      displayOperation: "pull",
    }),
    "pull",
    "实际同步方向已明确时，应优先使用 operation 覆盖默认来源推断。"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorPhaseFromResult({
      status: "success",
      action: "skipped_push_on_startup",
    }),
    "conflict",
    "启动安全同步命中 skipped_push_on_startup 时应落到 conflict。"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorReasonFromResult({
      status: "success",
      action: "skipped_push_on_startup",
      reason: "local_changed_during_sync",
    }),
    "local_changed_during_sync"
  );
};

const testIndicatorCyclePersistsSourceToResolvedState = () => {
  const { hooks, store } = createHarness();
  const token = hooks.startAutoSyncIndicatorCycle("daily_startup", {
    operation: "pull",
  });

  let state = toPlainObject(hooks.getAutoSyncIndicatorState());
  assert.strictEqual(state.phase, "running");
  assert.strictEqual(state.source, "daily_startup");
  assert.strictEqual(state.operation, "pull");
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...state,
    timestamp: Date.now() - 1000,
  });

  hooks.finishAutoSyncIndicatorCycle(
    token,
    hooks.getAutoSyncIndicatorPhaseFromResult({
      status: "success",
      action: "pulled",
    }),
    {
      source: "daily_startup",
      reason: hooks.getAutoSyncIndicatorReasonFromResult({
        status: "success",
        action: "pulled",
      }),
    }
  );

  state = toPlainObject(hooks.getAutoSyncIndicatorState());
  assert.strictEqual(state.phase, "success");
  assert.strictEqual(state.source, "daily_startup");
  assert.strictEqual(state.operation, "");
  assert.strictEqual(state.lastResolvedSource, "daily_startup");
};

const testSharedSchedulerAndLocksFeedUnifiedDisplayState = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();

  hooks.setAutoSyncIndicatorResolvedPhase("success", {
    source: "background",
    reason: "previous_success",
  });
  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 12,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 20000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { read_progress: 2 },
    threadIds: ["123"],
    reason: "debounced_read_progress",
  });

  let resolvedState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase()
  );
  assert.equal(resolvedState.displayPhase, "pending");
  assert.equal(resolvedState.displaySource, "background_push");
  assert.equal(resolvedState.displayReason, "debounced_read_progress");
  assert.equal(
    hooks.hasActivePendingAutoSyncRequest(),
    true,
    "shared debounce state should count as active pending work."
  );

  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 60000,
  });
  resolvedState = toPlainObject(hooks.resolveAutoSyncIndicatorDisplayPhase());
  assert.equal(resolvedState.displayPhase, "running");
  assert.equal(resolvedState.displaySource, "background_push");
};

const testAutoSyncEntryPointsBindIndicatorSources = () => {
  expectMatch(
    /const runStartupModeAutoSyncCheckWithIndicator = async[\s\S]*?startAutoSyncIndicatorCycle\(resolvedSource/m,
    "自动同步指示器缺少统一的启动同步封装 helper。"
  );
  expectMatch(
    /const handleStartupSync = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{\s*source:\s*AUTO_SYNC_INDICATOR_SOURCE_DAILY_STARTUP/m,
    "每日首次加载同步未绑定 daily_startup 指示器来源。"
  );
  expectMatch(
    /const handlePerLoadSyncCheck = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{\s*source:\s*AUTO_SYNC_INDICATOR_SOURCE_PER_LOAD/m,
    "每次页面加载同步检查未绑定 per_load 指示器来源。"
  );
  expectMatch(
    /const requestForegroundRemoteSyncCheck = async[\s\S]*?runForegroundFollowUpAutoSyncCheckWithIndicator\(\{\s*source:\s*resolvedSource/m,
    "前台 follow-up sync 未绑定专用 foreground_followup 指示器 helper。"
  );
  expectMatch(
    /indicatorLi\.dataset\.syncKind\s*=\s*displayKind/,
    "导航栏指示器未把探测/同步视觉类型写入 data-sync-kind。"
  );
  expectMatch(
    /s1p-auto-sync-kind-\$\{displayKind\}/,
    "导航栏指示器 SVG 未按探测/同步视觉类型添加 class。"
  );
  expectMatch(
    /foreground_probe_in_flight[\s\S]*?AUTO_SYNC_INDICATOR_OPERATION_PROBE/,
    "前台 metadata 探测未映射到独立的 probe 视觉类型。"
  );
  expectMatch(
    /s1p-auto-sync-kind-push[\s\S]*?s1p-auto-sync-kind-pull[\s\S]*?s1p-auto-sync-kind-probe/,
    "导航栏指示器缺少推送/拉取/probe 三类动态图标 class。"
  );
  expectMatch(
    /s1p-auto-sync-operation-breathe/,
    "推送/拉取动态图标缺少呼吸动画。"
  );
  expectMatch(
    /s1p-auto-sync-probe-search[\s\S]*?translate\(1\.2px,\s*0\)[\s\S]*?translate\(-1\.2px,\s*0\)/,
    "前台 probe 图标应使用巡视式位移动画，而不是缩放呼吸。"
  );
  expectMatch(
    /s1p-auto-sync-transition-active-to-idle[\s\S]*?s1p-auto-sync-transition-probe-origin/,
    "probe/running 到 idle/result 应使用专门的柔和转场，避免直接硬切。"
  );
  expectMatch(
    /getNavbarAutoSyncIndicatorTransitionClassNames = \(\s*fromPhase[\s\S]*?fromKind[\s\S]*?toKind[\s\S]*?AUTO_SYNC_INDICATOR_OPERATION_PROBE/,
    "导航栏转场 class 应同时感知 phase 和 probe/push/pull kind。"
  );
  expectMatch(
    /AUTO_SYNC_INDICATOR_TRANSITION_CLEANUP_MS[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?AUTO_SYNC_INDICATOR_TRANSITION_CLEANUP_MS/,
    "导航栏 layer cleanup 应等待进入和退出动画都结束，避免 probe 被过早移除。"
  );
  expectMatch(
    /getNavbarAutoSyncIndicatorTransitionTargetLayer[\s\S]*?__s1pAutoSyncIndicatorCleanupTimer[\s\S]*?displayKind[\s\S]*?\|\| stabilizeNavbarAutoSyncIndicatorLayers/,
    "重复重绘同一目标状态时不应提前压扁正在执行的双 layer 转场。"
  );
  expectMatch(
    /#s1p-nav-auto-sync-indicator svg \{[\s\S]*?color:\s*var\(--s1p-t\);/,
    "导航栏自动同步指示器应继承 S1Plus 主题色。"
  );
  expectNoMatch(
    /#s1p-nav-auto-sync-indicator\[data-sync-kind="(?:probe|pull|push)"\] svg \{[\s\S]*?color:/,
    "推送/拉取/probe 指示器不应使用独立状态色覆盖主题色。"
  );
  expectMatch(
    /const probeSearchSvg = `<svg[\s\S]*?M11 2C15\.968 2 20 6\.032 20 11[\s\S]*?19\.4853 18\.0711/,
    "前台 probe 图标未使用新版放大镜 SVG。"
  );
  expectMatch(
    /refreshAutoSyncIndicatorAfterManualLockRelease[\s\S]*?renderNavbarAutoSyncIndicator\(\)/,
    "手动同步释放锁后应立即重绘导航栏指示器，避免残留“手动同步中”。"
  );
  expectMatch(
    /const refreshAutoSyncIndicatorRuntimeDisplay = \([\s\S]*?clearAutoSyncIndicatorDeferredResolve\(\);[\s\S]*?renderNavbarAutoSyncIndicator\(\)/,
    "运行态刷新前应清理 deferred resolve timer，避免旧状态回写。"
  );
  expectMatch(
    /return manualSyncInFlightPromise\.finally\(\(\) => \{[\s\S]*?releaseManualSyncLock\(\);[\s\S]*?refreshAutoSyncIndicatorAfterManualLockRelease\(\);/,
    "普通手动同步结束后未刷新自动同步指示器。"
  );
  expectMatch(
    /foregroundRemoteSyncCheckInFlightPromise = null;[\s\S]*?refreshAutoSyncIndicatorRuntimeDisplay\("foreground_followup_finished"\)/,
    "前台 follow-up promise 清理后应立即重绘，避免 no_change 后仍显示拉取呼吸动画。"
  );
  expectMatch(
    /foregroundProbeInFlightPromise = runPromise;[\s\S]*?refreshAutoSyncIndicatorRuntimeDisplay\("foreground_probe_started"\)/,
    "前台 metadata probe 开始后应立即重绘，确保放大镜探测动画可见。"
  );
  expectMatch(
    /foregroundProbeInFlightPromise = null;[\s\S]*?refreshAutoSyncIndicatorRuntimeDisplay\("foreground_probe_finished"\)/,
    "前台 metadata probe promise 清理后应立即重绘，避免探测图标残留。"
  );
  expectMatch(
    /s1p-auto-sync-kind-push path[\s\S]*?stroke:\s*currentColor;[\s\S]*?stroke-width:\s*0\.6px/,
    "推送/拉取/probe 图标线粗应与左侧同步按钮保持一致。"
  );
  expectMatch(
    /AUTO_SYNC_INDICATOR_RUNNING_MIN_VISIBLE_MS\s*=\s*650/,
    "同步中状态应有轻量最短展示时间，避免立刻硬切到结果态。"
  );
  expectMatch(
    /scheduleAutoSyncIndicatorDeferredResolve[\s\S]*?skipMinVisibleDelay:\s*true/,
    "同步中到成功/失败/冲突应延后完成展示，而不是直接硬切。"
  );
  expectMatch(
    /scheduleNavbarAutoSyncIndicatorExpiryTimer[\s\S]*?renderNavbarAutoSyncIndicator\(\)/,
    "导航栏结果态应在 TTL 后主动重绘回待命，避免结果状态长期残留。"
  );
};

(async () => {
  testIndicatorVisibilityCoversAllAutoPaths();
  testSourceAwareTitlesAndMappings();
  testIndicatorCyclePersistsSourceToResolvedState();
  testSharedSchedulerAndLocksFeedUnifiedDisplayState();
  testAutoSyncEntryPointsBindIndicatorSources();

  console.log("[auto-sync-indicator-linkage] Auto sync indicator linkage verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
