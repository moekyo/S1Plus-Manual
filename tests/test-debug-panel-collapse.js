#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const vm = require("vm");
const { webcrypto } = require("crypto");
const {
  createHarness,
  sourceCode,
  sourceCodeWithCss,
} = require("./s1plus-test-helpers");

const DEBUG_CONSOLE_VISIBLE_KEY = "s1p_debug_console_visible";
const DEBUG_UNIFIED_PANEL_ID = "s1p-debug-unified-panel";
const DEBUG_FAB_ID = "s1p-debug-fab";

const noop = () => {};

class TestClassList {
  constructor(element) {
    this.element = element;
  }

  add(...classNames) {
    classNames.forEach((className) => {
      String(className || "")
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => this.element._classes.add(token));
    });
  }

  remove(...classNames) {
    classNames.forEach((className) => {
      String(className || "")
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => this.element._classes.delete(token));
    });
  }

  toggle(className, force) {
    const token = String(className || "");
    if (!token) return false;
    if (force === true) {
      this.element._classes.add(token);
      return true;
    }
    if (force === false) {
      this.element._classes.delete(token);
      return false;
    }
    if (this.element._classes.has(token)) {
      this.element._classes.delete(token);
      return false;
    }
    this.element._classes.add(token);
    return true;
  }

  contains(className) {
    return this.element._classes.has(String(className || ""));
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.parentNode = null;
    this.children = [];
    this.childNodes = this.children;
    this.dataset = {};
    this.style = {};
    this.attributes = [];
    this._attributes = new Map();
    this._classes = new Set();
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.eventListeners = {};
  }

  get className() {
    return [...this._classes].join(" ");
  }

  set className(value) {
    this._classes = new Set(
      String(value || "")
        .split(/\s+/)
        .filter(Boolean)
    );
    this.classList = new TestClassList(this);
  }

  setAttribute(name, value) {
    const normalizedName = String(name);
    const normalizedValue = String(value);
    this._attributes.set(normalizedName, normalizedValue);
    this.attributes = [...this._attributes].map(([attrName, attrValue]) => ({
      name: attrName,
      value: attrValue,
    }));
  }

  getAttribute(name) {
    return this._attributes.get(String(name)) || "";
  }

  removeAttribute(name) {
    this._attributes.delete(String(name));
    this.attributes = [...this._attributes].map(([attrName, attrValue]) => ({
      name: attrName,
      value: attrValue,
    }));
  }

  appendChild(child) {
    if (!child) return child;
    child.remove?.();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.childNodes = this.children;
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this
    );
    this.parentNode.childNodes = this.parentNode.children;
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    this.eventListeners[type] = this.eventListeners[type] || [];
    this.eventListeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    this.eventListeners[type] = (this.eventListeners[type] || []).filter(
      (listener) => listener !== handler
    );
  }

  matches(selector) {
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    if (/^\[data-[^\]]+\]$/.test(selector)) {
      const key = selector
        .slice(6, -1)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.dataset[key] !== undefined;
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches?.(selector)) {
          matches.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 44, bottom: 44, width: 44, height: 44 };
  }
}

class TestButtonElement extends TestElement {
  constructor() {
    super("button");
    this.type = "button";
  }
}

class TestTemplateElement extends TestElement {
  constructor() {
    super("template");
    this.content = new TestElement("fragment");
  }
}

class TestDocument {
  constructor() {
    this.body = new TestElement("body");
    this.documentElement = new TestElement("html");
    this.visibilityState = "visible";
  }

  createElement(tagName) {
    const normalizedTag = String(tagName).toLowerCase();
    if (normalizedTag === "button") return new TestButtonElement();
    if (normalizedTag === "template") return new TestTemplateElement();
    return new TestElement(normalizedTag);
  }

  createTextNode(text) {
    const node = new TestElement("#text");
    node.nodeType = 3;
    node.textContent = String(text || "");
    return node;
  }

  getElementById(id) {
    const targetId = String(id);
    const visit = (node) => {
      if (node.id === targetId) return node;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.body);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  addEventListener() {}
  removeEventListener() {}
}

const createDebugHarness = () =>
  createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露调试面板收起测试钩子。",
  });

const createDomHarness = () => {
  const store = new Map();
  const document = new TestDocument();
  const sandboxConsole = {
    log: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
  const location = {
    href: "https://stage1st.com/2b/",
    search: "",
    origin: "https://stage1st.com",
  };
  const sandbox = {
    __S1P_TEST_MODE__: true,
    console: sandboxConsole,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    navigator: { userAgent: "node" },
    location,
    window: {
      location,
      CSS: { supports: () => false },
      addEventListener: noop,
      removeEventListener: noop,
      pageXOffset: 0,
      pageYOffset: 0,
      innerWidth: 1920,
      innerHeight: 1080,
      getComputedStyle: () => ({ cursor: "default" }),
    },
    document,
    Node: {
      ELEMENT_NODE: 1,
      COMMENT_NODE: 8,
    },
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLButtonElement: TestButtonElement,
    HTMLAnchorElement: TestElement,
    HTMLImageElement: TestElement,
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
    GM_listValues: () => Array.from(store.keys()),
  };

  sandbox.window.document = document;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.performance = sandbox.performance;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  sandbox.global = sandbox;
  sandbox.unsafeWindow = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  return {
    sandbox,
    store,
    document,
    hooks: sandbox.__S1P_TEST_HOOKS__,
  };
};

const testDebugConsoleStatePersistence = () => {
  const { hooks, store } = createDebugHarness();

  assert.equal(hooks.getDebugConsoleStateForTest(), "closed");
  assert.equal(hooks.isDebugConsolePersistentlyVisibleForTest(), false);

  store.set(DEBUG_CONSOLE_VISIBLE_KEY, true);
  assert.equal(hooks.getDebugConsoleStateForTest(), "expanded");
  assert.equal(hooks.isDebugConsolePersistentlyVisibleForTest(), true);

  store.set(DEBUG_CONSOLE_VISIBLE_KEY, "collapsed");
  assert.equal(hooks.getDebugConsoleStateForTest(), "collapsed");
  assert.equal(hooks.isDebugConsolePersistentlyVisibleForTest(), true);

  store.set(DEBUG_CONSOLE_VISIBLE_KEY, "invalid");
  assert.equal(hooks.getDebugConsoleStateForTest(), "closed");
  assert.equal(hooks.isDebugConsolePersistentlyVisibleForTest(), false);

  hooks.setDebugConsoleStateForTest("expanded");
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "expanded");

  hooks.setDebugConsoleStateForTest("collapsed");
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "collapsed");

  hooks.setDebugConsolePersistentlyVisibleForTest(false);
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "closed");

  hooks.setDebugConsolePersistentlyVisibleForTest(true);
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "expanded");
};

const testCollapsedStartupCreatesFabOnly = () => {
  const { hooks, store, document } = createDomHarness();

  store.set(DEBUG_CONSOLE_VISIBLE_KEY, "collapsed");
  hooks.initializeDebugUnifiedPanelForTest({ persistVisible: false });

  assert.equal(
    hooks.getDebugLogCollectorStateForTest().logCollectorStarted,
    true
  );
  assert.ok(document.getElementById(DEBUG_FAB_ID));
  assert.equal(document.getElementById(DEBUG_UNIFIED_PANEL_ID), null);
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "collapsed");
};

const testExpandedCollapseCloseAndToggleBehavior = () => {
  const { hooks, store, document } = createDomHarness();

  hooks.initializeDebugUnifiedPanelForTest({ persistVisible: true });
  const panel = document.getElementById(DEBUG_UNIFIED_PANEL_ID);
  const hiddenFab = document.getElementById(DEBUG_FAB_ID);

  assert.ok(panel);
  assert.ok(panel.querySelector(".s1p-debug-collapse-btn"));
  assert.ok(hiddenFab);
  assert.equal(hiddenFab.classList.contains("s1p-fab-hidden"), true);
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "expanded");
  assert.equal(
    hooks.getDebugLogCollectorStateForTest().logCollectorStarted,
    true
  );

  hooks.collapseDebugPanelForTest(panel, hiddenFab);
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "collapsed");
  assert.equal(hiddenFab.classList.contains("s1p-fab-hidden"), false);
  assert.equal(
    hooks.getDebugLogCollectorStateForTest().logCollectorStarted,
    true
  );

  hooks.hideDebugUnifiedPanelForTest();
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "closed");
  assert.equal(document.getElementById(DEBUG_FAB_ID), null);
  assert.equal(
    hooks.getDebugLogCollectorStateForTest().logCollectorStarted,
    false
  );

  hooks.toggleDebugUnifiedPanelForTest();
  assert.equal(store.get(DEBUG_CONSOLE_VISIBLE_KEY), "expanded");
  assert.ok(document.getElementById(DEBUG_UNIFIED_PANEL_ID));
};

const testDebugPanelCollapseCssSurface = () => {
  assert.match(
    sourceCodeWithCss,
    /DEBUG_HOVER_REVEAL_MS\s*=\s*2000/,
    "FAB 悬停关闭延迟应为 2 秒。"
  );
  assert.match(
    sourceCodeWithCss,
    /\.s1p-debug-collapse-btn/,
    "调试面板 header 缺少收起按钮样式。"
  );
  assert.match(
    sourceCodeWithCss,
    /#s1p-debug-fab\s*\{/,
    "调试面板缺少 FAB 容器样式。"
  );
  assert.match(
    sourceCodeWithCss,
    /#s1p-debug-fab\.s1p-fab-hidden/,
    "FAB 缺少隐藏状态样式。"
  );
  assert.match(
    sourceCodeWithCss,
    /\.s1p-debug-panel\.s1p-collapsing[\s\S]*?transform-origin:\s*100%\s*100%/,
    "调试面板 collapse 动画应以右下角为 transform-origin。"
  );
  assert.match(
    sourceCodeWithCss,
    /#s1p-debug-unified-panel\.s1p-collapsed/,
    "调试面板缺少 collapsed 状态样式。"
  );
};

(async () => {
  testDebugConsoleStatePersistence();
  testCollapsedStartupCreatesFabOnly();
  testExpandedCollapseCloseAndToggleBehavior();
  testDebugPanelCollapseCssSurface();

  console.log("[debug-panel-collapse] Debug panel collapse state verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
