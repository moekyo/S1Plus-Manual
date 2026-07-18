#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, toPlainObject } = require("./s1plus-test-helpers");

const createModuleHarness = (initialValues = {}, moduleOptions = {}) => {
  const { hooks } = createHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Core Business Data 测试 seam。",
  });
  assert.equal(typeof hooks.s1pCreateCoreBusinessData, "function");
  assert.equal(
    typeof hooks.s1pCreateCoreBusinessDataMemoryAdapter,
    "function"
  );

  const storageAdapter = hooks.s1pCreateCoreBusinessDataMemoryAdapter(
    initialValues
  );
  const mutations = [];
  const refreshes = [];
  const diagnostics = [];
  const coreBusinessData = hooks.s1pCreateCoreBusinessData({
    storageAdapter,
    now: () => 1760000000000,
    random: () => 0.25,
    sourceId: "test-tab",
    invalidateLocalDataHash: () => {},
    recordLocalMutation: (...args) => mutations.push(args),
    publishRefreshIntents: (payload) => refreshes.push(payload),
    recordSnapshotResync: (keys) => diagnostics.push(keys),
    ...moduleOptions,
  });

  return {
    coreBusinessData,
    storageAdapter,
    mutations,
    refreshes,
    diagnostics,
  };
};

const canonicalValues = {
  blockedThreads: {
    101: { title: "Thread A", timestamp: 1760000000000, reason: "manual" },
  },
  blockedUsers: {
    202: { name: "User B", timestamp: 1760000000000, blockThreads: false },
  },
  blockedPosts: {
    303: {
      postId: "303",
      threadId: "101",
      threadTitle: "Thread A",
      floor: "3",
      authorId: "202",
      authorName: "User B",
      timestamp: 1760000000000,
      contentPreview: "preview",
    },
  },
  userTags: {
    202: { name: "User B", tag: "helpful", timestamp: 1760000000000 },
  },
  bookmarkedReplies: {
    303: {
      postId: "303",
      threadId: "101",
      postContent: "full bookmark content",
      timestamp: 1760000000000,
    },
  },
  titleFilterRules: [
    { id: "rule_1", pattern: "spoiler", enabled: true },
  ],
  readProgress: {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "3",
      timestamp: 1760000000000,
    },
  },
};

const expectedSyncProjection = {
  threads: canonicalValues.blockedThreads,
  users: canonicalValues.blockedUsers,
  blocked_posts: canonicalValues.blockedPosts,
  user_tags: canonicalValues.userTags,
  bookmarked_replies: canonicalValues.bookmarkedReplies,
  title_filter_rules: canonicalValues.titleFilterRules,
  read_progress: canonicalValues.readProgress,
};

const testEveryKindUsesOneReadWriteProjectionInterface = () => {
  const { coreBusinessData, storageAdapter, mutations } = createModuleHarness();

  Object.entries(canonicalValues).forEach(([kind, value]) => {
    const result = coreBusinessData.write(kind, value);
    assert.equal(result.changed, true, `${kind} 首次写入应发生变更。`);
    assert.deepStrictEqual(toPlainObject(coreBusinessData.read(kind)), value);
  });

  assert.deepStrictEqual(
    toPlainObject(
      coreBusinessData.projectForSync({
        compactBookmarksForSync: false,
        compactBlockedPostsForSync: false,
      })
    ),
    expectedSyncProjection
  );
  assert.equal(mutations.length, 7);
  assert.equal(mutations.at(-1)[0], "read_progress");

  const stored = toPlainObject(storageAdapter.snapshot());
  assert.deepStrictEqual(stored.s1p_blocked_threads, canonicalValues.blockedThreads);
  assert.deepStrictEqual(stored.s1p_blocked_users, canonicalValues.blockedUsers);
  assert.deepStrictEqual(stored.s1p_blocked_posts, canonicalValues.blockedPosts);
  assert.deepStrictEqual(stored.s1p_user_tags, canonicalValues.userTags);
  assert.deepStrictEqual(
    stored.s1p_bookmarked_replies,
    canonicalValues.bookmarkedReplies
  );
  assert.deepStrictEqual(
    stored.s1p_title_filter_rules,
    canonicalValues.titleFilterRules
  );
  assert.deepStrictEqual(stored.s1p_read_progress, canonicalValues.readProgress);
  assert.equal(stored.s1p_core_data_refresh_signal.key, "s1p_read_progress");
  assert.equal(stored.s1p_core_data_refresh_signal.sender, "test-tab");
};

const testEverySyncIdentityImportsThroughTheSameInterface = () => {
  const { coreBusinessData } = createModuleHarness();

  const result = coreBusinessData.importFromSync(expectedSyncProjection, {
    suppressSyncTrigger: true,
  });

  assert.deepStrictEqual(toPlainObject(result.counts), {
    blockedThreads: 1,
    blockedUsers: 1,
    blockedPosts: 1,
    userTags: 1,
    bookmarkedReplies: 1,
    titleFilterRules: 1,
    readProgress: 1,
  });
  Object.entries(canonicalValues).forEach(([kind, value]) => {
    assert.deepStrictEqual(toPlainObject(coreBusinessData.read(kind)), value);
  });
};

const testCacheSnapshotAndCrossTabBehaviorStayBehindTheInterface = () => {
  const { coreBusinessData, storageAdapter, refreshes, diagnostics } =
    createModuleHarness();
  coreBusinessData.write("blockedThreads", canonicalValues.blockedThreads, {
    suppressSyncTrigger: true,
  });

  const remoteThreads = {
    404: { title: "Remote", timestamp: 1760000000100, reason: "manual" },
  };
  storageAdapter.writeFromOtherContext("s1p_blocked_threads", remoteThreads, {
    notify: false,
  });
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("blockedThreads")),
    canonicalValues.blockedThreads,
    "普通读取应命中本地 TTL cache。"
  );

  const result = coreBusinessData.syncFromStorage({
    kinds: ["blockedThreads"],
    applyImmediately: true,
  });
  assert.deepStrictEqual(toPlainObject(result.changedKinds), ["blockedThreads"]);
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("blockedThreads")),
    remoteThreads
  );
  assert.deepStrictEqual(toPlainObject(diagnostics), [["s1p_blocked_threads"]]);
  assert.deepStrictEqual(toPlainObject(refreshes), [
    {
      intents: ["blocked_threads"],
      applyImmediately: true,
    },
  ]);

  coreBusinessData.bindCrossTab();
  const remoteRules = [{ id: "remote_rule", pattern: "remote", enabled: true }];
  storageAdapter.writeFromOtherContext("s1p_title_filter_rules", remoteRules);
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("titleFilterRules")),
    remoteRules
  );
  assert.deepStrictEqual(toPlainObject(refreshes.at(-1)), {
    intents: ["title_filter_rules"],
    applyImmediately: false,
  });

  coreBusinessData.write("blockedUsers", canonicalValues.blockedUsers, {
    suppressSyncTrigger: true,
  });
  const remoteUsers = {
    505: { name: "Remote User", timestamp: 1760000000200, blockThreads: true },
  };
  storageAdapter.writeFromOtherContext("s1p_blocked_users", remoteUsers, {
    notify: false,
  });
  storageAdapter.writeFromOtherContext("s1p_core_data_refresh_signal", {
    ts: 1760000000200,
    key: "s1p_blocked_users",
    sender: "remote-tab",
    nonce: 0.5,
  });
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("blockedUsers")),
    remoteUsers
  );
  assert.deepStrictEqual(toPlainObject(refreshes.at(-1)), {
    intents: ["blocked_users"],
    applyImmediately: false,
  });
};

const testKindNormalizationAndNoopWritesAreOwnedByTheModule = () => {
  const { coreBusinessData, mutations } = createModuleHarness();

  coreBusinessData.write(
    "readProgress",
    {
      101: {
        postId: "303",
        page: "1",
        lastReadFloor: 3,
        timestamp: 1760000000000,
      },
    },
    { suppressSyncTrigger: true }
  );
  assert.equal(
    coreBusinessData.read("readProgress")["101"].lastReadFloor,
    "3"
  );

  const first = coreBusinessData.write("titleFilterRules", "not-an-array");
  const second = coreBusinessData.write("titleFilterRules", "still-not-array");
  assert.equal(first.changed, false);
  assert.equal(second.changed, false);
  assert.deepStrictEqual(toPlainObject(coreBusinessData.read("titleFilterRules")), []);
  assert.equal(mutations.length, 0);
};

const testLegacyNormalizationPersistsThroughTheModule = () => {
  const { coreBusinessData, storageAdapter, mutations } = createModuleHarness({
    s1p_user_tags: { 202: "legacy-tag" },
    s1p_title_keywords: ["legacy-pattern"],
    s1p_read_progress: {
      101: {
        postId: "303",
        page: "1",
        lastReadFloor: 3,
        timestamp: 1760000000000,
      },
    },
  });

  assert.deepStrictEqual(toPlainObject(coreBusinessData.read("userTags")), {
    202: {
      name: "用户 #202",
      tag: "legacy-tag",
      timestamp: 1760000000000,
    },
  });
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("titleFilterRules")),
    [
      {
        pattern: "legacy-pattern",
        enabled: true,
        id: "rule_1760000000000_0.25",
      },
    ]
  );
  assert.equal(
    coreBusinessData.read("readProgress")["101"].lastReadFloor,
    "3"
  );

  const stored = toPlainObject(storageAdapter.snapshot());
  assert.equal(stored.s1p_title_keywords, null);
  assert.equal(stored.s1p_read_progress["101"].lastReadFloor, "3");
  assert.equal(stored.s1p_user_tags["202"].tag, "legacy-tag");
  assert.deepStrictEqual(
    toPlainObject(mutations),
    [
      ["general", { triggerSync: false }],
      ["general", { triggerSync: false }],
      ["read_progress", { triggerSync: false }],
    ]
  );
};

const testLegacySourceProjectionUsesKindImportRules = () => {
  const { coreBusinessData } = createModuleHarness();

  const projection = coreBusinessData.projectForSync({
    source: { title_keywords: ["legacy-pattern"] },
    compactBookmarksForSync: false,
    compactBlockedPostsForSync: false,
  });

  assert.deepStrictEqual(toPlainObject(projection.title_filter_rules), [
    {
      pattern: "legacy-pattern",
      enabled: true,
      id: "rule_1760000000000_0.25",
    },
  ]);
};

const testWritesRetireLegacyStorageEvenWhenCanonicalWriteIsNoop = () => {
  const legacyOnly = createModuleHarness({
    s1p_title_keywords: ["legacy-pattern"],
  });
  const changedResult = legacyOnly.coreBusinessData.write(
    "titleFilterRules",
    []
  );

  assert.equal(changedResult.changed, true);
  assert.deepStrictEqual(toPlainObject(legacyOnly.storageAdapter.snapshot()), {
    s1p_title_keywords: null,
    s1p_title_filter_rules: [],
    s1p_core_data_refresh_signal: {
      ts: 1760000000000,
      key: "s1p_title_filter_rules",
      sender: "test-tab",
      nonce: 0.25,
    },
  });

  const canonicalWithStaleLegacy = createModuleHarness({
    s1p_title_filter_rules: [],
    s1p_title_keywords: ["stale-pattern"],
  });
  const noopResult = canonicalWithStaleLegacy.coreBusinessData.write(
    "titleFilterRules",
    []
  );

  assert.equal(noopResult.changed, false);
  assert.deepStrictEqual(
    toPlainObject(canonicalWithStaleLegacy.storageAdapter.snapshot()),
    {
      s1p_title_filter_rules: [],
      s1p_title_keywords: null,
    }
  );
};

const testCanonicalImportPersistsEquivalentLegacyStorageShapes = () => {
  const canonicalUserTags = {
    202: {
      name: "用户 #202",
      tag: "helpful",
      timestamp: 1760000000000,
    },
  };
  const legacyBlockedPosts = {
    303: {
      ...canonicalValues.blockedPosts[303],
      postId: 303,
      threadId: 101,
      timestamp: "1760000000000",
    },
  };
  const legacyReadProgress = {
    101: {
      ...canonicalValues.readProgress[101],
      lastReadFloor: 3,
    },
  };
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    s1p_user_tags: { 202: "helpful" },
    s1p_blocked_posts: legacyBlockedPosts,
    s1p_read_progress: legacyReadProgress,
  });

  const result = coreBusinessData.importFromSync(
    {
      ...expectedSyncProjection,
      user_tags: canonicalUserTags,
    },
    { suppressSyncTrigger: true }
  );
  const stored = toPlainObject(storageAdapter.snapshot());

  assert.equal(result.hasImportNormalizationAdjustments, false);
  assert.equal(result.hasSuppressedSyncedDataTransform, false);
  assert.deepStrictEqual(stored.s1p_user_tags, canonicalUserTags);
  assert.deepStrictEqual(
    stored.s1p_blocked_posts,
    canonicalValues.blockedPosts
  );
  assert.deepStrictEqual(stored.s1p_read_progress, canonicalValues.readProgress);
  assert.equal(typeof stored.s1p_blocked_posts[303].postId, "string");
  assert.equal(typeof stored.s1p_read_progress[101].lastReadFloor, "string");
};

const testKindProjectionOwnsSyncCompaction = () => {
  const { coreBusinessData } = createModuleHarness();
  const projection = coreBusinessData.projectForSync({
    source: {
      bookmarked_replies: {
        303: {
          postId: "303",
          postContent: "bookmark full content",
          timestamp: 1760000000000,
        },
      },
      blocked_posts: {
        404: {
          postId: "404",
          threadId: "101",
          postContent: "blocked post full content",
          timestamp: 1760000000000,
        },
      },
    },
    compactBookmarksForSync: true,
    compactBlockedPostsForSync: true,
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      projection.bookmarked_replies["303"],
      "postContent"
    ),
    false
  );
  assert.equal(
    projection.bookmarked_replies["303"].contentPreview,
    "bookmark full content"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      projection.blocked_posts["404"],
      "postContent"
    ),
    false
  );
  assert.equal(
    projection.blocked_posts["404"].contentPreview,
    "blocked post full content"
  );
};

const testSettingsSignalBridgeRemainsBoundThroughTheModule = () => {
  const bridgeRefreshes = [];
  const { coreBusinessData, storageAdapter } = createModuleHarness(
    {},
    {
      bridgeSignalKeys: ["s1p_settings_refresh_signal"],
      shouldHandleBridgeSignal: (_key, value, isCrossContextChange) =>
        isCrossContextChange === true && value?.sender !== "test-tab",
      publishBridgeRefresh: (key) => bridgeRefreshes.push(key),
    }
  );
  coreBusinessData.bindCrossTab();

  storageAdapter.writeFromOtherContext("s1p_settings_refresh_signal", {
    sender: "remote-tab",
    ts: 1760000000300,
  });

  assert.deepStrictEqual(bridgeRefreshes, ["s1p_settings_refresh_signal"]);
};

const main = () => {
  testEveryKindUsesOneReadWriteProjectionInterface();
  testEverySyncIdentityImportsThroughTheSameInterface();
  testCacheSnapshotAndCrossTabBehaviorStayBehindTheInterface();
  testKindNormalizationAndNoopWritesAreOwnedByTheModule();
  testLegacyNormalizationPersistsThroughTheModule();
  testLegacySourceProjectionUsesKindImportRules();
  testWritesRetireLegacyStorageEvenWhenCanonicalWriteIsNoop();
  testCanonicalImportPersistsEquivalentLegacyStorageShapes();
  testKindProjectionOwnsSyncCompaction();
  testSettingsSignalBridgeRemainsBoundThroughTheModule();
  console.log("[core-business-data-module] checks passed.");
};

main();
