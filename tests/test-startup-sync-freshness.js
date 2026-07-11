"use strict";

const assert = require("assert");
const { createHarness } = require("./s1plus-test-helpers");

const { hooks, store } = createHarness();

const requestStartupFlow = (targetHooks, options = {}) =>
  targetHooks.s1pSyncSystem.requestSync({ kind: "startup_flow", options });

const settings = {
  syncRemoteEnabled: true,
  syncDailyFirstLoad: true,
};

store.set("s1p_last_daily_sync_date", "2026-05-21");

let decision = hooks.getStartupSyncOrchestratorDecision(1000, settings, {
  now: 7000,
  visibilityState: "visible",
});
assert.strictEqual(decision.action, "run_fresh_startup_flow");
assert.strictEqual(decision.freshnessState.isStaleStartupFlow, false);
assert.strictEqual(decision.freshnessState.freshnessWindowMs, 15000);
assert.strictEqual(
  decision.freshnessState.hasUserInteractionBeforeStartupDecision,
  false
);

hooks.markStartupSyncUserInteraction(6500);
decision = hooks.getStartupSyncOrchestratorDecision(1000, settings, {
  now: 7000,
  visibilityState: "visible",
});
assert.strictEqual(decision.action, "defer_daily_startup");
assert.strictEqual(decision.freshnessState.isStaleStartupFlow, true);
assert.strictEqual(decision.freshnessState.freshnessWindowMs, 4000);
assert.strictEqual(
  decision.freshnessState.hasUserInteractionBeforeStartupDecision,
  true
);

const earlyInteractionHarness = createHarness();
earlyInteractionHarness.store.set("s1p_last_daily_sync_date", "2026-05-21");
earlyInteractionHarness.hooks.markStartupSyncUserInteraction(500);
decision = earlyInteractionHarness.hooks.getStartupSyncOrchestratorDecision(
  1000,
  settings,
  {
    now: 7000,
    visibilityState: "visible",
  }
);
assert.strictEqual(decision.action, "defer_daily_startup");
assert.strictEqual(
  decision.freshnessState.hasUserInteractionBeforeStartupDecision,
  true
);

const hiddenHarness = createHarness({ visibilityState: "hidden" });
hiddenHarness.store.set("s1p_last_daily_sync_date", "2026-05-21");
decision = hiddenHarness.hooks.getStartupSyncOrchestratorDecision(
  1000,
  settings,
  {
    now: 7000,
    visibilityState: "hidden",
  }
);
assert.strictEqual(decision.action, "defer_daily_startup");
assert.strictEqual(decision.freshnessState.freshnessWindowMs, 4000);

const testScheduledDailyReloadShortCircuitsStartupOrchestrator = async () => {
  const startupHarness = createHarness();
  const calls = [];
  let scheduledFlow = null;
  requestStartupFlow(startupHarness.hooks, {
    welcomePopupWasShown: false,
    shouldTryNuxRecommendation: true,
    overrides: {
      getStartupSyncOrchestratorDecision: () => ({
        action: "run_fresh_startup_flow",
        freshnessState: {},
      }),
      scheduleTimeout: (callback) => {
        scheduledFlow = callback();
      },
      handleStartupSync: async () => {
        calls.push("daily");
        return true;
      },
      handlePerLoadSyncCheck: async () => {
        calls.push("per_load");
        return false;
      },
      handleInitialForegroundRemoteFreshnessCheck: async () => {
        calls.push("foreground");
        return false;
      },
      checkTokenExpiry: () => {
        calls.push("token");
        return false;
      },
      handleNuxRecommendation: () => {
        calls.push("nux");
      },
    },
  });
  await scheduledFlow;

  assert.deepStrictEqual(
    calls,
    ["daily"],
    "每日启动同步已经安排 reload 时，不应继续运行 per-load、foreground、Token 或 NUX。"
  );
};

(async () => {
  await testScheduledDailyReloadShortCircuitsStartupOrchestrator();
  console.log("[startup-sync-freshness] dynamic startup freshness verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
