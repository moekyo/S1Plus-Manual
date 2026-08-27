#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const noop = () => {};

const createHarness = () => {
  return createBaseHarness({
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 7 测试钩子。",
  });
};

const requestPerLoadSync = (hooks, options = {}) =>
  hooks.s1pSyncSystem.requestSync({ kind: "per_load", options });

const requestDailyStartupSync = (hooks, options = {}) =>
  hooks.s1pSyncSystem.requestSync({ kind: "daily_startup", options });

const createQueryDocument = ({
  hasThreadList = false,
  hasPostList = false,
  hasDirtySettings = false,
} = {}) => ({
  querySelector: (selector) => {
    if (
      selector === ".s1p-modal[data-s1p-settings-has-dirty-edits='true']"
    ) {
      return hasDirtySettings ? {} : null;
    }
    if (selector === "#postlist, #postlist table[id^='pid']") {
      return hasPostList ? {} : null;
    }
    if (
      selector ===
      "#threadlist, #threadlisttableid, tbody[id^='normalthread_'], tbody[id^='stickthread_']"
    ) {
      return hasThreadList ? {} : null;
    }
    return null;
  },
});

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testStaticWiring = () => {
  expectMatch(
    /const applyAutoPullRefreshPolicy = \(options = \{\}\) => \{/m,
    "Phase 7 未新增统一的自动拉取后刷新策略入口。"
  );
  expectMatch(
    /modal\.dataset\.s1pSettingsHasDirtyEdits = "true";/m,
    "Phase 7 未将设置弹窗脏状态暴露为可被同步逻辑检测的 DOM 标记。"
  );
  expectMatch(
    /const mergeReadProgressAndPush = async[\s\S]*?const result = asSuccessResult\(\s*"merged_read_progress",\s*\{\s*contentHash:\s*mergedContentHash,\s*remoteUpdatedAt:\s*pushResult\?\.updatedAt \|\| null,\s*\},\s*\{[\s\S]*?reason:\s*mergeReason[\s\S]*?\.\.\.recentRemoteWriteResultContext[\s\S]*?appliedRemoteWriter:\s*pushResult\?\.writerMetadata \|\| null[\s\S]*?\}\s*\)/m,
    "merged_read_progress 结果必须把 same-session / same-device 写入上下文放到 extraResult，提示层才能读取。"
  );
  expectMatch(
    /const createSameDeviceAutoPullRefreshMessages = \(\s*deviceId = "",\s*action = "pulled",\s*sourceLabel = ""\s*\) => \{/m,
    "未新增 same-device 自动拉取提示文案 helper。"
  );
};

const testResultPhasePolicyOwnsRefreshAndSuppression = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    decideRemoteChange: (result, context) => ({
      shouldApply: result.action === "pulled",
      shouldReload: result.action === "pulled",
      shouldNotify: result.action === "pulled",
      suppressMessage: result.action !== "pulled",
      reason: result.action === "pulled" ? "reload_now" : "not_applicable",
      source: context.source,
      action: result.action,
      refreshPlan:
        result.action === "pulled"
          ? { policy: "reload_now", shouldReload: true }
          : null,
    }),
    applyRefresh: (result, options) => {
      calls.push(`refresh:${options.remoteChangeDecision.source}`);
      return {
        ...options.remoteChangeDecision.refreshPlan,
        reloadSchedule: { status: "scheduled" },
      };
    },
    logSuppressed: (decision) => {
      calls.push(`suppressed:${decision.action}`);
    },
    pauseConflict: (reason) => {
      calls.push(`pause:${reason}`);
    },
    clearConflictPause: () => {
      calls.push("pause:clear");
    },
  });

  const applied = await policy.handle(
    { status: "success", action: "pulled" },
    { source: "background" }
  );
  assert.equal(applied.refreshIntent.kind, "apply");
  assert.equal(applied.refreshPlan.reloadSchedule.status, "scheduled");
  assert.deepStrictEqual(calls, ["pause:clear", "refresh:background"]);

  calls.length = 0;
  const suppressed = await policy.handle(
    { status: "success", action: "no_change" },
    { source: "per_load" }
  );
  assert.equal(suppressed.refreshIntent.kind, "suppress");
  assert.equal(suppressed.refreshPlan, null);
  assert.deepStrictEqual(calls, ["pause:clear", "suppressed:no_change"]);
};

const testResultPhasePolicyOwnsConflictAndRetryIntents = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    decideRemoteChange: () => ({
      shouldApply: false,
      shouldReload: false,
      shouldNotify: false,
      suppressMessage: true,
      reason: "not_applicable",
      action: "unknown",
      refreshPlan: null,
    }),
    applyRefresh: () => null,
    logSuppressed: noop,
    pauseConflict: (reason) => {
      calls.push(`pause:${reason}`);
    },
  });

  const conflict = await policy.handle(
    { status: "conflict", reason: "remote_newer" },
    {
      source: "background",
      notify: (intent) => {
        calls.push(`notify:${intent.kind}`);
      },
    }
  );
  assert.equal(conflict.conflictPauseIntent.reason, "remote_newer");
  assert.equal(conflict.notificationIntent.kind, "conflict");
  assert.deepStrictEqual(calls, ["pause:remote_newer", "notify:conflict"]);

  calls.length = 0;
  const failure = await policy.handle(
    {
      status: "failure",
      error: "network down",
      failureState: { open: false },
    },
    {
      source: "background",
      notify: (intent) => {
        calls.push(`notify:${intent.kind}`);
      },
      scheduleRetry: (intent) => {
        calls.push(`retry:${intent.kind}:${intent.delayMs}`);
        return { status: "scheduled" };
      },
    }
  );
  assert.equal(failure.retryIntent.kind, "background");
  assert.equal(failure.retryIntent.delayMs, 1200);
  assert.deepStrictEqual(calls, ["notify:failure", "retry:background:1200"]);

  calls.length = 0;
  const foregroundFailure = await policy.handle(
    {
      status: "failure",
      error: "temporary timeout",
      failureState: { open: false },
    },
    {
      source: "foreground",
      scheduleRetry: (intent) => {
        calls.push(`retry:${intent.kind}:${intent.delayMs}`);
        return { status: "scheduled" };
      },
    }
  );
  assert.equal(foregroundFailure.retryIntent.kind, "foreground");
  assert.equal(foregroundFailure.retryIntent.delayMs, 1200);
  assert.deepStrictEqual(calls, ["retry:foreground:1200"]);

  calls.length = 0;
  const foregroundBlocked = await policy.handle(
    {
      status: "blocked",
      blockLevel: "soft",
      reason: "read_progress_pending_write",
      retryAfterMs: 2600,
    },
    {
      source: "foreground",
      scheduleRetry: (intent) => {
        calls.push(`retry:${intent.kind}:${intent.delayMs}`);
      },
    }
  );
  assert.equal(foregroundBlocked.retryIntent.kind, "foreground");
  assert.equal(foregroundBlocked.retryIntent.delayMs, 2600);
  assert.deepStrictEqual(calls, ["retry:foreground:2600"]);
};

const testResultPhasePolicyHandlesRetryAndFallbackEdges = async () => {
  const { hooks } = createHarness();
  const retryCalls = [];
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    pauseConflict: (reason) => retryCalls.push(`pause:${reason}`),
  });

  const openCircuitFailure = await policy.handle(
    {
      status: "failure",
      error: "network down",
      failureState: { open: true },
    },
    {
      source: "background",
      scheduleRetry: () => retryCalls.push("retry"),
    }
  );
  assert.equal(openCircuitFailure.retryIntent, null);
  assert.deepStrictEqual(retryCalls, []);

  const missingResult = policy.resolve(null, { source: "unexpected_source" });
  assert.equal(missingResult.source, "generic");
  assert.equal(missingResult.status, "unknown");
  assert.equal(missingResult.retryIntent, null);
  assert.equal(missingResult.notificationIntent.kind, "none");

  const unexpectedResult = policy.resolve(
    { status: "unexpected_status" },
    { source: "background" }
  );
  assert.equal(unexpectedResult.status, "unexpected_status");
  assert.equal(unexpectedResult.retryIntent, null);
  assert.equal(unexpectedResult.notificationIntent.kind, "none");

  const fallbackConflict = await policy.handle(
    { status: "conflict" },
    { source: "background" }
  );
  assert.equal(fallbackConflict.conflictPauseIntent.reason, "sync_conflict");
  assert.deepStrictEqual(retryCalls, ["pause:sync_conflict"]);
};

const testBackgroundRetryAdapterReturnsExplicitStatuses = () => {
  const { hooks } = createHarness();
  const clearedReasons = [];
  const clearAutoSyncRuntimeQueue = () => {
    clearedReasons.push("cleared");
  };

  const scheduled = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => null,
    pendingDirtyScheduler: {
      retry: () => ({ status: "scheduled", strategy: "local" }),
    },
  });
  assert.deepStrictEqual(toPlainObject(scheduled), {
    status: "scheduled",
    reason: "background_retry",
    delayMs: 1250,
  });

  const delegated = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => null,
    pendingDirtyScheduler: {
      retry: () => ({ status: "scheduled", strategy: "shared" }),
    },
  });
  assert.deepStrictEqual(toPlainObject(delegated), {
    status: "delegated",
    reason: "shared_scheduler",
    delayMs: 1250,
  });

  const schedulerBlocked = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => null,
    clearAutoSyncRuntimeQueue,
    pendingDirtyScheduler: {
      retry: () => ({
        status: "skipped",
        reason: "sync_not_ready",
        strategy: "blocked",
      }),
    },
  });
  assert.deepStrictEqual(toPlainObject(schedulerBlocked), {
    status: "blocked",
    reason: "sync_not_ready",
    delayMs: 1250,
  });
  assert.equal(clearedReasons.length, 1);

  const rejected = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => null,
    clearAutoSyncRuntimeQueue,
    pendingDirtyScheduler: { retry: () => null },
  });
  assert.deepStrictEqual(toPlainObject(rejected), {
    status: "blocked",
    reason: "scheduler_rejected",
    delayMs: 1250,
  });
  assert.equal(clearedReasons.length, 2);

  const failed = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => null,
    clearAutoSyncRuntimeQueue,
    pendingDirtyScheduler: {
      retry: () => {
        throw new Error("scheduler failed");
      },
    },
  });
  assert.deepStrictEqual(toPlainObject(failed), {
    status: "blocked",
    reason: "scheduler_error",
    delayMs: 1250,
  });
  assert.equal(clearedReasons.length, 3);

  const conflictBlocked = hooks.s1pScheduleBackgroundSyncRetry(1250, {
    getActiveAutoSyncConflictPause: () => ({ paused: true }),
    clearAutoSyncRuntimeQueue,
  });
  assert.deepStrictEqual(toPlainObject(conflictBlocked), {
    status: "blocked",
    reason: "conflict_paused",
    delayMs: 1250,
  });
  assert.equal(clearedReasons.length, 4);
};

const testResultPhasePolicyDefersSourceSpecificProductBehavior = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    decideRemoteChange: () => ({
      shouldApply: false,
      shouldReload: false,
      shouldNotify: false,
      suppressMessage: true,
      reason: "startup_local_newer",
      action: "skipped_push_on_startup",
      refreshPlan: null,
    }),
    applyRefresh: () => null,
    logSuppressed: noop,
    pauseConflict: (reason) => {
      calls.push(`pause:${reason}`);
    },
  });

  const outcome = await policy.handle(
    {
      status: "success",
      action: "skipped_push_on_startup",
      reason: "local_changed_during_sync",
    },
    {
      source: "daily_startup",
      notify: (intent) => {
        calls.push(`notify:${intent.kind}`);
        return "popup_shown";
      },
    }
  );

  assert.equal(
    outcome.conflictPauseIntent.reason,
    "local_changed_during_sync"
  );
  assert.equal(
    outcome.notificationIntent.kind,
    "startup_local_changed_during_sync"
  );
  assert.equal(outcome.notificationResult, "popup_shown");
  assert.deepStrictEqual(calls, [
    "pause:local_changed_during_sync",
    "notify:startup_local_changed_during_sync",
  ]);
};

const testResultPhasePolicyIsolatesAdapterFailuresBeforeRetry = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    decideRemoteChange: () => ({
      shouldApply: false,
      shouldReload: false,
      shouldNotify: false,
      suppressMessage: true,
      reason: "not_applicable",
      action: "unknown",
      refreshPlan: null,
    }),
    applyRefresh: () => null,
    logSuppressed: noop,
    pauseConflict: noop,
    clearConflictPause: noop,
  });

  const outcome = await policy.handle(
    {
      status: "failure",
      error: "network down",
      failureState: { open: false },
    },
    {
      source: "background",
      notify: () => {
        calls.push("notify");
        throw new Error("toast failed");
      },
      scheduleRetry: (intent) => {
        calls.push(`retry:${intent.delayMs}`);
        return { status: "scheduled" };
      },
    }
  );

  assert.deepStrictEqual(calls, ["notify", "retry:1200"]);
  assert.equal(outcome.retryResult.status, "scheduled");
  assert.equal(outcome.intentErrors.length, 1);
  assert.equal(outcome.intentErrors[0].intent, "notification");
  assert.match(outcome.intentErrors[0].message, /toast failed/);
};

const testResultPhasePolicyAccumulatesIndependentAdapterFailures = async () => {
  const { hooks } = createHarness();
  const policy = hooks.s1pCreateSyncResultPhasePolicy({
    decideRemoteChange: (result) => ({
      shouldApply: result.action === "pulled",
      shouldReload: result.action === "pulled",
      shouldNotify: false,
      suppressMessage: true,
      reason: result.action === "pulled" ? "reload_now" : "already_current",
      action: result.action,
      refreshPlan: null,
    }),
    applyRefresh: () => {
      throw new Error("refresh failed");
    },
    logSuppressed: () => {
      throw new Error("suppression failed");
    },
    pauseConflict: noop,
    clearConflictPause: () => {
      throw new Error("pause clear failed");
    },
  });

  const accumulated = await policy.handle(
    { status: "success", action: "no_change" },
    {
      source: "daily_startup",
      notify: () => {
        throw new Error("daily notification failed");
      },
    }
  );
  assert.deepStrictEqual(
    Array.from(accumulated.intentErrors, ({ intent }) => intent),
    ["conflict_pause", "refresh_suppression", "notification"]
  );

  const refreshFailure = await policy.handle(
    { status: "success", action: "pulled" },
    { source: "per_load" }
  );
  assert.deepStrictEqual(
    Array.from(refreshFailure.intentErrors, ({ intent }) => intent),
    ["conflict_pause", "refresh"]
  );

  const pauseFailurePolicy = hooks.s1pCreateSyncResultPhasePolicy({
    pauseConflict: () => {
      throw new Error("pause write failed");
    },
  });
  const pauseFailure = await pauseFailurePolicy.handle({
    status: "conflict",
    reason: "remote_newer",
  });
  assert.deepStrictEqual(
    Array.from(pauseFailure.intentErrors, ({ intent }) => intent),
    ["conflict_pause"]
  );

  const retryFailure = await policy.handle(
    {
      status: "failure",
      error: "network down",
      failureState: { open: false },
    },
    {
      source: "background",
      notify: noop,
      scheduleRetry: () => {
        throw new Error("retry scheduling failed");
      },
    }
  );
  assert.equal(retryFailure.retryResult, null);
  assert.deepStrictEqual(
    Array.from(retryFailure.intentErrors, ({ intent }) => intent),
    ["retry"]
  );
};

const testProductionResultPhaseNotificationAdapters = async () => {
  {
    const { hooks } = createHarness();
    const policy = hooks.s1pCreateSyncResultPhasePolicy({
      decideRemoteChange: () => ({
        shouldApply: false,
        shouldReload: false,
        shouldNotify: false,
        suppressMessage: true,
        reason: "startup_local_newer",
        action: "skipped_push_on_startup",
        refreshPlan: null,
      }),
    });
    const result = {
      status: "success",
      action: "skipped_push_on_startup",
      reason: "startup_local_newer",
    };
    let modalCheckCount = 0;
    const notify = (intent, syncResult) =>
      hooks.s1pNotifyDailyStartupSyncResultPhase(intent, syncResult, {
        shouldShowConflictModal: async () => modalCheckCount++ === 0,
        createAdvancedConfirmationModal: noop,
        showMessage: noop,
      });
    const first = await policy.handle(result, {
      source: "daily_startup",
      notify,
    });
    const second = await policy.handle(result, {
      source: "daily_startup",
      notify,
    });
    assert.equal(first.notificationIntent.kind, "startup_local_newer");
    assert.equal(first.notificationResult, "popup_shown");
    assert.equal(second.notificationResult, "cooldown_notified");
  }

  {
    const { hooks } = createHarness();
    const policy = hooks.s1pCreateSyncResultPhasePolicy();
    const result = { status: "conflict", reason: "remote_newer" };
    let modalCheckCount = 0;
    const notify = (intent, syncResult) =>
      hooks.s1pNotifyBackgroundSyncResultPhase(intent, syncResult, {
        shouldShowConflictModal: async () => modalCheckCount++ === 0,
        createAdvancedConfirmationModal: noop,
        showMessage: noop,
      });
    const first = await policy.handle(result, {
      source: "background",
      notify,
    });
    const second = await policy.handle(result, {
      source: "background",
      notify,
    });
    assert.equal(first.notificationResult, "popup_shown");
    assert.equal(second.notificationResult, "cooldown_notified");
  }

  {
    const { hooks } = createHarness();
    const policy = hooks.s1pCreateSyncResultPhasePolicy();
    const result = { status: "conflict", reason: "remote_newer" };
    let modalCheckCount = 0;
    const notify = (intent, syncResult) =>
      hooks.s1pNotifyDailyStartupSyncResultPhase(intent, syncResult, {
        shouldShowConflictModal: async () => modalCheckCount++ === 0,
        createAdvancedConfirmationModal: noop,
        showMessage: noop,
      });
    const first = await policy.handle(result, {
      source: "daily_startup",
      notify,
    });
    const second = await policy.handle(result, {
      source: "daily_startup",
      notify,
    });
    assert.equal(first.notificationIntent.kind, "conflict");
    assert.equal(first.notificationResult, "popup_shown");
    assert.equal(second.notificationResult, "cooldown_notified");
  }

  {
    const { hooks } = createHarness();
    let notificationCount = 0;
    const createPolicy = (reason) =>
      hooks.s1pCreateSyncResultPhasePolicy({
        decideRemoteChange: () => ({
          shouldApply: false,
          shouldReload: false,
          shouldNotify: false,
          suppressMessage: true,
          reason,
          action: "no_change",
          refreshPlan: null,
        }),
      });
    const notify = async (...args) => {
      notificationCount += 1;
      return hooks.s1pNotifyDailyStartupSyncResultPhase(args[0], args[1], {
        showMessage: noop,
      });
    };
    const current = await createPolicy("already_current").handle(
      { status: "success", action: "no_change" },
      { source: "daily_startup", notify }
    );
    const sameMachine = await createPolicy("same_machine_write").handle(
      { status: "success", action: "no_change" },
      { source: "daily_startup", notify }
    );
    assert.equal(current.notificationIntent.kind, "success_current");
    assert.equal(current.notificationResult, "notified");
    assert.equal(sameMachine.notificationIntent.kind, "none");
    assert.equal(sameMachine.notificationResult, null);
    assert.equal(notificationCount, 1);
  }

  {
    const { hooks } = createHarness();
    const policy = hooks.s1pCreateSyncResultPhasePolicy();
    const messages = [];
    const circuitOpen = await policy.handle(
      { status: "skipped", reason: "circuit_open" },
      {
        source: "daily_startup",
        notify: (intent, result) =>
          hooks.s1pNotifyDailyStartupSyncResultPhase(intent, result, {
            showMessage: (message, isSuccess) => {
              messages.push({ message, isSuccess });
            },
          }),
      }
    );
    assert.equal(circuitOpen.notificationIntent.kind, "circuit_open");
    assert.equal(circuitOpen.notificationResult, "notified");
    assert.equal(messages.length, 1);
  }

  {
    const { hooks } = createHarness();
    const policy = hooks.s1pCreateSyncResultPhasePolicy({
      decideRemoteChange: () => ({
        shouldApply: false,
        shouldReload: false,
        shouldNotify: false,
        suppressMessage: true,
        reason: "already_current",
        action: "pushed_initial",
        refreshPlan: null,
      }),
    });
    let notificationCount = 0;
    const pushedInitial = await policy.handle(
      { status: "success", action: "pushed_initial" },
      {
        source: "daily_startup",
        notify: () => {
          notificationCount += 1;
        },
      }
    );
    assert.equal(pushedInitial.notificationIntent.kind, "none");
    assert.equal(notificationCount, 0);
  }
};

const testProductionStartupConsumersRouteThroughResultPhasePolicy = async () => {
  const { hooks } = createHarness();
  const calls = [];
  const entryCalls = [];
  const resultPhasePolicy = {
    handle: async (result, options) => {
      calls.push({ result, options });
      return options.source === "per_load"
        ? {
            refreshPlan: { reloadSchedule: { status: "scheduled" } },
            notificationResult: null,
          }
        : {
            refreshPlan: null,
            notificationResult: "popup_shown",
          };
    },
  };

  const perLoadResult = await requestPerLoadSync(hooks, {
    settings: {
      syncPerLoadCheckEnabled: true,
      syncRemoteEnabled: true,
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat",
    },
    runStartupModeAutoSyncCheckWithIndicator: async (options) => {
      entryCalls.push(options);
      return { status: "success", action: "pulled" };
    },
    syncResultPhasePolicy: resultPhasePolicy,
  });
  assert.equal(perLoadResult, true);
  assert.equal(calls[0].options.source, "per_load");
  assert.equal(calls[0].result.action, "pulled");
  assert.equal(calls[0].options.refreshOptions.reason, "per_load_auto_pull");
  assert.equal(entryCalls[0].source, "per_load");

  const dailyResult = await requestDailyStartupSync(hooks, {
    settings: {
      syncRemoteEnabled: true,
      syncDailyFirstLoad: true,
    },
    runStartupModeAutoSyncCheckWithIndicator: async (options) => {
      entryCalls.push(options);
      return { status: "conflict", reason: "remote_newer" };
    },
    syncResultPhasePolicy: resultPhasePolicy,
  });
  assert.equal(dailyResult, "popup_shown");
  assert.equal(calls[1].options.source, "daily_startup");
  assert.equal(calls[1].result.status, "conflict");
  assert.equal(
    calls[1].options.notify,
    hooks.s1pNotifyDailyStartupSyncResultPhase
  );
  assert.equal(entryCalls[1].source, "daily_startup");

  const reloadResult = await requestDailyStartupSync(hooks, {
    settings: {
      syncRemoteEnabled: true,
      syncDailyFirstLoad: true,
    },
    runStartupModeAutoSyncCheckWithIndicator: async () => ({
      status: "success",
      action: "pulled",
    }),
    syncResultPhasePolicy: {
      handle: async () => ({
        refreshPlan: { reloadSchedule: { status: "scheduled" } },
        notificationResult: null,
      }),
    },
  });
  assert.equal(reloadResult, true);
};

const testRefreshPlanDetection = () => {
  const { hooks } = createHarness();

  const listPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
  });
  assert.equal(listPlan.policy, "reload_now");
  assert.equal(listPlan.pageType, "lightweight_list");
  assert.equal(listPlan.shouldReload, true);

  const threadPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
  });
  assert.equal(threadPlan.policy, "thread_soft_prompt");
  assert.equal(threadPlan.pageType, "thread_detail");
  assert.equal(threadPlan.shouldReload, false);

  const dirtyPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({
      hasThreadList: true,
      hasDirtySettings: true,
    }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
  });
  assert.equal(dirtyPlan.policy, "settings_dirty");
  assert.equal(dirtyPlan.pageType, "settings_modal");
  assert.equal(dirtyPlan.shouldReload, false);

  const mergedListPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "merged_read_progress",
  });
  assert.equal(mergedListPlan.policy, "read_progress_merged_inline");
  assert.equal(mergedListPlan.pageType, "lightweight_list");
  assert.equal(mergedListPlan.shouldReload, false);
};

const testListPageSchedulesReload = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let scheduledTimer = null;
  let reloadCount = 0;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess, options = {}) => {
      messages.push({ message, isSuccess, options });
    },
    setTimeoutFn: (callback, delay) => {
      scheduledTimer = { callback, delay };
      return 1;
    },
    locationObject: {
      reload: () => {
        reloadCount += 1;
      },
    },
  });

  assert.equal(result.policy, "reload_now");
  assert.equal(result.reloadSchedule.status, "scheduled");
  assert.equal(result.reloadSchedule.reloadDelayMs, 3200);
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0].message,
    "检测到云端备份比当前页面更新，已自动拉取到本地。正在刷新页面..."
  );
  assert.equal(messages[0].isSuccess, true);
  assert.equal(
    messages[0].options.durationMs,
    3800,
    "自动拉取刷新前的 toast 应至少覆盖完整刷新等待窗口，避免提示刚出现就被刷新打断。"
  );
  assert.ok(scheduledTimer, "列表页应当调度自动刷新。");
  assert.equal(scheduledTimer.delay, 3200);

  scheduledTimer.callback();
  assert.equal(reloadCount, 1);
  hooks.clearPendingAutoPullReloadTimer();
};

const testThreadPageShowsSoftPromptOnly = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "thread_soft_prompt");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /当前在帖子页，暂不自动刷新/);
  assert.equal(messages[0].isSuccess, null);
};

const testMergedReadProgressThreadUsesMergeCopy = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    action: "merged_read_progress",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "read_progress_merged_inline");
  assert.equal(result.pageType, "thread_detail");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /已保留本地阅读进度并完成自动合并/);
  assert.doesNotMatch(messages[0].message, /正在刷新页面/);
  assert.equal(messages[0].isSuccess, null);
};

const testSuppressMessageKeepsReadProgressMergeQuietAndInline = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let scheduledTimer = null;
  let inlineRefreshCount = 0;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "merged_read_progress",
    suppressMessage: true,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: (callback, delay) => {
      scheduledTimer = { callback, delay };
      return 1;
    },
    refreshReadProgressList: () => {
      inlineRefreshCount += 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "read_progress_merged_inline");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(result.reloadSchedule.reason, "read_progress_merged_inline");
  assert.equal(result.inlineRefresh.status, "scheduled");
  assert.deepStrictEqual(messages, []);
  assert.equal(inlineRefreshCount, 1);
  assert.equal(scheduledTimer, null, "阅读进度自动合并不应再调度整页刷新。");
  hooks.clearPendingAutoPullReloadTimer();
};

const testSameDeviceBackgroundCopyUsesSpecificMessage = () => {
  const { hooks } = createHarness();

  const messages = hooks.getAutoPullRefreshMessagesForSource("background", "pulled", {
    sameDeviceDeviceId: "Mac-Main",
  });

  assert.match(messages.reloadMessage, /后台自动同步检测到同设备「Mac-Main」已同步更新/);
  assert.match(messages.threadPageMessage, /当前在帖子页，暂不自动刷新/);
};

const testSameDeviceBackgroundMergedCopyUsesSpecificMessage = () => {
  const { hooks } = createHarness();

  const messages = hooks.getAutoPullRefreshMessagesForSource(
    "background",
    "merged_read_progress",
    {
      sameDeviceDeviceId: "Mac-Main",
    }
  );

  assert.match(
    messages.reloadMessage,
    /后台自动同步检测到同设备「Mac-Main」已同步更新，已保留本地阅读进度并完成自动合并/
  );
  assert.match(messages.threadPageMessage, /当前在帖子页，暂不自动刷新/);
};

const testDirtySettingsSuppressesReload = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({
      hasThreadList: true,
      hasDirtySettings: true,
    }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "settings_dirty");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /未保存的设置编辑/);
  assert.equal(messages[0].isSuccess, null);
};

const testSameMachineDecisionSuppressesListReload = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "pulled",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_write");
  assert.equal(decision.refreshPlan.policy, "same_machine_suppressed");
};

const testMergedReadProgressDecisionUsesInlineRefresh = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "merged_read_progress",
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "read_progress_merged_inline");
  assert.equal(decision.refreshPlan.policy, "read_progress_merged_inline");
};

const testSameMachineMergedReadProgressKeepsInlineRefresh = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "merged_read_progress",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_read_progress_merged");
  assert.equal(decision.refreshPlan.policy, "read_progress_merged_inline");
};

const testDirtySettingsDecisionWinsOverSameMachineSuppression = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "pulled",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "daily_startup",
      document: createQueryDocument({
        hasThreadList: true,
        hasDirtySettings: true,
      }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, true);
  assert.equal(decision.suppressMessage, false);
  assert.equal(decision.reason, "settings_dirty");
  assert.equal(decision.refreshPlan.policy, "settings_dirty");
};

const testSameMachineNoChangeDecisionSuppressesDailyToast = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "no_change",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "daily_startup",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_write");
  assert.equal(decision.refreshPlan.policy, "same_machine_suppressed");
};

const testForegroundSameMachineNoChangeKeepsSpecificReason = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "no_change",
      sameDeviceRemoteWrite: true,
      foregroundRefreshSuppressReason: "same_machine_hash_equal",
    },
    {
      source: "foreground",
      remoteChangeKind: "same_device_write",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_hash_equal");
  assert.equal(decision.refreshPlan.policy, "foreground_probe_suppressed");
  assert.equal(
    decision.refreshPlan.reloadSchedule.reason,
    "same_machine_hash_equal"
  );
};

const main = async () => {
  testStaticWiring();
  await testResultPhasePolicyOwnsRefreshAndSuppression();
  await testResultPhasePolicyOwnsConflictAndRetryIntents();
  await testResultPhasePolicyHandlesRetryAndFallbackEdges();
  testBackgroundRetryAdapterReturnsExplicitStatuses();
  await testResultPhasePolicyDefersSourceSpecificProductBehavior();
  await testResultPhasePolicyIsolatesAdapterFailuresBeforeRetry();
  await testResultPhasePolicyAccumulatesIndependentAdapterFailures();
  await testProductionResultPhaseNotificationAdapters();
  await testProductionStartupConsumersRouteThroughResultPhasePolicy();
  testRefreshPlanDetection();
  testListPageSchedulesReload();
  testThreadPageShowsSoftPromptOnly();
  testMergedReadProgressThreadUsesMergeCopy();
  testSuppressMessageKeepsReadProgressMergeQuietAndInline();
  testSameDeviceBackgroundCopyUsesSpecificMessage();
  testSameDeviceBackgroundMergedCopyUsesSpecificMessage();
  testDirtySettingsSuppressesReload();
  testSameMachineDecisionSuppressesListReload();
  testMergedReadProgressDecisionUsesInlineRefresh();
  testSameMachineMergedReadProgressKeepsInlineRefresh();
  testDirtySettingsDecisionWinsOverSameMachineSuppression();
  testSameMachineNoChangeDecisionSuppressesDailyToast();
  testForegroundSameMachineNoChangeKeepsSpecificReason();
  console.log("Phase 7 post-sync refresh policy checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
