"use strict";

const assert = require("assert");
const { createHarness } = require("./s1plus-test-helpers");

const { hooks, store } = createHarness();

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

console.log("[startup-sync-freshness] dynamic startup freshness verified.");
