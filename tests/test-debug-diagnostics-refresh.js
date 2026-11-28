#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

const PANEL_ID = "s1p-debug-sync-diagnostics-panel";
const UNIFIED_ID = "s1p-debug-unified-panel";
const AUTO_REFRESH_MS = 2000;

const createClassList = () => {
  const names = new Set();
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    remove: (...values) => values.forEach((value) => names.delete(value)),
    toggle: (value, force) => {
      if (typeof force === "boolean") {
        if (force) names.add(value);
        else names.delete(value);
        return force;
      }
      if (names.has(value)) {
        names.delete(value);
        return false;
      }
      names.add(value);
      return true;
    },
    contains: (value) => names.has(value),
  };
};

const createFakeElement = ({ tag = "div", id = "", className = "" } = {}) => {
  const element = {
    tagName: String(tag).toUpperCase(),
    id,
    className,
    dataset: {},
    classList: createClassList(),
    children: [],
    parentElement: null,
    isConnected: true,
    renderSeq: 0,
    appendChild(child) {
      child.parentElement = element;
      element.children.push(child);
      return child;
    },
    closest(selector) {
      let node = element;
      while (node) {
        if (
          selector === "[data-s1p-debug-diagnostics-embed]" &&
          node.__diagnosticsEmbed === true
        ) {
          return node;
        }
        if (selector === "[data-s1p-debug-tab-pane]" && node.__tabPane === true) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      const wanted = String(selector).toUpperCase();
      return element.children.find((child) => child.tagName === wanted) || null;
    },
    querySelectorAll(selector) {
      if (selector === ".s1p-debug-diagnostics-row") {
        return element.children.filter((child) =>
          child.classList.contains("s1p-debug-diagnostics-row")
        );
      }
      return [];
    },
  };
  let text = "";
  Object.defineProperty(element, "textContent", {
    get: () => text,
    set: (value) => {
      text = String(value);
      element.renderSeq += 1;
      if (value === "") {
        element.children = [];
      }
    },
  });
  if (className) {
    className.split(/\s+/).filter(Boolean).forEach((name) => element.classList.add(name));
  }
  return element;
};

const createPanelHarness = () => {
  const harness = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露调试面板测试钩子。",
  });
  const { sandbox, hooks } = harness;

  const embed = createFakeElement({ className: "s1p-debug-diagnostics-embed" });
  embed.__diagnosticsEmbed = true;
  const pane = createFakeElement({ className: "s1p-debug-tab-pane is-active" });
  pane.__tabPane = true;
  const unified = createFakeElement({ id: UNIFIED_ID });
  const panel = createFakeElement({ id: PANEL_ID });
  embed.appendChild(pane);
  pane.appendChild(panel);

  const registry = new Map([
    [PANEL_ID, panel],
    [UNIFIED_ID, unified],
  ]);
  sandbox.document.getElementById = (id) => registry.get(id) ?? null;
  sandbox.document.createElement = (tag) => createFakeElement({ tag });

  const timers = [];
  sandbox.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  sandbox.clearTimeout = () => {};

  const replacePanel = (nextPanel) => {
    registry.set(PANEL_ID, nextPanel);
    pane.children = [nextPanel];
    nextPanel.parentElement = pane;
  };
  const rowTexts = (target = registry.get(PANEL_ID)) =>
    target.children.map((row) =>
      [row.querySelector("span")?.textContent || "", row.querySelector("strong")?.textContent || ""].join(": ")
    );
  const runPendingTimers = () => {
    let guard = 0;
    while (timers.length > 0 && guard < 20) {
      guard += 1;
      timers.shift().callback();
    }
  };

  return { harness, hooks, embed, pane, unified, registry, timers, replacePanel, rowTexts, runPendingTimers };
};

const testRendersRowsAndSchedulesAutoRefresh = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();

  assert.ok(ctx.registry.get(PANEL_ID).children.length > 20, "应渲染诊断行");
  assert.equal(ctx.timers.length, 1, "渲染后应排一次自检");
  assert.equal(ctx.timers[0].delay, AUTO_REFRESH_MS);
};

const testUnchangedRowsAreNotRerendered = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();
  const panel = ctx.registry.get(PANEL_ID);
  const firstRow = panel.children[0];
  const renderSeq = panel.renderSeq;

  ctx.hooks.updateSyncDiagnosticsPanelForTest();

  assert.equal(panel.children[0], firstRow, "内容不变不应重建行");
  assert.equal(panel.renderSeq, renderSeq, "内容不变不应重写 textContent");
  assert.equal(ctx.timers.length, 1, "已有待执行自检时不应叠加定时器");
};

const testTimerPicksUpChangedStats = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();
  const panel = ctx.registry.get(PANEL_ID);

  ctx.hooks.recordReadProgressShardWriteStats({
    kind: "readProgress",
    writtenShardIndices: [3],
  });
  const [pending] = ctx.timers.splice(0, 1);
  pending.callback();

  const texts = ctx.rowTexts(panel);
  assert.ok(
    texts.some((text) => text.includes("阅读进度分片写入") && text.includes("本页 1 次")),
    "定时器到点应自动刷新出新数字"
  );
  assert.equal(ctx.timers.length, 1, "刷新后应继续排下一次自检");
};

const testRebuiltPanelRendersAgain = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();
  const rebuilt = createFakeElement({ id: PANEL_ID });
  ctx.replacePanel(rebuilt);

  ctx.hooks.updateSyncDiagnosticsPanelForTest();

  assert.ok(rebuilt.children.length > 20, "面板重建后应重新渲染（签名随新元素为空）");
};

const testCollapsedPanelStopsAutoRefresh = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();
  const panel = ctx.registry.get(PANEL_ID);
  const renderSeq = panel.renderSeq;

  ctx.embed.classList.add("is-collapsed");
  ctx.runPendingTimers();

  assert.equal(panel.renderSeq, renderSeq, "折叠时自检不应重绘");
  assert.equal(ctx.timers.length, 0, "折叠时不再续排自检");
};

const testInactiveTabPaneStopsAutoRefresh = () => {
  const ctx = createPanelHarness();
  ctx.hooks.updateSyncDiagnosticsPanelForTest();
  const panel = ctx.registry.get(PANEL_ID);
  const renderSeq = panel.renderSeq;

  ctx.pane.classList.remove("is-active");
  ctx.runPendingTimers();

  assert.equal(panel.renderSeq, renderSeq, "非激活 tab 不应继续轮询");
  assert.equal(ctx.timers.length, 0, "非激活 tab 不再续排");
};

const main = () => {
  testRendersRowsAndSchedulesAutoRefresh();
  testUnchangedRowsAreNotRerendered();
  testTimerPicksUpChangedStats();
  testRebuiltPanelRendersAgain();
  testCollapsedPanelStopsAutoRefresh();
  testInactiveTabPaneStopsAutoRefresh();
  console.log("[debug-diagnostics-refresh] checks passed.");
};

main();
