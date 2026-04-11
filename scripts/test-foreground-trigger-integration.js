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
    throw new Error("未能从 S1Plus.js 暴露 Phase 4 测试钩子。");
  }

  return { sandbox, hooks };
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testListenerWiring = () => {
  expectMatch(
    /window\.addEventListener\("pageshow",\s*\(event\)\s*=>\s*\{\s*void handlePendingAutoSyncRecoveryPageShow\(event\);/m,
    "pageshow 监听未复用统一的 Phase 4 触发处理函数。"
  );
  expectMatch(
    /document\.addEventListener\("visibilitychange",\s*\(\)\s*=>\s*\{\s*void handlePendingAutoSyncRecoveryVisibilityChange\(\);/m,
    "visibilitychange 监听未复用统一的 Phase 4 触发处理函数。"
  );
};

const testVisibilityChangeTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handlePendingAutoSyncRecoveryVisibilityChange({
    recoverPendingAutoSyncIfNeeded: () => {
      calls.push("recover");
    },
    checkRemoteFreshnessOnForeground: async (reason) => {
      calls.push(`probe:${reason}`);
      return { status: "unchanged", reason: "remote_already_synced" };
    },
  });

  assert.deepStrictEqual(calls, ["recover", "probe:visibilitychange"]);
  assert.strictEqual(result.status, "unchanged");
};

const testHiddenVisibilityChangeDoesNothing = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "hidden";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.handlePendingAutoSyncRecoveryVisibilityChange({
    recoverPendingAutoSyncIfNeeded: () => {
      recoverCount += 1;
    },
    checkRemoteFreshnessOnForeground: async () => {
      probeCount += 1;
      return { status: "unchanged" };
    },
  });

  assert.strictEqual(recoverCount, 0);
  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "document_hidden");
};

const testPersistedPageShowTriggersRecoveryAndProbe = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  const calls = [];

  const result = await hooks.handlePendingAutoSyncRecoveryPageShow(
    { persisted: true },
    {
      recoverPendingAutoSyncIfNeeded: () => {
        calls.push("recover");
      },
      checkRemoteFreshnessOnForeground: async (reason) => {
        calls.push(`probe:${reason}`);
        return { status: "changed", reason: "remote_changed" };
      },
    }
  );

  assert.deepStrictEqual(calls, ["recover", "probe:pageshow"]);
  assert.strictEqual(result.status, "changed");
};

const testNonPersistedPageShowKeepsRecoveryOnly = async () => {
  const { sandbox, hooks } = createHarness();
  sandbox.document.visibilityState = "visible";
  let recoverCount = 0;
  let probeCount = 0;

  const result = await hooks.handlePendingAutoSyncRecoveryPageShow(
    { persisted: false },
    {
      recoverPendingAutoSyncIfNeeded: () => {
        recoverCount += 1;
      },
      checkRemoteFreshnessOnForeground: async () => {
        probeCount += 1;
        return { status: "changed" };
      },
    }
  );

  assert.strictEqual(recoverCount, 1);
  assert.strictEqual(probeCount, 0);
  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.reason, "pageshow_not_persisted");
};

const main = async () => {
  testListenerWiring();
  await testVisibilityChangeTriggersRecoveryAndProbe();
  await testHiddenVisibilityChangeDoesNothing();
  await testPersistedPageShowTriggersRecoveryAndProbe();
  await testNonPersistedPageShowKeepsRecoveryOnly();
  console.log("[foreground-trigger-integration] Phase 4 trigger integration verified.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
