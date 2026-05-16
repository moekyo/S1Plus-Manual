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
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 3 测试钩子。",
  });
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testRuntimeReusesStartupExecutionPath = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforePerform: async () => {
      calls.push("onBeforePerform");
    },
    onAfterRelease: async () => {
      calls.push("afterRelease");
    },
    performAutoSync: async (isStartupSafetyMode, lockMode) => {
      calls.push(`perform:${String(isStartupSafetyMode)}:${lockMode}`);
      return { status: "success", action: "pulled" };
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "onBeforePerform",
    "perform:true:startup",
    "heartbeat:stop",
    "release",
    "afterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pulled",
  });
};

const testForegroundFollowUpUsesDedicatedExecutionMode = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runForegroundFollowUpAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforePerform: async () => {
      calls.push("onBeforePerform");
    },
    onAfterRelease: async () => {
      calls.push("afterRelease");
    },
    performAutoSync: async (options) => {
      calls.push(
        `perform:${options.mode}:${options.syncLockMode}:${options.triggerSource}`
      );
      return {
        status: "blocked",
        blockLevel: "soft",
        reason: "local_changed_during_sync",
      };
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "onBeforePerform",
    "perform:foreground_followup:startup:foreground_resume",
    "heartbeat:stop",
    "release",
    "afterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "blocked",
    blockLevel: "soft",
    reason: "local_changed_during_sync",
  });
};

const testBeforePerformCanShortCircuitSafely = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return true;
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    stopStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:stop");
    },
    releaseStartupSyncLock: () => {
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return {
        skip: true,
        result: { status: "skipped", reason: "daily_sync_already_completed" },
      };
    },
    performAutoSync: async () => {
      calls.push("perform");
      throw new Error("beforePerform 已要求跳过时不应继续 performAutoSync。");
    },
  });

  assert.deepStrictEqual(calls, [
    "acquire",
    "heartbeat:start",
    "beforePerform",
    "heartbeat:stop",
    "release",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "daily_sync_already_completed",
  });
};

const testLockUnavailableSkipsWithoutHeartbeat = async () => {
  const { hooks } = createHarness();
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      return false;
    },
    onLockUnavailable: async () => {
      calls.push("lockUnavailable");
    },
    startStartupSyncLockHeartbeat: () => {
      calls.push("heartbeat:start");
    },
    performAutoSync: async () => {
      calls.push("perform");
      return { status: "success" };
    },
  });

  assert.deepStrictEqual(calls, ["acquire", "lockUnavailable"]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "startup_lock_unavailable",
  });
};

const testOnBeforeReleaseFiresBeforeLockRelease = async () => {
  const { sandbox, hooks } = createHarness();
  let lockHeld = false;
  let onBeforeReleaseSeenLock = null;
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      lockHeld = true;
      return true;
    },
    startStartupSyncLockHeartbeat: () => { calls.push("hb:start"); },
    stopStartupSyncLockHeartbeat: () => { calls.push("hb:stop"); },
    releaseStartupSyncLock: () => {
      lockHeld = false;
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return null;
    },
    onBeforeRelease: (syncResult) => {
      onBeforeReleaseSeenLock = lockHeld;
      calls.push("onBeforeRelease");
    },
    onAfterRelease: () => {
      calls.push("onAfterRelease");
    },
    performAutoSync: async () => {
      calls.push("perform");
      return { status: "success", action: "pulled" };
    },
  });

  assert.strictEqual(onBeforeReleaseSeenLock, true,
    "onBeforeRelease 应在锁仍然持有时执行");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
    "perform",
    "onBeforeRelease",
    "hb:stop",
    "release",
    "onAfterRelease",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "success",
    action: "pulled",
  });
};

const testOnBeforeReleaseFiresOnSkipBeforeLockRelease = async () => {
  const { sandbox, hooks } = createHarness();
  let lockHeld = false;
  let onBeforeReleaseSeenLock = null;
  let onBeforeReleaseSeenReason = null;
  const calls = [];

  const result = await hooks.runStartupModeAutoSyncCheck({
    acquireStartupSyncLock: async () => {
      calls.push("acquire");
      lockHeld = true;
      return true;
    },
    startStartupSyncLockHeartbeat: () => { calls.push("hb:start"); },
    stopStartupSyncLockHeartbeat: () => { calls.push("hb:stop"); },
    releaseStartupSyncLock: () => {
      lockHeld = false;
      calls.push("release");
    },
    beforePerform: async () => {
      calls.push("beforePerform");
      return {
        skip: true,
        result: { status: "skipped", reason: "daily_sync_already_completed" },
      };
    },
    onBeforeRelease: (syncResult) => {
      onBeforeReleaseSeenLock = lockHeld;
      onBeforeReleaseSeenReason = syncResult?.reason;
      calls.push("onBeforeRelease");
    },
    performAutoSync: async () => {
      calls.push("perform");
      throw new Error("beforePerform 已跳过, 不应到达 perform");
    },
  });

  assert.strictEqual(onBeforeReleaseSeenLock, true,
    "skip 路径下 onBeforeRelease 应在锁仍然持有时执行");
  assert.strictEqual(onBeforeReleaseSeenReason, "daily_sync_already_completed",
    "onBeforeRelease 应能拿到 skip 原因 daily_sync_already_completed");
  assert.deepStrictEqual(calls, [
    "acquire",
    "hb:start",
    "beforePerform",
    "onBeforeRelease",
    "hb:stop",
    "release",
  ]);
  assert.deepStrictEqual(toPlainObject(result), {
    status: "skipped",
    reason: "daily_sync_already_completed",
  });
};

const testShouldClearDeferredStartupSyncOnResult = () => {
  const { hooks } = createHarness();

  // deferred 未激活时不清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "daily_sync_already_completed" }, false
  ), false);

  // skipped + daily_sync_already_completed → 清理（本次新增的修复点）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "daily_sync_already_completed" }, true
  ), true);

  // skipped + conflict_paused → 清理（已有行为）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "conflict_paused" }, true
  ), true);

  // success → 清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "success", action: "pulled" }, true
  ), true);

  // conflict → 清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "conflict", reason: "both_changed_since_baseline" }, true
  ), true);

  // skipped + 其他 reason → 不清理（startup_lock_unavailable 等不应清 deferred）
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "skipped", reason: "startup_lock_unavailable" }, true
  ), false);

  // failure → 不清理
  assert.strictEqual(hooks.shouldClearDeferredStartupSyncOnResult(
    { status: "failure", error: "test" }, true
  ), false);
};

const testDecisionSplitsStartupBackgroundAndForegroundFollowUp = () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const localDataObject = {
    contentHash: "local-newer",
    lastUpdated: 200,
  };
  const remoteDataObject = {
    contentHash: "baseline",
    lastUpdated: 100,
  };

  const startupDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "startup",
  });
  const backgroundDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "background",
  });
  const foregroundDecision = hooks.decideSyncActionByVersion({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    syncMode: "foreground_followup",
  });

  assert.equal(startupDecision.action, "skip_push_on_startup");
  assert.equal(backgroundDecision.action, "push");
  assert.equal(
    foregroundDecision.action,
    "skip_push_on_foreground_followup"
  );
};

const testAutoSyncCompletionLogMessageIsSpecific = () => {
  const { hooks } = createHarness();

  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "success",
      result: { status: "success", action: "no_change" },
    }),
    "S1 Plus (Sync): 同步检查完成：成功（本地与远程一致，无需同步）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "success",
      result: { status: "success", action: "pushed" },
    }),
    "S1 Plus (Sync): 同步检查完成：成功（已推送本地数据到云端）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "failure",
      result: { status: "failure", error: "GitHub API请求失败" },
    }),
    "S1 Plus (Sync): 同步检查完成：失败（GitHub API请求失败）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "conflict",
      result: { status: "conflict", reason: "remote_changed_before_push" },
    }),
    "S1 Plus (Sync): 同步检查完成：冲突（推送前检测到云端版本变化，已暂停自动同步）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      outcome: "lock_lost",
      result: {
        status: "skipped",
        reason: "lock_lost",
        stage: "push_latest_local_data:after",
      },
    }),
    "S1 Plus (Sync): 同步检查完成：已中止（同步锁失效，阶段：推送最新本地数据 / 执行后）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "云端更新检查",
      outcome: "success",
      result: { status: "unchanged", reason: "remote_already_synced" },
    }),
    "S1 Plus (Sync): 云端更新检查完成：无变化（云端版本与本地已同步版本一致）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "强制推送",
      outcome: "success",
      result: { status: "success", action: "force_push" },
    }),
    "S1 Plus (Sync): 强制推送完成：成功（已强制推送本地数据到云端）。"
  );
  assert.equal(
    hooks.formatAutoSyncCompletionLogMessage({
      scopeLabel: "云端更新检查",
      outcome: "changed",
      result: {
        status: "changed",
        reason: "remote_changed",
        syncRequestResult: {
          status: "blocked",
          reason: "read_progress_pending_write",
        },
      },
    }),
    "S1 Plus (Sync): 云端更新检查完成：发现变化（后续同步已暂缓：阅读进度仍有待写入内容）。"
  );
};

const testSyncTraceEventsAreShownInDiagnostics = () => {
  const { hooks } = createHarness();
  hooks.resetSyncDiagnostics();

  hooks.recordSyncTraceEvent("auto_sync_decision", {
    scope: "auto_sync",
    status: "running",
    message: "同步决策完成",
    details: {
      action: "push",
      reason: "local_newer",
    },
    logToConsole: false,
    timestamp: 1778774439486,
  });

  const diagnostics = hooks.getSyncDiagnostics();
  assert.equal(diagnostics.lastSyncTraceScope, "auto_sync");
  assert.equal(diagnostics.lastSyncTracePhase, "auto_sync_decision");
  assert.equal(diagnostics.lastSyncTraceStatus, "running");
  assert.match(diagnostics.lastSyncTraceSummary, /同步决策完成/);
  assert.equal(diagnostics.syncTraceEvents.length, 1);
  assert.match(
    hooks.buildSyncDiagnosticsSummary(),
    /同步过程 1: .*同步决策完成/
  );
};

const testSyncTraceDetailsUseChineseLabels = () => {
  const { hooks } = createHarness();
  hooks.resetSyncDiagnostics();

  hooks.recordSyncTraceEvent("foreground_probe_followup_result", {
    scope: "foreground_probe",
    status: "changed",
    message: "前台补同步返回",
    details: {
      triggerSource: "foreground_resume",
      reason: "remote_probe_changed:pageshow",
      remoteChangeKind: "external_remote_change",
      refreshPlan: {
        policy: "reload_now",
        pageType: "generic",
        shouldReload: true,
      },
      snapshotResyncResult: {
        didSync: true,
        changedKeys: ["read_progress"],
        applyMode: "immediate",
      },
      until: 1778777843938,
    },
    logToConsole: false,
    timestamp: 1778774439486,
  });

  const diagnostics = hooks.getSyncDiagnostics();
  assert.match(diagnostics.lastSyncTraceSummary, /触发源=回到前台检查/);
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /原因=云端版本变化：页面显示或从缓存恢复/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /云端变化归因=其他设备或会话写入/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /刷新计划=策略=立即刷新，页面=普通页面，刷新=是/
  );
  assert.match(
    diagnostics.lastSyncTraceSummary,
    /本地快照收敛=已收敛=是，变更键=1，应用=立即应用/
  );
  assert.doesNotMatch(
    diagnostics.lastSyncTraceSummary,
    /foreground_resume|external_remote_change|reload_now|generic|immediate/
  );
};

const testPhase3CallSitesUseDedicatedHelpers = () => {
  expectMatch(
    /name: "start debug log collector"[\s\S]*?run: \(\) => startLogCollector\(\)/m,
    "调试日志收集器未在 document-start 无条件启动，打开调试面板后会丢失早期同步日志。"
  );
  expectMatch(
    /const checkRemoteFreshnessOnForeground = async[\s\S]*?scopeLabel: "云端更新检查"/m,
    "云端更新检查未接入统一完成日志。"
  );
  expectMatch(
    /const handleManualSync = async[\s\S]*?scopeLabel: "手动同步"/m,
    "手动同步未接入统一完成日志。"
  );
  expectMatch(
    /const handleForcePush = async[\s\S]*?scopeLabel: "强制推送"/m,
    "强制推送未接入统一完成日志。"
  );
  expectMatch(
    /const handleForcePull = async[\s\S]*?scopeLabel: "强制拉取"/m,
    "强制拉取未接入统一完成日志。"
  );
  expectMatch(
    /const requestForegroundRemoteSyncCheck = async[\s\S]*?runForegroundFollowUpAutoSyncCheckWithIndicator\(\{/m,
    "前台 follow-up sync 入口未切到专用 foreground_followup helper。"
  );
  expectMatch(
    /const handlePerLoadSyncCheck = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{/m,
    "每次页面加载同步检查未复用统一的启动安全同步 helper。"
  );
  expectMatch(
    /const handleStartupSync = async[\s\S]*?runStartupModeAutoSyncCheckWithIndicator\(\{/m,
    "每日首次加载同步未复用统一的启动安全同步 helper。"
  );
  expectMatch(
    /LOG_COLLAPSED_MESSAGE_MAX_LENGTH\s*=\s*180/,
    "调试控制台长日志没有默认折叠长度。"
  );
  expectMatch(
    /data-s1p-debug-action="toggle-expand-logs"/,
    "调试控制台缺少展开全部/收起全部按钮。"
  );
  expectMatch(
    /s1p-debug-console-expand-line/,
    "调试控制台缺少单条日志展开按钮。"
  );
};

(async () => {
  await testRuntimeReusesStartupExecutionPath();
  await testForegroundFollowUpUsesDedicatedExecutionMode();
  await testBeforePerformCanShortCircuitSafely();
  await testLockUnavailableSkipsWithoutHeartbeat();
  await testOnBeforeReleaseFiresBeforeLockRelease();
  await testOnBeforeReleaseFiresOnSkipBeforeLockRelease();
  testShouldClearDeferredStartupSyncOnResult();
  testDecisionSplitsStartupBackgroundAndForegroundFollowUp();
  testAutoSyncCompletionLogMessageIsSpecific();
  testSyncTraceEventsAreShownInDiagnostics();
  testSyncTraceDetailsUseChineseLabels();
  testPhase3CallSitesUseDedicatedHelpers();

  console.log("[safe-sync-execution] Phase 3 sync execution layering verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
