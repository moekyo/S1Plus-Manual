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
    throw new Error("未能从 S1Plus.js 暴露 Phase 7 测试钩子。");
  }

  return { sandbox, hooks };
};

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
    /applyAutoPullRefreshPolicy\(\{\s*action:\s*result\.action,\s*reason:\s*"per_load_auto_pull"/m,
    "Phase 7 未将每次加载同步成功接入刷新策略。"
  );
  expectMatch(
    /applyAutoPullRefreshPolicy\(\{\s*action:\s*result\.action,\s*reason:\s*"background_auto_pull"/m,
    "Phase 7 未将后台自动同步成功接入刷新策略。"
  );
  expectMatch(
    /refreshPlan = applyAutoPullRefreshPolicy\(\{\s*action:\s*syncRequestResult\.action,/m,
    "Phase 7 未将前台远端探测命中的 follow-up sync 接入刷新策略。"
  );
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
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
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
  assert.equal(result.reloadSchedule.reloadDelayMs, 1500);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "检测到云端有更新，正在刷新页面...");
  assert.equal(messages[0].isSuccess, true);
  assert.ok(scheduledTimer, "列表页应当调度自动刷新。");
  assert.equal(scheduledTimer.delay, 1500);

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
  assert.equal(messages[0].isSuccess, true);
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
  assert.match(messages[0].message, /设置面板有未保存编辑/);
  assert.equal(messages[0].isSuccess, true);
};

const main = async () => {
  testStaticWiring();
  testRefreshPlanDetection();
  testListPageSchedulesReload();
  testThreadPageShowsSoftPromptOnly();
  testDirtySettingsSuppressesReload();
  console.log("Phase 7 post-sync refresh policy checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
