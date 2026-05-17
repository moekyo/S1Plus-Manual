#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
} = require("./s1plus-test-helpers");

const LOG_SESSION_STORAGE_KEY = "s1p_log_buffer";

const createHarness = () =>
  createBaseHarness({
    includeSessionStorage: true,
    hookErrorMessage: "未能从 S1Plus.js 暴露调试日志收集器测试钩子。",
  });

const installFakeConsole = (sandbox) => {
  const calls = [];
  sandbox.console = {
    log: (...args) => calls.push(["log", args]),
    warn: (...args) => calls.push(["warn", args]),
    error: (...args) => calls.push(["error", args]),
    debug: (...args) => calls.push(["debug", args]),
  };
  return calls;
};

const toPlain = (value) => JSON.parse(JSON.stringify(value));

const testSessionRestoreSanitizesPayload = () => {
  const { hooks, sessionStore } = createHarness();
  const ts = 1760000000000;
  sessionStore.set(
    LOG_SESSION_STORAGE_KEY,
    JSON.stringify({
      entries: [
        { id: 1, ts, level: "log", message: "ok" },
        { id: 2, ts, level: "info", message: "bad level" },
        { id: "3", ts: ts + 1, level: "warn", message: { text: "object" } },
        { id: -1, ts, level: "error", message: "bad id" },
        { id: 4, ts: "invalid", level: "debug", message: "bad ts" },
        null,
      ],
      nextId: 2,
      expandedIds: [1, "3", 999, -1, "x"],
      expandAll: true,
    })
  );

  hooks.restoreLogBufferFromSession();
  const state = hooks.getDebugLogCollectorStateForTest();

  assert.deepEqual(
    toPlain(state.logBuffer.map((entry) => [entry.id, entry.level, entry.message])),
    [
      [1, "log", "ok"],
      [3, "warn", "[object Object]"],
    ]
  );
  assert.equal(state.nextLogEntryId, 4);
  assert.deepEqual(toPlain(state.expandedLogEntryIds), [1, 3]);
  assert.equal(state.logExpandAll, true);

  hooks.persistLogBuffer();
  const persisted = JSON.parse(sessionStore.get(LOG_SESSION_STORAGE_KEY));
  assert.deepEqual(
    toPlain(persisted.entries.map((entry) => [entry.id, entry.level, entry.message])),
    [
      [1, "log", "ok"],
      [3, "warn", "[object Object]"],
    ]
  );
  assert.deepEqual(persisted.expandedIds, [1, 3]);
  assert.equal(persisted.expandAll, true);
};

const testStopDoesNotOverwriteExternalConsolePatch = () => {
  const { hooks, sandbox } = createHarness();
  installFakeConsole(sandbox);

  hooks.startLogCollector();
  sandbox.console.log("first");
  const firstWrapper = sandbox.console.log;
  const externalCalls = [];
  const externalPatch = (...args) => {
    externalCalls.push(args);
    firstWrapper(...args);
  };

  sandbox.console.log = externalPatch;
  hooks.stopLogCollector();
  assert.equal(sandbox.console.log, externalPatch);

  sandbox.console.log("after stop");
  assert.equal(hooks.getDebugLogCollectorStateForTest().logBuffer.length, 1);

  hooks.startLogCollector();
  assert.notEqual(sandbox.console.log, externalPatch);
  sandbox.console.log("after restart");

  const state = hooks.getDebugLogCollectorStateForTest();
  assert.equal(state.logBuffer.length, 2);
  assert.equal(state.logBuffer[1].message, "after restart");
  assert.equal(externalCalls.length, 2);

  hooks.stopLogCollector();
  assert.equal(sandbox.console.log, externalPatch);
};

const testExpandAllPersistsAndEmptyBufferRemovesSessionKey = () => {
  const { hooks, sessionStore } = createHarness();
  hooks.setDebugLogCollectorStateForTest({
    entries: [
      {
        id: 1,
        ts: 1760000000000,
        level: "log",
        message: "long message",
      },
    ],
    nextId: 2,
    expandAll: true,
  });
  hooks.persistLogBuffer();

  assert.equal(
    JSON.parse(sessionStore.get(LOG_SESSION_STORAGE_KEY)).expandAll,
    true
  );

  hooks.resetDebugLogCollectorStateForTest();
  hooks.restoreLogBufferFromSession();
  assert.equal(hooks.getDebugLogCollectorStateForTest().logExpandAll, true);

  hooks.setDebugLogCollectorStateForTest();
  hooks.persistLogBuffer();
  assert.equal(sessionStore.has(LOG_SESSION_STORAGE_KEY), false);
};

(async () => {
  testSessionRestoreSanitizesPayload();
  testStopDoesNotOverwriteExternalConsolePatch();
  testExpandAllPersistsAndEmptyBufferRemovesSessionKey();

  console.log("[debug-log-collector] Debug log collector lifecycle verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
