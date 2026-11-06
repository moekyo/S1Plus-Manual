#!/usr/bin/env node
"use strict";

// [ARCH-INV-5] 运行态是“本进程的事实”，不得持久化：
// - reload 后不得继承上一页面的 running；
// - 结果态（success/failure/conflict）仍可跨标签页交接；
// - 其他标签页只能通过同步锁判断“是否有同步在跑”。

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = (options = {}) =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露同步运行态测试钩子。",
    ...options,
  });

const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";

const IDLE_STATE = Object.freeze({
  phase: "idle",
  timestamp: 0,
  token: "",
  source: "",
  reason: "",
  operation: "",
  lastResolvedPhase: "idle",
  lastResolvedTimestamp: 0,
  lastResolvedSource: "",
  lastResolvedReason: "",
});

const readNavbarProjection = (harness, state = IDLE_STATE) =>
  toPlainObject(
    harness.hooks.s1pSyncSystem.readState({
      surface: "navbar",
      state,
      allowCache: false,
    })
  );

const testRunningIsMemoryOnlyAndDiesWithThePage = () => {
  const first = createHarness();
  const token = first.hooks.startAutoSyncIndicatorCycle("background_push", {
    operation: "push",
    reason: "read_progress",
  });
  assert.equal(
    toPlainObject(first.hooks.getAutoSyncIndicatorState()).phase,
    "running",
    "本进程内应看到运行态"
  );
  assert.equal(
    first.store.has(AUTO_SYNC_INDICATOR_STATE_KEY),
    false,
    "运行态不得写入 s1p_auto_sync_indicator_state"
  );

  // 同一份 GM（sharedStore）上的“新页面”= reload。
  const reloaded = createHarness({ sharedStore: first.store });
  const inherited = toPlainObject(reloaded.hooks.getAutoSyncIndicatorState());
  assert.notEqual(
    inherited.phase,
    "running",
    "reload 后不得继承上一页面的运行态"
  );
  assert.equal(
    readNavbarProjection(reloaded).displayPhase,
    "idle",
    "reload 后指示器不得显示运行中"
  );
  assert.equal(typeof token, "string");
};

const testResolvedResultStillHandsOffAcrossPages = () => {
  const first = createHarness();
  const token = first.hooks.startAutoSyncIndicatorCycle("background_push", {
    operation: "push",
    reason: "read_progress",
  });
  first.hooks.backdateAutoSyncIndicatorRuntimeRunningForTest(1000);
  first.hooks.finishAutoSyncIndicatorCycle(token, "success", {
    source: "background_push",
    reason: "pushed",
    operation: "push",
  });
  assert.equal(
    first.store.has(AUTO_SYNC_INDICATOR_STATE_KEY),
    true,
    "结果态仍应持久化以支持跨标签页/跨页面交接"
  );
  const reloaded = createHarness({ sharedStore: first.store });
  const inherited = toPlainObject(reloaded.hooks.getAutoSyncIndicatorState());
  assert.equal(inherited.phase, "success");
  assert.equal(inherited.operation, "push");
};

const testTransientFactsDoNotBecomePersistedState = () => {
  const harness = createHarness();
  harness.hooks.startAutoSyncIndicatorCycle("background_push", {
    operation: "push",
    reason: "read_progress",
  });
  harness.store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...IDLE_STATE,
    phase: "success",
    timestamp: Date.now(),
    lastResolvedPhase: "success",
    lastResolvedTimestamp: Date.now(),
  });
  // 运行中写结果 = 其他标签页的写入：本进程运行态仍在，但不得把 running 落盘。
  assert.equal(
    toPlainObject(harness.hooks.getAutoSyncIndicatorState()).phase,
    "running"
  );
  assert.notEqual(
    toPlainObject(
      JSON.parse(JSON.stringify(harness.store.get(AUTO_SYNC_INDICATOR_STATE_KEY)))
    ).phase,
    "running"
  );
};

const run = () => {
  testRunningIsMemoryOnlyAndDiesWithThePage();
  testResolvedResultStillHandsOffAcrossPages();
  testTransientFactsDoNotBecomePersistedState();
  console.log("[sync-running-not-persisted] INV-5 verified.");
};

run();
