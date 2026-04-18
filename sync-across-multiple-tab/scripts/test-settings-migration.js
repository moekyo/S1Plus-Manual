#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { webcrypto } = require("crypto");

const repoRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");
const fixturePath = path.join(
  repoRoot,
  "tests",
  "settings-migration",
  "fixtures.json"
);

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
    GM_getValue: (_key, defaultValue) => defaultValue,
    GM_setValue: noop,
    GM_addStyle: noop,
    GM_deleteValue: noop,
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

const getPathSegments = (pathText) =>
  String(pathText)
    .split(".")
    .map((segment) =>
      /^\d+$/.test(segment) ? Number.parseInt(segment, 10) : segment
    );

const getByPath = (target, pathText) => {
  const segments = getPathSegments(pathText);
  let cursor = target;
  for (const segment of segments) {
    if (cursor === null || typeof cursor === "undefined") {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
};

const hasPath = (target, pathText) => {
  const segments = getPathSegments(pathText);
  let cursor = target;
  for (const segment of segments) {
    if (
      cursor === null ||
      typeof cursor === "undefined" ||
      !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) {
      return false;
    }
    cursor = cursor[segment];
  }
  return true;
};

const sourceCode = fs.readFileSync(sourcePath, "utf8");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const sandbox = createSandbox();

vm.createContext(sandbox);
vm.runInContext(sourceCode, sandbox, {
  filename: "S1Plus.js",
  timeout: 20000,
});

const hooks = sandbox.__S1P_TEST_HOOKS__;
if (!hooks || typeof hooks.buildNormalizedSettings !== "function") {
  throw new Error("未能从 S1Plus.js 暴露 buildNormalizedSettings 测试钩子。");
}

const { buildNormalizedSettings } = hooks;
let passedCount = 0;

fixtures.forEach((fixture, index) => {
  const caseName = fixture.name || `case_${index + 1}`;
  const expected = fixture.expected || {};
  const {
    settings,
    migrationApplied,
    migrationReasons = [],
  } = buildNormalizedSettings(fixture.input || {});

  assert.strictEqual(
    migrationApplied,
    expected.migrationApplied,
    `[${caseName}] migrationApplied 不符合预期`
  );

  Object.entries(expected.settings || {}).forEach(([pathText, expectedValue]) => {
    assert.deepStrictEqual(
      getByPath(settings, pathText),
      expectedValue,
      `[${caseName}] 设置路径 ${pathText} 结果不符合预期`
    );
  });

  (expected.absentPaths || []).forEach((pathText) => {
    assert.strictEqual(
      hasPath(settings, pathText),
      false,
      `[${caseName}] 设置路径 ${pathText} 预期应被移除`
    );
  });

  (expected.reasonsInclude || []).forEach((reason) => {
    assert.ok(
      migrationReasons.includes(reason),
      `[${caseName}] migrationReasons 缺少 ${reason}`
    );
  });

  (expected.reasonsExclude || []).forEach((reason) => {
    assert.ok(
      !migrationReasons.includes(reason),
      `[${caseName}] migrationReasons 不应包含 ${reason}`
    );
  });

  passedCount += 1;
});

console.log(
  `[settings-migration] ${passedCount}/${fixtures.length} 个迁移用例通过。`
);
