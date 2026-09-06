#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const { createHarness } = require("./s1plus-test-helpers");
const quiet = () => {
  const harness = createHarness({ includeSessionStorage: true });
  harness.sandbox.console = { log() {}, warn() {}, error() {}, debug() {} };
  return harness;
};
const events = (hooks) => hooks.s1pBuildDiagnosticExport().events;

const testStructuredExportAndPrivacy = () => {
  const { hooks } = quiet();
  const details = { nested: { why: "owner still fetching", remainingMs: 43000 },
    longDetail: "x".repeat(900), token: "secret-value", body: "private post body",
    requestUrl: "https://example.com/api?access_token=secret-value", opaque: "ghp_0123456789abcdef" };
  hooks.recordSyncTraceEvent("test_detail", { scope: "background_auto_sync", message: "decision", details });
  details.nested.why = "mutated afterwards";
  const bundle = hooks.s1pBuildDiagnosticExport();
  const entry = bundle.events.find((item) => item.event === "sync.test_detail");
  assert.equal(entry.details.nested.why, "owner still fetching");
  assert.equal(entry.details.longDetail.length, 900, "structured data must survive the old 500 character summary cap");
  const serialized = JSON.stringify(bundle);
  for (const secret of ["secret-value", "private post body", "ghp_0123456789abcdef"]) assert.ok(!serialized.includes(secret));
  assert.ok(serialized.includes("[REDACTED]"));
  assert.equal(bundle.coverage.consoleCapture, false);
  assert.ok(bundle.scriptVersion);
  assert.ok(entry.context.contextId);
  assert.match(hooks.formatLogEntryForCopy(entry), /owner still fetching/);
};

const testHostileDetailsAndSummaryOrder = () => {
  const { hooks } = quiet();
  const sparse = [];
  sparse[1000000000] = 42;
  let tree = { value: 1 };
  for (let depth = 0; depth < 6; depth++) tree = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, { ...tree }]));
  hooks.s1pRecordDiagnosticEvent("bounded", { details: { sparse, tree } });
  const bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(JSON.stringify(bundle).length < 100000, "sparse arrays and numeric trees must remain bounded");
  assert.equal(bundle.events[0].details.sparse.length, 1);
  assert.ok(bundle.coverage.loss.truncated > 0);
  const summaries = hooks.s1pGetDiagnosticOperationSummaries([
    { operationId: "a", ts: 10 }, { operationId: "b", ts: 20 },
    { operationId: "a", ts: 5, lastTs: 30 },
  ]);
  assert.equal(summaries.at(-1).operationId, "a");
  assert.equal(summaries.at(-1).startedAt, 5);
};

const testConcurrentSharedReceipts = () => {
  const first = createHarness({ includeGmListValues: true });
  const second = createHarness({ sharedStore: first.store, includeGmListValues: true });
  // Force the other page to write while the first page is in its storage call.
  const originalWrite = first.sandbox.GM_setValue;
  let interleaved = false;
  first.sandbox.GM_setValue = (key, value) => {
    if (!interleaved) {
      interleaved = true;
      second.hooks.s1pWriteSharedLockReceipt({ at: Date.now(), event: "lock.released", owner: "second" });
    }
    originalWrite(key, value);
  };
  first.hooks.s1pWriteSharedLockReceipt({ at: Date.now(), event: "lock.acquired", owner: "first" });
  const rows = second.hooks.s1pReadSharedLockReceipts();
  assert.equal(rows.length, 2, "interleaved writers must preserve both receipts");
  assert.ok(rows.some((row) => row.owner === "first"));
  assert.ok(rows.some((row) => row.owner === "second"));
  const duplicate = {
    at: Date.now(),
    event: "lock.renewed",
    operationId: "same_receipt",
    executionId: "same-token",
    reason: "lease_renewed",
    owner: "first",
  };
  first.hooks.s1pWriteSharedLockReceipt(duplicate);
  first.hooks.s1pWriteSharedLockReceipt(duplicate);
  assert.equal(
    first.hooks.s1pReadSharedLockReceipts().filter(
      (row) => row.operationId === "same_receipt"
    ).length,
    1,
    "重复的跨标签页回执不应重复计入诊断"
  );
  first.store.set("s1p_sync_lock_receipt:1:expired", { at: 1, event: "old" });
  for (let i = 0; i < 270; i++) first.hooks.s1pWriteSharedLockReceipt({ at: Date.now(), event: "lock.renewed", sequence: i });
  assert.equal(first.store.has("s1p_sync_lock_receipt:1:expired"), false);
  assert.ok([...first.store.keys()].filter((key) => key.startsWith("s1p_sync_lock_receipt:")).length <= 256);
  assert.equal(second.hooks.s1pReadSharedLockReceipts().length, 256);
};

const testRepeatsRetentionAndPersistence = () => {
  const { hooks, sessionStorage } = quiet();
  for (let index = 0; index < 100; index++) {
    hooks.s1pRecordDiagnosticEvent("lock.wait", { module: "sync.lock", repeatKey: "same_owner", reason: "busy",
      timestamp: 1000000 + index, details: { remainingMs: 5000 - index } });
  }
  let bundle = hooks.s1pBuildDiagnosticExport();
  assert.equal(bundle.events.length, 1);
  assert.equal(bundle.events[0].repeatCount, 100);
  assert.equal(bundle.events[0].firstDetails.remainingMs, 5000);
  assert.equal(bundle.events[0].details.remainingMs, 4901);
  hooks.s1pRecordDiagnosticEvent("lock.wait", { module: "sync.lock", repeatKey: "new_owner", reason: "busy", timestamp: 1000200 });
  assert.equal(events(hooks).length, 2, "owner changes must not disappear into a repeat group");
  hooks.s1pRecordDiagnosticEvent("op.start", { operationId: "failed_operation", message: "failure prelude" });
  hooks.s1pRecordDiagnosticEvent("op.fail", { operationId: "failed_operation", status: "failure", level: "error" });
  hooks.s1pRecordDiagnosticEvent("lock.released", {
    module: "sync.lock",
    operationId: "retained_terminal_operation",
    status: "released",
    reason: "execution_success",
    details: { stage: "complete" },
  });
  const start = performance.now();
  for (let index = 0; index < 1100; index++) hooks.s1pRecordDiagnosticEvent("noise", { message: "n".repeat(1200), details: { index } });
  bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(bundle.events.length <= 1000);
  assert.ok(JSON.stringify(bundle.events).length * 2 <= 1024 * 1024);
  assert.ok(bundle.coverage.loss.evicted > 0);
  assert.ok(bundle.events.some((entry) => entry.message === "failure prelude"));
  assert.ok(
    bundle.events.some(
      (entry) => entry.event === "lock.released" && entry.operationId === "retained_terminal_operation"
    ),
    "高价值锁终态证据不能被普通噪声挤出日志缓冲区"
  );
  console.log(`[structured-diagnostics] 1100 bounded records: ${Math.round(performance.now() - start)}ms`);
  hooks.persistLogBuffer();
  hooks.resetDebugLogCollectorStateForTest();
  hooks.restoreLogBufferFromSession();
  assert.ok(events(hooks).some((entry) => entry.message === "failure prelude"));
  sessionStorage.setItem = () => { throw new Error("quota full"); };
  assert.doesNotThrow(() => hooks.persistLogBuffer());
  assert.ok(hooks.s1pBuildDiagnosticExport().coverage.loss.persistenceFailures > 0);
};

const testBatchingAndMerge = () => {
  const { hooks, store } = quiet();
  for (let i = 0; i < 10; i++) hooks.recordSyncTraceEvent(`stage_${i}`, { message: `stage ${i}`, logToConsole: false });
  assert.equal(store.has("s1p_sync_diagnostics"), false, "trace history writes should be batched");
  assert.equal(hooks.getSyncDiagnostics().syncTraceEvents.length, 10);
  hooks.s1pFlushSyncTrace();
  assert.equal(store.get("s1p_sync_diagnostics").syncTraceEvents.length, 10);
  const first = hooks.s1pBuildDiagnosticExport();
  const secondHarness = quiet();
  secondHarness.hooks.s1pRecordDiagnosticEvent("another_tab", { message: "separate context" });
  const second = secondHarness.hooks.s1pBuildDiagnosticExport();
  const merged = hooks.s1pMergeDiagnosticExports([first, first, second]);
  assert.equal(merged.events.length, first.events.length + second.events.length);
  assert.throws(() => hooks.s1pMergeDiagnosticExports([{ schemaVersion: 9 }]));
};

const testLockEvidence = async () => {
  const first = quiet();
  const { hooks, store } = first;
  const authority = await hooks.acquireModeSyncLock("background", { returnAuthority: true, operationId: "owner_operation" });
  assert.ok(authority);
  const acquired = events(hooks).find((entry) => entry.event === "lock.acquired");
  assert.equal(acquired.operationId, "owner_operation");
  assert.equal(acquired.details.executionId, authority.token);
  assert.ok(store.get("s1p_sync_global_lock").acquiredAt);
  hooks.recordSyncTraceEvent("remote_fetch_start", { scope: "remote_fetch", message: "fetching" });
  hooks.refreshModeSyncLock("background", authority.token);
  assert.equal(store.get("s1p_sync_global_lock").stage, "remote_fetch_start");
  const observer = createHarness({ includeSessionStorage: true, sharedStore: store });
  observer.sandbox.console = first.sandbox.console;
  assert.equal(await observer.hooks.acquireModeSyncLock("manual"), false);
  assert.ok(events(observer.hooks).some((entry) => entry.reason === "active_execution_lock"));
  const lock = store.get("s1p_sync_global_lock");
  observer.hooks.s1pObserveSyncLocks(lock.timestamp + lock.ttlMs + 1);
  assert.ok(events(observer.hooks).some((entry) => entry.event === "lock.expired_observed"));
  assert.ok(!events(observer.hooks).some((entry) => entry.event === "lock.released"), "expiry observation must never fabricate owner release");
  hooks.releaseModeSyncLock("background", authority.token);
  assert.ok(events(hooks).some((entry) => entry.event === "lock.released"));
  assert.ok(observer.hooks.s1pBuildDiagnosticExport().state.sharedLockHistory.some((entry) => entry.event === "lock.released"));
  hooks.s1pSetManualPriorityGateForTest(() => true);
  assert.equal(await hooks.acquireModeSyncLock("background"), false);
  const refused = events(hooks).filter((entry) => entry.event === "lock.acquire_refused").at(-1);
  assert.equal(refused.reason, "manual_priority_pending");
  assert.equal(refused.details.locks.length, 0);
};

const testDiagnosticFailureCannotBreakSync = async () => {
  const { hooks, sandbox, store, sessionStorage } = quiet();
  const write = sandbox.GM_setValue;
  sandbox.GM_setValue = (key, value) => {
    if (key === "s1p_sync_lock_history" || key === "s1p_sync_diagnostics") throw new Error("diagnostics storage unavailable");
    return write(key, value);
  };
  sessionStorage.setItem = () => { throw new Error("session quota"); };
  const result = await hooks.runRunningSync({ mode: "background", runTransaction: async () => {
    hooks.recordSyncTraceEvent("transaction_work", { message: "still runs" });
    hooks.s1pFlushSyncTrace();
    hooks.persistLogBuffer();
    return { status: "success" };
  } });
  assert.equal(result.status, "success");
  assert.equal(store.has("s1p_sync_global_lock"), false);
  assert.equal(store.has("s1p_background_sync_lock"), false);
  assert.ok(hooks.s1pBuildDiagnosticExport().coverage.loss.persistenceFailures > 0);
};

const testLockStorageFailureLeavesTerminalEvidence = async () => {
  const { hooks, sandbox, store } = quiet();
  const write = sandbox.GM_setValue;
  sandbox.GM_setValue = (key, value) => {
    if (key === "s1p_background_sync_lock") {
      throw new Error("mode lock storage unavailable");
    }
    return write(key, value);
  };
  await assert.rejects(
    hooks.acquireModeSyncLock("background", {
      operationId: "lock_storage_failure",
    }),
    /mode lock storage unavailable/
  );
  assert.equal(store.has("s1p_background_sync_lock"), false);
  assert.equal(store.has("s1p_sync_global_lock"), false);
  const bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(
    bundle.events.some(
      (entry) =>
        entry.operationId === "lock_storage_failure" &&
        entry.event === "lock.acquisition_failed"
    )
  );
  const operation = bundle.operations.find(
    (entry) => entry.operationId === "lock_storage_failure"
  );
  assert.equal(operation.terminalEvent, "lock.acquisition_failed");
  assert.equal(operation.terminalReason, "lock_storage_write_failed");
};

const testLockStagePersistenceFailureCleansUpAndLeavesTerminalEvidence = async () => {
  const { hooks, sandbox, store } = quiet();
  const write = sandbox.GM_setValue;
  sandbox.GM_setValue = (key, value) => {
    if (
      key === "s1p_background_sync_lock" &&
      value?.stage === "transaction_start"
    ) {
      throw new Error("mode lock stage storage unavailable");
    }
    return write(key, value);
  };
  await assert.rejects(
    hooks.acquireModeSyncLock("background", {
      operationId: "lock_stage_persist_failure",
    }),
    /mode lock stage storage unavailable/
  );
  assert.equal(store.has("s1p_background_sync_lock"), false);
  assert.equal(store.has("s1p_sync_global_lock"), false);
  const bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(
    bundle.events.some(
      (entry) =>
        entry.operationId === "lock_stage_persist_failure" &&
        entry.event === "lock.acquisition_failed" &&
        entry.reason === "lock_stage_persist_failed"
    )
  );
  const operation = bundle.operations.find(
    (entry) => entry.operationId === "lock_stage_persist_failure"
  );
  assert.equal(operation.terminalEvent, "lock.acquisition_failed");
  assert.equal(operation.terminalReason, "lock_stage_persist_failed");
};

const testExpiredReleaseIsNotReportedAsOwnerRelease = async () => {
  const { hooks, sandbox } = quiet();
  const authority = await hooks.acquireModeSyncLock("background", {
    operationId: "expired_release",
    returnAuthority: true,
  });
  const realDate = Date;
  const expiredAt = authority.timestamp + authority.ttlMs + 1;
  sandbox.Date = class extends realDate {
    static now() {
      return expiredAt;
    }
  };
  try {
    hooks.releaseModeSyncLock("background", authority.token);
  } finally {
    delete sandbox.Date;
  }
  const bundle = hooks.s1pBuildDiagnosticExport();
  const lockEvents = bundle.events.filter(
    (entry) => entry.operationId === "expired_release"
  );
  assert.ok(lockEvents.some((entry) => entry.event === "lock.expired_cleanup"));
  assert.ok(!lockEvents.some((entry) => entry.event === "lock.released"));
  const operation = bundle.operations.find(
    (entry) => entry.operationId === "expired_release"
  );
  assert.equal(operation.terminalEvent, "lock.expired_cleanup");
  assert.equal(operation.terminalEvidence, "ttl_expiry_cleanup");
};

const testLockRenewalAndReleaseStorageFailuresAreDiagnosed = async () => {
  const { hooks, sandbox, store } = quiet();
  const authority = await hooks.acquireModeSyncLock("background", {
    operationId: "lock_storage_cleanup_failure",
    returnAuthority: true,
  });
  const originalWrite = sandbox.GM_setValue;
  sandbox.GM_setValue = (key, value) => {
    if (key === "s1p_background_sync_lock") {
      throw new Error("mode lock renewal storage unavailable");
    }
    return originalWrite(key, value);
  };
  assert.equal(
    hooks.refreshModeSyncLock("background", authority.token),
    false
  );
  sandbox.GM_setValue = originalWrite;
  const originalDelete = sandbox.GM_deleteValue;
  sandbox.GM_deleteValue = (key) => {
    if (key === "s1p_background_sync_lock") {
      throw new Error("mode lock delete unavailable");
    }
    return originalDelete(key);
  };
  assert.doesNotThrow(() => {
    hooks.releaseModeSyncLock("background", authority.token);
  });
  sandbox.GM_deleteValue = originalDelete;
  assert.equal(store.has("s1p_sync_global_lock"), false);
  assert.equal(store.has("s1p_background_sync_lock"), true);
  const bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(
    bundle.events.some(
      (entry) =>
        entry.operationId === "lock_storage_cleanup_failure" &&
        entry.event === "lock.renewal_failed" &&
        entry.reason === "lock_storage_write_failed"
    )
  );
  const operation = bundle.operations.find(
    (entry) => entry.operationId === "lock_storage_cleanup_failure"
  );
  assert.equal(operation.terminalEvent, "lock.release_failed");
  assert.equal(operation.terminalEvidence, "explicit_lock_release_failure");
};

const testSharedReceiptAppearsInOperationSummary = () => {
  const { hooks } = quiet();
  hooks.s1pWriteSharedLockReceipt({
    at: Date.now(),
    event: "lock.released",
    operationId: "cross_tab_owner_operation",
    executionId: "cross-tab-token",
    reason: "execution_success",
  });
  const operation = hooks
    .s1pBuildDiagnosticExport()
    .operations.find(
      (entry) => entry.operationId === "cross_tab_owner_operation"
    );
  assert.equal(operation.terminalEvent, "lock.released");
  assert.equal(operation.terminalEvidence, "explicit_owner_release");
  assert.deepEqual(Array.from(operation.evidenceSources), ["shared_receipt"]);
  assert.equal(operation.sharedReceiptCount, 1);
};

const testOperationSummaryKeepsLockEvidenceAfterTransactionCompletion = () => {
  const { hooks } = quiet();
  const now = Date.now();
  const summaries = hooks.s1pGetDiagnosticOperationSummaries([
    {
      event: "lock.release_failed",
      module: "sync.lock",
      operationId: "release_then_complete",
      ts: now,
      lastTs: now,
      status: "failure",
      reason: "lock_storage_delete_failed",
      details: { stage: "transaction_start" },
      repeatCount: 1,
    },
    {
      event: "sync.complete",
      module: "sync",
      operationId: "release_then_complete",
      ts: now + 1,
      lastTs: now + 1,
      status: "success",
      details: { mode: "background" },
      repeatCount: 1,
    },
  ]);
  const operation = summaries.find(
    (entry) => entry.operationId === "release_then_complete"
  );
  assert.equal(operation.terminalEvent, "sync.complete");
  assert.equal(operation.lockTerminalEvent, "lock.release_failed");
  assert.equal(operation.lockTerminalEvidence, "explicit_lock_release_failure");
  assert.equal(operation.transactionTerminalEvidence, "explicit_transaction_completion");
  assert.equal(operation.terminalEvidence, "explicit_lock_release_failure");
  assert.deepEqual(
    Array.from(operation.terminalEvents, (entry) => entry.event),
    ["lock.release_failed", "sync.complete"]
  );
};

const testOperationSummaryKeepsTransactionAndCleanupFailuresAfterLockRelease = () => {
  const { hooks } = quiet();
  const now = Date.now();
  const transactionFailure = hooks.s1pGetDiagnosticOperationSummaries([
    {
      event: "sync.transaction_failed",
      module: "sync",
      operationId: "transaction_then_release",
      ts: now,
      lastTs: now,
      status: "failure",
      reason: "transaction_threw",
      details: { stage: "remote_fetch" },
      repeatCount: 1,
    },
    {
      event: "lock.released",
      module: "sync.lock",
      operationId: "transaction_then_release",
      ts: now + 1,
      lastTs: now + 1,
      status: "released",
      reason: "execution_failure",
      details: { stage: "complete" },
      repeatCount: 1,
    },
  ]).find((entry) => entry.operationId === "transaction_then_release");
  assert.equal(transactionFailure.lockTerminalEvidence, "explicit_owner_release");
  assert.equal(transactionFailure.transactionTerminalEvidence, "explicit_transaction_failure");
  assert.equal(transactionFailure.terminalEvidence, "explicit_transaction_failure");

  const cleanupFailure = hooks.s1pGetDiagnosticOperationSummaries([
    {
      event: "lock.released",
      module: "sync.lock",
      operationId: "cleanup_then_release",
      ts: now,
      lastTs: now,
      status: "released",
      reason: "execution_success",
      details: { stage: "complete" },
      repeatCount: 1,
    },
    {
      event: "sync.cleanup_failed",
      module: "sync",
      operationId: "cleanup_then_release",
      ts: now + 1,
      lastTs: now + 1,
      status: "failure",
      reason: "result_handling_failed",
      details: { phase: "result_handling" },
      repeatCount: 1,
    },
  ]).find((entry) => entry.operationId === "cleanup_then_release");
  assert.equal(cleanupFailure.lockTerminalEvidence, "explicit_owner_release");
  assert.equal(cleanupFailure.cleanupTerminalEvidence, "explicit_cleanup_failure");
  assert.equal(cleanupFailure.terminalEvidence, "explicit_cleanup_failure");
};

const testSettledOperationReceivesLateCompletionCorrelation = async () => {
  const { hooks } = quiet();
  await hooks.runRunningSync({
    mode: "background",
    runTransaction: async () => ({ status: "success" }),
    handleResult: async () => {},
  });
  hooks.recordSyncTraceEvent("complete", {
    scope: "auto_sync",
    status: "success",
    details: { mode: "background" },
    logToConsole: false,
  });
  const operation = hooks
    .s1pBuildDiagnosticExport()
    .operations.find((entry) => entry.transactionTerminalEvent === "sync.complete");
  assert.ok(operation, "事务完成事件应关联到最近结束的同步 operation。");
  assert.equal(operation.lockTerminalEvent, "lock.released");
  assert.equal(operation.transactionTerminalEvidence, "explicit_transaction_completion");
};

(async () => {
  testStructuredExportAndPrivacy();
  testConcurrentSharedReceipts();
  testHostileDetailsAndSummaryOrder();
  testRepeatsRetentionAndPersistence();
  testBatchingAndMerge();
  await testLockEvidence();
  await testDiagnosticFailureCannotBreakSync();
  await testLockStorageFailureLeavesTerminalEvidence();
  await testLockStagePersistenceFailureCleansUpAndLeavesTerminalEvidence();
  await testExpiredReleaseIsNotReportedAsOwnerRelease();
  await testLockRenewalAndReleaseStorageFailuresAreDiagnosed();
  testSharedReceiptAppearsInOperationSummary();
  testOperationSummaryKeepsLockEvidenceAfterTransactionCompletion();
  testOperationSummaryKeepsTransactionAndCleanupFailuresAfterLockRelease();
  await testSettledOperationReceivesLateCompletionCorrelation();
  console.log("[structured-diagnostics] export, redaction, retention, batching, merge and lock evidence verified.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
