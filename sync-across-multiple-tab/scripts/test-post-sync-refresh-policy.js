#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
} = require("./s1plus-test-helpers");

const noop = () => {};

const createHarness = () => {
  return createBaseHarness({
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 7 测试钩子。",
  });
};

const createQueryDocument = ({
  hasThreadList = false,
  hasPostList = false,
  hasDirtySettings = false,
} = {}) => ({
  querySelector: (selector) => {
    if (
      selector === ".s1p-modal[data-s1p-settings-has-dirty-edits='true']"
    ) {
      return hasDirtySettings ? {} : null;
    }
    if (selector === "#postlist, #postlist table[id^='pid']") {
      return hasPostList ? {} : null;
    }
    if (
      selector ===
      "#threadlist, #threadlisttableid, tbody[id^='normalthread_'], tbody[id^='stickthread_']"
    ) {
      return hasThreadList ? {} : null;
    }
    return null;
  },
});

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testStaticWiring = () => {
  expectMatch(
    /const applyAutoPullRefreshPolicy = \(options = \{\}\) => \{/m,
    "Phase 7 未新增统一的自动拉取后刷新策略入口。"
  );
  expectMatch(
    /modal\.dataset\.s1pSettingsHasDirtyEdits = "true";/m,
    "Phase 7 未将设置弹窗脏状态暴露为可被同步逻辑检测的 DOM 标记。"
  );
  expectMatch(
    /const handlePerLoadSyncCheck = async[\s\S]*?applyRefreshPolicyForSyncResult\(result,\s*\{\s*reason:\s*"per_load_auto_pull"/m,
    "Phase 7 未将每次加载同步成功接入刷新策略。"
  );
  expectMatch(
    /const handleBackgroundAutoSyncResult = async[\s\S]*?applyRefreshPolicyForSyncResult\(result,\s*\{[\s\S]*?reason:\s*result\.action === "merged_read_progress"[\s\S]*?"background_auto_pull"/m,
    "Phase 7 未将后台自动同步成功接入刷新策略。"
  );
  expectMatch(
    /const handleBackgroundAutoSyncResult = async[\s\S]*?suppressMessage:\s*result\.sameSessionRemoteWrite === true[\s\S]*?getSameDeviceRefreshMessageOptions\(result\)/m,
    "后台自动同步结果未区分 same-session 静默与 same-device 文案。"
  );
  expectMatch(
    /refreshPlan = applyRefreshPolicyForSyncResult\(syncRequestResult,\s*\{[\s\S]*?reason:\s*`foreground_probe:\$\{normalizedReason\}`/m,
    "Phase 7 未将前台远端探测命中的 follow-up sync 接入刷新策略。"
  );
  expectMatch(
    /const createSameDeviceAutoPullRefreshMessages = \(\s*deviceId = "",\s*action = "pulled",\s*sourceLabel = ""\s*\) => \{/m,
    "未新增 same-device 自动拉取提示文案 helper。"
  );
};

const testRefreshPlanDetection = () => {
  const { hooks } = createHarness();

  const listPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
  });
  assert.equal(listPlan.policy, "reload_now");
  assert.equal(listPlan.pageType, "lightweight_list");
  assert.equal(listPlan.shouldReload, true);

  const threadPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
  });
  assert.equal(threadPlan.policy, "thread_soft_prompt");
  assert.equal(threadPlan.pageType, "thread_detail");
  assert.equal(threadPlan.shouldReload, false);

  const dirtyPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({
      hasThreadList: true,
      hasDirtySettings: true,
    }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
  });
  assert.equal(dirtyPlan.policy, "settings_dirty");
  assert.equal(dirtyPlan.pageType, "settings_modal");
  assert.equal(dirtyPlan.shouldReload, false);
};

const testListPageSchedulesReload = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let scheduledTimer = null;
  let reloadCount = 0;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: (callback, delay) => {
      scheduledTimer = { callback, delay };
      return 1;
    },
    locationObject: {
      reload: () => {
        reloadCount += 1;
      },
    },
  });

  assert.equal(result.policy, "reload_now");
  assert.equal(result.reloadSchedule.status, "scheduled");
  assert.equal(result.reloadSchedule.reloadDelayMs, 1500);
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0].message,
    "检测到云端备份比当前页面更新，已自动拉取到本地。正在刷新页面..."
  );
  assert.equal(messages[0].isSuccess, true);
  assert.ok(scheduledTimer, "列表页应当调度自动刷新。");
  assert.equal(scheduledTimer.delay, 1500);

  scheduledTimer.callback();
  assert.equal(reloadCount, 1);
  hooks.clearPendingAutoPullReloadTimer();
};

const testThreadPageShowsSoftPromptOnly = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "thread_soft_prompt");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /当前在帖子页，暂不自动刷新/);
  assert.equal(messages[0].isSuccess, null);
};

const testMergedReadProgressThreadUsesMergeCopy = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasPostList: true }),
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    action: "merged_read_progress",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "thread_soft_prompt");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /已保留本地阅读进度并完成自动合并/);
  assert.match(messages[0].message, /当前在帖子页，暂不自动刷新/);
  assert.equal(messages[0].isSuccess, null);
};

const testSuppressMessageKeepsReloadQuiet = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let scheduledTimer = null;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "merged_read_progress",
    suppressMessage: true,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: (callback, delay) => {
      scheduledTimer = { callback, delay };
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "reload_now");
  assert.equal(result.reloadSchedule.status, "scheduled");
  assert.equal(result.reloadSchedule.reloadDelayMs, 1500);
  assert.deepStrictEqual(messages, []);
  assert.ok(scheduledTimer, "静默处理仍应保留必要的自动刷新。");
  hooks.clearPendingAutoPullReloadTimer();
};

const testSameDeviceBackgroundCopyUsesSpecificMessage = () => {
  const { hooks } = createHarness();

  const messages = hooks.getAutoPullRefreshMessagesForSource("background", "pulled", {
    sameDeviceDeviceId: "Mac-Main",
  });

  assert.match(messages.reloadMessage, /后台自动同步检测到同设备「Mac-Main」已同步更新/);
  assert.match(messages.threadPageMessage, /当前在帖子页，暂不自动刷新/);
};

const testDirtySettingsSuppressesReload = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let timerScheduled = false;
  const result = hooks.applyAutoPullRefreshPolicy({
    document: createQueryDocument({
      hasThreadList: true,
      hasDirtySettings: true,
    }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "pulled",
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    setTimeoutFn: () => {
      timerScheduled = true;
      return 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "settings_dirty");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /未保存的设置编辑/);
  assert.equal(messages[0].isSuccess, null);
};

const main = async () => {
  testStaticWiring();
  testRefreshPlanDetection();
  testListPageSchedulesReload();
  testThreadPageShowsSoftPromptOnly();
  testMergedReadProgressThreadUsesMergeCopy();
  testSuppressMessageKeepsReloadQuiet();
  testSameDeviceBackgroundCopyUsesSpecificMessage();
  testDirtySettingsSuppressesReload();
  console.log("Phase 7 post-sync refresh policy checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
