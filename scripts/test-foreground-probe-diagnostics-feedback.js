#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = () => {
  return createBaseHarness({
    href: "https://stage1st.com/2b/forum-1-1.html",
    search: "",
    hookErrorMessage: "未能从 S1Plus.js 暴露前台探测测试钩子。",
  });
};

const enabledSettings = {
  syncRemoteEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncCheckOnReturnToForeground: true,
};

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const testStaticWiring = () => {
  expectMatch(
    /lastProbeTimestamp:\s*0,/m,
    "Phase 7 未扩展同步诊断默认字段中的 lastProbeTimestamp。"
  );
  expectMatch(
    /lastProbeTriggeredSyncResult:\s*""/m,
    "Phase 7 未扩展同步诊断默认字段中的 lastProbeTriggeredSyncResult。"
  );
  expectMatch(
    /"最近探测远端版本"/m,
    "Phase 7 未将探测诊断字段接入同步诊断面板。"
  );
  expectMatch(
    /lastSyncResultCode:\s*""/m,
    "Phase 7 未扩展同步诊断默认字段中的 lastSyncResultCode。"
  );
  expectMatch(
    /"最近结果码"/m,
    "Phase 7 未将结果码接入同步诊断面板。"
  );
  expectMatch(
    /const getForegroundFollowUpSoftBlockState = \(\) =>/m,
    "Phase 3 未暴露前台 follow-up soft block 状态辅助函数。"
  );
};

const testUnchangedProbeUpdatesDiagnosticsQuietly = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const messages = [];
  const now = 1760000010000;
  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:30:00Z",
      },
    }),
    requestForegroundRemoteSyncCheck: async () => {
      throw new Error("未变化场景不应触发 follow-up sync。");
    },
  });

  assert.equal(result.status, "unchanged");
  assert.equal(messages.length, 0, "未变化场景应保持静默。");
  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastAttemptTimestamp, 0);
  assert.equal(diagnostics.lastSuccessTimestamp, 0);
  assert.equal(diagnostics.lastFailureTimestamp, 0);
  assert.equal(diagnostics.lastConflictTimestamp, 0);
  assert.equal(diagnostics.lastProbeTimestamp, now);
  assert.equal(diagnostics.lastProbeRemoteUpdatedAt, "2026-04-11T12:30:00Z");
  assert.equal(diagnostics.lastSyncedRemoteUpdatedAt, "2026-04-11T12:30:00Z");
  assert.equal(diagnostics.lastProbeResult, "unchanged");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
  assert.equal(diagnostics.lastProbeTriggeredSyncResult, "");
  assert.equal(diagnostics.lastTriggerSource, "foreground_resume");
  assert.equal(diagnostics.lastPageVisibility, "visible");
  assert.match(diagnostics.lastTabId, /^s1p_tab_/);
  assert.equal(diagnostics.lastBaselineHash, "baseline-hash");
  assert.equal(diagnostics.lastSyncResultKind, "probe");
  assert.equal(diagnostics.lastSyncResultCode, "unchanged");
  assert.equal(diagnostics.lastSyncBlockKind, "");
  assert.equal(diagnostics.lastSyncBlockReason, "");
  assert.equal(diagnostics.lastCleanupSource, "");
  assert.equal(diagnostics.lastPendingCleanupCount, 0);
  assert.equal(diagnostics.lastHadConfirmedVisiblePost, false);
};

const testChangedRemoteBlockedByLocalChangesStaysQuietAndRecordsSoftBlock = async () => {
  const { hooks } = createHarness();
  hooks.setSyncBaselineState({
    contentHash: "baseline-hash",
    remoteUpdatedAt: "2026-04-11T12:30:00Z",
  });

  const messages = [];
  const now = 1760000100000;
  const result = await hooks.checkRemoteFreshnessOnForeground("pageshow", {
    now,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => ({
      meta: {
        updatedAt: "2026-04-11T12:45:00Z",
      },
    }),
    requestForegroundRemoteSyncCheck: async () => ({
      status: "blocked",
      blockLevel: "soft",
      reason: "local_changed_during_sync",
    }),
  });

  assert.equal(result.status, "changed");
  assert.equal(
    messages.length,
    0,
    "Phase 3 的 soft block 不应再把前台局部脏状态升级成高打扰提示。"
  );

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeTimestamp, now);
  assert.equal(diagnostics.lastProbeRemoteUpdatedAt, "2026-04-11T12:45:00Z");
  assert.equal(diagnostics.lastSyncedRemoteUpdatedAt, "2026-04-11T12:30:00Z");
  assert.equal(diagnostics.lastProbeResult, "changed");
  assert.equal(diagnostics.lastProbeTriggeredSync, true);
  assert.equal(
    diagnostics.lastProbeTriggeredSyncResult,
    "blocked:soft:local_changed_during_sync"
  );
  assert.equal(diagnostics.lastTriggerSource, "foreground_resume");
  assert.equal(diagnostics.lastSyncResultKind, "blocked");
  assert.equal(diagnostics.lastSyncResultCode, "local_changed_during_sync");
  assert.equal(diagnostics.lastSyncBlockKind, "soft");
  assert.equal(diagnostics.lastSyncBlockReason, "local_changed_during_sync");
};

const testSharedCooldownRecordsDiagnosticsAndStaysQuietDuringPolling = async () => {
  const { hooks } = createHarness();
  const now = 1760000200000;
  hooks.setRemoteProbeSharedCooldownState({
    lastObservedRemoteUpdatedAt: "2026-04-11T12:45:00Z",
    lastObservedAt: now - 1000,
    checkedBy: "other-tab",
  });

  const messages = [];
  const result = await hooks.checkRemoteFreshnessOnForeground(
    "visible_poll_active",
    {
      now,
      settingsSnapshot: enabledSettings,
      showMessage: (message, isSuccess) => {
        messages.push({ message, isSuccess });
      },
      fetchRemoteData: async () => {
        throw new Error("shared cooldown 命中后不应继续请求远端。");
      },
    }
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "shared_cooldown");
  assert.equal(messages.length, 0, "轮询场景下的 cooldown 命中应保持静默。");

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeResult, "throttled_shared_cooldown");
  assert.equal(diagnostics.lastProbeRemoteUpdatedAt, "2026-04-11T12:45:00Z");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
  assert.equal(diagnostics.lastTriggerSource, "visible_poll");
  assert.equal(diagnostics.lastSyncResultKind, "probe");
  assert.equal(diagnostics.lastSyncResultCode, "throttled_shared_cooldown");
};

const testActiveSyncSkipStaysQuiet = async () => {
  const { hooks, store } = createHarness();
  store.set("s1p_sync_global_lock", {
    owner: "other-tab",
    mode: "background",
    timestamp: Date.now(),
    ttlMs: 60000,
  });

  const messages = [];
  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now: 1760000300000,
    settingsSnapshot: enabledSettings,
    showMessage: (message, isSuccess) => {
      messages.push({ message, isSuccess });
    },
    fetchRemoteData: async () => {
      throw new Error("已有同步锁时不应继续 probe。");
    },
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "sync_lock_active");
  assert.equal(messages.length, 0, "已有同步任务时自动检查应保持静默。");

  const diagnosticsText = hooks.buildSyncDiagnosticsSummary();
  assert.match(diagnosticsText, /最近结果码: skipped_active_sync/);
  assert.match(diagnosticsText, /最近探测结果: skipped_active_sync/);
  assert.match(diagnosticsText, /探测是否触发安全同步: 否/);
};

const testProbeExecutionFailureStillRecordsDiagnostics = async () => {
  const { hooks } = createHarness();
  const now = 1760000400000;

  const result = await hooks.checkRemoteFreshnessOnForeground("visibilitychange", {
    now,
    settingsSnapshot: enabledSettings,
    fetchRemoteData: async () => {
      throw new Error("metadata fetch exploded");
    },
  });

  assert.equal(result.status, "failure");
  assert.equal(result.reason, "probe_execution_error");

  const diagnostics = toPlainObject(hooks.getSyncDiagnostics());
  assert.equal(diagnostics.lastProbeTimestamp, now);
  assert.equal(diagnostics.lastProbeResult, "failure_probe_execution_error");
  assert.equal(diagnostics.lastProbeTriggeredSync, false);
  assert.equal(diagnostics.lastProbeTriggeredSyncResult, "");
  assert.equal(diagnostics.lastSyncResultKind, "probe");
  assert.equal(diagnostics.lastSyncResultCode, "failure_probe_execution_error");
};

(async () => {
  testStaticWiring();
  await testUnchangedProbeUpdatesDiagnosticsQuietly();
  await testChangedRemoteBlockedByLocalChangesStaysQuietAndRecordsSoftBlock();
  await testSharedCooldownRecordsDiagnosticsAndStaysQuietDuringPolling();
  await testActiveSyncSkipStaysQuiet();
  await testProbeExecutionFailureStillRecordsDiagnostics();

  console.log("[foreground-probe-diagnostics-feedback] Phase 7 diagnostics and feedback verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
