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
    ["阅读进度写入累计", "3 次更新 / 3 片次"],
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
    ["阅读进度写入累计", "1 次更新 / 2 片次"],
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
    ["阅读进度写入累计", "70 次更新 / 70 片次"],
  ]);
};

const testStatsSurviveNavigationThroughSessionStorage = () => {
  const first = createStatsHarness();
  first.hooks.resetReadProgressWriteStats();
  record(first.hooks, [2]);
  record(first.hooks, [2]);
  record(first.hooks, [5]);

  // 新页面只带 sessionStorage 过来，统计应继续累计（模拟跨页刷帖）。
  const second = createStatsHarness({
    sessionStorageEntries: Array.from(first.sessionStore.entries()),
  });
  assert.deepEqual(readRows(second.hooks), [
    ["阅读进度分片写入", "窗口 3 次更新 / 2 片（U/D≈1.5）"],
    ["阅读进度写入累计", "3 次更新 / 3 片次"],
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
    ["阅读进度写入累计", "1 次更新 / 1 片次"],
  ]);
};

const main = () => {
  testWindowShowsUpdatesPerShard();
  testIgnoresOtherKindsAndEmptyWrites();
  testWindowKeepsLast64Operations();
  testStatsSurviveNavigationThroughSessionStorage();
  testDiagnosticsSummaryIncludesTheStat();
  testRealFacadeWritesReachTheStats();
  console.log("[read-progress-write-stats] checks passed.");
};

main();
