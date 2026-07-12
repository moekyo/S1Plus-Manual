#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      (listeners.get(type) || []).forEach((handler) => handler(event));
    },
  };
};

const installReadingProgressPage = (
  sandbox,
  { postId = "1002", floor = 2, hasFocus = false, now = 1000 } = {}
) => {
  let currentNow = now;
  let focused = hasFocus;
  const documentEvents = createEventTarget();
  const windowEvents = createEventTarget();

  class TestElement {}
  class TestPostTable extends TestElement {
    constructor() {
      super();
      this.id = `pid${postId}`;
      this.dataset = {};
    }

    querySelector(selector) {
      if (selector === `#postnum${postId} em` || selector === ".pi em") {
        return { textContent: String(floor) };
      }
      return null;
    }

    removeAttribute(name) {
      if (name === "data-s1p-observed") {
        delete this.dataset.s1pObserved;
      }
    }
  }

  const postTable = new TestPostTable();
  let observer = null;
  class TestIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      observer = this;
    }

    observe(element) {
      this.observed.push(element);
    }

    disconnect() {
      this.observed = [];
    }

    emit(entries) {
      this.callback(entries);
    }
  }

  const NativeDate = Date;
  class TestDate extends NativeDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [currentNow]));
    }

    static now() {
      return currentNow;
    }
  }

  sandbox.Date = TestDate;
  sandbox.Element = TestElement;
  sandbox.IntersectionObserver = TestIntersectionObserver;
  sandbox.document.hasFocus = () => focused;
  sandbox.document.addEventListener = documentEvents.addEventListener;
  sandbox.document.removeEventListener = documentEvents.removeEventListener;
  sandbox.window.addEventListener = windowEvents.addEventListener;
  sandbox.window.removeEventListener = windowEvents.removeEventListener;
  sandbox.document.getElementById = (id) =>
    id === "postlist" ? { id: "postlist" } : null;
  sandbox.document.querySelector = (selector) => {
    if (selector === '#postlist table[id^="pid"]') {
      return postTable;
    }
    return null;
  };
  sandbox.document.querySelectorAll = (selector) =>
    selector.includes('table[id^="pid"]') ? [postTable] : [];

  return {
    postTable,
    documentEvents,
    getObserver: () => observer,
    advance(ms) {
      currentNow += ms;
    },
    setFocus(value) {
      focused = value;
    },
  };
};

const createHarness = ({ visibilityState = "visible" } = {}) => {
  const runtime = createBaseHarness({
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    visibilityState,
    hookErrorMessage: "未能从 S1Plus.js 暴露后台开帖被动会话测试钩子。",
  });
  const page = installReadingProgressPage(runtime.sandbox);
  return { ...runtime, page };
};

const observePost = (page) => {
  const observer = page.getObserver();
  assert.ok(observer, "会话挂载后应创建帖子可见性观察器。");
  assert.deepEqual(observer.observed, [page.postTable]);
  observer.emit([{ target: page.postTable, isIntersecting: true }]);
};

const readStoredProgress = (store) => store.get("s1p_read_progress") || {};

const testBackgroundOpenHintLifecycle = () => {
  const { hooks } = createHarness();
  const hint = hooks.registerBackgroundOpenThreadHintForUrl(
    "https://stage1st.com/2b/thread-123456-2-1.html"
  );

  assert.ok(hint, "后台开帖应写入短寿命提示。");
  assert.equal(hint.threadId, "123456");
  assert.equal(hint.page, "2");
  assert.equal(hooks.getBackgroundOpenThreadHints().length, 1);

  const consumedHint = hooks.consumeBackgroundOpenThreadHint({
    threadId: "123456",
    page: "2",
  });
  assert.ok(consumedHint, "线程页启动时应能消费对应的后台开帖提示。");
  assert.equal(consumedHint.sessionId, hint.sessionId);
  assert.equal(hooks.getBackgroundOpenThreadHints().length, 0);
};

const testVisibleSessionPersistsThroughPublicInterface = () => {
  const { hooks, store, page } = createHarness();
  const session = hooks.readingProgressSession;

  session.attach();
  observePost(page);
  page.documentEvents.dispatch("wheel");
  const result = session.handleLifecycle({ phase: "pagehide" });

  assert.equal(result.status, "completed");
  const storedRecord = readStoredProgress(store)["123456"];
  assert.equal(storedRecord.postId, "1002");
  assert.equal(storedRecord.page, "1");
  assert.equal(storedRecord.timestamp, 1000);
  assert.equal(storedRecord.lastReadFloor, "2");
  assert.equal(storedRecord.provenance.threadId, "123456");
  assert.equal(storedRecord.provenance.page, "1");
  assert.equal(storedRecord.provenance.saveReason, "pagehide_flush");
  assert.equal(storedRecord.provenance.documentVisibilityState, "visible");
  assert.equal(storedRecord.provenance.hadConfirmedVisiblePost, true);
  assert.equal(storedRecord.provenance.createdAt, 1000);
  assert.equal(storedRecord.provenance.initiatedWhileHidden, false);
  assert.equal(storedRecord.provenance.saveKind, "real_reading");
  assert.ok(storedRecord.provenance.sourceTabId);
};

const testPassiveBackgroundOpenWaitsForForegroundConfirmation = () => {
  const { hooks, store, page } = createHarness();
  hooks.registerBackgroundOpenThreadHintForUrl(
    "https://stage1st.com/2b/thread-123456-1-1.html"
  );
  const session = hooks.readingProgressSession;

  session.attach();
  observePost(page);
  page.advance(2000);
  session.handleLifecycle({ phase: "pagehide" });
  assert.deepEqual(
    readStoredProgress(store),
    {},
    "后台打开页在没有真实前台确认前不应记录阅读进度。"
  );

  page.setFocus(true);
  session.handleLifecycle({ phase: "pagehide" });
  assert.equal(
    readStoredProgress(store)["123456"].provenance.saveReason,
    "pagehide_flush",
    "稳定可见且获得焦点后，应允许会话在生命周期退出时落盘。"
  );
};

const testHiddenStartConfirmsAfterVisibleLifecycle = () => {
  const { hooks, sandbox, store, page } = createHarness({
    visibilityState: "hidden",
  });
  const session = hooks.readingProgressSession;

  session.attach();
  observePost(page);
  session.handleLifecycle({ phase: "pagehide" });
  assert.deepEqual(readStoredProgress(store), {});

  sandbox.document.visibilityState = "visible";
  page.setFocus(true);
  session.handleLifecycle({ phase: "visible" });
  page.advance(2000);
  session.handleLifecycle({ phase: "pagehide" });
  assert.equal(readStoredProgress(store)["123456"].postId, "1002");
};

const main = async () => {
  testBackgroundOpenHintLifecycle();
  testVisibleSessionPersistsThroughPublicInterface();
  testPassiveBackgroundOpenWaitsForForegroundConfirmation();
  testHiddenStartConfirmsAfterVisibleLifecycle();
  console.log("[background-open-passive-session] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
