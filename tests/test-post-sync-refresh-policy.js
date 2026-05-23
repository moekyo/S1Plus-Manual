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
    /const handlePerLoadSyncCheck = async[\s\S]*?applyRefreshPolicyForSyncResult\(result,\s*\{[\s\S]*?reason:\s*"per_load_auto_pull"/m,
    "Phase 7 未将每次加载同步成功接入刷新策略。"
  );
  expectMatch(
    /const handleBackgroundAutoSyncResult = async[\s\S]*?applyRefreshPolicyForSyncResult\(result,\s*\{[\s\S]*?reason:\s*result\.action === "merged_read_progress"[\s\S]*?"background_auto_pull"/m,
    "Phase 7 未将后台自动同步成功接入刷新策略。"
  );
  expectMatch(
    /const handleBackgroundAutoSyncResult = async[\s\S]*?suppressMessage:\s*!decision\.shouldNotify[\s\S]*?getSameDeviceRefreshMessageOptions\(result\)/m,
    "后台自动同步结果未通过决策函数区分 same-session 静默与 same-device 文案。"
  );
  expectMatch(
    /const mergeReadProgressAndPush = async[\s\S]*?const result = asSuccessResult\(\s*"merged_read_progress",\s*\{\s*contentHash:\s*mergedContentHash,\s*remoteUpdatedAt:\s*pushResult\?\.updatedAt \|\| null,\s*\},\s*\{[\s\S]*?reason:\s*mergeReason[\s\S]*?\.\.\.recentRemoteWriteResultContext[\s\S]*?appliedRemoteWriter:\s*pushResult\?\.writerMetadata \|\| null[\s\S]*?\}\s*\)/m,
    "merged_read_progress 结果必须把 same-session / same-device 写入上下文放到 extraResult，提示层才能读取。"
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

  const mergedListPlan = hooks.getAutoPullRefreshPlan({
    document: createQueryDocument({ hasThreadList: true }),
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    action: "merged_read_progress",
  });
  assert.equal(mergedListPlan.policy, "read_progress_merged_inline");
  assert.equal(mergedListPlan.pageType, "lightweight_list");
  assert.equal(mergedListPlan.shouldReload, false);
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
    showMessage: (message, isSuccess, options = {}) => {
      messages.push({ message, isSuccess, options });
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
  assert.equal(result.reloadSchedule.reloadDelayMs, 3200);
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0].message,
    "检测到云端备份比当前页面更新，已自动拉取到本地。正在刷新页面..."
  );
  assert.equal(messages[0].isSuccess, true);
  assert.equal(
    messages[0].options.durationMs,
    3800,
    "自动拉取刷新前的 toast 应至少覆盖完整刷新等待窗口，避免提示刚出现就被刷新打断。"
  );
  assert.ok(scheduledTimer, "列表页应当调度自动刷新。");
  assert.equal(scheduledTimer.delay, 3200);

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

  assert.equal(result.policy, "read_progress_merged_inline");
  assert.equal(result.pageType, "thread_detail");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(timerScheduled, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /已保留本地阅读进度并完成自动合并/);
  assert.doesNotMatch(messages[0].message, /正在刷新页面/);
  assert.equal(messages[0].isSuccess, null);
};

const testSuppressMessageKeepsReadProgressMergeQuietAndInline = () => {
  const { hooks } = createHarness();
  hooks.clearPendingAutoPullReloadTimer();

  const messages = [];
  let scheduledTimer = null;
  let inlineRefreshCount = 0;
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
    refreshReadProgressList: () => {
      inlineRefreshCount += 1;
    },
    locationObject: {
      reload: noop,
    },
  });

  assert.equal(result.policy, "read_progress_merged_inline");
  assert.equal(result.reloadSchedule.status, "suppressed");
  assert.equal(result.reloadSchedule.reason, "read_progress_merged_inline");
  assert.equal(result.inlineRefresh.status, "scheduled");
  assert.deepStrictEqual(messages, []);
  assert.equal(inlineRefreshCount, 1);
  assert.equal(scheduledTimer, null, "阅读进度自动合并不应再调度整页刷新。");
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

const testSameDeviceBackgroundMergedCopyUsesSpecificMessage = () => {
  const { hooks } = createHarness();

  const messages = hooks.getAutoPullRefreshMessagesForSource(
    "background",
    "merged_read_progress",
    {
      sameDeviceDeviceId: "Mac-Main",
    }
  );

  assert.match(
    messages.reloadMessage,
    /后台自动同步检测到同设备「Mac-Main」已同步更新，已保留本地阅读进度并完成自动合并/
  );
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

const testSameMachineDecisionSuppressesListReload = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "pulled",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_write");
  assert.equal(decision.refreshPlan.policy, "same_machine_suppressed");
};

const testMergedReadProgressDecisionUsesInlineRefresh = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "merged_read_progress",
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "read_progress_merged_inline");
  assert.equal(decision.refreshPlan.policy, "read_progress_merged_inline");
};

const testSameMachineMergedReadProgressKeepsInlineRefresh = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "merged_read_progress",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "background",
      document: createQueryDocument({ hasThreadList: true }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_read_progress_merged");
  assert.equal(decision.refreshPlan.policy, "read_progress_merged_inline");
};

const testDirtySettingsDecisionWinsOverSameMachineSuppression = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "pulled",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "daily_startup",
      document: createQueryDocument({
        hasThreadList: true,
        hasDirtySettings: true,
      }),
      href: "https://stage1st.com/2b/forum-1-1.html",
      search: "",
    }
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, true);
  assert.equal(decision.suppressMessage, false);
  assert.equal(decision.reason, "settings_dirty");
  assert.equal(decision.refreshPlan.policy, "settings_dirty");
};

const testSameMachineNoChangeDecisionSuppressesDailyToast = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "no_change",
      sameDeviceRemoteWrite: true,
    },
    {
      source: "daily_startup",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_write");
  assert.equal(decision.refreshPlan.policy, "same_machine_suppressed");
};

const testForegroundSameMachineNoChangeKeepsSpecificReason = () => {
  const { hooks } = createHarness();

  const decision = hooks.decideWhatToDoWithRemoteChange(
    {
      status: "success",
      action: "no_change",
      sameDeviceRemoteWrite: true,
      foregroundRefreshSuppressReason: "same_machine_hash_equal",
    },
    {
      source: "foreground",
      remoteChangeKind: "same_device_write",
    }
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.shouldReload, false);
  assert.equal(decision.shouldNotify, false);
  assert.equal(decision.reason, "same_machine_hash_equal");
  assert.equal(decision.refreshPlan.policy, "foreground_probe_suppressed");
  assert.equal(
    decision.refreshPlan.reloadSchedule.reason,
    "same_machine_hash_equal"
  );
};

const main = async () => {
  testStaticWiring();
  testRefreshPlanDetection();
  testListPageSchedulesReload();
  testThreadPageShowsSoftPromptOnly();
  testMergedReadProgressThreadUsesMergeCopy();
  testSuppressMessageKeepsReadProgressMergeQuietAndInline();
  testSameDeviceBackgroundCopyUsesSpecificMessage();
  testSameDeviceBackgroundMergedCopyUsesSpecificMessage();
  testDirtySettingsSuppressesReload();
  testSameMachineDecisionSuppressesListReload();
  testMergedReadProgressDecisionUsesInlineRefresh();
  testSameMachineMergedReadProgressKeepsInlineRefresh();
  testDirtySettingsDecisionWinsOverSameMachineSuppression();
  testSameMachineNoChangeDecisionSuppressesDailyToast();
  testForegroundSameMachineNoChangeKeepsSpecificReason();
  console.log("Phase 7 post-sync refresh policy checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
