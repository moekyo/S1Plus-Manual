#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHarness = () => {
  return createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露 Phase 4 probe gate 测试钩子。",
  });
};

const readNavbarProjection = (hooks, state = null) =>
  hooks.readSyncIndicatorStateProjection({ surface: "navbar", state });

const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const testRetryPendingKeepsExplicitOperationWhenPendingWriteIsDeduped =
  async () => {
    const { hooks, store } = createHarness();
    const now = Date.now();
    store.set(AUTO_SYNC_INDICATOR_STATE_KEY, {
      phase: "pending",
      timestamp: now,
      token: "",
      source: "foreground_resume",
      reason: "foreground_probe_verification_retry",
      operation: "",
      lastResolvedPhase: "idle",
      lastResolvedTimestamp: now,
      lastResolvedSource: "",
      lastResolvedReason: "",
    });

    let retrySyncCalls = 0;
    const scheduleResult = hooks.scheduleForegroundRemoteSyncRetry(
      "remote_probe_changed:visible_poll_active",
      {
        preferredDelayMs: 20,
        indicatorReason: "foreground_probe_changed_retry",
        indicatorOperation: "sync",
        getForegroundProbeGateBlockResult: () => null,
        requestForegroundRemoteSyncCheck: async () => {
          retrySyncCalls += 1;
          return {
            status: "success",
            action: "no_change",
          };
        },
        applyRefreshPolicyForSyncResult: () => null,
        maybeShowForegroundProbeFeedback: () => false,
      }
    );

    assert.equal(scheduleResult.status, "scheduled");
    const resolvedState = toPlainObject(
      readNavbarProjection(hooks)
    );
    assert.equal(resolvedState.displayPhase, "pending");
    assert.equal(resolvedState.displaySource, "visible_poll");
    assert.equal(
      hooks.getAutoSyncIndicatorDisplayKind(resolvedState),
      "probe",
      "pending 状态写入被去重时，运行时 retry 应保持云端复查语义，不能因旧 source 回退成 pull。"
    );

    await wait(1500);
    assert.equal(retrySyncCalls, 1);
  };

const testProbeGateBlocksChangedRemoteAndRetriesAfterLocalSettles = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  let gateActive = true;
  let retrySyncCalls = 0;
  const messages = [];

  const result = await hooks.checkRemoteFreshnessOnForeground("visible_poll_active", {
    now: 1760000500000,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:45:00Z",
      },
    }),
    getForegroundProbeGateBlockResult: () => {
      if (!gateActive) {
        return null;
      }
      return {
        status: "blocked",
        blockLevel: "soft",
        reason: "read_progress_pending_write",
        action: "probe_gate_blocked",
        retryAfterMs: 20,
      };
    },
    foregroundRemoteSyncRetryOptions: {
      requestForegroundRemoteSyncCheck: async () => {
        retrySyncCalls += 1;
        return {
          status: "success",
          action: "no_change",
        };
      },
      applyRefreshPolicyForSyncResult: () => null,
      maybeShowForegroundProbeFeedback: () => false,
    },
  });

  assert.equal(result.status, "changed");
  assert.equal(result.syncRequestResult?.status, "blocked");
  assert.equal(result.syncRequestResult?.reason, "read_progress_pending_write");
  assert.equal(result.retryPlan?.status, "scheduled");
  assert.equal(messages.length, 0, "probe gate 命中时应保持静默。");
  const pendingIndicatorState = toPlainObject(
    readNavbarProjection(hooks)
  );
  assert.equal(pendingIndicatorState.displayPhase, "pending");
  assert.equal(pendingIndicatorState.displaySource, "visible_poll");
  assert.equal(
    hooks.getAutoSyncIndicatorDisplayKind(pendingIndicatorState),
    "probe",
    "远端变化被前台门禁暂缓时，pending 指示器应显示放大镜复查态，避免误显示待拉取。"
  );

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeResult, "changed");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
  assert.equal(
    diagnostics.lastProbeTriggeredSyncResult,
    "blocked:soft:read_progress_pending_write"
  );

  gateActive = false;
  await wait(1500);

  assert.equal(
    hooks.getForegroundRemoteSyncRetryRemainingMs() <= 0,
    true,
    "retry 完成后不应残留 pending retry。"
  );
  assert.equal(retrySyncCalls, 1, "本地稳定后应仅补做一次 follow-up sync。");
};

const testRetryPendingSuppressesRepeatedForegroundProbe = async () => {
  const { hooks } = createHarness();

  let gateActive = true;
  let retrySyncCalls = 0;

  const scheduleResult = hooks.scheduleForegroundRemoteSyncRetry(
    "remote_probe_changed:foreground_resume",
    {
      preferredDelayMs: 30,
      getForegroundProbeGateBlockResult: () => {
        if (!gateActive) {
          return null;
        }
        return {
          status: "blocked",
          blockLevel: "soft",
          reason: "read_progress_sync_debounce",
          action: "probe_gate_blocked",
          retryAfterMs: 30,
        };
      },
      requestForegroundRemoteSyncCheck: async () => {
        retrySyncCalls += 1;
        return {
          status: "success",
          action: "no_change",
        };
      },
      applyRefreshPolicyForSyncResult: () => null,
      maybeShowForegroundProbeFeedback: () => false,
    }
  );

  assert.equal(scheduleResult.status, "scheduled");

  const probeResult = await hooks.checkRemoteFreshnessOnForeground("pageshow", {
    now: Date.now(),
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      throw new Error("retry pending 时不应再次请求远端 metadata。");
    },
  });

  assert.equal(probeResult.status, "skipped");
  assert.equal(probeResult.reason, "followup_retry_pending");
  assert.ok(
    Number(probeResult.retryAfterMs) > 0,
    "retry pending 应回传剩余等待时间。"
  );

  gateActive = false;
  await wait(1500);
  assert.equal(retrySyncCalls, 1, "retry pending 结束后应恢复一次 follow-up sync。");
};

const run = async () => {
  await testRetryPendingKeepsExplicitOperationWhenPendingWriteIsDeduped();
  await testProbeGateBlocksChangedRemoteAndRetriesAfterLocalSettles();
  await testRetryPendingSuppressesRepeatedForegroundProbe();
  console.log("[foreground-probe-gate-retry] Phase 4 probe gate and retry verified.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
