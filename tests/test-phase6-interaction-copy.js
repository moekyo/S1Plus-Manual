#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
} = require("./s1plus-test-helpers");

const createHarness = () =>
  createBaseHarness({
    href: "https://stage1st.com/2b/thread-123-1-1.html",
    search: "",
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 6 交互文案测试钩子。",
  });

const testPersistentAlertUsesGlobalSyncLanguage = () => {
  const { hooks, store } = createHarness();
  store.set("s1p_auto_sync_conflict_pause", {
    paused: true,
    reason: "local_changed_during_sync",
    timestamp: 1760001000000,
  });

  const descriptor = hooks.getNavbarPersistentSyncAlertDescriptor();
  assert.ok(descriptor, "存在 conflict pause 时应生成常驻提示描述。");
  assert.equal(descriptor.actionLabel, "全局同步");
  assert.match(descriptor.text, /全局同步暂停/);
  assert.match(descriptor.title, /不是只处理当前帖子/);
  assert.match(descriptor.preflightLeadHtml, /全局手动同步/);
};

const testPreflightExplainsGlobalScopeAndCleanupContext = () => {
  const { hooks } = createHarness();

  const html = hooks.createManualSyncPreflightHtml({
    currentThreadId: "123",
    triggerDescriptor: {
      preflightLeadHtml:
        "自动同步期间检测到本地改动，已暂停自动拉取，等待一次全局手动同步来决定整套数据的去向。",
    },
    pendingCleanupInfo: {
      source: "manual_group_delete",
      deletedCount: 3,
      threadIds: ["999"],
      initiatedFromThreadId: "999",
      createdAt: 1760001000000,
    },
  });

  assert.match(html, /这不是只处理当前帖子/);
  assert.match(html, /云端变化、阅读进度，以及最近的 cleanup 删除来源/);
  assert.match(html, /来自当前帖子之外/);
};

const testComparisonHtmlKeepsRootCauseAndCleanupSeparate = () => {
  const { hooks } = createHarness();

  const html = hooks.createSyncComparisonHtml(
    {
      data: {
        users: {},
        threads: {},
        user_tags: {},
        bookmarked_replies: {},
        title_filter_rules: [],
        read_progress: {
          123: { page: "1", lastReadFloor: "10", postId: "1" },
        },
      },
      lastUpdated: 1760001000000,
    },
    {
      data: {
        users: {},
        threads: {},
        user_tags: {},
        bookmarked_replies: {},
        title_filter_rules: [],
        read_progress: {
          456: { page: "2", lastReadFloor: "20", postId: "2" },
        },
      },
      lastUpdated: 1760000900000,
    },
    false,
    {
      source: "manual_group_delete",
      deletedCount: 2,
      threadIds: ["999"],
      initiatedFromThreadId: "999",
      createdAt: 1760001000000,
    },
    {
      action: "push",
      localNewer: true,
    },
    {
      currentThreadId: "123",
      conflictPauseState: {
        paused: true,
        reason: "local_changed_during_sync",
        timestamp: 1760001000000,
      },
    }
  );

  assert.match(html, /原始触发原因/);
  assert.match(html, /另有 cleanup 记录/);
  assert.match(html, /不代表当前帖子发生了自动清理/);
};

const testAutoPullCopyExplainsCloudNewer = () => {
  const { hooks } = createHarness();

  const messages = hooks.getAutoPullRefreshMessagesForSource("background", "pulled");
  assert.equal(
    messages.reloadMessage,
    "后台自动同步发现云端备份较新，已自动拉取到本地。正在刷新页面..."
  );
  assert.equal(
    messages.threadPageMessage,
    "后台自动同步发现云端备份较新，已自动拉取到本地。当前在帖子页，暂不自动刷新。"
  );
};

(async () => {
  testPersistentAlertUsesGlobalSyncLanguage();
  testPreflightExplainsGlobalScopeAndCleanupContext();
  testComparisonHtmlKeepsRootCauseAndCleanupSeparate();
  testAutoPullCopyExplainsCloudNewer();

  console.log("[phase6-interaction-copy] Phase 6 interaction copy verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
