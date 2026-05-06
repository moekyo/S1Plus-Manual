#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY =
  "s1p_background_sync_debounce_state";

const TITLE_SYNC_STATUS_REQUIRED_HOOKS = [
  "getTitleSyncStatusTestConstants",
  "composeDocumentTitle",
  "stripLastAppliedTitleSyncStatusPrefix",
  "getTitleSyncStatusPrefixForPhase",
  "isTitleSyncStatusForegroundTab",
  "shouldWriteCurrentTitleSyncStatusPresence",
  "resolveTitleSyncStatusTabDisplayDecision",
  "hasEnabledTitleSyncStatusPath",
  "getTitleSyncStatusRuntimeStateForTest",
];

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage:
      "S1Plus.js did not expose title sync status test hooks.",
  });

const requireHook = (hooks, hookName) => {
  assert.equal(
    typeof hooks[hookName],
    "function",
    [
      `Title sync status hook is not implemented/exposed yet: ${hookName}`,
      "This is the expected red state for Phase A before Phase B+ implementation.",
    ].join("\n")
  );
  return hooks[hookName];
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const expectNotMatch = (pattern, message) => {
  assert.doesNotMatch(sourceCode, pattern, message);
};

const getTitleSyncStatusSource = () => {
  const match = sourceCode.match(
    /let interfaceTitleBaseCache[\s\S]*?\/\/ --- 界面定制功能 ---/
  );
  assert.ok(match, "未能定位标题同步状态实现区块。");
  return match[0];
};

const createReadySettings = (overrides = {}) => ({
  syncRemoteEnabled: true,
  syncDailyFirstLoad: true,
  syncPerLoadCheckEnabled: false,
  syncCheckOnReturnToForeground: false,
  syncAutoEnabled: true,
  syncShowAutoSyncIndicator: true,
  syncShowTitleSyncStatus: true,
  ...overrides,
});

const createResolvedState = (phase, timestamp = Date.now()) => ({
  phase,
  timestamp,
  token: `test_${phase}_${timestamp}`,
  source: "background_push",
  reason: `test_${phase}`,
  lastResolvedPhase: phase === "running" || phase === "pending" ? "idle" : phase,
  lastResolvedTimestamp: timestamp,
  lastResolvedSource: "background_push",
  lastResolvedReason: `test_${phase}`,
});

const createUnifiedDisplayState = (
  displayPhase,
  timestamp = Date.now(),
  overrides = {}
) => ({
  ...createResolvedState(displayPhase, timestamp),
  displayPhase,
  displaySource: "background_push",
  displayReason: `test_${displayPhase}`,
  ...overrides,
});

const createTab = ({
  tabId,
  createdAt,
  lastSeen,
  visibilityState = "hidden",
  hasFocus = false,
  isForeground,
} = {}) => ({
  tabId,
  createdAt,
  lastSeen,
  visibilityState,
  hasFocus,
  isForeground:
    typeof isForeground === "boolean"
      ? isForeground
      : visibilityState === "visible" && hasFocus === true,
});

const assertDisplayDecision = (actual, expected, message) => {
  assert.deepEqual(
    {
      shouldDisplay: Boolean(actual.shouldDisplay),
      shouldRunAnimationTimer: Boolean(actual.shouldRunAnimationTimer),
      ownerTabId: actual.ownerTabId || "",
      displayPhase: actual.displayPhase || "",
      prefix: actual.prefix || "",
      hasForegroundTab: Boolean(actual.hasForegroundTab),
    },
    expected,
    message
  );
};

const testTitleComposition = () => {
  const { hooks } = createHarness();
  const composeDocumentTitle = requireHook(hooks, "composeDocumentTitle");
  const stripLastAppliedTitleSyncStatusPrefix = requireHook(
    hooks,
    "stripLastAppliedTitleSyncStatusPrefix"
  );
  const titleBase = "Stage1st - Some Thread";
  const suffix = " - STAGE1st";

  assert.equal(
    composeDocumentTitle({
      prefix: "",
      titleBase,
      suffix,
    }),
    "Stage1st - Some Thread - STAGE1st",
    "无同步状态时应保留原始标题和自定义后缀。"
  );
  assert.equal(
    composeDocumentTitle({
      prefix: "[同步中.]",
      titleBase,
      suffix,
    }),
    "[同步中.] Stage1st - Some Thread - STAGE1st",
    "running 状态应把同步前缀放在标题开头。"
  );
  assert.equal(
    composeDocumentTitle({
      prefix: "[同步成功]",
      titleBase,
      suffix,
    }),
    "[同步成功] Stage1st - Some Thread - STAGE1st",
    "success 状态应组合成功前缀。"
  );
  assert.equal(
    composeDocumentTitle({
      prefix: "[同步失败]",
      titleBase,
      suffix,
    }),
    "[同步失败] Stage1st - Some Thread - STAGE1st",
    "failure 状态应组合失败前缀。"
  );
  assert.equal(
    composeDocumentTitle({
      prefix: "[冲突]",
      titleBase,
      suffix,
    }),
    "[冲突] Stage1st - Some Thread - STAGE1st",
    "conflict 状态应组合冲突前缀。"
  );

  const firstTitle = composeDocumentTitle({
    prefix: "[同步成功]",
    titleBase,
    suffix,
  });
  const strippedTitle = stripLastAppliedTitleSyncStatusPrefix(
    firstTitle,
    "[同步成功]"
  );
  const nextTitle = composeDocumentTitle({
    prefix: "[同步失败]",
    titleBase: strippedTitle.replace(suffix, ""),
    suffix: " - New Suffix",
  });

  assert.equal(
    strippedTitle,
    "Stage1st - Some Thread - STAGE1st",
    "刷新标题前应能剥离上一次添加的同步状态前缀。"
  );
  assert.equal(
    nextTitle,
    "[同步失败] Stage1st - Some Thread - New Suffix",
    "自定义标题后缀更新后，同步前缀仍应按当前状态正确组合。"
  );
  assert.doesNotMatch(
    nextTitle,
    /\[同步成功\].*\[同步失败\]|\[同步失败\].*\[同步成功\]/,
    "重复刷新不应叠加多个同步状态前缀。"
  );
};

const testStatusPrefixMapping = () => {
  const { hooks } = createHarness();
  const getPrefix = requireHook(hooks, "getTitleSyncStatusPrefixForPhase");

  assert.equal(getPrefix("idle"), "", "idle 不应显示标题前缀。");
  assert.equal(getPrefix("pending"), "", "pending 不应显示标题前缀。");
  assert.equal(
    getPrefix("running", { animationFrame: 0 }),
    "[同步中.]",
    "running 第 1 帧应显示 [同步中.]。"
  );
  assert.equal(
    getPrefix("running", { animationFrame: 1 }),
    "[同步中..]",
    "running 第 2 帧应显示 [同步中..]。"
  );
  assert.equal(
    getPrefix("running", { animationFrame: 2 }),
    "[同步中...]",
    "running 第 3 帧应显示 [同步中...]。"
  );
  assert.equal(getPrefix("success"), "[同步成功]");
  assert.equal(getPrefix("failure"), "[同步失败]");
  assert.equal(getPrefix("conflict"), "[冲突]");
};

const testUnifiedStateMappingAndTtl = () => {
  const { hooks, store } = createHarness();
  const getPrefix = requireHook(hooks, "getTitleSyncStatusPrefixForPhase");
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const now = Date.now();

  assert.equal(constants.TITLE_SYNC_STATUS_ANIMATION_INTERVAL_MS, 500);
  assert.equal(constants.TITLE_SYNC_STATUS_SUCCESS_TTL_MS, 2 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_FAILURE_TTL_MS, 5 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_CONFLICT_TTL_MS, 10 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_UNIFIED_STATE_DEBOUNCE_MS, 100);

  const idleState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(createResolvedState("idle", now))
  );
  assert.equal(idleState.displayPhase, "idle");
  assert.equal(getPrefix(idleState.displayPhase), "");

  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 1,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30 * 1000,
    dueAt: now + 20 * 1000,
    maxWaitUntil: now + 60 * 1000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { read_progress: 1 },
    threadIds: ["123"],
    reason: "debounced_read_progress",
  });
  const pendingState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(createResolvedState("success", now))
  );
  assert.equal(pendingState.displayPhase, "pending");
  assert.equal(
    getPrefix(pendingState.displayPhase),
    "",
    "shared scheduler pending 只消费统一状态源，但标题层不显示 pending 前缀。"
  );
  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);

  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 60 * 1000,
  });
  const runningState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(createResolvedState("success", now))
  );
  assert.equal(runningState.displayPhase, "running");
  assert.equal(getPrefix(runningState.displayPhase, { animationFrame: 0 }), "[同步中.]");
  store.delete("s1p_sync_global_lock");

  [
    ["success", constants.TITLE_SYNC_STATUS_SUCCESS_TTL_MS, "[同步成功]"],
    ["failure", constants.TITLE_SYNC_STATUS_FAILURE_TTL_MS, "[同步失败]"],
    ["conflict", constants.TITLE_SYNC_STATUS_CONFLICT_TTL_MS, "[冲突]"],
  ].forEach(([phase, ttlMs, expectedPrefix]) => {
    const activeState = toPlainObject(
      hooks.resolveAutoSyncIndicatorDisplayPhase(
        createResolvedState(phase, now - ttlMs + 50)
      )
    );
    assert.equal(activeState.displayPhase, phase);
    assert.equal(getPrefix(activeState.displayPhase), expectedPrefix);

    const expiredState = toPlainObject(
      hooks.resolveAutoSyncIndicatorDisplayPhase(
        createResolvedState(phase, now - ttlMs - 50)
      )
    );
    assert.equal(
      expiredState.displayPhase,
      "idle",
      `${phase} 超过统一状态源 TTL 后应恢复 idle。`
    );
    assert.equal(getPrefix(expiredState.displayPhase), "");
  });
};

const testMultiTabForegroundAndOwnerCoordination = () => {
  const { hooks } = createHarness();
  const isForegroundTab = requireHook(hooks, "isTitleSyncStatusForegroundTab");
  const decide = requireHook(hooks, "resolveTitleSyncStatusTabDisplayDecision");
  const now = Date.now();
  const settings = createReadySettings();
  const state = createUnifiedDisplayState("running", now);

  assert.equal(
    isForegroundTab({ visibilityState: "visible", hasFocus: true }),
    true,
    "visible 且 focused 才是前台 S1 标签页。"
  );
  assert.equal(
    isForegroundTab({ visibilityState: "visible", hasFocus: false }),
    false,
    "visible 但 document.hasFocus() 为 false 时应视为后台。"
  );
  assert.equal(
    isForegroundTab({ visibilityState: "hidden", hasFocus: false }),
    false,
    "hidden 标签页应视为后台。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: [
        createTab({
          tabId: "tab-a",
          createdAt: now,
          lastSeen: now,
          visibilityState: "visible",
          hasFocus: true,
        }),
      ],
      state,
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: true,
    },
    "单个 S1 标签页在前台时不应显示标题同步状态。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: [
        createTab({
          tabId: "tab-a",
          createdAt: now,
          lastSeen: now,
          visibilityState: "hidden",
          hasFocus: false,
        }),
      ],
      state,
      settings,
      now,
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: true,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "[同步中.]",
      hasForegroundTab: false,
    },
    "单个 S1 标签页在后台时，负责人可以显示 running 动画。"
  );

  const multiTabs = [
    createTab({
      tabId: "tab-a",
      createdAt: now - 2_000,
      lastSeen: now,
      visibilityState: "hidden",
      hasFocus: false,
    }),
    createTab({
      tabId: "tab-b",
      createdAt: now - 1_000,
      lastSeen: now,
      visibilityState: "hidden",
      hasFocus: false,
    }),
  ];
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: multiTabs,
      state,
      settings,
      now,
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: true,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "[同步中.]",
      hasForegroundTab: false,
    },
    "所有 S1 标签页都在后台时，createdAt 最早的负责人显示标题状态。"
  );
  assertDisplayDecision(
    decide({
      currentTabId: "tab-b",
      tabs: multiTabs,
      state,
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: false,
    },
    "非负责人标签页不显示前缀，也不启动动画 timer。"
  );

  const foregroundTabs = [
    multiTabs[0],
    createTab({
      tabId: "tab-b",
      createdAt: now - 1_000,
      lastSeen: now,
      visibilityState: "visible",
      hasFocus: true,
    }),
  ];
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: foregroundTabs,
      state,
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: true,
    },
    "多个 S1 标签页中任意一个前台时，所有标题状态都隐藏。"
  );
};

const testPresenceTtlOwnerLeaseAndForegroundTtlPause = () => {
  const { hooks } = createHarness();
  const decide = requireHook(hooks, "resolveTitleSyncStatusTabDisplayDecision");
  const shouldWritePresence = requireHook(
    hooks,
    "shouldWriteCurrentTitleSyncStatusPresence"
  );
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const now = Date.now();
  const settings = createReadySettings();

  assert.equal(constants.TITLE_SYNC_STATUS_PRESENCE_TTL_MS, 2 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_PRESENCE_REFRESH_MIN_MS, 40 * 1000);
  assert.ok(
    constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS >= 20 * 1000 &&
      constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS <= 30 * 1000,
    "owner lease should stay in the recommended 20s-30s range."
  );

  const previousPresence = createTab({
    tabId: "tab-a",
    createdAt: now - 1_000,
    lastSeen: now,
    visibilityState: "hidden",
    hasFocus: false,
  });
  assert.equal(
    shouldWritePresence({
      previousTabRecord: previousPresence,
      currentTabRecord: {
        ...previousPresence,
        lastSeen: now + constants.TITLE_SYNC_STATUS_HEARTBEAT_MS,
      },
      now: now + constants.TITLE_SYNC_STATUS_HEARTBEAT_MS,
    }),
    false,
    "heartbeat 内前后台状态未变且未到 presence 刷新间隔时，应跳过跨标签 presence 写入。"
  );
  assert.equal(
    shouldWritePresence({
      previousTabRecord: previousPresence,
      currentTabRecord: {
        ...previousPresence,
        lastSeen: now + 1_000,
        visibilityState: "visible",
        hasFocus: true,
        isForeground: true,
      },
      now: now + 1_000,
    }),
    true,
    "前后台状态变化时应立即写入 presence 通知其他标签。"
  );
  assert.equal(
    shouldWritePresence({
      previousTabRecord: previousPresence,
      currentTabRecord: {
        ...previousPresence,
        lastSeen: now + constants.TITLE_SYNC_STATUS_PRESENCE_REFRESH_MIN_MS + 1,
      },
      now: now + constants.TITLE_SYNC_STATUS_PRESENCE_REFRESH_MIN_MS + 1,
    }),
    true,
    "超过 presence 刷新间隔后应写入 lastSeen，避免存活标签被 TTL 误清理。"
  );
  assert.equal(
    shouldWritePresence({
      previousTabRecord: null,
      currentTabRecord: previousPresence,
      now,
    }),
    true,
    "首次 presence 记录必须写入。"
  );
  assert.equal(
    shouldWritePresence({
      previousTabRecord: null,
      remove: true,
      now,
    }),
    false,
    "释放不存在的 presence 记录时应跳过无效写入。"
  );
  assert.equal(
    shouldWritePresence({
      previousTabRecord: previousPresence,
      remove: true,
      now,
    }),
    true,
    "释放已存在的 presence 记录时必须写入删除。"
  );

  const staleOwnerTabs = [
    createTab({
      tabId: "tab-a",
      createdAt: now - 10_000,
      lastSeen: now - constants.TITLE_SYNC_STATUS_PRESENCE_TTL_MS - 1,
      visibilityState: "visible",
      hasFocus: true,
    }),
    createTab({
      tabId: "tab-b",
      createdAt: now - 1_000,
      lastSeen: now,
      visibilityState: "hidden",
      hasFocus: false,
    }),
  ];
  assertDisplayDecision(
    decide({
      currentTabId: "tab-b",
      tabs: staleOwnerTabs,
      state: createUnifiedDisplayState("success", now - 30 * 1000),
      settings,
      now,
      previousOwner: {
        tabId: "tab-a",
        leaseUntil: now - 1,
      },
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-b",
      displayPhase: "success",
      prefix: "[同步成功]",
      hasForegroundTab: false,
    },
    "超过 presence TTL 的前台残留标签页应被忽略，owner lease 过期后其他标签页应接管。"
  );

  const successTimestamp = now - 60 * 1000;
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: [
        createTab({
          tabId: "tab-a",
          createdAt: now,
          lastSeen: now + 30 * 1000,
          visibilityState: "visible",
          hasFocus: true,
        }),
      ],
      state: createUnifiedDisplayState("success", successTimestamp),
      settings,
      now: now + 30 * 1000,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "success",
      prefix: "",
      hasForegroundTab: true,
    },
    "切回前台只暂停标题显示，不应清除或重置统一状态源结果。"
  );
  const expiredSuccessState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(
      createResolvedState(
        "success",
        Date.now() - constants.TITLE_SYNC_STATUS_SUCCESS_TTL_MS - 50
      )
    )
  );
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: [
        createTab({
          tabId: "tab-a",
          createdAt: now,
          lastSeen: now + 130 * 1000,
          visibilityState: "hidden",
          hasFocus: false,
        }),
      ],
      state: expiredSuccessState,
      settings,
      now: Date.now(),
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "idle",
      prefix: "",
      hasForegroundTab: false,
    },
    "前后台切换不应重置 success TTL，超过 2 分钟后应恢复原始标题。"
  );
};

const testDisplayPhaseOnlyAndNoTitleSchedulerRewrite = () => {
  const { hooks, store } = createHarness();
  const decide = requireHook(hooks, "resolveTitleSyncStatusTabDisplayDecision");
  const now = Date.now();
  const settings = createReadySettings();
  const hiddenOwnerTab = [
    createTab({
      tabId: "tab-a",
      createdAt: now,
      lastSeen: now,
      visibilityState: "hidden",
      hasFocus: false,
    }),
  ];

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: {},
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "idle",
      prefix: "",
      hasForegroundTab: false,
    },
    "缺少 displayPhase 的空统一状态应显式回落为 idle。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: createResolvedState("success", now),
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "idle",
      prefix: "",
      hasForegroundTab: false,
    },
    "标题层不应从原始 phase 自行推导状态，只消费统一状态源暴露的 displayPhase。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: {
        ...createResolvedState("success", now),
        displayPhase: "pending",
        displaySource: "background_push",
        displayReason: "debounced_read_progress",
      },
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "pending",
      prefix: "",
      hasForegroundTab: false,
    },
    "success -> pending 的稳定结果应来自统一 displayPhase，标题层只按 pending 映射为空前缀。"
  );

  store.set(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY, {
    version: 1,
    generation: 2,
    ownerTabId: "tab-a",
    ownerLeaseUntil: now + 30 * 1000,
    dueAt: now + 10 * 1000,
    maxWaitUntil: now + 60 * 1000,
    firstDirtyAt: now,
    lastDirtyAt: now,
    maxLastModified: now,
    sources: { settings: 1 },
    threadIds: [],
    reason: "debounced_local_change",
  });
  const unifiedPendingState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(createResolvedState("success", now))
  );
  assert.equal(unifiedPendingState.displayPhase, "pending");
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: unifiedPendingState,
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "pending",
      prefix: "",
      hasForegroundTab: false,
    },
    "shared debounce 的标题表现应来自统一状态源的 pending display phase。"
  );

  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: now,
    ttlMs: 60 * 1000,
  });
  const unifiedRunningState = toPlainObject(
    hooks.resolveAutoSyncIndicatorDisplayPhase(createResolvedState("success", now))
  );
  assert.equal(unifiedRunningState.displayPhase, "running");
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: unifiedRunningState,
      settings,
      now,
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: true,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "[同步中.]",
      hasForegroundTab: false,
    },
    "running -> success 的稳定结果应来自统一 displayPhase，标题层不额外裁决。"
  );

  const titleSource = getTitleSyncStatusSource();
  assert.match(
    titleSource,
    /const resolvedState = resolveAutoSyncIndicatorDisplayPhase\(\);/,
    "标题运行时应通过统一状态源获取 display phase。"
  );
  assert.match(
    titleSource,
    /setTimeout\(\s*flushTitleSyncStatusUnifiedStateChange,\s*TITLE_SYNC_STATUS_UNIFIED_STATE_DEBOUNCE_MS\s*\)/,
    "统一状态源通知应通过短 debounce 合并本地刷新和 fallback signal。"
  );
  assert.match(
    titleSource,
    /const shouldWriteCurrentTitleSyncStatusPresence = \(\{[\s\S]*TITLE_SYNC_STATUS_PRESENCE_REFRESH_MIN_MS/,
    "presence heartbeat 写入应通过刷新间隔和前后台签名判断减振。"
  );
  assert.match(
    titleSource,
    /const shouldWrite = shouldWriteCurrentTitleSyncStatusPresence\(\{/,
    "presence 写入路径应调用减振判断函数。"
  );
  assert.doesNotMatch(
    titleSource,
    /getBackgroundSyncDebounceState|BACKGROUND_SYNC_DEBOUNCE|requestForegroundRemoteSyncCheck|scheduleForegroundRemoteSyncRetry|getForegroundProbeGateBlockResult|getRemoteProbeSharedCooldown|performAutoSync|setAutoSyncIndicatorPendingState|setAutoSyncIndicatorResolvedPhase/,
    "标题层不应读取 shared debounce、foreground probe/retry/gate 或同步执行入口。"
  );
  assert.doesNotMatch(
    titleSource,
    /displayPhase\s*\|\|\s*(?:resolvedState|state|source)\.phase|(?:resolvedState|state|source)\.displayPhase\s*\|\|\s*(?:resolvedState|state|source)\.phase/,
    "标题层不应在缺少 displayPhase 时回退读取原始 phase。"
  );
};

const testSettingsDefaultsUiAndIndependence = () => {
  const { hooks } = createHarness();
  const hasEnabledTitleSyncStatusPath = requireHook(
    hooks,
    "hasEnabledTitleSyncStatusPath"
  );
  const { settings } = hooks.buildNormalizedSettings({});

  assert.equal(
    settings.syncShowTitleSyncStatus,
    false,
    "syncShowTitleSyncStatus 默认值应为 false。"
  );
  assert.equal(
    hasEnabledTitleSyncStatusPath(
      createReadySettings({ syncShowAutoSyncIndicator: false })
    ),
    true,
    "关闭导航栏同步状态开关不应影响标题同步状态。"
  );
  assert.equal(
    hasEnabledTitleSyncStatusPath(
      createReadySettings({ syncShowTitleSyncStatus: false })
    ),
    false,
    "关闭标题同步状态开关后，标题状态路径应禁用。"
  );
  assert.equal(
    hooks.hasEnabledAutoSyncIndicatorPath(
      createReadySettings({
        syncShowAutoSyncIndicator: true,
        syncShowTitleSyncStatus: false,
      })
    ),
    true,
    "关闭标题同步状态开关不应影响导航栏同步状态。"
  );
  assert.equal(
    hasEnabledTitleSyncStatusPath(
      createReadySettings({ syncRemoteEnabled: false })
    ),
    false,
    "关闭远程同步时，标题状态开关应整体不可用。"
  );

  expectMatch(
    /id="s1p-title-sync-status-subgroup"[\s\S]*for="s1p-show-title-sync-status-toggle">显示标签页标题同步状态/,
    "同步设置页状态显示区缺少标题同步状态开关。"
  );
  expectMatch(
    /开启后，仅当所有 S1 标签页都不在前台时，第一个标签页标题会在同步发生时显示状态提示（同步中\/成功\/失败\/冲突）/,
    "标题同步状态开关缺少指定说明文案。"
  );
  expectMatch(
    /titleSyncStatusToggle:\s*modal\.querySelector\("#s1p-show-title-sync-status-toggle"\)/,
    "标题同步状态开关未接入同步设置控件集合。"
  );
  expectMatch(
    /titleSyncStatusToggle\.disabled = !isEnabled;/,
    "远程同步关闭时，标题同步状态开关应置灰禁用。"
  );
  expectMatch(
    /#s1p-title-sync-status-subgroup\.is-disabled[\s\S]*opacity: 0\.5;[\s\S]*pointer-events: none;/,
    "标题同步状态子设置组缺少 disabled 视觉置灰样式。"
  );
  expectMatch(
    /syncShowTitleSyncStatus:\s*titleSyncStatusToggle\.checked/,
    "保存设置时未收集 syncShowTitleSyncStatus。"
  );
  expectMatch(
    /settingsSnapshot\.syncShowTitleSyncStatus === true/,
    "同步设置页未回填 syncShowTitleSyncStatus。"
  );
  expectMatch(
    /SETTINGS_CROSS_TAB_PASSIVE_PATHS[\s\S]*"syncShowTitleSyncStatus"/,
    "syncShowTitleSyncStatus 应参与设置跨标签同步刷新。"
  );
  expectNotMatch(
    /syncShowTitleSyncStatus[\s\S]{0,120}syncShowAutoSyncIndicator !== false|syncShowAutoSyncIndicator[\s\S]{0,120}syncShowTitleSyncStatus !== false/,
    "标题同步状态和导航栏同步状态不应互相作为启用前提。"
  );
};

const tests = [
  ["title composition", testTitleComposition],
  ["status prefix mapping", testStatusPrefixMapping],
  ["unified state mapping and ttl", testUnifiedStateMappingAndTtl],
  ["multi-tab foreground and owner coordination", testMultiTabForegroundAndOwnerCoordination],
  ["presence ttl, owner lease, foreground ttl pause", testPresenceTtlOwnerLeaseAndForegroundTtlPause],
  ["display phase only and no title scheduler rewrite", testDisplayPhaseOnlyAndNoTitleSchedulerRewrite],
  ["settings defaults, ui, and independence", testSettingsDefaultsUiAndIndependence],
];

let failed = 0;
for (const [name, testFn] of tests) {
  try {
    testFn();
    console.log(`[title-sync-status] PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[title-sync-status] FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

if (failed > 0) {
  console.error(
    `[title-sync-status] ${failed}/${tests.length} test groups failed.`
  );
  process.exitCode = 1;
} else {
  console.log("[title-sync-status] Title sync status behavior verified.");
}
