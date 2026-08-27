"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
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

const createSessionStorageStub = (initialEntries = []) => {
  const sessionStore = new Map(initialEntries);
  const sessionStorage = {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => {
      sessionStore.set(key, String(value));
    },
    removeItem: (key) => {
      sessionStore.delete(key);
    },
  };

  return { sessionStore, sessionStorage };
};

const createLocationStub = ({
  href = "https://stage1st.com/2b/",
  search = "",
  origin = "https://stage1st.com",
  reload = noop,
} = {}) => ({
  href,
  search,
  origin,
  reload,
});

const createSandbox = ({
  href = "https://stage1st.com/2b/",
  search = "",
  visibilityState = "visible",
  includeSessionStorage = false,
  sessionStorageEntries = [],
  includeGmListValues = true,
} = {}) => {
  const store = new Map();
  const { sessionStore, sessionStorage } =
    createSessionStorageStub(sessionStorageEntries);
  const documentElement = {
    style: {
      setProperty: noop,
      removeProperty: noop,
    },
    classList: createClassListStub(),
  };
  const bodyElement = createElementStub();
  const locationStub = createLocationStub({ href, search });

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
    location: locationStub,
    window: {
      location: { ...locationStub },
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
      visibilityState,
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
    GM_removeValueChangeListener: noop,
  };

  if (includeGmListValues) {
    sandbox.GM_listValues = () => Array.from(store.keys());
  }

  sandbox.window.document = sandbox.document;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  sandbox.window.performance = sandbox.performance;

  if (includeSessionStorage) {
    sandbox.window.sessionStorage = sessionStorage;
  }

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  sandbox.global = sandbox;
  sandbox.unsafeWindow = sandbox.window;

  return { sandbox, store, sessionStore, sessionStorage };
};

const createHarness = ({
  hookErrorMessage = "未能从 S1Plus.js 暴露测试钩子。",
  ...sandboxOptions
} = {}) => {
  const runtime = createSandbox(sandboxOptions);
  vm.createContext(runtime.sandbox);
  vm.runInContext(sourceCode, runtime.sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = runtime.sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error(hookErrorMessage);
  }

  return {
    ...runtime,
    hooks,
    sourceCode,
  };
};

const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

module.exports = {
  sourceCode,
  createHarness,
  toPlainObject,
};
