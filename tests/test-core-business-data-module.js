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

const READ_PROGRESS_SHARD_PREFIX = "s1p_read_progress#";

// 阅读进度分片落盘：把 s1p_read_progress#0..#N-1 合并回逻辑上的整表。
const collectStoredReadProgressShards = (stored) => {
  const merged = {};
  Object.keys(stored)
    .filter((key) => key.startsWith(READ_PROGRESS_SHARD_PREFIX))
    .forEach((key) => {
      assert.ok(
        stored[key] && typeof stored[key] === "object",
        `${key} 应当是分片对象。`
      );
      Object.assign(merged, stored[key]);
    });
  const legacy = stored.s1p_read_progress;
  if (legacy && typeof legacy === "object") {
    Object.assign(merged, legacy);
  }
  return merged;
};

const getStoredReadProgressShardKeys = (stored) =>
  Object.keys(stored).filter((key) =>
    key.startsWith(READ_PROGRESS_SHARD_PREFIX)
  );

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
  assert.deepStrictEqual(
    collectStoredReadProgressShards(stored),
    canonicalValues.readProgress
  );
  assert.equal(
    getStoredReadProgressShardKeys(stored).length,
    1,
    "只有一条阅读进度时只应落一片，不写空的其余分片。"
  );
  assert.equal(stored.s1p_core_data_refresh_signal.key, "s1p_read_progress");
  assert.equal(stored.s1p_core_data_refresh_signal.sender, "test-tab");
};

const testSyncImportPrimitiveIsNotReachableFromTheFacade = () => {
  const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");
  const harness = createBaseHarness({ hookErrorMessage: "h" });
  const facade = harness.hooks.s1pCoreBusinessData;
  assert.equal(
    Object.isFrozen(facade),
    true,
    "公开门面必须冻结"
  );
  assert.equal(
    "importFromSync" in facade,
    false,
    "公开门面不得包含 importFromSync"
  );
  assert.equal(facade.importFromSync, undefined);
  // 工厂在隔离闭包内创建；原语一次性注入后不可再取。
  const boundary = harness.hooks.s1pSyncImportBoundary;
  assert.equal(Object.isFrozen(boundary), true, "边界对象必须冻结");
  assert.equal(
    boundary.takeImportPayload(),
    null,
    "初始化之后不得再取得导入原语"
  );
};

const testImportFromSyncRequiresDeclaredOrigin = () => {
  const { coreBusinessData } = createModuleHarness();
  assert.throws(
    () => coreBusinessData.importFromSync(expectedSyncProjection, {}),
    /必须声明合法来源/,
    "未声明来源的导入必须被拒绝"
  );
  assert.throws(
    () =>
      coreBusinessData.importFromSync(expectedSyncProjection, {
        origin: "made_up_origin",
      }),
    /必须声明合法来源/,
    "未知来源的导入必须被拒绝"
  );
};

const testEverySyncIdentityImportsThroughTheSameInterface = () => {
  const { coreBusinessData } = createModuleHarness();

  // [ARCH-INV-3] 同步数据导入必须声明来源。
  const result = coreBusinessData.importFromSync(expectedSyncProjection, {
    suppressSyncTrigger: true,
    origin: "user_json_import",
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
  assert.equal(stored.s1p_read_progress, null);
  assert.equal(
    collectStoredReadProgressShards(stored)["101"].lastReadFloor,
    "3"
  );
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
    { suppressSyncTrigger: true, origin: "user_json_import" }
  );
  const stored = toPlainObject(storageAdapter.snapshot());

  assert.equal(result.hasImportNormalizationAdjustments, false);
  assert.equal(result.hasSuppressedSyncedDataTransform, false);
  assert.deepStrictEqual(stored.s1p_user_tags, canonicalUserTags);
  assert.deepStrictEqual(
    stored.s1p_blocked_posts,
    canonicalValues.blockedPosts
  );
  assert.deepStrictEqual(
    collectStoredReadProgressShards(stored),
    canonicalValues.readProgress
  );
  assert.equal(typeof stored.s1p_blocked_posts[303].postId, "string");
  assert.equal(
    typeof collectStoredReadProgressShards(stored)[101].lastReadFloor,
    "string"
  );
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

const testReadProgressWritesOnlyTheChangedShard = () => {
  const { coreBusinessData, storageAdapter } = createModuleHarness();
  const progress = {};
  for (let index = 0; index < 320; index += 1) {
    progress[String(100000 + index)] = {
      postId: String(200000 + index),
      page: "1",
      lastReadFloor: "1",
      timestamp: 1760000000000 + index,
    };
  }

  coreBusinessData.write("readProgress", progress);
  const before = toPlainObject(storageAdapter.snapshot());
  const shardKeys = getStoredReadProgressShardKeys(before);
  assert.equal(shardKeys.length, 32, "首次写入应铺满分片。");
  assert.equal(
    before.s1p_read_progress,
    undefined,
    "全新安装不应再写旧单键。"
  );

  const nextProgress = {
    ...progress,
    "100010": {
      ...progress["100010"],
      page: "2",
      lastReadFloor: "40",
      timestamp: 1760000001000,
    },
  };
  coreBusinessData.write("readProgress", nextProgress);

  const after = toPlainObject(storageAdapter.snapshot());
  const changedShardKeys = shardKeys.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
  assert.equal(
    changedShardKeys.length,
    1,
    "单帖进度更新只应写入该帖所在的那一片。"
  );
  assert.ok(
    Object.keys(after[changedShardKeys[0]]).length < 64,
    "单片条目数应远小于总条数。"
  );
  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("readProgress")),
    nextProgress
  );
};

const testReadProgressMigratesLegacySingleKey = () => {
  const legacyProgress = {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "3",
      timestamp: 1760000000000,
    },
    102: {
      postId: "404",
      page: "2",
      lastReadFloor: "8",
      timestamp: 1760000000500,
    },
  };
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    s1p_read_progress: legacyProgress,
  });

  assert.deepStrictEqual(
    toPlainObject(coreBusinessData.read("readProgress")),
    legacyProgress
  );

  const migrated = toPlainObject(storageAdapter.snapshot());
  assert.equal(
    migrated.s1p_read_progress,
    null,
    "迁移后应清空旧单键，避免每次读取重复迁移。"
  );
  assert.deepStrictEqual(
    collectStoredReadProgressShards(migrated),
    legacyProgress
  );

  const nextProgress = {
    103: {
      postId: "505",
      page: "1",
      lastReadFloor: "1",
      timestamp: 1760000001000,
    },
  };
  coreBusinessData.write("readProgress", { ...legacyProgress, ...nextProgress });
  const afterWrite = toPlainObject(storageAdapter.snapshot());
  assert.equal(afterWrite.s1p_read_progress, null, "迁移后不再回写旧单键。");
  assert.deepStrictEqual(
    collectStoredReadProgressShards(afterWrite),
    { ...legacyProgress, ...nextProgress }
  );
};

const testReadProgressMigrationKeepsNewerShardRecord = () => {
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    s1p_read_progress: {
      101: {
        postId: "303",
        page: "1",
        lastReadFloor: "3",
        timestamp: 1760000000000,
      },
    },
  });
  coreBusinessData.read("readProgress");

  // 旧版本标签页可能再次写回整表：更旧的记录不能盖掉分片里的新记录。
  storageAdapter.setValue("s1p_read_progress", {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "2",
      timestamp: 1759999999000,
    },
    102: {
      postId: "404",
      page: "4",
      lastReadFloor: "4",
      timestamp: 1760000002000,
    },
  });

  const mergedValue = toPlainObject(
    coreBusinessData.read("readProgress", { fresh: true })
  );
  assert.equal(mergedValue["101"].lastReadFloor, "3");
  assert.equal(mergedValue["102"].lastReadFloor, "4");
};

const testReadProgressCrossTabRefreshConvergesThroughSignal = () => {
  const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");
  const harness = createBaseHarness({ hookErrorMessage: "h" });
  const storageAdapter = harness.hooks.s1pCreateCoreBusinessDataMemoryAdapter({});
  const refreshes = [];
  const createTab = (sourceId, intents) =>
    harness.hooks.s1pCreateCoreBusinessData({
      storageAdapter,
      now: () => 1760000000000,
      random: () => 0.25,
      sourceId,
      publishRefreshIntents: (payload) => intents.push(payload),
    });
  const tabA = createTab("tab-a", []);
  const tabB = createTab("tab-b", refreshes);
  tabB.bindCrossTab();

  assert.deepStrictEqual(toPlainObject(tabB.read("readProgress")), {});

  // 另一个标签页写入后，本页没有分片监听，只能靠刷新信号重新读取整表。
  tabA.write("readProgress", canonicalValues.readProgress);
  assert.deepStrictEqual(
    toPlainObject(tabB.read("readProgress")),
    canonicalValues.readProgress
  );
  assert.deepStrictEqual(toPlainObject(refreshes.at(-1)), {
    intents: ["read_progress"],
    applyImmediately: false,
  });
};

const testReadProgressDropsAgedProvenanceOnPersist = () => {
  const { coreBusinessData, storageAdapter } = createModuleHarness();
  const harnessNow = 1760000000000;
  const buildProvenance = (threadId, createdAt) => ({
    sourceTabId: "test-tab",
    threadId,
    page: "1",
    saveReason: "visible_stable",
    documentVisibilityState: "visible",
    hadConfirmedVisiblePost: true,
    createdAt,
    initiatedWhileHidden: false,
    saveKind: "real_reading",
  });
  const agedAt = harnessNow - 8 * 86400000;
  const freshAt = harnessNow - 1000;
  const progress = {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "3",
      timestamp: agedAt,
      provenance: buildProvenance("101", agedAt),
    },
    102: {
      postId: "404",
      page: "2",
      lastReadFloor: "8",
      timestamp: freshAt,
      provenance: buildProvenance("102", freshAt),
    },
  };

  const first = coreBusinessData.write("readProgress", progress);
  assert.equal(first.changed, true);
  const stored = collectStoredReadProgressShards(
    toPlainObject(storageAdapter.snapshot())
  );
  assert.equal(
    stored["101"].provenance,
    undefined,
    "超过保留期的 provenance 不应落盘。"
  );
  assert.equal(stored["102"].provenance.sourceTabId, "test-tab");
  assert.equal(
    coreBusinessData.read("readProgress")["101"].provenance,
    undefined,
    "缓存与磁盘必须同形，否则每次写入都会被误判成变更。"
  );

  const second = coreBusinessData.write("readProgress", progress);
  assert.equal(
    second.changed,
    false,
    "同一份输入重复写入时，已压缩的记录不能再产生回写。"
  );
};

const testReadProgressReadPathNeverCompactsOrWrites = () => {
  const agedAt = 1760000000000 - 30 * 86400000;
  const legacyShardValue = {
    101: {
      postId: "303",
      page: "1",
      lastReadFloor: "3",
      timestamp: agedAt,
      provenance: {
        sourceTabId: "test-tab",
        threadId: "101",
        page: "1",
        saveReason: "visible_stable",
        documentVisibilityState: "visible",
        hadConfirmedVisiblePost: true,
        createdAt: agedAt,
        initiatedWhileHidden: false,
        saveKind: "real_reading",
      },
    },
  };
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    "s1p_read_progress#7": legacyShardValue,
  });

  const snapshotBefore = JSON.stringify(
    toPlainObject(storageAdapter.snapshot())
  );
  const readValue = coreBusinessData.read("readProgress", { fresh: true });

  assert.equal(
    readValue["101"].provenance.sourceTabId,
    "test-tab",
    "读路径不得压缩 provenance：压缩只在写入路径做，否则记录一过期就滚动回写。"
  );
  assert.equal(
    JSON.stringify(toPlainObject(storageAdapter.snapshot())),
    snapshotBefore,
    "纯读取不应产生任何存储写入。"
  );
};

const testShardedWriteReportsWrittenShardIndices = () => {
  const recorded = [];
  const { coreBusinessData, storageAdapter } = createModuleHarness(
    {},
    { recordShardedWrite: (payload) => recorded.push(payload) }
  );
  const progress = {
    101: { postId: "303", page: "1", lastReadFloor: "3", timestamp: 1760000000000 },
  };

  coreBusinessData.write("readProgress", progress);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "readProgress");
  assert.equal(recorded[0].writtenShardIndices.length, 1);
  assert.ok(
    toPlainObject(storageAdapter.snapshot())[
      `s1p_read_progress#${recorded[0].writtenShardIndices[0]}`
    ],
    "上报的分片编号应当就是真正落盘的那一片。"
  );

  coreBusinessData.write("readProgress", progress);
  assert.equal(recorded.length, 1, "没有真正写入时不应记统计。");

  coreBusinessData.write("blockedThreads", canonicalValues.blockedThreads);
  assert.equal(recorded.length, 1, "未分片的 kind 不记统计。");
};

const testLegacyMigrationKeepsShardRecordOnTimestampTie = () => {
  const ts = 1760000000000;
  const legacyRecord = { postId: "9002", page: "2", lastReadFloor: "50", timestamp: ts };
  const shardRecord = { postId: "9001", page: "5", lastReadFloor: "200", timestamp: ts };
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    s1p_read_progress: { 2294954: legacyRecord },
  });

  coreBusinessData.read("readProgress");
  const afterMigration = toPlainObject(storageAdapter.snapshot());
  const shardKey = Object.keys(afterMigration).find((key) =>
    key.startsWith("s1p_read_progress#")
  );
  assert.ok(shardKey, "迁移后应存在分片键。");

  storageAdapter.setValue(shardKey, { 2294954: shardRecord });
  storageAdapter.setValue("s1p_read_progress", { 2294954: legacyRecord });

  const merged = toPlainObject(
    coreBusinessData.read("readProgress", { fresh: true })
  );
  assert.equal(merged["2294954"].page, "5", "同毫秒冲突应保留分片内容。");
  assert.equal(merged["2294954"].lastReadFloor, "200");
  assert.equal(
    toPlainObject(storageAdapter.snapshot()).s1p_read_progress,
    null,
    "迁移应清空旧单键。"
  );
};

const testImpossibleFirstPageFloorIsRepaired = () => {
  const { coreBusinessData, storageAdapter } = createModuleHarness({
    s1p_read_progress: {
      2294954: {
        postId: "70560222",
        page: "1",
        lastReadFloor: "2026",
        timestamp: 1760000000000,
      },
    },
  });

  const value = toPlainObject(coreBusinessData.read("readProgress"));
  assert.equal(
    value["2294954"].lastReadFloor,
    "1",
    "第 1 页不可能有 2026 楼：应把年份误判修回主楼。"
  );
  assert.equal(
    collectStoredReadProgressShards(toPlainObject(storageAdapter.snapshot()))[
      "2294954"
    ].lastReadFloor,
    "1",
    "修复结果应落盘。"
  );
};

const main = () => {
  testEveryKindUsesOneReadWriteProjectionInterface();
  testSyncImportPrimitiveIsNotReachableFromTheFacade();
  testImportFromSyncRequiresDeclaredOrigin();
  testEverySyncIdentityImportsThroughTheSameInterface();
  testCacheSnapshotAndCrossTabBehaviorStayBehindTheInterface();
  testKindNormalizationAndNoopWritesAreOwnedByTheModule();
  testLegacyNormalizationPersistsThroughTheModule();
  testLegacySourceProjectionUsesKindImportRules();
  testWritesRetireLegacyStorageEvenWhenCanonicalWriteIsNoop();
  testCanonicalImportPersistsEquivalentLegacyStorageShapes();
  testKindProjectionOwnsSyncCompaction();
  testSettingsSignalBridgeRemainsBoundThroughTheModule();
  testReadProgressWritesOnlyTheChangedShard();
  testReadProgressMigratesLegacySingleKey();
  testReadProgressMigrationKeepsNewerShardRecord();
  testReadProgressCrossTabRefreshConvergesThroughSignal();
  testReadProgressDropsAgedProvenanceOnPersist();
  testReadProgressReadPathNeverCompactsOrWrites();
  testShardedWriteReportsWrittenShardIndices();
  testLegacyMigrationKeepsShardRecordOnTimestampTie();
  testImpossibleFirstPageFloorIsRepaired();
  console.log("[core-business-data-module] checks passed.");
};

main();
