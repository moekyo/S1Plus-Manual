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

  return { sandbox };
};

const createHarness = () => {
  const { sandbox } = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error("未能从 S1Plus.js 暴露 Phase 6 测试钩子。");
  }

  return { sandbox, hooks };
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

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

const testPhase6CallSitesUseSharedHelper = () => {
  expectMatch(
    /const requestForegroundRemoteSyncCheck = async[\s\S]*?const runPromise = runStartupModeAutoSyncCheck\(\{/m,
    "前台 follow-up sync 入口未复用统一的启动安全同步 helper。"
  );
  expectMatch(
    /const handlePerLoadSyncCheck = async[\s\S]*?const result = await runStartupModeAutoSyncCheck\(\{/m,
    "每次页面加载同步检查未复用统一的启动安全同步 helper。"
  );
  expectMatch(
    /const handleStartupSync = async[\s\S]*?const result = await runStartupModeAutoSyncCheck\(\{/m,
    "每日首次加载同步未复用统一的启动安全同步 helper。"
  );
};

(async () => {
  await testRuntimeReusesStartupExecutionPath();
  await testBeforePerformCanShortCircuitSafely();
  await testLockUnavailableSkipsWithoutHeartbeat();
  testPhase6CallSitesUseSharedHelper();

  console.log("[safe-sync-execution] Phase 6 startup-path reuse verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
