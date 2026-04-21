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
      syncAutoEnabled: true,
    }),
    true,
    "仅开启后台自动同步时，指示器仍应允许显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncPerLoadCheckEnabled: true,
    }),
    false,
    "仅开启每次加载检查时，指示器不应再驱动导航状态指示器显示。"
  );
  assert.strictEqual(
    hooks.hasEnabledAutoSyncIndicatorPath({
      ...baseSettings,
      syncCheckOnReturnToForeground: true,
    }),
    false,
    "仅开启回到前台检查时，指示器不应再驱动导航状态指示器显示。"
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
    "自动同步：同步中",
    "旧的前台自动检查来源应降级为通用标题。"
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

const testAutoSyncEntryPointsBindIndicatorSources = () => {
  expectMatch(
    /const runStartupModeAutoSyncCheckWithIndicator = async[\s\S]*?startAutoSyncIndicatorCycle\(resolvedSource/m,
    "自动同步指示器缺少统一的启动同步封装 helper。"
  );
  expectMatch(
    /const handleStartupSync = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{\s*source:\s*AUTO_SYNC_INDICATOR_SOURCE_DAILY_STARTUP/m,
    "每日首次加载同步未绑定 daily_startup 指示器来源。"
  );
  assert.doesNotMatch(
    sourceCode,
    /const handlePerLoadSyncCheck = async/m,
    "自动检查运行入口 handlePerLoadSyncCheck 应已移除。"
  );
  assert.doesNotMatch(
    sourceCode,
    /const requestForegroundRemoteSyncCheck = async/m,
    "前台自动检查 follow-up 入口应已移除。"
  );
};

(async () => {
  testIndicatorVisibilityCoversAllAutoPaths();
  testSourceAwareTitlesAndMappings();
  testIndicatorCyclePersistsSourceToResolvedState();
  testAutoSyncEntryPointsBindIndicatorSources();

  console.log("[auto-sync-indicator-linkage] Auto sync indicator linkage verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
