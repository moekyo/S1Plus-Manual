#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, toPlainObject } = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage:
    "未能从 S1Plus.js 暴露 Page Enhancement Projection 测试 seam。",
});
const {
  defaultSettings,
  s1pCreatePageEnhancementProjection,
  s1pPageEnhancementProjection,
  s1pSettingsSemantics,
} = hooks;

assert.equal(typeof s1pCreatePageEnhancementProjection, "function");
assert.ok(s1pPageEnhancementProjection, "缺少 Page Enhancement Projection 模块。");
assert.equal(Object.isFrozen(s1pPageEnhancementProjection), true);
assert.deepStrictEqual(Object.keys(s1pPageEnhancementProjection), ["project"]);

const createProjectionHarness = ({
  isThreadListPage = false,
  hasPostTables = true,
  profileButtonApplied = true,
  nativeButtonApplied = true,
  nativeBlacklistPage = false,
  autoSignError = null,
} = {}) => {
  const calls = [];
  const record = (name, result) => (...args) => {
    calls.push([name, ...args]);
    return result;
  };
  const effects = new Proxy(
    {
      isConnectedElement: (node) => node?.isConnected === true,
      isThreadListPage: () => isThreadListPage,
      hasPostTables: () => hasPostTables,
      addProfileHeaderBlockButton: record(
        "addProfileHeaderBlockButton",
        profileButtonApplied
      ),
      addNativeBlacklistImportButton: record(
        "addNativeBlacklistImportButton",
        nativeButtonApplied
      ),
      isNativeBlacklistPage: record(
        "isNativeBlacklistPage",
        nativeBlacklistPage
      ),
      autoSign: (...args) => {
        calls.push(["autoSign", ...args]);
        if (autoSignError) {
          throw autoSignError;
        }
      },
    },
    {
      get(target, key) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
          return target[key];
        }
        return record(String(key));
      },
    }
  );
  const projection = s1pCreatePageEnhancementProjection({
    settingsSemantics: s1pSettingsSemantics,
    effects,
    scopeLimits: {
      threadRows: 2,
      postTables: 2,
      quoteScopes: 2,
      ratingsScopes: 2,
      notificationScopes: 2,
    },
  });
  return { projection, calls };
};

const names = (calls) => calls.map(([name]) => name);
const settingsWith = (overrides = {}) => ({
  ...toPlainObject(defaultSettings),
  ...overrides,
});

const testFullProjectionOwnsOrderAndDisablePolicy = () => {
  const { projection, calls } = createProjectionHarness();
  assert.equal(Object.isFrozen(projection), true);
  assert.deepStrictEqual(Object.keys(projection), ["project"]);

  const outcome = projection.project({
    type: "full",
    settings: settingsWith({
      enablePostBlocking: false,
      enableUserBlocking: false,
      enableUserTagging: false,
      enableGeneralSettings: true,
      enableReadProgress: false,
    }),
  });

  assert.equal(Object.isFrozen(outcome), true);
  assert.deepStrictEqual(toPlainObject(outcome), {
    type: "full",
    mode: "full",
  });
  assert.deepStrictEqual(names(calls), [
    "manageFloatingControls",
    "restoreManagedVisibility",
    "removeBlockButtonsFromThreads",
    "clearKeywordHiddenThreads",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
    "hideBlockedUserNotifications",
    "hideSystemBlockedPosts",
    "refreshPostActions",
    "addProfileHeaderBlockButton",
    "renameAuthorLinks",
    "removeProgressJumpButtons",
    "clearReadIndicator",
    "applyInterfaceCustomizations",
    "applyImageHiding",
    "manageImageToggleAllButtons",
    "applyImageSizeLimits",
    "applyImageViewerBehavior",
    "applyNuxDarkTextContrastFix",
    "applyPlainTextUrlAutolinks",
    "applyGlobalLinkBehavior",
    "addNativeBlacklistImportButton",
    "ensureMyThreadsQuickLink",
    "attachReadingProgress",
    "markRuntimeSnapshot",
    "autoSign",
  ]);
  assert.equal(
    names(calls).filter((name) => name === "restoreManagedVisibility").length,
    1,
    "full projection 中多个关闭态只能恢复一次托管可见性。"
  );

  calls.length = 0;
  projection.project({ type: "full", settings: settingsWith() });
  assert.deepStrictEqual(names(calls).slice(0, 9), [
    "manageFloatingControls",
    "hideBlockedThreads",
    "hideThreadsByTitleKeyword",
    "addBlockButtonsToThreads",
    "applyUserThreadBlocklist",
    "hideBlockedPosts",
    "hideBlockedUsersPosts",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
  ]);
  assert.equal(names(calls).includes("initializeTaggingPopover"), true);
  assert.equal(names(calls).includes("addProgressJumpButtons"), true);

  const retryError = new Error("auto sign failed");
  const retryHarness = createProjectionHarness({
    profileButtonApplied: false,
    nativeButtonApplied: false,
    nativeBlacklistPage: true,
    autoSignError: retryError,
  });
  assert.doesNotThrow(() =>
    retryHarness.projection.project({
      type: "full",
      settings: settingsWith(),
    })
  );
  assert.equal(
    names(retryHarness.calls).includes("scheduleProfileHeaderBlockButtonRefresh"),
    true
  );
  assert.equal(
    names(retryHarness.calls).includes(
      "scheduleNativeBlacklistImportButtonRefresh"
    ),
    true
  );
  const loggedAutoSignError = retryHarness.calls.find(
    ([name]) => name === "logAutoSignError"
  );
  assert.strictEqual(loggedAutoSignError[1], retryError);
};

const testMutationProjectionChoosesScopedOrFullFallback = () => {
  const { projection, calls } = createProjectionHarness();
  const threadRow = { id: "thread-1", isConnected: true };
  const postTable = { id: "post-1", isConnected: true };
  const quoteScope = { id: "quote-1", isConnected: true };
  const ratingsScope = { id: "ratings-1", isConnected: true };
  const notificationScope = { id: "notification-1", isConnected: true };
  const baseEvent = {
    type: "mutation",
    settings: settingsWith({ hideSystemBlockedPosts: true }),
    refresh: {
      threads: true,
      posts: true,
      quotes: true,
      ratings: true,
      notifications: true,
    },
    scopes: {
      threadRows: [threadRow],
      postTables: [postTable],
      quoteScopes: [quoteScope],
      ratingsScopes: [ratingsScope],
      notificationScopes: [notificationScope],
    },
  };

  const scopedOutcome = projection.project(baseEvent);
  assert.deepStrictEqual(toPlainObject(scopedOutcome), {
    type: "mutation",
    mode: "scoped",
  });
  assert.deepStrictEqual(names(calls), [
    "addBlockButtonsToThreadRows",
    "applyBlockedThreadVisibilityForRows",
    "applyKeywordThreadHidingForRows",
    "applyUserThreadBlocklistForRows",
    "addProgressJumpButtonsForRows",
    "hideBlockedUsersPostsInTables",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
    "hideBlockedUserNotifications",
    "hideBlockedPostsInTables",
    "hideSystemBlockedPosts",
    "addActionsToSinglePost",
    "addProfileHeaderBlockButton",
    "renameAuthorLinks",
    "initializeTaggingPopover",
    "applyImageHiding",
    "manageImageToggleAllButtons",
    "applyImageSizeLimits",
    "applyImageViewerBehavior",
    "applyNuxDarkTextContrastFix",
    "applyPlainTextUrlAutolinks",
    "attachReadingProgress",
    "applyGlobalLinkBehavior",
    "ensureMyThreadsQuickLink",
  ]);
  assert.strictEqual(calls[0][1][0], threadRow);
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUsersPostsInTables")[1][0],
    postTable
  );
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserQuotes")[1][0],
    quoteScope
  );

  calls.length = 0;
  const scopedFallbackOutcome = projection.project({
    ...baseEvent,
    refresh: {
      ...baseEvent.refresh,
      notifications: false,
    },
    scopeSafety: {
      quoteOverflow: true,
      ratingsOverflow: true,
    },
  });
  assert.deepStrictEqual(toPlainObject(scopedFallbackOutcome), {
    type: "mutation",
    mode: "fallback-scoped",
  });
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserQuotes")[1][0],
    postTable,
    "quote scope 不安全时应回退到 post scope。"
  );
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserRatings")[1][0],
    postTable,
    "ratings scope 不安全时应回退到 post scope。"
  );

  calls.length = 0;
  const notificationFallbackOutcome = projection.project({
    ...baseEvent,
    refresh: {
      ...baseEvent.refresh,
      quotes: false,
      ratings: false,
    },
    scopeSafety: {
      notificationOverflow: true,
    },
  });
  assert.deepStrictEqual(toPlainObject(notificationFallbackOutcome), {
    type: "mutation",
    mode: "fallback-full",
  });
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserNotifications")[1],
    null,
    "notification scope 不安全时只能回退到 null 全量语义。"
  );

  calls.length = 0;
  const unsafeOutcome = projection.project({
    ...baseEvent,
    scopeSafety: {
      threadRequiresFull: true,
      postRequiresFull: true,
      quoteOverflow: true,
      ratingsOverflow: true,
      notificationOverflow: true,
    },
  });
  assert.deepStrictEqual(toPlainObject(unsafeOutcome), {
    type: "mutation",
    mode: "fallback-full",
  });
  assert.deepStrictEqual(names(calls).slice(0, 10), [
    "hideBlockedThreads",
    "hideThreadsByTitleKeyword",
    "addBlockButtonsToThreads",
    "applyUserThreadBlocklist",
    "addProgressJumpButtons",
    "hideBlockedUsersPosts",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
    "hideBlockedUserNotifications",
    "hideBlockedPosts",
  ]);
  assert.equal(names(calls).includes("addActionsToPostFooter"), true);
  assert.equal(
    names(calls).includes("hideBlockedUsersPostsInTables"),
    false
  );
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserQuotes")[1],
    null
  );
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserRatings")[1],
    null
  );
  assert.strictEqual(
    calls.find(([name]) => name === "hideBlockedUserNotifications")[1],
    null
  );

  calls.length = 0;
  const forcedOutcome = projection.project({
    ...baseEvent,
    forceFull: true,
    refresh: { ...baseEvent.refresh, navbar: true },
  });
  assert.deepStrictEqual(toPlainObject(forcedOutcome), {
    type: "mutation",
    mode: "full",
  });
  assert.deepStrictEqual(names(calls).slice(0, 3), [
    "logNavbarReset",
    "initializeNavbar",
    "manageFloatingControls",
  ]);
};

const testSettingsProjectionReusesSettingsSemantics = () => {
  const { projection, calls } = createProjectionHarness();
  const settings = settingsWith({
    syncShowTitleSyncStatus: true,
    imageViewerDefaultZoomScalePercent: 75,
  });
  const targeted = projection.project({
    type: "settings",
    changedPaths: [
      "syncShowTitleSyncStatus",
      "imageViewerDefaultZoomScalePercent",
    ],
    settings,
    origin: "cross_tab",
  });
  assert.deepStrictEqual(toPlainObject(targeted), {
    type: "settings",
    mode: "targeted",
  });
  assert.deepStrictEqual(names(calls), [
    "initializeNavbar",
    "refreshTitleSyncStatus",
    "imageViewerDefaultTransform",
  ]);
  assert.equal(calls[1][1], "settings_changed");
  assert.equal(names(calls).includes("updateNavbarSyncButton"), false);

  calls.length = 0;
  projection.project({
    type: "settings",
    changedPaths: ["openInNewTab.progress"],
    settings: settingsWith(),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(names(calls), [
    "applyGlobalLinkBehavior",
    "removeProgressJumpButtons",
    "addProgressJumpButtons",
    "markRuntimeSnapshot",
  ]);

  const crossTabHarness = createProjectionHarness({ isThreadListPage: true });
  crossTabHarness.projection.project({
    type: "settings",
    changedPaths: ["openInNewTab.progress"],
    settings: settingsWith(),
    origin: "cross_tab",
  });
  assert.deepStrictEqual(names(crossTabHarness.calls), [
    "applyGlobalLinkBehavior",
    "scheduleProgressJumpButtonsRefresh",
  ]);
  crossTabHarness.calls.length = 0;
  crossTabHarness.projection.project({
    type: "settings",
    changedPaths: ["showReadIndicator"],
    settings: settingsWith({ showReadIndicator: false }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(names(crossTabHarness.calls), [
    "clearReadIndicator",
    "markRuntimeSnapshot",
  ]);

  calls.length = 0;
  const modalFeature = projection.project({
    type: "settings",
    changedPaths: ["enablePostBlocking"],
    settings: settingsWith({ enablePostBlocking: false }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(toPlainObject(modalFeature), {
    type: "settings",
    mode: "targeted-feature",
  });
  assert.deepStrictEqual(names(calls), [
    "removeBlockButtonsFromThreads",
    "refreshPostActions",
    "showBlockedPosts",
    "markRuntimeSnapshot",
  ]);

  calls.length = 0;
  const disabledReadProgress = projection.project({
    type: "settings",
    changedPaths: ["enableReadProgress"],
    settings: settingsWith({ enableReadProgress: false }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(toPlainObject(disabledReadProgress), {
    type: "settings",
    mode: "targeted-feature",
  });
  assert.deepStrictEqual(names(calls), [
    "removeProgressJumpButtons",
    "clearReadIndicator",
    "resetReadingProgress",
    "markRuntimeSnapshot",
  ]);

  calls.length = 0;
  const full = projection.project({
    type: "settings",
    changedPaths: ["futureSetting"],
    settings: settingsWith(),
    origin: "cross_tab",
  });
  assert.deepStrictEqual(toPlainObject(full), {
    type: "settings",
    mode: "full",
  });
  assert.deepStrictEqual(names(calls).slice(0, 2), [
    "initializeNavbar",
    "manageFloatingControls",
  ]);
};

const testCoreDataProjectionOwnsIntentOrderAndEnablePolicy = () => {
  const { projection, calls } = createProjectionHarness({
    isThreadListPage: true,
  });
  const allIntents = [
    "thread_actions",
    "title_filter_rules",
    "read_progress",
    "blocked_posts",
    "blocked_users",
    "blocked_threads",
  ];
  const outcome = projection.project({
    type: "core-data",
    settings: settingsWith(),
    intents: allIntents,
  });
  assert.deepStrictEqual(toPlainObject(outcome), {
    type: "core-data",
    mode: "targeted",
  });
  assert.deepStrictEqual(names(calls), [
    "hideBlockedThreads",
    "applyUserThreadBlocklist",
    "hideThreadsByTitleKeyword",
    "restoreManagedVisibility",
    "hideBlockedUsersPosts",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
    "hideBlockedUserNotifications",
    "applyUserThreadBlocklist",
    "restoreManagedVisibility",
    "hideBlockedPosts",
    "scheduleProgressJumpButtonsRefresh",
    "hideThreadsByTitleKeyword",
    "refreshPostActions",
  ]);

  calls.length = 0;
  projection.project({
    type: "core-data",
    settings: settingsWith({
      enablePostBlocking: false,
      enableUserBlocking: false,
      enableUserTagging: false,
      enableBookmarkReplies: false,
    }),
    intents: allIntents,
  });
  assert.deepStrictEqual(names(calls), [
    "restoreManagedVisibility",
    "clearKeywordHiddenThreads",
    "restoreManagedVisibility",
    "hideBlockedUserQuotes",
    "hideBlockedUserRatings",
    "hideBlockedUserNotifications",
    "restoreManagedVisibility",
    "scheduleProgressJumpButtonsRefresh",
    "clearKeywordHiddenThreads",
  ]);

  const postHarness = createProjectionHarness({
    isThreadListPage: false,
    hasPostTables: true,
  });
  postHarness.projection.project({
    type: "core-data",
    settings: settingsWith(),
    intents: ["read_progress"],
  });
  assert.deepStrictEqual(names(postHarness.calls), [
    "attachReadingProgress",
    "refreshReadIndicatorFromProgress",
  ]);

  const noPostHarness = createProjectionHarness({
    isThreadListPage: false,
    hasPostTables: false,
  });
  noPostHarness.projection.project({
    type: "core-data",
    settings: settingsWith(),
    intents: ["read_progress"],
  });
  assert.deepStrictEqual(noPostHarness.calls, []);
};

testFullProjectionOwnsOrderAndDisablePolicy();
testMutationProjectionChoosesScopedOrFullFallback();
testSettingsProjectionReusesSettingsSemantics();
testCoreDataProjectionOwnsIntentOrderAndEnablePolicy();

console.log("Page Enhancement Projection behavior tests passed.");
