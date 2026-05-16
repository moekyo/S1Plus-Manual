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

  return sandbox;
};

const sourceCode = fs.readFileSync(sourcePath, "utf8");
const sandbox = createSandbox();
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

vm.createContext(sandbox);
vm.runInContext(sourceCode, sandbox, {
  filename: "S1Plus.js",
  timeout: 20000,
});

const hooks = sandbox.__S1P_TEST_HOOKS__;
if (!hooks) {
  throw new Error("未能从 S1Plus.js 暴露测试钩子。");
}

const {
  getLastRemoteProbeInfo,
  setLastRemoteProbeInfo,
  getRemoteProbeSharedCooldownState,
  setRemoteProbeSharedCooldownState,
  getRemoteProbeLockValue,
  isRemoteProbeLockValid,
  setRemoteProbeLockValue,
  releaseRemoteProbeLockValue,
  clearRemoteProbeState,
  setSyncBaselineState,
} = hooks;

assert.deepStrictEqual(toPlainObject(getLastRemoteProbeInfo()), {
  lastObservedRemoteUpdatedAt: null,
  lastObservedAt: 0,
  lastSyncedRemoteUpdatedAt: null,
});

assert.deepStrictEqual(
  toPlainObject(setLastRemoteProbeInfo({
    lastObservedRemoteUpdatedAt: "2026-04-11T12:34:56Z",
    lastObservedAt: "1760000000000",
    lastSyncedRemoteUpdatedAt: "",
  })),
  {
    lastObservedRemoteUpdatedAt: "2026-04-11T12:34:56Z",
    lastObservedAt: 1760000000000,
    lastSyncedRemoteUpdatedAt: null,
  }
);

assert.deepStrictEqual(
  toPlainObject(setLastRemoteProbeInfo({
    lastSyncedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
  })),
  {
    lastObservedRemoteUpdatedAt: "2026-04-11T12:34:56Z",
    lastObservedAt: 1760000000000,
    lastSyncedRemoteUpdatedAt: "2026-04-11T12:30:00Z",
  }
);

setSyncBaselineState({
  contentHash: "baseline-hash",
  remoteUpdatedAt: "2026-04-11T13:00:00Z",
});
assert.strictEqual(
  getLastRemoteProbeInfo().lastSyncedRemoteUpdatedAt,
  "2026-04-11T13:00:00Z"
);

assert.deepStrictEqual(
  toPlainObject(setRemoteProbeSharedCooldownState({
    lastObservedRemoteUpdatedAt: "2026-04-11T13:00:00Z",
    lastObservedAt: "1760000005000",
    checkedBy: " probe-tab-1 ",
  })),
  {
    lastObservedRemoteUpdatedAt: "2026-04-11T13:00:00Z",
    lastObservedAt: 1760000005000,
    checkedBy: "probe-tab-1",
  }
);
assert.deepStrictEqual(toPlainObject(getRemoteProbeSharedCooldownState()), {
  lastObservedRemoteUpdatedAt: "2026-04-11T13:00:00Z",
  lastObservedAt: 1760000005000,
  checkedBy: "probe-tab-1",
});

const freshLock = setRemoteProbeLockValue({
  owner: "probe-tab-1",
  timestamp: Date.now(),
  reason: "visibilitychange",
});
assert.deepStrictEqual(
  toPlainObject(getRemoteProbeLockValue()),
  toPlainObject(freshLock)
);
assert.strictEqual(isRemoteProbeLockValid(freshLock), true);
assert.strictEqual(
  isRemoteProbeLockValid({
    owner: "probe-tab-1",
    timestamp: Date.now() - 9000,
    reason: "stale",
  }),
  false
);
assert.strictEqual(releaseRemoteProbeLockValue("other-tab"), false);
assert.strictEqual(releaseRemoteProbeLockValue("probe-tab-1"), true);
assert.strictEqual(getRemoteProbeLockValue(), null);

clearRemoteProbeState();
assert.deepStrictEqual(toPlainObject(getLastRemoteProbeInfo()), {
  lastObservedRemoteUpdatedAt: null,
  lastObservedAt: 0,
  lastSyncedRemoteUpdatedAt: null,
});
assert.deepStrictEqual(toPlainObject(getRemoteProbeSharedCooldownState()), {
  lastObservedRemoteUpdatedAt: null,
  lastObservedAt: 0,
  checkedBy: "",
});
assert.strictEqual(getRemoteProbeLockValue(), null);

console.log("[remote-probe-state] Phase 1 probe state helpers verified.");
