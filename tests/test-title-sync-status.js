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
const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";

const TITLE_SYNC_STATUS_REQUIRED_HOOKS = [
  "getTitleSyncStatusTestConstants",
  "composeDocumentTitle",
  "stripLastAppliedTitleSyncStatusPrefix",
  "getTitleSyncStatusPrefixForPhase",
  "isTitleSyncStatusForegroundTab",
  "isTitleSyncStatusLeaseWorthyPhase",
  "getTitleSyncStatusTabPresenceKey",
  "getTitleSyncStatusPresenceState",
  "shouldWriteCurrentTitleSyncStatusPresence",
  "writeCurrentTitleSyncStatusPresence",
  "resolveTitleSyncStatusTabDisplayDecision",
  "writeTitleSyncStatusOwnerLease",
  "releaseTitleSyncStatusOwnerLease",
  "maybeRefreshTitleSyncStatusOwnerLease",
  "hasEnabledTitleSyncStatusPath",
  "getTitleSyncStatusRuntimeStateForTest",
  "getSyncIndicatorStateProjectionTestConstants",
  "runTitleSyncStatusRuntimeSync",
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

const getProjectionSurfaces = (hooks) =>
  requireHook(hooks, "getSyncIndicatorStateProjectionTestConstants")();

const readNavbarProjection = (hooks, state = null) =>
  hooks.s1pSyncSystem.readState({
    surface: getProjectionSurfaces(hooks).SURFACE_NAVBAR,
    state,
  });

const readTitleProjection = (hooks, state = null) =>
  hooks.s1pSyncSystem.readState({
    surface: getProjectionSurfaces(hooks).SURFACE_TITLE,
    state,
  });

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

const setBackgroundSyncLocks = (store, constants, owner, timestamp = Date.now()) => {
  store.set(constants.BACKGROUND_SYNC_LOCK_KEY, {
    owner,
    timestamp,
  });
  store.set(constants.GLOBAL_SYNC_LOCK_KEY, {
    owner,
    mode: constants.SYNC_LOCK_MODE_BACKGROUND,
    timestamp,
    ttlMs: constants.BACKGROUND_SYNC_LOCK_TTL_MS,
  });
};

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
  lastActiveAt,
  syncOwnerId = "",
  visibilityState = "hidden",
  hasFocus = false,
  isForeground,
} = {}) => ({
  tabId,
  createdAt,
  lastSeen,
  lastActiveAt:
    typeof lastActiveAt === "number"
      ? lastActiveAt
      : visibilityState === "visible"
        ? lastSeen
        : 0,
  syncOwnerId,
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
  assert.equal(constants.AUTO_SYNC_INDICATOR_RUNNING_MIN_VISIBLE_MS, 650);
  assert.equal(constants.TITLE_SYNC_STATUS_SUCCESS_TTL_MS, 2 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_FAILURE_TTL_MS, 5 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_CONFLICT_TTL_MS, 10 * 60 * 1000);
  assert.equal(constants.TITLE_SYNC_STATUS_UNIFIED_STATE_DEBOUNCE_MS, 100);

  const idleState = toPlainObject(
    readTitleProjection(hooks, createResolvedState("idle", now))
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
    readTitleProjection(hooks, createResolvedState("success", now))
  );
  assert.equal(pendingState.displayPhase, "pending");
  assert.equal(
    getPrefix(pendingState.displayPhase),
    "",
    "shared scheduler pending 只消费统一状态源，但标题层不显示 pending 前缀。"
  );
  store.delete(BACKGROUND_SYNC_DEBOUNCE_STATE_KEY);

  setBackgroundSyncLocks(store, constants, constants.BACKGROUND_SYNC_OWNER_ID, now);
  const liveRunnerTitleState = toPlainObject(
    readTitleProjection(hooks, createResolvedState("success", now))
  );
  assert.equal(liveRunnerTitleState.displayPhase, "running");
  assert.equal(
    liveRunnerTitleState.displayLiveRunnerOwnerId,
    constants.BACKGROUND_SYNC_OWNER_ID,
    "Running Phase 标题状态必须标记当前 Live Runner owner。"
  );
  assert.equal(
    getPrefix(liveRunnerTitleState.displayPhase, { animationFrame: 0 }),
    "[同步中.]"
  );

  setBackgroundSyncLocks(store, constants, "closed-runner-tab", now);
  const ghostRunningTitleState = toPlainObject(
    readTitleProjection(hooks, createResolvedState("success", now))
  );
  assert.equal(
    ghostRunningTitleState.displayPhase,
    "idle",
    "Running Phase 不能只凭其它 tab 留下的新鲜锁在标题显示同步中。"
  );
  store.delete(constants.BACKGROUND_SYNC_LOCK_KEY);
  store.delete(constants.GLOBAL_SYNC_LOCK_KEY);

  const foregroundProbeRunningState = {
    ...createResolvedState("running", now),
    source: "foreground_resume",
    reason: "foreground_probe_in_flight",
    operation: "probe",
  };
  const navbarProbeState = toPlainObject(
    readNavbarProjection(hooks, foregroundProbeRunningState)
  );
  assert.equal(navbarProbeState.displayPhase, "running");
  assert.equal(navbarProbeState.displayOperation, "probe");
  assert.equal(navbarProbeState.displaySessionKind, "cloud_probe_session");

  const titleProbeState = toPlainObject(
    readTitleProjection(hooks, foregroundProbeRunningState)
  );
  assert.equal(
    titleProbeState.displayPhase,
    "idle",
    "纯前台云端探测不应让后台标签标题短暂显示同步中。"
  );
  assert.equal(getPrefix(titleProbeState.displayPhase), "");

  [
    ["success", constants.TITLE_SYNC_STATUS_SUCCESS_TTL_MS, "[同步成功]"],
    ["failure", constants.TITLE_SYNC_STATUS_FAILURE_TTL_MS, "[同步失败]"],
    ["conflict", constants.TITLE_SYNC_STATUS_CONFLICT_TTL_MS, "[冲突]"],
  ].forEach(([phase, ttlMs, expectedPrefix]) => {
    const activeState = toPlainObject(
      readTitleProjection(
        hooks,
        createResolvedState(phase, now - ttlMs + 50)
      )
    );
    assert.equal(activeState.displayPhase, phase);
    assert.equal(getPrefix(activeState.displayPhase), expectedPrefix);

    const expiredState = toPlainObject(
      readTitleProjection(
        hooks,
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
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const now = Date.now();
  const settings = createReadySettings();
  const liveRunnerOwnerId = "sync-owner-a";
  const state = createUnifiedDisplayState("running", now, {
    displayLiveRunnerOwnerId: liveRunnerOwnerId,
  });

  assert.equal(
    isForegroundTab({ visibilityState: "visible", hasFocus: true }),
    true,
    "visible 且 focused 才是前台 S1 标签页。"
  );
  assert.equal(
    isForegroundTab({ visibilityState: "visible", hasFocus: false }),
    false,
    "visible 但 document.hasFocus() 为 false 时，应按后台 S1 标签页处理。"
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
          syncOwnerId: liveRunnerOwnerId,
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
          syncOwnerId: liveRunnerOwnerId,
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
      lastActiveAt: now - 8_000,
      syncOwnerId: liveRunnerOwnerId,
      visibilityState: "hidden",
      hasFocus: false,
    }),
    createTab({
      tabId: "tab-b",
      createdAt: now - 1_000,
      lastSeen: now,
      lastActiveAt: now - 1_000,
      syncOwnerId: "sync-owner-b",
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
    "Running Phase 应优先 Live Runner，而不是最近离开的普通 Title Owner。"
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
    "非 Live Runner 即使更近活跃，也不能显示 Running Phase 标题。"
  );
  assertDisplayDecision(
    decide({
      currentTabId: "tab-b",
      tabs: multiTabs,
      state,
      settings,
      now,
      previousOwner: {
        tabId: "tab-b",
        leaseUntil: now + constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS,
      },
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: false,
    },
    "Running Phase 下，Live Runner 应覆盖普通 Title Owner 的有效 lease。"
  );

  const foregroundTabs = [
    multiTabs[0],
    createTab({
      tabId: "tab-b",
      createdAt: now - 1_000,
      lastSeen: now,
      lastActiveAt: now,
      syncOwnerId: "sync-owner-b",
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
    readTitleProjection(
      hooks,
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

const testResultPhaseHandoffAndRunningLiveRunnerBoundaries = () => {
  const { hooks, store } = createHarness();
  const decide = requireHook(hooks, "resolveTitleSyncStatusTabDisplayDecision");
  const maybeRefreshOwnerLease = requireHook(
    hooks,
    "maybeRefreshTitleSyncStatusOwnerLease"
  );
  const writePresence = requireHook(hooks, "writeCurrentTitleSyncStatusPresence");
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const now = Date.now();
  const settings = createReadySettings();
  const currentPresence = toPlainObject(
    writePresence({ reason: "init", force: true })
  );
  const currentTab = Object.values(currentPresence.tabs)[0];
  const currentTabId = currentTab.tabId;
  const staleOwner = {
    tabId: "closed-title-owner",
    leaseUntil: now + constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS,
    updatedAt: now,
    generation: 7,
  };

  store.set(constants.TITLE_SYNC_STATUS_OWNER_KEY, staleOwner);
  const successHandoffDecision = decide({
    currentTabId,
    tabs: [currentTab],
    state: createUnifiedDisplayState("success", now - 1000),
    settings,
    now,
    previousOwner: staleOwner,
  });
  assertDisplayDecision(
    successHandoffDecision,
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: false,
      ownerTabId: currentTabId,
      displayPhase: "success",
      prefix: "[同步成功]",
      hasForegroundTab: false,
    },
    "Result Phase 当前 Title Owner 关闭后，剩余 S1 tab 应能成为标题 owner。"
  );
  const refreshedOwner = toPlainObject(
    maybeRefreshOwnerLease(successHandoffDecision, now, {
      allowOwnerLeaseRefresh: false,
      reason: "presence_change",
    })
  );
  assert.equal(
    refreshedOwner.tabId,
    currentTabId,
    "Result Phase handoff 应允许 presence_change 路径显式刷新 owner lease。"
  );
  assert.equal(store.get(constants.TITLE_SYNC_STATUS_OWNER_KEY).tabId, currentTabId);

  [
    ["success", "[同步成功]"],
    ["failure", "[同步失败]"],
    ["conflict", "[冲突]"],
  ].forEach(([phase, prefix]) => {
    assertDisplayDecision(
      decide({
        currentTabId,
        tabs: [currentTab],
        state: createUnifiedDisplayState(phase, now - 500),
        settings,
        now,
      }),
      {
        shouldDisplay: true,
        shouldRunAnimationTimer: false,
        ownerTabId: currentTabId,
        displayPhase: phase,
        prefix,
        hasForegroundTab: false,
      },
      `Result Phase handoff 不应破坏普通 ${phase} 标题显示。`
    );
  });

  const ghostRunningDecision = decide({
    currentTabId,
    tabs: [currentTab],
    state: createUnifiedDisplayState("running", now, {
      displayOperation: "push",
      displaySessionKind: "local_push_session",
      displayDominantDirection: "push",
    }),
    settings,
    now,
    previousOwner: staleOwner,
  });
  assertDisplayDecision(
    ghostRunningDecision,
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: false,
    },
    "Running Phase 缺少 Live Runner 证据时，普通 Title Owner 不得接管同步中标题。"
  );

  const liveRunnerState = createUnifiedDisplayState("running", now, {
    displayLiveRunnerOwnerId: "runner-sync-owner",
    displayOperation: "push",
    displaySessionKind: "local_push_session",
    displayDominantDirection: "push",
  });
  const liveRunnerTabs = [
    createTab({
      tabId: "runner-tab",
      createdAt: now - 2000,
      lastSeen: now,
      lastActiveAt: now - 9000,
      syncOwnerId: "runner-sync-owner",
    }),
    createTab({
      tabId: "recent-background-tab",
      createdAt: now - 1000,
      lastSeen: now,
      lastActiveAt: now - 100,
      syncOwnerId: "other-sync-owner",
    }),
  ];
  assertDisplayDecision(
    decide({
      currentTabId: "runner-tab",
      tabs: liveRunnerTabs,
      state: liveRunnerState,
      settings,
      now,
      previousOwner: {
        tabId: "recent-background-tab",
        leaseUntil: now + constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS,
      },
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: true,
      ownerTabId: "runner-tab",
      displayPhase: "running",
      prefix: "[同步中.]",
      hasForegroundTab: false,
    },
    "Running Phase 有真实 Live Runner 时，Title Owner 必须优先 Live Runner。"
  );
  assertDisplayDecision(
    decide({
      currentTabId: "recent-background-tab",
      tabs: liveRunnerTabs,
      state: liveRunnerState,
      settings,
      now,
    }),
    {
      shouldDisplay: false,
      shouldRunAnimationTimer: false,
      ownerTabId: "runner-tab",
      displayPhase: "running",
      prefix: "",
      hasForegroundTab: false,
    },
    "非 Live Runner 即使是最近活动后台 tab，也不得显示 Running Phase 标题。"
  );

  const staleRunningTitleState = toPlainObject(
    readTitleProjection(hooks, {
      ...createResolvedState("running", now - 5000),
      operation: "push",
      lastResolvedPhase: "success",
      lastResolvedTimestamp: now - 10_000,
      lastResolvedSource: "background_push",
      lastResolvedReason: "previous_success",
    })
  );
  assert.equal(
    staleRunningTitleState.displayPhase,
    "idle",
    "stale Running Phase 不应回退显示旧 success/failure/conflict。"
  );
};

const testOwnerLeaseGuardPreventsCrossTabSelfTrigger = () => {
  const { hooks, store } = createHarness();
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const writeOwnerLease = requireHook(hooks, "writeTitleSyncStatusOwnerLease");
  const releaseOwnerLease = requireHook(hooks, "releaseTitleSyncStatusOwnerLease");
  const maybeRefreshOwnerLease = requireHook(
    hooks,
    "maybeRefreshTitleSyncStatusOwnerLease"
  );
  const isLeaseWorthyPhase = requireHook(
    hooks,
    "isTitleSyncStatusLeaseWorthyPhase"
  );
  const now = Date.now();
  const ownerKey = constants.TITLE_SYNC_STATUS_OWNER_KEY;

  assert.equal(isLeaseWorthyPhase("running"), true);
  assert.equal(isLeaseWorthyPhase("success"), true);
  assert.equal(isLeaseWorthyPhase("pending"), false);
  assert.equal(isLeaseWorthyPhase("idle"), false);

  store.set(ownerKey, {
    tabId: "other-tab",
    leaseUntil: now + constants.TITLE_SYNC_STATUS_OWNER_LEASE_MS,
    updatedAt: now,
  });
  const blockedOwner = toPlainObject(
    writeOwnerLease(now + 1, { reason: "owner_change" })
  );
  assert.equal(blockedOwner.tabId, "other-tab");
  assert.equal(
    store.get(ownerKey).tabId,
    "other-tab",
    "有效的其他 owner lease 存在时，当前 tab 不应覆盖 owner key。"
  );

  const blockedByRuntime = toPlainObject(
    maybeRefreshOwnerLease(
      {
        ownerTabId: "this-tab-decision-is-stale",
        displayPhase: "running",
        hasForegroundTab: false,
      },
      now + 2,
      { allowOwnerLeaseRefresh: false, reason: "owner_change" }
    )
  );
  assert.equal(
    blockedByRuntime.tabId,
    "other-tab",
    "owner_change 触发的 runtime 不应抢写 owner lease。"
  );

  store.delete(ownerKey);
  assert.equal(
    releaseOwnerLease(),
    false,
    "owner 为空时释放 lease 不应 GM_deleteValue 制造额外 owner change。"
  );
  assert.equal(store.has(ownerKey), false);
};

const testPartitionedPresenceStorage = () => {
  const { hooks, store } = createHarness();
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
  const getPresenceKey = requireHook(hooks, "getTitleSyncStatusTabPresenceKey");
  const writePresence = requireHook(hooks, "writeCurrentTitleSyncStatusPresence");
  const getPresenceState = requireHook(hooks, "getTitleSyncStatusPresenceState");
  const now = Date.now();

  const currentState = toPlainObject(
    writePresence({ reason: "init", force: true })
  );
  const currentTabId = Object.keys(currentState.tabs)[0];
  const currentPresenceKey = getPresenceKey(currentTabId);
  assert.ok(
    currentPresenceKey.startsWith(
      constants.TITLE_SYNC_STATUS_TAB_PRESENCE_KEY_PREFIX
    ),
    "当前 tab presence 应写入 partitioned per-tab key。"
  );
  assert.equal(
    store.has(constants.TITLE_SYNC_STATUS_PRESENCE_KEY),
    true,
    "新版 presence 写入应同步维护 aggregate 兼容镜像，供无法枚举 GM key 的环境读取。"
  );
  assert.equal(
    store.get(constants.TITLE_SYNC_STATUS_PRESENCE_KEY).tabs[currentTabId].tabId,
    currentTabId,
    "aggregate 兼容镜像应包含当前 tab presence。"
  );
  assert.equal(store.has(currentPresenceKey), true);
  assert.equal(
    store.get(constants.TITLE_SYNC_STATUS_PRESENCE_SIGNAL_KEY).action,
    "upsert",
    "partitioned presence 写入后应通过 signal key 通知其它 tab。"
  );

  const otherPresenceKey = getPresenceKey("other-tab");
  store.set(otherPresenceKey, {
    tabId: "other-tab",
    createdAt: now - 2000,
    lastSeen: now,
    lastActiveAt: now - 1000,
    visibilityState: "hidden",
    hasFocus: false,
    isForeground: false,
  });
  store.set(constants.TITLE_SYNC_STATUS_PRESENCE_KEY, {
    version: 1,
    updatedAt: now,
    tabs: {
      "legacy-tab": {
        tabId: "legacy-tab",
        createdAt: now - 3000,
        lastSeen: now,
        lastActiveAt: now - 3000,
        visibilityState: "hidden",
        hasFocus: false,
        isForeground: false,
      },
    },
  });

  const mergedState = toPlainObject(getPresenceState());
  assert.equal(
    Object.keys(mergedState.tabs).length,
    3,
    "presence 读取应合并 partitioned records 和 legacy aggregate，兼容滚动升级。"
  );
  assert.equal(mergedState.tabs["other-tab"].tabId, "other-tab");
  assert.equal(mergedState.tabs["legacy-tab"].tabId, "legacy-tab");

  writePresence({ remove: true, reason: "pagehide", force: true });
  assert.equal(store.has(currentPresenceKey), false);
  assert.equal(
    store.get(constants.TITLE_SYNC_STATUS_PRESENCE_SIGNAL_KEY).action,
    "remove",
    "移除当前 tab presence 时也应通过 signal key 通知其它 tab。"
  );

  const fallbackHarness = createHarness({ includeGmListValues: false });
  const fallbackHooks = fallbackHarness.hooks;
  const fallbackStore = fallbackHarness.store;
  const fallbackConstants = requireHook(
    fallbackHooks,
    "getTitleSyncStatusTestConstants"
  )();
  const fallbackWritePresence = requireHook(
    fallbackHooks,
    "writeCurrentTitleSyncStatusPresence"
  );
  const fallbackGetPresenceState = requireHook(
    fallbackHooks,
    "getTitleSyncStatusPresenceState"
  );
  fallbackStore.set(fallbackConstants.TITLE_SYNC_STATUS_PRESENCE_KEY, {
    version: 2,
    updatedAt: now,
    tabs: {
      "other-visible-tab": {
        tabId: "other-visible-tab",
        createdAt: now - 5000,
        lastSeen: now,
        lastActiveAt: now,
        visibilityState: "visible",
        hasFocus: true,
        isForeground: true,
      },
    },
  });
  const fallbackLocalState = toPlainObject(
    fallbackWritePresence({ reason: "init", force: true })
  );
  const fallbackCurrentTabId = Object.keys(fallbackLocalState.tabs)[0];
  const fallbackMergedState = toPlainObject(fallbackGetPresenceState());
  assert.equal(
    fallbackMergedState.tabs["other-visible-tab"].isForeground,
    true,
    "GM_listValues 不可用时，应仍能从 aggregate 镜像看到其它前台 S1 标签页。"
  );
  assert.equal(
    fallbackMergedState.tabs[fallbackCurrentTabId].tabId,
    fallbackCurrentTabId,
    "GM_listValues 不可用时，当前 tab 写入也应合并到 aggregate 镜像。"
  );
};

const testDisplayPhaseOnlyAndNoTitleSchedulerRewrite = () => {
  const { hooks, store } = createHarness();
  const decide = requireHook(hooks, "resolveTitleSyncStatusTabDisplayDecision");
  const projectTitle = (state) =>
    toPlainObject(readTitleProjection(hooks, state));
  const getConstants = requireHook(hooks, "getTitleSyncStatusTestConstants");
  const constants = getConstants();
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
    projectTitle(createResolvedState("success", now))
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
  setBackgroundSyncLocks(store, constants, "closed-runner-tab", now);
  const unifiedRunningState = projectTitle(createResolvedState("success", now));
  assert.equal(unifiedRunningState.displayPhase, "idle");
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: unifiedRunningState,
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
    "Title 投影应在进入 Title Owner 前抑制缺少 Live Runner 的 Ghost Running。"
  );

  const sourceMismatchPullState = projectTitle({
      ...createResolvedState("running", now),
      source: "foreground_resume",
      reason: "foreground_followup_in_flight",
      operation: "pull",
    });
  assert.equal(sourceMismatchPullState.displayPhase, "idle");
  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: sourceMismatchPullState,
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
    "原始拉取状态即使被上游 source mismatch 默认成 push，也不应点亮标签页标题。"
  );
  store.delete(constants.BACKGROUND_SYNC_LOCK_KEY);
  store.delete(constants.GLOBAL_SYNC_LOCK_KEY);

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("running", now),
        source: "foreground_resume",
        operation: "pull",
      }),
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
    "拉取中的统一状态不应点亮标签页标题同步状态。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("success", now),
        source: "foreground_resume",
        reason: "pulled",
        operation: "pull",
      }),
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
    "拉取成功必须先经过 Title 投影，不能直接把 raw display state 交给 Title Owner。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("running", now),
        source: "foreground_resume",
        reason: "foreground_probe_in_flight",
        operation: "probe",
      }),
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
    "云端探测的统一状态不应点亮标签页标题同步状态。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("failure", now),
        operation: "push",
      }),
      settings,
      now,
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "failure",
      prefix: "[同步失败]",
      hasForegroundTab: false,
    },
    "推送失败仍应显示标签页标题失败提示。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle(createResolvedState("conflict", now)),
      settings,
      now,
    }),
    {
      shouldDisplay: true,
      shouldRunAnimationTimer: false,
      ownerTabId: "tab-a",
      displayPhase: "conflict",
      prefix: "[冲突]",
      hasForegroundTab: false,
    },
    "未标明为拉取或探测的冲突仍应保留标签页标题提示。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("conflict", now),
        source: "foreground_resume",
        operation: "pull",
      }),
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
    "明确标记为拉取侧的冲突不应点亮标签页标题同步状态。"
  );

  assertDisplayDecision(
    decide({
      currentTabId: "tab-a",
      tabs: hiddenOwnerTab,
      state: projectTitle({
        ...createResolvedState("running", now),
        source: "foreground_resume",
        operation: "",
      }),
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
    "source mismatch 时，标题层不应仅凭 background display source 自行默认成推送方向。"
  );

  const titleSource = getTitleSyncStatusSource();
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
  assert.match(
    titleSource,
    /scheduleTitleSyncStatusCrossTabRuntimeSync\("owner_change",\s*\{\s*allowOwnerLeaseRefresh:\s*false/,
    "owner change listener 应走 debounce，且不允许在监听回调中续租 owner。"
  );
  assert.doesNotMatch(
    titleSource,
    /syncTitleSyncStatusRuntime\(\{\s*reason:\s*"animation_tick"/,
    "running 标题动画 tick 不应重跑完整 runtime。"
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

const testTitleRuntimeRoutesThroughProjectionBeforeRefreshingDocumentTitle = () => {
  const { hooks, store, sandbox } = createHarness();
  const now = Date.now();
  store.set("s1p_settings", createReadySettings());
  store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
    ...createResolvedState("success", now),
    source: "foreground_resume",
    reason: "pulled",
    operation: "pull",
    lastResolvedSource: "foreground_resume",
    lastResolvedReason: "pulled",
  });
  sandbox.document.title = "Stage1st Test Thread";

  const decision = toPlainObject(
    hooks.runTitleSyncStatusRuntimeSync({
      reason: "projection_integration",
      forceOwnerLease: true,
    })
  );
  assert.equal(decision.displayPhase, "idle");
  assert.equal(decision.prefix, "");
  assert.equal(decision.shouldDisplay, false);
  assert.ok(sandbox.document.title.startsWith("Stage1st Test Thread"));
  assert.doesNotMatch(sandbox.document.title, /\[同步成功\]/);
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
  assert.equal(
    hooks.s1pSettingsSemantics.projectSyncModal({
      syncShowTitleSyncStatus: true,
    }).showTitleSyncStatus,
    true,
    "同步设置投影应回填标题同步状态。"
  );
  assert.equal(
    hooks.s1pSettingsSemantics.buildSyncSettingsPatch({
      showTitleSyncStatus: true,
    }).syncShowTitleSyncStatus,
    true,
    "同步设置补丁应收集标题同步状态。"
  );
  const titleSettingSemantics = toPlainObject(
    hooks.s1pSettingsSemantics.resolveChangedPaths([
      "syncShowTitleSyncStatus",
    ])
  );
  assert.deepStrictEqual(titleSettingSemantics, {
    effectClass: "passive",
    runtimeIntents: ["navbar_initialize", "title_sync_status"],
    modalTabs: ["sync"],
  });

  expectMatch(
    /id="s1p-title-sync-status-subgroup"[\s\S]*for="s1p-show-title-sync-status-toggle">显示标签页标题同步状态/,
    "同步设置页状态显示区缺少标题同步状态开关。"
  );
  expectMatch(
    /开启后，仅当所有 S1 标签页都不在前台时，最近离开的 S1 标签页标题会在本地推送或同步冲突时显示状态提示（同步中\/成功\/失败\/冲突）/,
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
  [
    "result phase handoff and running live runner boundaries",
    testResultPhaseHandoffAndRunningLiveRunnerBoundaries,
  ],
  ["partitioned presence storage", testPartitionedPresenceStorage],
  ["owner lease guard prevents cross-tab self trigger", testOwnerLeaseGuardPreventsCrossTabSelfTrigger],
  ["display phase only and no title scheduler rewrite", testDisplayPhaseOnlyAndNoTitleSchedulerRewrite],
  [
    "title runtime routes through projection before refresh",
    testTitleRuntimeRoutesThroughProjectionBeforeRefreshingDocumentTitle,
  ],
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
