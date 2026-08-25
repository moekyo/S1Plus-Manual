#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const vm = require("node:vm");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");

const createHarness = () =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露启动错误报告测试钩子。",
  });

(async () => {
  const { hooks, sandbox } = createHarness();
  assert.equal(typeof hooks.runInitializationTaskWithRetryForTest, "function");
  assert.equal(typeof hooks.reportInitializationFailureOnceForTest, "function");

  const consoleErrors = [];
  sandbox.console = {
    log: () => {},
    warn: () => {},
    debug: () => {},
    error: (...args) => consoleErrors.push(args),
  };
  const crossRealmError = vm.runInNewContext(
    'Object.assign(new Error("cross-realm startup failure"), { name: "RemoteStartupError" })'
  );

  let propagatedError = null;
  try {
    await hooks.runInitializationTaskWithRetryForTest(
      "body-ready",
      {
        name: "required startup task",
        run: () => {
          throw crossRealmError;
        },
      },
      {}
    );
  } catch (error) {
    propagatedError = error;
  }

  assert.ok(propagatedError, "必需启动任务失败必须继续向顶层传播。");
  assert.equal(propagatedError.name, "RemoteStartupError");
  assert.match(propagatedError.message, /cross-realm startup failure/);
  assert.match(
    String(propagatedError.__s1pInitializationErrorLabel || ""),
    /body-ready\/required startup task/
  );
  assert.equal(
    consoleErrors.length,
    0,
    "必需任务层不应先打印一次、再由顶层重复打印。"
  );

  hooks.reportInitializationFailureOnceForTest(propagatedError);
  hooks.reportInitializationFailureOnceForTest(propagatedError);
  assert.equal(consoleErrors.length, 1, "同一个启动失败只能由顶层报告一次。");
  assert.match(String(consoleErrors[0][0]), /required startup task/);
  assert.strictEqual(consoleErrors[0][1], propagatedError);

  console.log("[startup-error-reporting] Startup failure authority verified.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
