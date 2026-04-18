#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");
const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露核心数据快照收敛测试钩子。",
  });

const testReadProgressSnapshotResyncRefreshesStaleCache = () => {
  const { hooks, sandbox } = createHarness();
  const initialProgress = {
    123456: {
      postId: "70000001",
      page: "1",
      lastReadFloor: "3",
      timestamp: Date.now() - 5000,
    },
  };
  const newerProgress = {
    123456: {
      postId: "70000002",
      page: "2",
      lastReadFloor: "16",
      timestamp: Date.now(),
    },
  };

  sandbox.GM_setValue("s1p_read_progress", initialProgress);
  assert.deepStrictEqual(toPlainObject(hooks.getReadProgress()), initialProgress);
  hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_read_progress"],
    applyImmediately: false,
  });

  sandbox.GM_setValue("s1p_read_progress", newerProgress);
  const result = hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_read_progress"],
    applyImmediately: false,
  });

  assert.equal(result.didSync, true);
  assert.deepStrictEqual(toPlainObject(result.changedKeys), ["s1p_read_progress"]);
  assert.deepStrictEqual(toPlainObject(hooks.getReadProgress()), newerProgress);
};

const testFreshSnapshotExportBypassesStaleCache = async () => {
  const { hooks, sandbox } = createHarness();
  const initialProgress = {
    123456: {
      postId: "70000001",
      page: "1",
      lastReadFloor: "3",
      timestamp: Date.now() - 5000,
    },
  };
  const newerProgress = {
    123456: {
      postId: "70000002",
      page: "2",
      lastReadFloor: "16",
      timestamp: Date.now(),
    },
  };

  sandbox.GM_setValue("s1p_read_progress", initialProgress);
  hooks.getReadProgress();
  sandbox.GM_setValue("s1p_read_progress", newerProgress);

  const exported = await hooks.exportLocalDataObject({
    useFreshSnapshot: true,
    compactBookmarksForSync: false,
    compactBlockedPostsForSync: false,
  });

  assert.deepStrictEqual(
    toPlainObject(exported.data.read_progress),
    newerProgress
  );
};

const testNoopSnapshotResyncStaysQuietWhenUnchanged = () => {
  const { hooks, sandbox } = createHarness();
  const rules = [{ id: "rule_1", pattern: "foo", enabled: true }];

  sandbox.GM_setValue("s1p_title_filter_rules", rules);
  const result = hooks.syncCoreDataFromStorageSnapshotIfNeeded({
    keys: ["s1p_title_filter_rules"],
    applyImmediately: false,
  });

  assert.equal(result.didSync, false);
  assert.deepStrictEqual(toPlainObject(result.changedKeys), []);
};

const main = async () => {
  testReadProgressSnapshotResyncRefreshesStaleCache();
  await testFreshSnapshotExportBypassesStaleCache();
  testNoopSnapshotResyncStaysQuietWhenUnchanged();
  console.log("[core-data-snapshot-resync] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
