#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { webcrypto } = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");

const noop = () => {};
const createClassListStub = () => ({
  add: noop,
  remove: noop,
  toggle: noop,
  contains: () => false,
});
const createElementStub = () => ({
  style: {},
  classList: createClassListStub(),
  appendChild: noop,
  removeChild: noop,
  remove: noop,
  setAttribute: noop,
  getAttribute: () => "",
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  closest: () => null,
  innerHTML: "",
  textContent: "",
  value: "",
});

const createSandbox = () => {
  const store = new Map();
  const documentElement = {
    style: {
      setProperty: noop,
      removeProperty: noop,
    },
    classList: createClassListStub(),
  };
  const bodyElement = createElementStub();

  const sandbox = {
    __S1P_TEST_MODE__: true,
    __S1P_TEST_STORE__: store,
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    navigator: { userAgent: "node" },
    location: {
      href: "https://stage1st.com/2b/",
      origin: "https://stage1st.com",
    },
    window: {
      location: {
        href: "https://stage1st.com/2b/",
        origin: "https://stage1st.com",
      },
      CSS: { supports: () => false },
      addEventListener: noop,
      removeEventListener: noop,
      pageXOffset: 0,
      pageYOffset: 0,
      innerWidth: 1920,
      innerHeight: 1080,
    },
    document: {
      body: bodyElement,
      documentElement,
      title: "",
      visibilityState: "visible",
      addEventListener: noop,
      removeEventListener: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: createElementStub,
    },
    Node: {
      ELEMENT_NODE: 1,
      COMMENT_NODE: 8,
    },
    Element: function Element() {},
    HTMLAnchorElement: function HTMLAnchorElement() {},
    HTMLImageElement: function HTMLImageElement() {},
    MutationObserver: class MutationObserver {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    GM_getValue: (key, defaultValue) =>
      store.has(key) ? store.get(key) : defaultValue,
    GM_setValue: (key, value) => {
      store.set(key, value);
    },
    GM_addStyle: noop,
    GM_deleteValue: (key) => {
      store.delete(key);
    },
    GM_xmlhttpRequest: noop,
    GM_openInTab: noop,
    GM_download: noop,
    GM_addValueChangeListener: noop,
  };

  sandbox.window.document = sandbox.document;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  sandbox.window.performance = sandbox.performance;

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  sandbox.global = sandbox;
  sandbox.unsafeWindow = sandbox.window;

  return { sandbox, store };
};

const sourceCode = fs.readFileSync(sourcePath, "utf8");
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

const createHarness = () => {
  const { sandbox, store } = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error("未能从 S1Plus.js 暴露 Phase 3 测试钩子。");
  }

  return { sandbox, store, hooks };
};

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const requestForegroundProbe = (hooks, reason, options = {}) =>
  hooks.s1pSyncSystem.requestSync({
    kind: "foreground_probe",
    reason,
    options,
  });

const CLEAN_STATE_COOLDOWN_MS = 5 * 60 * 1000;

const testUnchangedRemoteSkipsFollowUpSync = async () => {
  const { sandbox, hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });
  sandbox.GM_setValue("s1p_sync_baseline_state", {
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
    savedAt: 0,
  });

  let fetchCount = 0;
  let requestCount = 0;
  const now = 1760000010000;
  const result = await requestForegroundProbe(hooks, "visibility", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      fetchCount += 1;
      return {
        meta: {
          updatedAt: "2026-04-11T12:30:00Z",
        },
      };
    },
    requestForegroundRemoteSyncCheck: async () => {
      requestCount += 1;
      return { status: "success", action: "pulled" };
    },
  });

  assert.strictEqual(fetchCount, 1, "未变化场景应只执行一次 metadata probe。");
  assert.strictEqual(requestCount, 0, "未变化场景不应触发 follow-up sync。");
  assert.strictEqual(result.status, "unchanged");
  assert.strictEqual(result.reason, "remote_already_synced");
  assert.deepStrictEqual(toPlainObject(hooks.getLastRemoteProbeInfo()), {
    lastObservedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
    lastObservedAt: now,
    lastSyncedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
  });
};

const testChangedRemoteTriggersSafeFollowUpSync = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  let followUpReason = "";
  let followUpCount = 0;
  const now = 1760000100000;
  const result = await requestForegroundProbe(hooks, "pageshow", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:45:00Z",
      },
    }),
    requestForegroundRemoteSyncCheck: async (reason) => {
      followUpCount += 1;
      followUpReason = reason;
      return {
        status: "success",
        action: "pulled",
      };
    },
  });

  assert.strictEqual(result.status, "changed");
  assert.strictEqual(result.reason, "remote_changed");
  assert.strictEqual(followUpCount, 1, "远端变化后应调度一次安全 follow-up sync。");
  assert.strictEqual(
    followUpReason,
    "remote_probe_changed:pageshow",
    "follow-up sync 应带上 probe 来源原因。"
  );
  assert.deepStrictEqual(toPlainObject(hooks.getLastRemoteProbeInfo()), {
    lastObservedRemoteUpdatedAt: "2026-04-11T12:45:00Z",
    lastObservedAt: now,
    lastSyncedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
  });
};

const testForegroundProbeClearsRetryWhenPolicyExecutionDidNotSchedule = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const policyCalls = [];
  await requestForegroundProbe(hooks, "pageshow", {
    now: 1760000150000,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => ({
      meta: { updatedAt: "2026-04-11T12:45:00Z" },
    }),
    requestForegroundRemoteSyncCheck: async () => ({
      status: "blocked",
      blockLevel: "soft",
      reason: "read_progress_pending_write",
      retryAfterMs: 1500,
    }),
    syncResultPhasePolicy: {
      handle: async (result, options) => {
        policyCalls.push({ result, options });
        const partialRetryResult = options.scheduleRetry({
          kind: "foreground",
          delayMs: 60 * 1000,
        });
        assert.strictEqual(partialRetryResult.status, "scheduled");
        return {
          refreshPlan: null,
          retryIntent: { kind: "foreground", delayMs: 1500 },
          retryResult: null,
        };
      },
    },
  });

  assert.strictEqual(policyCalls.length, 1);
  assert.strictEqual(policyCalls[0].options.source, "foreground");
  assert.strictEqual(
    policyCalls[0].options.refreshOptions.reason,
    "foreground_probe:pageshow"
  );
  assert.strictEqual(typeof policyCalls[0].options.scheduleRetry, "function");
  assert.strictEqual(
    (() => {
      const remainingMs = hooks.getForegroundRemoteSyncRetryRemainingMs();
      hooks.clearForegroundRemoteSyncRetry(
        hooks.getForegroundRemoteSyncRetryOwnerToken()
      );
      return remainingMs;
    })(),
    0,
    "retry adapter 未真正排队时，foreground probe 不应保留旧 retry 状态。"
  );
};

const testForegroundRetryConsumerResetsAfterRetryExecutionFailure = async () => {
  const { sandbox, hooks } = createHarness();
  const scheduledCallbacks = [];
  sandbox.setTimeout = (callback, delayMs) => {
    scheduledCallbacks.push({ callback, delayMs });
    return scheduledCallbacks.length;
  };
  sandbox.clearTimeout = () => {};
  const policyCalls = [];

  const first = hooks.scheduleForegroundRemoteSyncRetry("retry_execution_failure", {
    preferredDelayMs: 1,
    requestForegroundRemoteSyncCheck: async () => ({
      status: "blocked",
      blockLevel: "soft",
      reason: "read_progress_pending_write",
      retryAfterMs: 1500,
    }),
    syncResultPhasePolicy: {
      handle: async (result, options) => {
        policyCalls.push({ result, options });
        return {
          refreshPlan: null,
          retryIntent: { kind: "foreground", delayMs: 1500 },
          retryResult: null,
        };
      },
    },
    maybeShowForegroundProbeFeedback: () => {},
  });
  assert.strictEqual(first.attempt, 1);
  assert.ok(scheduledCallbacks.length >= 1);

  const retryTimer = scheduledCallbacks.find(({ delayMs }) => delayMs === 1200);
  assert.ok(retryTimer, "应捕获 foreground retry timer。");
  await retryTimer.callback();
  assert.strictEqual(policyCalls.length, 1);
  assert.strictEqual(policyCalls[0].options.source, "foreground");
  assert.strictEqual(
    policyCalls[0].options.refreshOptions.reason,
    "foreground_retry:retry_execution_failure"
  );
  assert.strictEqual(typeof policyCalls[0].options.scheduleRetry, "function");

  const next = hooks.scheduleForegroundRemoteSyncRetry("retry_after_failure", {
    preferredDelayMs: 1,
  });
  assert.strictEqual(
    next.attempt,
    1,
    "retry adapter 未真正排队时，timer consumer 应重置上一轮尝试计数。"
  );
  hooks.clearForegroundRemoteSyncRetry(
    hooks.getForegroundRemoteSyncRetryOwnerToken()
  );
};

const testForegroundRetryKeepsInjectedResultPhasePolicy = async () => {
  const { sandbox, hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const scheduledCallbacks = [];
  sandbox.setTimeout = (callback, delayMs) => {
    scheduledCallbacks.push({ callback, delayMs });
    return scheduledCallbacks.length;
  };
  sandbox.clearTimeout = () => {};

  const policyCalls = [];
  const injectedPolicy = {
    handle: async (result, options) => {
      policyCalls.push({ result, options });
      if (policyCalls.length === 1) {
        return {
          refreshPlan: null,
          retryResult: options.scheduleRetry({
            kind: "foreground",
            delayMs: 1,
          }),
        };
      }
      return { refreshPlan: null, retryResult: null };
    },
  };

  await requestForegroundProbe(hooks, "pageshow", {
    now: 1760000155000,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => ({
      meta: { updatedAt: "2026-04-11T12:45:00Z" },
    }),
    requestForegroundRemoteSyncCheck: async () => ({
      status: "blocked",
      blockLevel: "soft",
      reason: "read_progress_pending_write",
      retryAfterMs: 1,
    }),
    syncResultPhasePolicy: injectedPolicy,
    foregroundRemoteSyncRetryOptions: {
      getForegroundProbeGateBlockResult: () => null,
      requestForegroundRemoteSyncCheck: async () => ({
        status: "success",
        action: "no_change",
      }),
      maybeShowForegroundProbeFeedback: () => false,
    },
  });

  assert.strictEqual(policyCalls.length, 1);
  assert.ok(scheduledCallbacks.length >= 1);
  const retryTimer = scheduledCallbacks.find(({ delayMs }) => delayMs === 1200);
  assert.ok(retryTimer, "应捕获 foreground retry timer。");
  await retryTimer.callback();
  assert.strictEqual(
    policyCalls.length,
    2,
    "foreground retry timer 必须继续使用 probe 注入的 Result Phase policy。"
  );
  assert.strictEqual(policyCalls[1].options.source, "foreground");
  hooks.clearForegroundRemoteSyncRetry(
    hooks.getForegroundRemoteSyncRetryOwnerToken()
  );
};

const testForegroundConflictPausesAndShowsFeedback = async () => {
  const { hooks, store } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });
  const messages = [];

  const result = await requestForegroundProbe(hooks, "pageshow", {
    now: 1760000160000,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => ({
      meta: { updatedAt: "2026-04-11T12:45:00Z" },
    }),
    requestForegroundRemoteSyncCheck: async () => ({
      status: "conflict",
      reason: "remote_newer",
    }),
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
  });

  assert.strictEqual(result.syncRequestResult.status, "conflict");
  assert.strictEqual(
    store.get("s1p_auto_sync_conflict_pause")?.paused,
    true,
    "foreground conflict 应写入统一冲突暂停。"
  );
  assert.strictEqual(messages.length, 1, "foreground conflict 不应静默暂停。");
  assert.match(messages[0].message, /已暂停自动处理/);
  assert.strictEqual(messages[0].isSuccess, false);
};

const testSharedCooldownSuppressesRepeatedProbe = async () => {
  const { hooks } = createHarness();
  const now = 1760000200000;
  hooks.setRemoteProbeSharedCooldownState({
    lastObservedRemoteUpdatedAt: "2026-04-11T12:45:00Z",
    lastObservedAt: now - 1000,
    checkedBy: "other-tab",
  });

  let fetchCount = 0;
  const result = await requestForegroundProbe(hooks, "visibility", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      fetchCount += 1;
      return {
        meta: {
          updatedAt: "2026-04-11T12:45:00Z",
        },
      };
    },
  });

  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "shared_cooldown");
  assert.strictEqual(fetchCount, 0, "共享 cooldown 命中后不应再次访问远端元数据。");
};

const testCleanStateDoesNotSkipForegroundProbeWithinCooldown = async () => {
  const { hooks, store } = createHarness();
  const now = 1760000250000;
  store.set("s1p_last_sync_timestamp", now - 60 * 1000);
  store.set("s1p_last_modified", now - 90 * 1000);
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  let fetchCount = 0;
  let followUpCount = 0;
  const result = await requestForegroundProbe(hooks, "pageshow", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      fetchCount += 1;
      return {
        meta: {
          updatedAt: "2026-04-11T12:45:00Z",
        },
      };
    },
    requestForegroundRemoteSyncCheck: async () => {
      followUpCount += 1;
      return { status: "success", action: "pulled" };
    },
  });

  assert.strictEqual(result.status, "changed");
  assert.strictEqual(result.reason, "remote_changed");
  assert.strictEqual(fetchCount, 1, "本地干净不能跳过前台远端 metadata probe。");
  assert.strictEqual(
    followUpCount,
    1,
    "冷却窗口内发现远端变化时仍应触发 follow-up safe sync。"
  );
  assert.strictEqual(
    store.get("s1p_last_sync_timestamp"),
    now - 60 * 1000,
    "metadata probe 本身不应刷新 lastSuccessfulSyncTs。"
  );
};

const testForegroundProbeRunsAfterCooldownOrLocalMutation =
  async () => {
    {
      const { hooks, store } = createHarness();
      const now = 1760000260000;
      store.set("s1p_last_sync_timestamp", now - CLEAN_STATE_COOLDOWN_MS - 1);
      store.set("s1p_last_modified", now - CLEAN_STATE_COOLDOWN_MS - 10);
      hooks.setSyncBaselineState({
        contentHash: "baseline-hash",
        remoteUpdatedAt: "2026-04-11T12:30:00Z",
      });

      let fetchCount = 0;
      const result = await requestForegroundProbe(hooks, "visibility", {
        now,
        settingsSnapshot: enabledSettings,
        fetchRemoteData: async () => {
          fetchCount += 1;
          return { meta: { updatedAt: "2026-04-11T12:30:00Z" } };
        },
      });

      assert.strictEqual(fetchCount, 1);
      assert.notStrictEqual(result.reason, "clean_state_fence");
      assert.strictEqual(
        result.status,
        "unchanged",
        "超过 clean-state cooldown 后仍应允许自动 pull probe 检查远端。"
      );
    }

    {
      const { hooks, store } = createHarness();
      const now = 1760000270000;
      store.set("s1p_last_sync_timestamp", now - 60 * 1000);
      store.set("s1p_last_modified", now + 1);
      hooks.setSyncBaselineState({
        contentHash: "baseline-hash",
        remoteUpdatedAt: "2026-04-11T12:30:00Z",
      });

      let fetchCount = 0;
      const result = await requestForegroundProbe(hooks,
        "visibilitychange",
        {
          now,
          settingsSnapshot: enabledSettings,
          fetchRemoteData: async () => {
            fetchCount += 1;
            return { meta: { updatedAt: "2026-04-11T12:30:00Z" } };
          },
        }
      );

      assert.strictEqual(fetchCount, 1);
      assert.notStrictEqual(
        result.reason,
        "clean_state_fence",
        "本地有新变更时，自动 pull probe 不应被 clean-state fence 拦截。"
      );
    }
  };

const testCleanStateFenceDoesNotApplyToManualSource = () => {
  const { hooks, store } = createHarness();
  const now = 1760000280000;
  store.set("s1p_last_sync_timestamp", now - 1000);
  store.set("s1p_last_modified", now - 2000);

  const decision = hooks.shouldSkipAutoSyncDueToCleanState({
    direction: "push",
    triggerSource: "manual_sync",
    reason: "manual_push",
    now,
  });
  assert.strictEqual(
    decision.skip,
    false,
    "用户主动手动同步不应被 Clean State Fence 拦截。"
  );

  for (const triggerSource of [
    "page_load_visible",
    "foreground_resume",
    "visible_poll",
  ]) {
    const foregroundDecision = hooks.shouldSkipAutoSyncDueToCleanState({
      direction: "pull",
      triggerSource,
      reason: `${triggerSource}_probe`,
      now,
    });
    assert.strictEqual(
      foregroundDecision.skip,
      false,
      `${triggerSource} metadata probe 不应被本地 clean-state fence 拦截。`
    );
  }
};

const testCleanStateFenceCodeGuards = () => {
  const foregroundProbeStart = sourceCode.indexOf(
    "const checkRemoteFreshnessOnForeground = async"
  );
  const foregroundProbeEnd = sourceCode.indexOf(
    "if (IS_S1P_TEST_MODE)",
    foregroundProbeStart
  );
  const foregroundProbeSource = sourceCode.slice(
    foregroundProbeStart,
    foregroundProbeEnd
  );
  assert.match(
    sourceCode,
    /const shouldRecordSuccessfulSyncTimestamp = \(action\) =>[\s\S]*?skipped_push_on_startup[\s\S]*?skip_push_on_foreground_followup/,
    "未实际推送的 foreground follow-up soft block 不应刷新 lastSuccessfulSyncTs。"
  );
  assert.match(
    sourceCode,
    /const isAutoSyncCleanStateFenceSource =[\s\S]*?normalizedSource === SYNC_TRIGGER_SOURCE_BACKGROUND_PUSH/,
    "clean-state fence 应只覆盖本地自动 push 去重，不能覆盖前台 metadata probe。"
  );
  assert.doesNotMatch(
    foregroundProbeSource,
    /shouldSkipAutoSyncDueToCleanState\(/,
    "checkRemoteFreshnessOnForeground 不应在读取远端 metadata 前使用本地 clean-state fence。"
  );
  assert.match(
    sourceCode,
    /const triggerRemoteSyncPush = \(reason = "local_change"[\s\S]*?shouldSkipAutoSyncDueToCleanState\(\{[\s\S]*?allowCoveredBackgroundDebounceState:\s*true/,
    "background push 直调路径应允许已被成功同步覆盖的 debounce state 命中 clean-state fence。"
  );
};

const testProbeLockRejectsOtherOwner = async () => {
  const { hooks } = createHarness();
  hooks.setRemoteProbeLockValue({
    owner: "tab-a",
    timestamp: Date.now(),
    reason: "visibility",
  });
  const acquired = await hooks.acquireRemoteProbeLock({
    owner: "tab-b",
    reason: "pageshow",
  });
  assert.strictEqual(acquired, false, "其他标签已持有 probe lock 时不应重复获取。");
};

const testGuardConditionsSkipEarly = async () => {
  {
    const { hooks, store } = createHarness();
    store.set("s1p_auto_sync_conflict_pause", {
      paused: true,
      reason: "startup_conflict",
      timestamp: 1760000300000,
    });
    const result = await requestForegroundProbe(hooks, "visibility", {
      now: 1760000305000,
      settingsSnapshot: enabledSettings,
      fetchRemoteData: async () => {
        throw new Error("conflict pause 命中后不应继续 probe。");
      },
    });
    assert.strictEqual(result.reason, "conflict_paused");
  }

  {
    const { hooks, store } = createHarness();
    store.set("s1p_auto_sync_circuit_open_until", Date.now() + 60 * 1000);
    const result = await requestForegroundProbe(hooks, "visibility", {
      now: 1760000405000,
      settingsSnapshot: enabledSettings,
      fetchRemoteData: async () => {
        throw new Error("circuit open 命中后不应继续 probe。");
      },
    });
    assert.strictEqual(result.reason, "circuit_open");
  }

  {
    const { hooks, store } = createHarness();
    store.set("s1p_sync_global_lock", {
      owner: "other-tab",
      mode: "background",
      timestamp: Date.now(),
      ttlMs: 60000,
    });
    const result = await requestForegroundProbe(hooks, "visibility", {
      now: 1760000500000,
      settingsSnapshot: enabledSettings,
      fetchRemoteData: async () => {
        throw new Error("已有同步锁时不应继续 probe。");
      },
    });
    assert.strictEqual(result.reason, "sync_lock_active");
  }
};

(async () => {
  await testUnchangedRemoteSkipsFollowUpSync();
  await testChangedRemoteTriggersSafeFollowUpSync();
  await testForegroundProbeClearsRetryWhenPolicyExecutionDidNotSchedule();
  await testForegroundRetryConsumerResetsAfterRetryExecutionFailure();
  await testForegroundRetryKeepsInjectedResultPhasePolicy();
  await testForegroundConflictPausesAndShowsFeedback();
  await testSharedCooldownSuppressesRepeatedProbe();
  await testCleanStateDoesNotSkipForegroundProbeWithinCooldown();
  await testForegroundProbeRunsAfterCooldownOrLocalMutation();
  testCleanStateFenceDoesNotApplyToManualSource();
  testCleanStateFenceCodeGuards();
  await testProbeLockRejectsOtherOwner();
  await testGuardConditionsSkipEarly();

  console.log("[foreground-remote-probe] Phase 3 foreground probe behavior verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
