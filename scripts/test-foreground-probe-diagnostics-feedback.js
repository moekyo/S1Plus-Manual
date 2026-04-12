#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { webcrypto } = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");
const sourceCode = fs.readFileSync(sourcePath, "utf8");

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
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
      origin: "https://stage1st.com",
      reload: noop,
    },
    window: {
      location: {
        href: "https://stage1st.com/2b/forum-1-1.html",
        search: "",
        origin: "https://stage1st.com",
        reload: noop,
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

const createHarness = () => {
  const { sandbox, store } = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error("未能从 S1Plus.js 暴露 Phase 8 测试钩子。");
  }

  return { sandbox, store, hooks };
};

const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testStaticWiring = () => {
  expectMatch(
    /lastProbeTimestamp:\s*0,/m,
    "Phase 8 未扩展同步诊断默认字段中的 lastProbeTimestamp。"
  );
  expectMatch(
    /lastProbeTriggeredSyncResult:\s*""/m,
    "Phase 8 未扩展同步诊断默认字段中的 lastProbeTriggeredSyncResult。"
  );
  expectMatch(
    /"最近探测远端版本"/m,
    "Phase 8 未将探测诊断字段接入同步诊断面板。"
  );
  expectMatch(
    /检测到云端有更新，但本地也有未处理改动。为保护数据，已暂停自动拉取，请手动同步。/m,
    "Phase 8 未新增“本地改动阻止自动拉取”的低打扰提示语。"
  );
  expectMatch(
    /前台检查刚刚执行过，已跳过本轮重复探测。/m,
    "Phase 8 未新增 cooldown 命中时的低打扰提示语。"
  );
};

const testUnchangedProbeUpdatesDiagnosticsQuietly = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const messages = [];
  const now = 1760000010000;
  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:30:00Z",
      },
    }),
    requestForegroundRemoteSyncCheck: async () => {
      throw new Error("未变化场景不应触发 follow-up sync。");
    },
  });

  assert.equal(result.status, "unchanged");
  assert.equal(messages.length, 0, "未变化场景应保持静默。");
  assert.deepStrictEqual(toPlainObject(hooks.getSyncDiagnostics()), {
    lastAttemptTimestamp: 0,
    lastSuccessTimestamp: 0,
    lastFailureTimestamp: 0,
    lastFailureReason: "",
    consecutiveFailureCount: 0,
    lastActionType: "",
    lastConflictTimestamp: 0,
    lastProbeTimestamp: now,
    lastProbeRemoteUpdatedAt: "2026-04-11T12:30:00Z",
    lastSyncedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
    lastProbeResult: "unchanged",
    lastProbeTriggeredSync: false,
    lastProbeTriggeredSyncResult: "",
  });
};

const testChangedRemoteBlockedByLocalChangesShowsFeedback = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const messages = [];
  const now = 1760000100000;
  const result = await hooks.checkRemoteFreshnessOnForeground("pageshow", {
    now,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:45:00Z",
      },
    }),
    requestForegroundRemoteSyncCheck: async () => ({
      status: "success",
      action: "skipped_push_on_startup",
      reason: "local_changed_during_sync",
    }),
  });

  assert.equal(result.status, "changed");
  assert.equal(messages.length, 1, "本地改动阻止自动拉取时应提示用户。");
  assert.match(messages[0].message, /本地也有未处理改动/);
  assert.equal(messages[0].isSuccess, false);

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeTimestamp, now);
  assert.equal(diagnostics.lastProbeRemoteUpdatedAt, "2026-04-11T12:45:00Z");
  assert.equal(diagnostics.lastSyncedRemoteUpdatedAt, "2026-04-11T12:30:00Z");
  assert.equal(diagnostics.lastProbeResult, "changed");
  assert.equal(diagnostics.lastProbeTriggeredSync, true);
  assert.equal(
    diagnostics.lastProbeTriggeredSyncResult,
    "success:skipped_push_on_startup:local_changed_during_sync"
  );
};

const testSharedCooldownRecordsDiagnosticsAndStaysQuietDuringPolling = async () => {
  const { hooks } = createHarness();
  const now = 1760000200000;
  hooks.setRemoteProbeSharedCooldownState({
    lastObservedRemoteUpdatedAt: "2026-04-11T12:45:00Z",
    lastObservedAt: now - 1000,
    checkedBy: "other-tab",
  });

  const messages = [];
  const result = await hooks.checkRemoteFreshnessOnForeground(
    "visible_poll_active",
    {
      now,
      settingsSnapshot: enabledSettings,
      showMessage: (message, isSuccess) => {
        messages.push({ message, isSuccess });
      },
      fetchRemoteData: async () => {
        throw new Error("shared cooldown 命中后不应继续请求远端。");
      },
    }
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "shared_cooldown");
  assert.equal(messages.length, 0, "轮询场景下的 cooldown 命中应保持静默。");

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeResult, "throttled_shared_cooldown");
  assert.equal(diagnostics.lastProbeRemoteUpdatedAt, "2026-04-11T12:45:00Z");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
};

const testActiveSyncSkipShowsLowNoiseFeedback = async () => {
  const { hooks, store } = createHarness();
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: Date.now(),
    ttlMs: 60000,
  });

  const messages = [];
  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now: 1760000300000,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => {
      throw new Error("已有同步锁时不应继续 probe。");
    },
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "sync_lock_active");
  assert.equal(messages.length, 1, "已有同步任务时应给出低打扰提示。");
  assert.match(messages[0].message, /已有同步任务在执行/);
  assert.equal(messages[0].isSuccess, null);

  const diagnosticsText = hooks.buildSyncDiagnosticsSummary();
  assert.match(diagnosticsText, /最近探测结果: skipped_active_sync/);
  assert.match(diagnosticsText, /探测是否触发安全同步: 否/);
};

const testProbeExecutionFailureStillRecordsDiagnostics = async () => {
  const { hooks } = createHarness();
  const now = 1760000400000;

  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      throw new Error("metadata fetch exploded");
    },
  });

  assert.equal(result.status, "failure");
  assert.equal(result.reason, "probe_execution_error");

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeTimestamp, now);
  assert.equal(diagnostics.lastProbeResult, "failure_probe_execution_error");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
  assert.equal(diagnostics.lastProbeTriggeredSyncResult, "");
};

(async () => {
  testStaticWiring();
  await testUnchangedProbeUpdatesDiagnosticsQuietly();
  await testChangedRemoteBlockedByLocalChangesShowsFeedback();
  await testSharedCooldownRecordsDiagnosticsAndStaysQuietDuringPolling();
  await testActiveSyncSkipShowsLowNoiseFeedback();
  await testProbeExecutionFailureStillRecordsDiagnostics();

  console.log("[foreground-probe-diagnostics-feedback] Phase 8 diagnostics and feedback verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
