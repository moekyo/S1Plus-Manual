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
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));
const ACTIVE_INTERVAL_MS = 4 * 60 * 1000;
const IDLE_INTERVAL_MS = 12 * 60 * 1000;
const IDLE_AFTER_MS = 15 * 60 * 1000;

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

const createTimerControls = () => {
  let nextTimerId = 1;
  const timers = new Map();

  return {
    timers,
    setTimeout: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, {
        callback,
        delay,
      });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    getLatestTimer: () => {
      let latestTimer = null;
      for (const [id, timer] of timers.entries()) {
        latestTimer = { id, ...timer };
      }
      return latestTimer;
    },
    runTimer: async (id) => {
      const timer = timers.get(id);
      if (!timer) {
        throw new Error(`未找到 timer: ${id}`);
      }
      timers.delete(id);
      await timer.callback();
    },
  };
};

const createSandbox = () => {
  const store = new Map();
  const timerControls = createTimerControls();
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
    setTimeout: timerControls.setTimeout,
    clearTimeout: timerControls.clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback) =>
      timerControls.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => timerControls.clearTimeout(id),
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

  return { sandbox, store, timerControls };
};

const createHarness = () => {
  const { sandbox, store, timerControls } = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error("未能从 S1Plus.js 暴露 Phase 5 测试钩子。");
  }

  return { sandbox, store, timerControls, hooks };
};

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
  syncVisibleRemotePollingEnabled: true,
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testPollingConfigurationAndActivityWiring = () => {
  expectMatch(
    /const isVisibleRemoteFreshnessPollingEnabled = \(settingsSnapshot\) =>\s*isForegroundRemoteFreshnessCheckEnabled\(settingsSnapshot\) &&\s*settingsSnapshot\.syncVisibleRemotePollingEnabled === true;/m,
    "可见页低频轮询未拆成独立开关。"
  );
  expectMatch(
    /window\.addEventListener\("pointerdown",\s*handleUserActivity,\s*\{\s*capture:\s*true,\s*passive:\s*true,/m,
    "Phase 5 未绑定 pointer 活跃度监听。"
  );
  expectMatch(
    /document\.addEventListener\("keydown",\s*handleUserActivity,\s*true\);/m,
    "Phase 5 未绑定键盘活跃度监听。"
  );
  expectMatch(
    /window\.addEventListener\("scroll",\s*handleUserActivity,\s*\{\s*capture:\s*true,\s*passive:\s*true,/m,
    "Phase 5 未绑定滚动活跃度监听。"
  );
};

const testForegroundSupportInitializesVisiblePolling = () => {
  const { hooks } = createHarness();
  const calls = [];
  const support = hooks.s1pInitializePendingAutoSyncRecoverySupport({
    bindActivityHooks: () => {
      calls.push("activity:bind");
      return { status: "bound" };
    },
    syncPolling: ({ resetActivity }) => {
      calls.push(`polling:sync:${resetActivity}`);
    },
    stopPolling: () => {
      calls.push("polling:stop");
    },
  });

  assert.deepStrictEqual(calls, ["activity:bind", "polling:sync:true"]);
  support.dispose();
  assert.deepStrictEqual(calls, [
    "activity:bind",
    "polling:sync:true",
    "polling:stop",
  ]);
};

const testForegroundCheckAloneDoesNotScheduleVisiblePolling = () => {
  const { hooks, timerControls } = createHarness();
  hooks.scheduleVisibleRemoteFreshnessPolling({
    now: 1760000940000,
    resetActivity: true,
    settingsSnapshot: enabledSettings,
  });
  assert.ok(timerControls.getLatestTimer(), "前置条件：开启时应已安排 timer。");

  const result = hooks.scheduleVisibleRemoteFreshnessPolling({
    now: 1760000950000,
    resetActivity: true,
    settingsSnapshot: {
      syncRemoteEnabled: true,
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat-token",
      syncCheckOnReturnToForeground: true,
      syncVisibleRemotePollingEnabled: false,
    },
  });

  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "visible_polling_disabled");
  assert.strictEqual(timerControls.getLatestTimer(), null);
};

const testVisiblePageSchedulesActivePolling = () => {
  const { hooks, timerControls } = createHarness();
  const now = 1760001000000;
  const result = hooks.scheduleVisibleRemoteFreshnessPolling({
    now,
    resetActivity: true,
    settingsSnapshot: enabledSettings,
  });

  assert.strictEqual(result.status, "scheduled");
  assert.strictEqual(result.mode, "active");
  assert.strictEqual(result.intervalMs, ACTIVE_INTERVAL_MS);
  assert.deepStrictEqual(
    toPlainObject(hooks.getVisibleRemoteFreshnessPollingRuntimeState()),
    {
      lastUserInteractionAt: now,
      currentVisibleProbeIntervalMs: ACTIVE_INTERVAL_MS,
      hasTimer: true,
    }
  );
  assert.strictEqual(
    timerControls.getLatestTimer()?.delay,
    ACTIVE_INTERVAL_MS,
    "可见页面应按活跃轮询间隔调度。"
  );
};

const testHiddenPageStopsPolling = () => {
  const { sandbox, hooks } = createHarness();
  hooks.scheduleVisibleRemoteFreshnessPolling({
    now: 1760001100000,
    resetActivity: true,
    settingsSnapshot: enabledSettings,
  });

  sandbox.document.visibilityState = "hidden";
  const result = hooks.syncVisibleRemoteFreshnessPollingForCurrentState();

  assert.strictEqual(result.status, "stopped");
  assert.deepStrictEqual(
    toPlainObject(hooks.getVisibleRemoteFreshnessPollingRuntimeState()),
    {
      lastUserInteractionAt: 1760001100000,
      currentVisibleProbeIntervalMs: 0,
      hasTimer: false,
    }
  );
};

const testPollingTimerRunsProbeAndReschedules = async () => {
  const { store, timerControls, hooks } = createHarness();
  store.set("s1p_settings", enabledSettings);
  const reasons = [];
  const now = Date.now();

  hooks.scheduleVisibleRemoteFreshnessPolling({
    now,
    resetActivity: true,
    settingsSnapshot: enabledSettings,
    checkRemoteFreshnessOnForeground: async (reason) => {
      reasons.push(reason);
      return { status: "unchanged", reason: "remote_already_synced" };
    },
  });

  const timer = timerControls.getLatestTimer();
  assert.ok(timer, "应先调度首个可见页轮询 timer。");
  await timerControls.runTimer(timer.id);

  assert.deepStrictEqual(reasons, ["visible_poll_active"]);
  assert.strictEqual(
    timerControls.getLatestTimer()?.delay,
    ACTIVE_INTERVAL_MS,
    "轮询执行后应继续调度下一轮可见页探测。"
  );
};

const testLongInactivityUsesIdleInterval = () => {
  const { hooks, timerControls } = createHarness();
  const now = 1760002200000;
  hooks.markVisibleRemoteFreshnessUserActivity(now - IDLE_AFTER_MS - 60 * 1000);

  const result = hooks.scheduleVisibleRemoteFreshnessPolling({
    now,
    settingsSnapshot: enabledSettings,
  });

  assert.strictEqual(result.status, "scheduled");
  assert.strictEqual(result.mode, "idle");
  assert.strictEqual(result.intervalMs, IDLE_INTERVAL_MS);
  assert.strictEqual(
    timerControls.getLatestTimer()?.delay,
    IDLE_INTERVAL_MS,
    "长时间无交互后应退避到低频轮询。"
  );
};

const testNewInteractionRestoresActiveInterval = () => {
  const { hooks, timerControls } = createHarness();
  const now = 1760003200000;
  hooks.markVisibleRemoteFreshnessUserActivity(now - IDLE_AFTER_MS - 60 * 1000);
  hooks.scheduleVisibleRemoteFreshnessPolling({
    now,
    settingsSnapshot: enabledSettings,
  });

  const result = hooks.handleVisibleRemoteFreshnessUserActivity({
    now: now + 1000,
    settingsSnapshot: enabledSettings,
  });

  assert.strictEqual(result.status, "scheduled");
  assert.strictEqual(result.mode, "active");
  assert.strictEqual(result.intervalMs, ACTIVE_INTERVAL_MS);
  assert.deepStrictEqual(
    toPlainObject(hooks.getVisibleRemoteFreshnessPollingRuntimeState()),
    {
      lastUserInteractionAt: now + 1000,
      currentVisibleProbeIntervalMs: ACTIVE_INTERVAL_MS,
      hasTimer: true,
    }
  );
  assert.strictEqual(
    timerControls.getLatestTimer()?.delay,
    ACTIVE_INTERVAL_MS,
    "新的用户交互后应恢复活跃轮询频率。"
  );
};

const run = async () => {
  testPollingConfigurationAndActivityWiring();
  testForegroundSupportInitializesVisiblePolling();
  testForegroundCheckAloneDoesNotScheduleVisiblePolling();
  testVisiblePageSchedulesActivePolling();
  testHiddenPageStopsPolling();
  await testPollingTimerRunsProbeAndReschedules();
  testLongInactivityUsesIdleInterval();
  testNewInteractionRestoresActiveInterval();
  console.log("test-visible-remote-polling: OK");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
