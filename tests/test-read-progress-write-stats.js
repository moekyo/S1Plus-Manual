#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

const createStatsHarness = (sandboxOptions = {}) =>
  createHarness({
    includeSessionStorage: true,
    hookErrorMessage: "未能从 S1Plus.js 暴露阅读进度写入统计钩子。",
    ...sandboxOptions,
  });

const record = (hooks, indices, kind = "readProgress") =>
  hooks.recordReadProgressShardWriteStats({
    kind,
    writtenShardIndices: indices,
  });

const readRows = (hooks) =>
  JSON.parse(JSON.stringify(hooks.buildReadProgressWriteStatsRows()));

const testWindowShowsUpdatesPerShard = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();

  record(hooks, [3]);
  record(hooks, [3]);
  record(hooks, [7]);

  assert.deepEqual(readRows(hooks), [
    ["阅读进度分片写入", "窗口 3 次更新 / 2 片（U/D≈1.5）"],
    ["阅读进度写入累计", "3 次 / 3 片次 · 1 个标签页（本页 3 次）"],
  ]);
};

const testIgnoresOtherKindsAndEmptyWrites = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();

  record(hooks, [1], "blockedThreads");
  record(hooks, []);
  record(hooks, [1, 2], "readProgress");

  assert.deepEqual(readRows(hooks), [
    ["阅读进度分片写入", "窗口 1 次更新 / 2 片（U/D≈0.5）"],
    ["阅读进度写入累计", "1 次 / 2 片次 · 1 个标签页（本页 1 次）"],
  ]);
};

const testWindowKeepsLast64Operations = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();
  for (let index = 0; index < 70; index += 1) {
    record(hooks, [index % 8]);
  }

  assert.deepEqual(readRows(hooks), [
    ["阅读进度分片写入", "窗口 64 次更新 / 8 片（U/D≈8.0）"],
    ["阅读进度写入累计", "70 次 / 70 片次 · 1 个标签页（本页 70 次）"],
  ]);
};

const testEmptyStateSaysNoRecords = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();
  assert.deepEqual(readRows(hooks), [
    ["阅读进度分片写入", "尚无阅读进度写入记录"],
    ["阅读进度写入累计", "尚无阅读进度写入记录"],
  ]);
};

const testOtherTabRecordsAreAggregated = () => {
  const sharedStore = new Map();
  const first = createStatsHarness({ sharedStore });
  first.hooks.resetReadProgressWriteStats();
  record(first.hooks, [2]);
  record(first.hooks, [2]);
  record(first.hooks, [5]);
  first.hooks.publishReadProgressWriteStats();

  // 另一个标签页：只共享 GM 存储，不共享 sessionStorage。
  const second = createStatsHarness({ sharedStore });
  assert.deepEqual(readRows(second.hooks), [
    ["阅读进度分片写入", "窗口 3 次更新 / 2 片（U/D≈1.5）"],
    ["阅读进度写入累计", "3 次 / 3 片次 · 1 个标签页（本页 0 次）"],
  ]);

  // 本页自己再写一次，汇总应把两个标签页加起来。
  record(second.hooks, [9]);
  assert.deepEqual(readRows(second.hooks), [
    ["阅读进度分片写入", "窗口 4 次更新 / 3 片（U/D≈1.3）"],
    ["阅读进度写入累计", "4 次 / 4 片次 · 2 个标签页（本页 1 次）"],
  ]);
};

const testSameTabContinuesAfterNavigation = () => {
  const sharedStore = new Map();
  const first = createStatsHarness({ sharedStore });
  first.hooks.resetReadProgressWriteStats();
  record(first.hooks, [4]);
  record(first.hooks, [4]);
  first.hooks.publishReadProgressWriteStats();

  // 同一标签页的新页面：GM 与 sessionStorage（含统计键）都跟着走。
  const second = createStatsHarness({
    sharedStore,
    sessionStorageEntries: Array.from(first.sessionStore.entries()),
  });
  assert.deepEqual(readRows(second.hooks), [
    ["阅读进度分片写入", "窗口 2 次更新 / 1 片（U/D≈2.0）"],
    ["阅读进度写入累计", "2 次 / 2 片次 · 1 个标签页（本页 2 次）"],
  ]);

  record(second.hooks, [6]);
  assert.deepEqual(readRows(second.hooks), [
    ["阅读进度分片写入", "窗口 3 次更新 / 2 片（U/D≈1.5）"],
    ["阅读进度写入累计", "3 次 / 3 片次 · 1 个标签页（本页 3 次）"],
  ]);
};

const testDiagnosticsSummaryIncludesTheStat = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();
  record(hooks, [0]);

  const summary = hooks.buildSyncDiagnosticsSummary();
  assert.ok(
    summary.includes("阅读进度分片写入: 窗口 1 次更新 / 1 片（U/D≈1.0）"),
    "同步诊断快照应包含阅读进度写入统计。"
  );
};

const testRealFacadeWritesReachTheStats = () => {
  const { hooks } = createStatsHarness();
  hooks.resetReadProgressWriteStats();

  hooks.s1pCoreBusinessData.write("readProgress", {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "3",
      timestamp: 1760000000000,
    },
  });

  assert.deepEqual(readRows(hooks), [
    ["阅读进度分片写入", "窗口 1 次更新 / 1 片（U/D≈1.0）"],
    ["阅读进度写入累计", "1 次 / 1 片次 · 1 个标签页（本页 1 次）"],
  ]);
};

const main = () => {
  testWindowShowsUpdatesPerShard();
  testIgnoresOtherKindsAndEmptyWrites();
  testWindowKeepsLast64Operations();
  testEmptyStateSaysNoRecords();
  testOtherTabRecordsAreAggregated();
  testSameTabContinuesAfterNavigation();
  testDiagnosticsSummaryIncludesTheStat();
  testRealFacadeWritesReachTheStats();
  console.log("[read-progress-write-stats] checks passed.");
};

main();
