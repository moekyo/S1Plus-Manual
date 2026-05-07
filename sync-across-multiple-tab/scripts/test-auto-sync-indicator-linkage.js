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

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
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
    "自动同步：后台自动同步待处理"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "daily_startup",
    }),
    "自动同步：每日首次同步中"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "foreground_followup",
    }),
    "自动同步：回到前台检查命中更新，正在同步"
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
    "sync",
    "真正同步执行应保留 sync 视觉状态。"
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
  const { hooks } = createHarness();
  const token = hooks.startAutoSyncIndicatorCycle("daily_startup");

  let state = toPlainObject(hooks.getAutoSyncIndicatorState());
  assert.strictEqual(state.phase, "running");
  assert.strictEqual(state.source, "daily_startup");

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
    /foreground_probe_in_flight[\s\S]*?return "probe"/,
    "前台 metadata 探测未映射到独立的 probe 视觉类型。"
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
