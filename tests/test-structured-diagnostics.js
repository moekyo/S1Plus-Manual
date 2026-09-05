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
  const start = performance.now();
  for (let index = 0; index < 1100; index++) hooks.s1pRecordDiagnosticEvent("noise", { message: "n".repeat(1200), details: { index } });
  bundle = hooks.s1pBuildDiagnosticExport();
  assert.ok(bundle.events.length <= 1000);
  assert.ok(JSON.stringify(bundle.events).length * 2 <= 1024 * 1024);
  assert.ok(bundle.coverage.loss.evicted > 0);
  assert.ok(bundle.events.some((entry) => entry.message === "failure prelude"));
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

(async () => {
  testStructuredExportAndPrivacy();
  testConcurrentSharedReceipts();
  testHostileDetailsAndSummaryOrder();
  testRepeatsRetentionAndPersistence();
  testBatchingAndMerge();
  await testLockEvidence();
  await testDiagnosticFailureCannotBreakSync();
  console.log("[structured-diagnostics] export, redaction, retention, batching, merge and lock evidence verified.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
