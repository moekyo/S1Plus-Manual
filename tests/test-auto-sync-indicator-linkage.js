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

const getProjectionSurfaces = (hooks) =>
  hooks.getSyncIndicatorStateProjectionTestConstants();

const readNavbarProjection = (
  hooks,
  state = null,
  { allowCache = false } = {}
) =>
  hooks.s1pSyncSystem.readState({
    surface: getProjectionSurfaces(hooks).SURFACE_NAVBAR,
    state,
    allowCache,
  });

const readTitleProjection = (
  hooks,
  state = null,
  { allowCache = false } = {}
) =>
  hooks.s1pSyncSystem.readState({
    surface: getProjectionSurfaces(hooks).SURFACE_TITLE,
    state,
    allowCache,
  });

const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY =
  "s1p_background_sync_debounce_state";
const BACKGROUND_SYNC_LOCK_KEY = "s1p_background_sync_lock";
const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";
const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
const STARTUP_SYNC_LOCK_KEY = "s1p_startup_sync_lock";
const FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY =
  "s1p_foreground_followup_sync_lock";
const GLOBAL_SYNC_LOCK_KEY = "s1p_sync_global_lock";

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
    "自动同步：本地变更待推送"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "daily_startup",
    }),
    "自动同步：云端更新拉取中"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "running",
      displaySource: "foreground_followup",
    }),
    "自动同步：云端更新拉取中"
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
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "pending",
      displaySource: "foreground_resume",
      displayReason: "foreground_probe_verification_retry",
      displayOperation: "sync",
    }),
    "自动同步：确认云端状态中"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorDisplayKind({
      displayPhase: "pending",
      displaySource: "foreground_resume",
      displayReason: "foreground_probe_verification_retry",
      displayOperation: "sync",
    }),
    "probe",
    "云端版本时间相同的内部复查应显示放大镜确认态，而不是中性三点或拉取箭头。"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorTitle({
      displayPhase: "pending",
      displaySource: "page_load_visible",
      displayReason: "foreground_probe_changed_retry",
      displayOperation: "sync",
    }),
    "自动同步：云端有变化，等待本地状态稳定后复查"
  );
  assert.strictEqual(
    hooks.getAutoSyncIndicatorDisplayKind({
      displayPhase: "pending",
      displaySource: "page_load_visible",
      displayReason: "foreground_probe_changed_retry",
      displayOperation: "sync",
    }),
    "probe",
    "metadata-only 发现 updated_at 变化但补同步被门禁暂缓时，应显示放大镜等待复查。"
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
    hooks.getAutoSyncIndicatorPhaseFromResult({
      status: "success",
      action: "no_change",
      reason: "hash_equal",
    }),
    "idle",
    "二次确认得到 no_change/hash_equal 时不应显示成功态或写入标题成功提示。"
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

const testDeferredResolvedPhaseKeepsOperation = async () => {
  const { hooks, store } = createHarness();
  const token = hooks.startAutoSyncIndicatorCycle("foreground_resume", {
    operation: "pull",
    reason: "foreground_probe",
  });
  const runningState = toPlainObject(hooks.getAutoSyncIndicatorState());
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...runningState,
    token,
    timestamp: Date.now() - 645,
  });

  assert.equal(
    hooks.setAutoSyncIndicatorResolvedPhase("success", {
      source: "foreground_resume",
      reason: "pulled",
      operation: "pull",
    }),
    true
  );

  await new Promise((resolve) => setTimeout(resolve, 80));

  const state = toPlainObject(hooks.getAutoSyncIndicatorState());
  assert.equal(state.phase, "success");
  assert.equal(
    state.operation,
    "pull",
    "延迟落成功态也必须保留调用方传入的 pull 方向。"
  );
  const resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(hooks.getAutoSyncIndicatorDisplayKind(resolvedState), "pull");
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：云端更新已拉取"
  );
};

const testForegroundFollowupRefreshKeepsDeferredSuccess = async () => {
  const { hooks, store } = createHarness();
  const result = await hooks.requestForegroundRemoteSyncCheck(
    "remote_probe_changed:visibility",
    {
      settingsSnapshot: {
        syncRemoteEnabled: true,
        syncRemoteGistId: "gist-id",
        syncRemotePat: "token",
      },
      acquireStartupSyncLock: async () => true,
      startStartupSyncLockHeartbeat: () => {},
      stopStartupSyncLockHeartbeat: () => {},
      releaseStartupSyncLock: () => {},
      performAutoSync: async () => {
        const runningState = toPlainObject(hooks.getAutoSyncIndicatorState());
        store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
          ...runningState,
          timestamp: Date.now() - 400,
        });
        return {
          status: "success",
          action: "pulled",
          reason: "remote_changed_since_baseline",
        };
      },
    }
  );

  assert.equal(result.status, "success");
  assert.equal(result.action, "pulled");

  const messages = [];
  const timers = [];
  const refreshPlan = hooks.applyAutoPullRefreshPolicy({
    action: "pulled",
    refreshPlan: {
      policy: "reload_now",
      pageType: "generic",
      shouldReload: true,
      reloadDelayMs: 3200,
    },
    showMessage: (message, isSuccess, options = {}) => {
      messages.push({ message, isSuccess, options });
    },
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    locationObject: {
      reload: () => {},
    },
  });

  assert.equal(refreshPlan.reloadSchedule.status, "scheduled");
  assert.ok(
    refreshPlan.reloadSchedule.indicatorSettleDelayMs > 0,
    "刷新策略应等待已排队的导航栏 success 落态。"
  );
  assert.ok(
    refreshPlan.reloadSchedule.reloadDelayMs > 3200,
    "页面刷新倒计时应从导航栏结果态可见后开始计算。"
  );
  assert.equal(
    messages.length,
    0,
    "导航栏 success 还在 deferred 时，不应立即显示“即将刷新页面”的 toast。"
  );
  assert.ok(
    timers.some(
      (timer) =>
        timer.delay > 0 &&
        timer.delay <= refreshPlan.reloadSchedule.indicatorSettleDelayMs + 5
    ),
    "应安排一个短延迟，在导航栏 success 可见后再显示刷新 toast。"
  );

  await new Promise((resolve) => setTimeout(resolve, 340));

  const state = toPlainObject(hooks.getAutoSyncIndicatorState());
  assert.equal(
    state.phase,
    "success",
    "前台 follow-up 结束后的运行态重绘不能取消已排队的 success 落态。"
  );
  assert.equal(state.operation, "pull");
  const resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(hooks.getAutoSyncIndicatorDisplayKind(resolvedState), "pull");
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：云端更新已拉取"
  );
  hooks.clearPendingAutoPullReloadTimer();
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
    readNavbarProjection(hooks)
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
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    phase: "running",
    timestamp: now,
    token: "foreground-stale-operation",
    source: "foreground_resume",
    reason: "foreground_followup_in_flight",
    operation: "pull",
    lastResolvedPhase: "idle",
    lastResolvedTimestamp: now,
    lastResolvedSource: "",
    lastResolvedReason: "",
  });
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 60000,
  });
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "running");
  assert.equal(resolvedState.displaySource, "background_push");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "push",
    "active lock 来源切到后台推送时，不应沿用旧 foreground running 的 pull operation。"
  );

  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    phase: "pending",
    timestamp: now,
    token: "",
    source: "foreground_resume",
    reason: "foreground_probe_verification_retry",
    operation: "",
    lastResolvedPhase: "idle",
    lastResolvedTimestamp: now,
    lastResolvedSource: "",
    lastResolvedReason: "",
  });
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "startup",
    timestamp: now,
    ttlMs: 60000,
  });
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "running");
  assert.equal(resolvedState.displaySource, "foreground_resume");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "probe",
    "前台二次确认进入 running 锁窗口时应显示放大镜确认态，不能回退成默认拉取箭头。"
  );
};

const testSyncIndicatorStateProjectionSurfaceContract = () => {
  const { hooks, store } = createHarness();
  assert.equal(
    typeof hooks.s1pSyncSystem?.readState,
    "function",
    "Phase 4 应暴露统一 Sync Indicator State 投影 interface。"
  );
  const now = Date.now();
  const resultState = {
    phase: "success",
    timestamp: now - 5000,
    token: "phase-4-result",
    source: "background_push",
    reason: "pushed",
    operation: "push",
    lastResolvedPhase: "success",
    lastResolvedTimestamp: now - 5000,
    lastResolvedSource: "background_push",
    lastResolvedReason: "pushed",
  };

  const navbarResult = toPlainObject(
    readNavbarProjection(hooks, resultState)
  );
  const titleResult = toPlainObject(
    readTitleProjection(hooks, resultState)
  );
  assert.equal(navbarResult.displayPhase, "idle");
  assert.equal(titleResult.displayPhase, "success");

  const defaultSurfaceResult = toPlainObject(
    hooks.s1pSyncSystem.readState({ state: resultState })
  );
  assert.equal(
    defaultSurfaceResult.projectionSurface,
    getProjectionSurfaces(hooks).SURFACE_NAVBAR
  );
  assert.equal(defaultSurfaceResult.displayPhase, navbarResult.displayPhase);
  const malformedInputResult = toPlainObject(
    hooks.s1pSyncSystem.readState({
      surface: "unexpected",
      state: "invalid",
    })
  );
  assert.equal(
    malformedInputResult.projectionSurface,
    getProjectionSurfaces(hooks).SURFACE_NAVBAR
  );
  assert.equal(malformedInputResult.displayPhase, "idle");

  const pullResultState = {
    ...resultState,
    timestamp: now,
    source: "foreground_resume",
    reason: "pulled",
    operation: "pull",
    lastResolvedTimestamp: now,
    lastResolvedSource: "foreground_resume",
    lastResolvedReason: "pulled",
  };
  assert.equal(
    readNavbarProjection(hooks, pullResultState).displayPhase,
    "success"
  );
  assert.equal(
    readTitleProjection(hooks, pullResultState).displayPhase,
    "idle",
    "Title surface 应在投影层抑制拉取侧结果，而不是交给 Title Owner 二次解释。"
  );

  const cloudProbeState = {
    ...resultState,
    phase: "running",
    timestamp: now,
    source: "foreground_resume",
    reason: "foreground_probe_in_flight",
    operation: "probe",
    lastResolvedPhase: "idle",
    lastResolvedTimestamp: now,
    lastResolvedSource: "",
    lastResolvedReason: "",
  };
  assert.equal(
    readTitleProjection(hooks, cloudProbeState).displayPhase,
    "idle",
    "cloud probe session 必须在 Title 投影中静默。"
  );
  assert.equal(
    readTitleProjection(hooks, {
      ...resultState,
      phase: "conflict",
      timestamp: now,
      source: "foreground_resume",
      reason: "probe_conflict",
      operation: "probe",
      lastResolvedPhase: "conflict",
      lastResolvedTimestamp: now,
      lastResolvedSource: "foreground_resume",
      lastResolvedReason: "probe_conflict",
    }).displayPhase,
    "idle",
    "probe 方向的 conflict 不应显示在 Title。"
  );
  assert.equal(
    readTitleProjection(hooks, {
      ...resultState,
      timestamp: now,
      operation: "",
      lastResolvedTimestamp: now,
    }).displayPhase,
    "success",
    "未显式标注方向的 background result 应回退为 push 并保留 Title 结果态。"
  );

  const constants = hooks.getTitleSyncStatusTestConstants();
  store.set(BACKGROUND_SYNC_LOCK_KEY, {
    owner: constants.BACKGROUND_SYNC_OWNER_ID,
    timestamp: now,
  });
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: constants.BACKGROUND_SYNC_OWNER_ID,
    mode: "background",
    timestamp: now,
    ttlMs: 60000,
  });
  assert.equal(
    readTitleProjection(hooks, {
      ...cloudProbeState,
      reason: "foreground_followup_in_flight",
      operation: "sync",
    }).displayPhase,
    "idle",
    "source mismatch 默认出的 background push 不能绕过 Title 的原始方向保护。"
  );

  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 60000,
  });
  const navbarForeignRunning = toPlainObject(
    readNavbarProjection(hooks, resultState)
  );
  const titleForeignRunning = toPlainObject(
    readTitleProjection(hooks, resultState)
  );
  assert.equal(
    navbarForeignRunning.displayPhase,
    "running",
    "Navbar 应保留外来新鲜后台锁的运行中反馈。"
  );
  assert.equal(
    titleForeignRunning.displayPhase,
    "idle",
    "Title 投影不能仅凭外来 Sync Lock 产生 Ghost Running。"
  );
  assert.equal(titleForeignRunning.displayLiveRunnerOwnerId, "");

  const cacheHarness = createHarness();
  const cacheNow = Date.now();
  cacheHarness.store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...resultState,
    timestamp: cacheNow,
    lastResolvedTimestamp: cacheNow,
  });
  const cachedSuccess = toPlainObject(
    readTitleProjection(cacheHarness.hooks, null, { allowCache: true })
  );
  assert.equal(cachedSuccess.displayPhase, "success");
  cacheHarness.store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...resultState,
    phase: "conflict",
    timestamp: cacheNow,
    reason: "conflict_after_cache_write",
    lastResolvedPhase: "conflict",
    lastResolvedTimestamp: cacheNow,
    lastResolvedReason: "conflict_after_cache_write",
  });
  assert.equal(
    readTitleProjection(cacheHarness.hooks, null, { allowCache: true })
      .displayPhase,
    "success",
    "allowCache 命中时应复用 250ms 内的 Title 投影。"
  );
  assert.equal(
    readTitleProjection(cacheHarness.hooks).displayPhase,
    "conflict",
    "关闭 allowCache 时必须重新读取最新持久化状态。"
  );
};

const testTitleProjectionPhasePolicyBranches = () => {
  const { hooks } = createHarness();
  const resolveTitlePhase = hooks.resolveTitleSyncIndicatorProjectionPhase;
  assert.equal(typeof resolveTitlePhase, "function");

  [
    [null, "idle", "null input"],
    ["invalid", "idle", "malformed input"],
    [[], "idle", "array input"],
    [{ displayPhase: "pending" }, "pending", "pending phase"],
    [
      { displayPhase: "success", operation: "push" },
      "success",
      "original push direction",
    ],
    [
      {
        displayPhase: "failure",
        operation: "sync",
        displaySessionKind: "local_push_session",
      },
      "failure",
      "local push session direction",
    ],
    [
      {
        displayPhase: "success",
        operation: "sync",
        displaySessionKind: "remote_pull_session",
      },
      "idle",
      "remote pull session suppression",
    ],
    [
      {
        displayPhase: "running",
        operation: "sync",
        displaySessionKind: "cloud_probe_session",
      },
      "idle",
      "cloud probe session suppression",
    ],
    [
      {
        displayPhase: "success",
        operation: "sync",
        displayDominantDirection: "push",
      },
      "success",
      "dominant push direction",
    ],
    [
      {
        displayPhase: "success",
        operation: "sync",
        displayOperation: "push",
      },
      "success",
      "display operation push direction",
    ],
    [
      {
        displayPhase: "success",
        source: "background_push",
        displaySource: "background_push",
      },
      "success",
      "background source push fallback",
    ],
    [
      {
        displayPhase: "success",
        source: "foreground_resume",
        displaySource: "foreground_resume",
      },
      "idle",
      "directionless foreground result suppression",
    ],
    [
      { displayPhase: "conflict", operation: "push" },
      "conflict",
      "push conflict",
    ],
    [
      { displayPhase: "conflict", operation: "pull" },
      "idle",
      "pull conflict suppression",
    ],
    [
      { displayPhase: "conflict", operation: "probe" },
      "idle",
      "probe conflict suppression",
    ],
    [
      {
        displayPhase: "success",
        source: "foreground_resume",
        displaySource: "background_push",
        operation: "sync",
        displaySessionKind: "local_push_session",
      },
      "idle",
      "defaulted background push suppression",
    ],
  ].forEach(([state, expectedPhase, label]) => {
    assert.equal(resolveTitlePhase(state), expectedPhase, label);
  });
};

const testForegroundFollowupLockDisplayDoesNotUseFullLockTtl = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  const setForegroundState = (overrides = {}) => {
    store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
      phase: "success",
      timestamp: now - 3000,
      token: "",
      source: "foreground_resume",
      reason: "hash_equal",
      operation: "",
      lastResolvedPhase: "success",
      lastResolvedTimestamp: now - 3000,
      lastResolvedSource: "foreground_resume",
      lastResolvedReason: "hash_equal",
      ...overrides,
    });
  };
  const setStartupLocks = (timestamp) => {
    store.set(STARTUP_SYNC_LOCK_KEY, {
      owner: "other-tab",
      timestamp,
    });
    store.set(GLOBAL_SYNC_LOCK_KEY, {
      owner: "other-tab",
      mode: "startup",
      timestamp,
      ttlMs: 3 * 60 * 1000,
    });
  };

  setForegroundState();
  setStartupLocks(now - 120000);
  let resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.notEqual(
    resolvedState.displayPhase,
    "running",
    "超过指示器展示窗口的 startup 锁不能继续把导航栏渲染成回到前台检查中。"
  );

  setForegroundState();
  setStartupLocks(now - 1000);
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "running");
  assert.equal(resolvedState.displaySource, "foreground_resume");
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：回到前台检查中",
    "晚于上一终态的新鲜 startup 锁仍应展示正在运行，避免真实同步中没有反馈。"
  );

  setForegroundState({
    phase: "running",
    timestamp: now,
    token: "probe-followup",
    reason: "remote_probe_changed:foreground_resume",
    operation: "probe",
    lastResolvedPhase: "idle",
    lastResolvedTimestamp: now,
    lastResolvedSource: "",
    lastResolvedReason: "",
  });
  setStartupLocks(now - 1000);
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "probe",
    "remote_probe_changed 触发的前台 follow-up 在决策前应保持放大镜 probe 语义，而不是中性三点。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：正在检查云端更新"
  );
};

const testNewerTerminalAuthoritySupersedesOlderForegroundLock = () => {
  const { hooks, store } = createHarness();
  const terminalTimestamp = Date.now();
  const staleLockTimestamp = terminalTimestamp - 1000;
  const terminalState = {
    phase: "success",
    timestamp: terminalTimestamp,
    token: "terminal-pull",
    source: "foreground_resume",
    reason: "remote_changed_since_baseline",
    operation: "pull",
    lastResolvedPhase: "success",
    lastResolvedTimestamp: terminalTimestamp,
    lastResolvedSource: "foreground_resume",
    lastResolvedReason: "remote_changed_since_baseline",
  };
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, terminalState);
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-tab",
    mode: "foreground_followup",
    timestamp: staleLockTimestamp,
    ttlMs: 45 * 1000,
  });
  store.set(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY, {
    owner: "other-tab",
    timestamp: staleLockTimestamp,
  });

  let resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    resolvedState.displayPhase,
    "success",
    "较旧但仍有效的 foreground 锁不能覆盖更新的终态结果。"
  );
  assert.notEqual(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "probe",
    "旧锁不能让已完成的拉取重新显示成 probe。"
  );

  const activeProbeTimestamp = terminalTimestamp + 1000;
  store.set(GLOBAL_SYNC_LOCK_KEY, {
    owner: "other-tab",
    mode: "foreground_followup",
    timestamp: activeProbeTimestamp,
    ttlMs: 45 * 1000,
  });
  store.set(FOREGROUND_FOLLOWUP_SYNC_LOCK_KEY, {
    owner: "other-tab",
    timestamp: activeProbeTimestamp,
  });
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...terminalState,
    phase: "running",
    timestamp: activeProbeTimestamp,
    source: "foreground_resume",
    reason: "foreground_probe_in_flight",
    operation: "probe",
  });
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    resolvedState.displayPhase,
    "running",
    "更新的合法 foreground 锁仍必须显示真实运行态。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "probe",
    "更新的合法 probe 不能被终态保护误隐藏。"
  );
};

const testDisplaySessionCoalescesPushVerification = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  hooks.clearLastAutoSyncIndicatorDisplaySession();
  hooks.rememberAutoSyncIndicatorDisplaySessionFromRemoteWrite({
    action: "pushed",
    remoteUpdatedAt: "2026-05-15T16:24:35Z",
    threadId: "2268704",
    syncMode: "background",
    createdAt: now - 1500,
  });

  hooks.scheduleForegroundRemoteSyncRetry(
    "remote_probe_equal_ambiguous:foreground_resume",
    {
      preferredDelayMs: 20,
      indicatorReason: "foreground_probe_verification_retry",
      indicatorOperation: "sync",
      getForegroundProbeGateBlockResult: () => null,
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "no_change",
      }),
      applyRefreshPolicyForSyncResult: () => null,
      maybeShowForegroundProbeFeedback: () => false,
    }
  );

  let resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "pending");
  assert.equal(resolvedState.displaySessionKind, "local_push_session");
  assert.equal(resolvedState.displaySubstate, "settling");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "probe",
    "同机会话刚推送后的二次确认应显示为云端确认探测，而不是待推送箭头。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：推送完成，正在确认云端状态"
  );

  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 13,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 20000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { read_progress: 1 },
    threadIds: ["2268704"],
    reason: "debounced_read_progress",
  });
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "pending");
  assert.equal(resolvedState.displaySubstate, "pending");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "push",
    "settling 期间出现新的同方向本地 dirty 时，应直接续到 push pending。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：阅读进度待推送"
  );

  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 14,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 20000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { read_progress: 1, user_tags: 1 },
    threadIds: ["2268704"],
    reason: "debounced_mixed_local_changes",
  });
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：本地变更待推送",
    "多个本地来源交织时，tooltip 应升级为本地变更，而不是硬写阅读进度。"
  );

  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);
  hooks.clearForegroundRemoteSyncRetry();
  hooks.setLastAutoSyncIndicatorDisplaySession({
    direction: "push",
    source: "background_push",
    completedAt: Date.now() - 31000,
    remoteUpdatedAt: "2026-05-15T16:24:35Z",
    sameSessionWrite: true,
  });
  hooks.scheduleForegroundRemoteSyncRetry(
    "remote_probe_equal_ambiguous:foreground_resume",
    {
      preferredDelayMs: 20,
      indicatorReason: "foreground_probe_verification_retry",
      indicatorOperation: "sync",
      getForegroundProbeGateBlockResult: () => null,
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "no_change",
      }),
      applyRefreshPolicyForSyncResult: () => null,
      maybeShowForegroundProbeFeedback: () => false,
    }
  );
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "idle");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "idle",
    "超过会话归并窗口后的等值二次确认应静默执行，不再点亮导航栏 pending。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：待命",
    "静默等值二次确认不应继续显示旧的等待确认文案。"
  );
  hooks.clearForegroundRemoteSyncRetry();
  hooks.clearLastAutoSyncIndicatorDisplaySession();
};

const testPullRetryKeepsCloudDirectionOverLocalPending = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  hooks.clearLastAutoSyncIndicatorDisplaySession();
  hooks.scheduleForegroundRemoteSyncRetry(
    "remote_probe_changed:foreground_resume",
    {
      preferredDelayMs: 20,
      indicatorReason: "foreground_followup_retry",
      indicatorOperation: "pull",
      getForegroundProbeGateBlockResult: () => null,
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "pulled",
      }),
      applyRefreshPolicyForSyncResult: () => null,
      maybeShowForegroundProbeFeedback: () => false,
    }
  );
  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 15,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30000,
    dueAt: now + 20000,
    maxWaitUntil: now + 60000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { read_progress: 1 },
    threadIds: ["2268704"],
    reason: "debounced_read_progress",
  });

  const resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "pending");
  assert.equal(resolvedState.displaySessionKind, "remote_pull_session");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "pull",
    "明确的 pull retry 应保留云端拉取方向，不能被本地 pending push 盖掉。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：云端更新待拉取"
  );

  hooks.clearForegroundRemoteSyncRetry();
  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);
};

const testSuccessDisplayKeepsDirectionalCompletion = () => {
  {
    const { hooks, store } = createHarness();
    const token = hooks.startAutoSyncIndicatorCycle("background_push", {
      operation: "push",
      reason: "read_progress",
    });
    const runningState = toPlainObject(hooks.getAutoSyncIndicatorState());
    store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
      ...runningState,
      timestamp: Date.now() - 1000,
    });
    hooks.finishAutoSyncIndicatorCycle(token, "success", {
      source: "background_push",
      reason: "pushed",
      operation: "push",
    });
    const resolvedState = toPlainObject(readNavbarProjection(hooks));
    assert.equal(resolvedState.displayPhase, "success");
    assert.equal(resolvedState.displaySessionKind, "local_push_session");
    assert.equal(resolvedState.displaySubstate, "done");
    assert.equal(
      hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
      "push",
      "push success 应保留推送方向，不能退回泛化成功态。"
    );
    assert.equal(
      hooks.getAutoSyncIndicatorTitle(resolvedState),
      "自动同步：本地变更已推送"
    );
  }

  {
    const { hooks, store } = createHarness();
    const token = hooks.startAutoSyncIndicatorCycle("foreground_resume", {
      operation: "pull",
      reason: "pull",
    });
    const runningState = toPlainObject(hooks.getAutoSyncIndicatorState());
    store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
      ...runningState,
      timestamp: Date.now() - 1000,
    });
    hooks.finishAutoSyncIndicatorCycle(token, "success", {
      source: "foreground_resume",
      reason: "pull",
      operation: "pull",
    });
    const resolvedState = toPlainObject(readNavbarProjection(hooks));
    assert.equal(resolvedState.displayPhase, "success");
    assert.equal(resolvedState.displaySessionKind, "remote_pull_session");
    assert.equal(resolvedState.displaySubstate, "done");
    assert.equal(
      hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
      "pull",
      "pull success 应保留拉取方向，不能显示成普通成功态。"
    );
    assert.equal(
      hooks.getAutoSyncIndicatorTitle(resolvedState),
      "自动同步：云端更新已拉取"
    );
  }
};

const testBackgroundDrainKeepsSuccessAfterPushVerification = () => {
  const { hooks } = createHarness();
  const pushedCompletion = hooks.resolveAutoSyncIndicatorDrainCompletion({
    result: {
      status: "success",
      action: "pushed",
    },
  });
  assert.equal(pushedCompletion.phase, "success");
  assert.equal(pushedCompletion.hadSuccessfulWrite, true);
  assert.equal(pushedCompletion.lastSuccessfulOperation, "push");

  const verificationCompletion = hooks.resolveAutoSyncIndicatorDrainCompletion({
    currentPhase: pushedCompletion.phase,
    currentReason: pushedCompletion.reason,
    hadSuccessfulWrite: pushedCompletion.hadSuccessfulWrite,
    lastSuccessfulOperation: pushedCompletion.lastSuccessfulOperation,
    result: {
      status: "success",
      action: "no_change",
      reason: "hash_equal",
    },
  });
  assert.equal(
    verificationCompletion.phase,
    "success",
    "同一轮后台 drain 已经推送成功后，后续 hash_equal/no_change 只应作为确认，不应把最终展示态压回 idle。"
  );
  assert.equal(
    verificationCompletion.lastSuccessfulOperation,
    "push",
    "no_change 确认不应覆盖上一条成功方向。"
  );

  const pulledCompletion = hooks.resolveAutoSyncIndicatorDrainCompletion({
    currentPhase: pushedCompletion.phase,
    currentReason: pushedCompletion.reason,
    hadSuccessfulOperation: pushedCompletion.hadSuccessfulOperation,
    lastSuccessfulOperation: pushedCompletion.lastSuccessfulOperation,
    result: {
      status: "success",
      action: "pulled",
    },
  });
  assert.equal(
    pulledCompletion.lastSuccessfulOperation,
    "pull",
    "drain 应记录最后一次有方向的成功结果，而不是停留在第一次 push-like 成功。"
  );

  const plainNoChangeCompletion = hooks.resolveAutoSyncIndicatorDrainCompletion({
    result: {
      status: "success",
      action: "no_change",
      reason: "hash_equal",
    },
  });
  assert.equal(
    plainNoChangeCompletion.phase,
    "idle",
    "没有先发生 push 的普通 no_change 仍应安静回 idle。"
  );
};

const testStalePendingAutoSyncRequestDoesNotDisplay = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  const staleAt = now - 120000;
  store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "read_progress",
    lastModified: staleAt,
    maxLastModified: staleAt,
    createdAt: staleAt,
    firstDirtyAt: staleAt,
    lastDirtyAt: staleAt,
    sources: { read_progress: 1 },
    threadIds: ["2268704"],
  });

  let resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.notEqual(
    resolvedState.displayPhase,
    "pending",
    "过期 pending auto sync request 不应继续让导航栏显示待推送。"
  );
  assert.equal(hooks.hasActivePendingAutoSyncRequest(), false);

  store.set(PENDING_AUTO_SYNC_KEY, {
    version: 1,
    source: "read_progress",
    lastModified: now,
    maxLastModified: now,
    createdAt: now,
    firstDirtyAt: now,
    lastDirtyAt: now,
    sources: { read_progress: 1 },
    threadIds: ["2268704"],
  });

  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(resolvedState.displayPhase, "pending");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
    "push",
    "新鲜 pending auto sync request 仍应显示待推送。"
  );
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：阅读进度待推送"
  );
};

const testBackgroundPushRunningRequiresCurrentLiveRunner = () => {
  const { hooks, store } = createHarness();
  const now = Date.now();
  const constants = hooks.getTitleSyncStatusTestConstants();
  const pendingRequest = {
    version: 1,
    source: "read_progress",
    lastModified: now,
    maxLastModified: now,
    createdAt: now,
    firstDirtyAt: now,
    lastDirtyAt: now,
    sources: { read_progress: 1 },
    threadIds: ["2283403"],
  };
  const setBackgroundLocks = (owner, timestamp = now - 5000) => {
    store.set(BACKGROUND_SYNC_LOCK_KEY, {
      owner,
      timestamp,
    });
    store.set(GLOBAL_SYNC_LOCK_KEY, {
      owner,
      mode: "background",
      timestamp,
      ttlMs: constants.BACKGROUND_SYNC_LOCK_TTL_MS,
    });
  };

  store.set(PENDING_AUTO_SYNC_KEY, pendingRequest);
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    phase: "success",
    timestamp: now - 3000,
    token: "",
    source: "background_push",
    reason: "previous_push",
    operation: "push",
    lastResolvedPhase: "success",
    lastResolvedTimestamp: now - 3000,
    lastResolvedSource: "background_push",
    lastResolvedReason: "previous_push",
  });

  setBackgroundLocks("other-tab");
  let resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    resolvedState.displayPhase,
    "pending",
    "其他标签页留下的新鲜后台同步锁不能把待推送状态渲染成推送中动画。"
  );
  assert.equal(hooks.getAutoSyncIndicatorDisplayKind(resolvedState), "push");
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：阅读进度待推送"
  );

  setBackgroundLocks(constants.BACKGROUND_SYNC_OWNER_ID, now - 1000);
  resolvedState = toPlainObject(readNavbarProjection(hooks));
  assert.equal(
    resolvedState.displayPhase,
    "running",
    "当前标签页自己持有后台同步锁时，仍应显示真正的推送中动画。"
  );
  assert.equal(hooks.getAutoSyncIndicatorDisplayKind(resolvedState), "push");
  assert.equal(
    hooks.getAutoSyncIndicatorTitle(resolvedState),
    "自动同步：阅读进度推送中"
  );
};

const testAutoSyncEntryPointsBindIndicatorSources = () => {
  expectMatch(
    /const runStartupModeAutoSyncCheckWithIndicator = async[\s\S]*?startAutoSyncIndicatorCycle\(resolvedSource/m,
    "自动同步指示器缺少统一的启动同步封装 helper。"
  );
  expectMatch(
    /runStartupModeAutoSyncCheckWithIndicator[\s\S]*?startAutoSyncIndicatorCycle\(resolvedSource,\s*\{[\s\S]*?operation:\s*AUTO_SYNC_INDICATOR_OPERATION_SYNC/m,
    "启动/加载类安全同步在决策前应使用中性 sync 图标，避免误显示拉取后又切推送。"
  );
  expectMatch(
    /runForegroundFollowUpAutoSyncCheckWithIndicator[\s\S]*?startAutoSyncIndicatorCycle\(resolvedSource,\s*\{[\s\S]*?operation:\s*getForegroundFollowUpInitialIndicatorOperation\(normalizedReason\)/m,
    "前台 follow-up 安全同步应按触发原因决定初始图标，remote_probe_changed 在决策前保持 probe 语义。"
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
    /remote_probe_equal_ambiguous:\$\{normalizedReason\}[\s\S]*?indicatorReason:\s*AUTO_SYNC_INDICATOR_REASON_FOREGROUND_PROBE_VERIFICATION_RETRY[\s\S]*?indicatorOperation:\s*AUTO_SYNC_INDICATOR_OPERATION_SYNC/,
    "云端版本时间相同的内部复查应保留中性 sync operation，避免异常显示时误表达为待拉取。"
  );
  expectMatch(
    /shouldSuppressAutoSyncIndicatorEqualVerificationDisplay[\s\S]*?AUTO_SYNC_INDICATOR_REASON_FOREGROUND_PROBE_VERIFICATION_RETRY[\s\S]*?buildSilentAutoSyncIndicatorIdleDisplayState/,
    "等值二次校验没有 push settling 上下文时，应被显示层静默折回待命。"
  );
  expectMatch(
    /remote_probe_changed:\$\{normalizedReason\}[\s\S]*?indicatorReason:\s*AUTO_SYNC_INDICATOR_REASON_FOREGROUND_PROBE_CHANGED_RETRY[\s\S]*?indicatorOperation:\s*AUTO_SYNC_INDICATOR_OPERATION_SYNC/,
    "metadata-only 发现 updated_at 变化但补同步暂缓时，应使用中性 sync pending，避免过早显示待拉取。"
  );
  expectMatch(
    /const isChangedUpdatedAtProbeFollowUpReason[\s\S]*?remote_probe_changed:[\s\S]*?const getForegroundFollowUpInitialIndicatorOperation[\s\S]*?AUTO_SYNC_INDICATOR_OPERATION_PROBE[\s\S]*?AUTO_SYNC_INDICATOR_OPERATION_SYNC/,
    "remote_probe_changed 触发的前台 follow-up 在 full sync 决策前应继续显示 probe，而不是中性三点。"
  );
  expectMatch(
    /AUTO_SYNC_INDICATOR_LOCK_DISPLAY_STALE_MS[\s\S]*?getAutoSyncIndicatorActiveLockDisplayState[\s\S]*?isAutoSyncIndicatorLockFreshForDisplay/,
    "导航栏不能用完整同步锁 TTL 保持 running；锁展示应有更短的 stale 窗口。"
  );
  expectMatch(
    /const indicatorOperation[\s\S]*?normalizeAutoSyncIndicatorOperation\(options\.indicatorOperation\)[\s\S]*?AUTO_SYNC_INDICATOR_OPERATION_PULL/,
    "真正远端变化的前台补偿重试仍应默认按 pull 待拉取展示。"
  );
  expectMatch(
    /isEqualUpdatedAtProbeVerificationReason[\s\S]*?云端版本时间相同，正在执行前台二次确认同步检查/,
    "版本时间相同的前台二次确认日志不应再写成远端探测命中更新。"
  );
  expectMatch(
    /s1p-auto-sync-kind-push[\s\S]*?s1p-auto-sync-kind-pull[\s\S]*?s1p-auto-sync-kind-probe/,
    "导航栏指示器缺少推送/拉取/probe 三类动态图标 class。"
  );
  expectMatch(
    /s1p-auto-sync-arrow-flow-up[\s\S]*?s1p-auto-sync-arrow-flow-down/,
    "推送/拉取动态图标缺少方向箭头队列动画。"
  );
  expectMatch(
    /s1p-auto-sync-arrow-flow-up[\s\S]*?translateY\(13\.5px\)[\s\S]*?translateY\(-13\.5px\)[\s\S]*?s1p-auto-sync-arrow-flow-down[\s\S]*?translateY\(-13\.5px\)[\s\S]*?translateY\(13\.5px\)/,
    "推送/拉取箭头队列应使用完整轨道匀速位移，保证上下方向的视觉路径清晰。"
  );
  expectMatch(
    /s1p-auto-sync-pending-to-running-svg[\s\S]*?scale\(1\.25\)[\s\S]*?scale\(1\.18\)[\s\S]*?s1p-auto-sync-pending-to-running-arrow-bridge/,
    "pending 方向图标进入 running 箭头队列时应有专门的尺寸和队列相位衔接动画。"
  );
  expectMatch(
    /s1p-auto-sync-pending\.s1p-auto-sync-kind-push \.s1p-sync-flow-arrow:nth-child\(1\)[\s\S]*?translateY\(-4\.5px\)[\s\S]*?s1p-auto-sync-pending\.s1p-auto-sync-kind-push \.s1p-sync-flow-arrow:nth-child\(2\)[\s\S]*?translateY\(4\.5px\)[\s\S]*?--s1p-sync-arrow-bridge-start-y:\s*4\.5px;[\s\S]*?--s1p-sync-arrow-bridge-end-y:\s*4\.5px;/,
    "pending 推送箭头应直接对齐 running 队列相位，避免切换时先向反方向后退。"
  );
  expectMatch(
    /svg\.s1p-auto-sync-pending\.s1p-auto-sync-kind-push[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*scale\(1\.25\)[\s\S]*?s1p-auto-sync-pending\.s1p-auto-sync-kind-push \.s1p-sync-flow-arrow[\s\S]*?opacity:\s*1;/,
    "pending 推送/拉取箭头不能用半透明弱化，否则会比手动同步按钮显灰。"
  );
  expectMatch(
    /svg\.s1p-auto-sync-running\.s1p-auto-sync-kind-push[\s\S]*?transform:\s*scale\(1\.18\)/,
    "running 推送/拉取箭头队列应略微放大，和 pending 双箭头尺寸更连贯。"
  );
  expectMatch(
    /s1p-auto-sync-indicator-probe-to-operation-enter[\s\S]*?rotate\(0deg\)[\s\S]*?s1p-auto-sync-indicator-probe-to-operation-exit[\s\S]*?rotate\(0deg\)[\s\S]*?s1p-auto-sync-transition-probe-to-operation/,
    "probe 切换到推送/拉取 running 时应使用无横向摇摆、无旋转的专用转场。"
  );
  expectMatch(
    /AUTO_SYNC_INDICATOR_DEBUG_DEFAULT_SEQUENCE_STEPS[\s\S]*?label:\s*"Push 待处理 → Running"[\s\S]*?operation:\s*AUTO_SYNC_INDICATOR_OPERATION_PUSH[\s\S]*?label:\s*"Pull 待处理 → Running"[\s\S]*?operation:\s*AUTO_SYNC_INDICATOR_OPERATION_PULL[\s\S]*?label:\s*"Probe → Pull"[\s\S]*?operation:\s*AUTO_SYNC_INDICATOR_OPERATION_PROBE[\s\S]*?operation:\s*AUTO_SYNC_INDICATOR_OPERATION_PULL/,
    "指示器调试面板应提供与当前实现一致的固定转场预览入口。"
  );
  expectMatch(
    /normalizeAutoSyncIndicatorDebugSequenceStep[\s\S]*?hasOwnOperation[\s\S]*?nextStep\.operation[\s\S]*?runAutoSyncIndicatorDebugSequence\(sequenceButton\.steps/,
    "指示器调试转场应支持每一步指定 operation，才能预览 probe -> pull 这类同 phase 换 kind 的路径。"
  );
  expectMatch(
    /actual-display[\s\S]*?formatAutoSyncIndicatorDebugDisplaySummary\(actualDisplayState\)[\s\S]*?preview-display[\s\S]*?formatAutoSyncIndicatorDebugDisplaySummary\(previewDisplayState\)/,
    "指示器调试面板应显示实际/预览经过显示层解析后的最终状态。"
  );
  expectMatch(
    /animation-duration:\s*3\.15s;[\s\S]*?nth-child\(1\)[\s\S]*?animation-delay:\s*-2\.1s;[\s\S]*?nth-child\(2\)[\s\S]*?animation-delay:\s*-1\.05s;[\s\S]*?nth-child\(3\)[\s\S]*?animation-delay:\s*0s;/,
    "推送/拉取箭头队列应以稳定错相铺满队列，避免三枚箭头一起跳变。"
  );
  expectNoMatch(
    /@keyframes s1p-auto-sync-arrow-flow-(?:up|down)\s*\{(?:(?!@keyframes)[\s\S])*?scale\(/,
    "推送/拉取箭头队列不应在关键帧里缩放，避免产生先快后稳的错觉。"
  );
  expectMatch(
    /const pushArrowPath = "M11\.9999 10\.8284[\s\S]*?const pullArrowPath = "M11\.9999 13\.1714[\s\S]*?const buildArrowQueueSvg[\s\S]*?s1p-sync-flow-arrow[\s\S]*?const pushArrowQueueSvg = buildArrowQueueSvg\(pushArrowPath\)[\s\S]*?const pullArrowQueueSvg = buildArrowQueueSvg\(pullArrowPath\)/,
    "pending 与 running 推送/拉取应复用同一组三箭头 SVG 结构。"
  );
  expectNoMatch(
    /s1p-sync-pending-arrow/,
    "pending 推送/拉取不应再使用独立的双箭头 path class。"
  );
  expectNoMatch(
    /M12 4\.83582|M12 19\.1642/,
    "pending 不应继续使用独立的双箭头 SVG path。"
  );
  expectMatch(
    /case AUTO_SYNC_INDICATOR_PHASE_PENDING:\s*case AUTO_SYNC_INDICATOR_PHASE_RUNNING:[\s\S]*?return getOperationSvg\(\);/,
    "pending 与 running 应复用同一方向图标结构，由 phase class 决定静态或流动表现。"
  );
  expectMatch(
    /svg\.s1p-auto-sync-pending\.s1p-auto-sync-kind-push[\s\S]*?transform:\s*scale\(1\.25\)/,
    "pending 推送/拉取静态双箭头应按当前视觉校准放大到 1.25。"
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
    /const refreshAutoSyncIndicatorRuntimeDisplay = \([\s\S]*?\) => \{\s*invalidateAutoSyncIndicatorDisplayPhaseCache\(\);\s*renderNavbarAutoSyncIndicator\(\)/,
    "运行态刷新应立即重绘导航栏指示器。"
  );
  expectNoMatch(
    /const refreshAutoSyncIndicatorRuntimeDisplay = \([\s\S]*?\) => \{\s*clearAutoSyncIndicatorDeferredResolve\(\);/,
    "运行态刷新不能取消已排队的结果态，否则快速前台拉取会在刷新前看不到成功。"
  );
  expectMatch(
    /return manualSyncInFlightPromise\.finally\(\(\) => \{[\s\S]*?releaseManualSyncLock\(\);[\s\S]*?refreshAutoSyncIndicatorAfterManualLockRelease\(\);/,
    "普通手动同步结束后未刷新自动同步指示器。"
  );
  expectMatch(
    /foregroundRemoteSyncCheckInFlightPromise = null;[\s\S]*?refreshAutoSyncIndicatorRuntimeDisplay\("foreground_followup_finished"\)/,
    "前台 follow-up promise 清理后应立即重绘，避免 no_change 后仍显示拉取箭头动画。"
  );
  expectMatch(
    /foregroundProbeInFlightPromise = runPromise;[\s\S]*?scheduleForegroundProbeIndicatorDisplay\(/,
    "前台 metadata probe 开始后应延迟显示，避免快速请求造成放大镜闪烁。"
  );
  expectMatch(
    /foregroundProbeInFlightPromise = null;[\s\S]*?settleForegroundProbeIndicatorDisplay\("foreground_probe_finished"\)/,
    "前台 metadata probe promise 清理后应通过最短可见时间收束探测图标。"
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
    /AUTO_SYNC_INDICATOR_PROBE_SHOW_DELAY_MS\s*=\s*160[\s\S]*?AUTO_SYNC_INDICATOR_PROBE_MIN_VISIBLE_MS\s*=\s*560/,
    "前台 probe 指示器应有延迟显示和最短可见时间，避免快速 metadata 请求闪烁。"
  );
  expectMatch(
    /path:\s*\[[\s\S]*?"class"[\s\S]*?"d"/,
    "图标 sanitizer 应允许 path class，以便推送/拉取箭头队列动画生效。"
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
  await testDeferredResolvedPhaseKeepsOperation();
  await testForegroundFollowupRefreshKeepsDeferredSuccess();
  testSharedSchedulerAndLocksFeedUnifiedDisplayState();
  testSyncIndicatorStateProjectionSurfaceContract();
  testTitleProjectionPhasePolicyBranches();
  testForegroundFollowupLockDisplayDoesNotUseFullLockTtl();
  testNewerTerminalAuthoritySupersedesOlderForegroundLock();
  testDisplaySessionCoalescesPushVerification();
  testPullRetryKeepsCloudDirectionOverLocalPending();
  testSuccessDisplayKeepsDirectionalCompletion();
  testBackgroundDrainKeepsSuccessAfterPushVerification();
  testStalePendingAutoSyncRequestDoesNotDisplay();
  testBackgroundPushRunningRequiresCurrentLiveRunner();
  testAutoSyncEntryPointsBindIndicatorSources();

  console.log("[auto-sync-indicator-linkage] Auto sync indicator linkage verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
