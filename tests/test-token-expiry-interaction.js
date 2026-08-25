#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, sourceCode } = require("./s1plus-test-helpers");

const { sandbox, hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露 Token 交互测试 seam。",
});

const { getS1pTokenExpiryDaysLeft, createRemoteSyncAuthRejectedError } = hooks;

assert.equal(typeof getS1pTokenExpiryDaysLeft, "function");
assert.equal(typeof createRemoteSyncAuthRejectedError, "function");

const testCalendarDayExpirySemantics = () => {
  const expiryTimestamp = new Date(2026, 7, 26, 23, 59, 59, 999).getTime();

  assert.equal(
    getS1pTokenExpiryDaysLeft(
      expiryTimestamp,
      new Date(2026, 7, 25, 23, 59, 59, 999).getTime()
    ),
    1,
    "Token should show one day remaining on the previous calendar day."
  );
  assert.equal(
    getS1pTokenExpiryDaysLeft(
      expiryTimestamp,
      new Date(2026, 7, 26, 12, 0, 0, 0).getTime()
    ),
    0,
    "Token should show zero days remaining throughout its configured expiry day."
  );
  assert.equal(
    getS1pTokenExpiryDaysLeft(
      expiryTimestamp,
      new Date(2026, 7, 27, 0, 0, 0, 0).getTime()
    ),
    -1,
    "Token should show one day expired on the following calendar day."
  );
  assert.equal(getS1pTokenExpiryDaysLeft(null), null);
};

const testAuthRejectionContract = () => {
  const error = createRemoteSyncAuthRejectedError(
    { status: 401, response: { responseText: "redacted" } },
    "remote_probe"
  );

  assert.equal(error.code, "REMOTE_SYNC_AUTH_REJECTED");
  assert.equal(error.status, 401);
  assert.equal(error.operation, "remote_probe");
  assert.match(error.message, /Token 已失效或已过期/);
  assert.equal(error.response.responseText, "redacted");
};

const testCandidateTokenIsUsedForRemoteValidation = async () => {
  let requestOptions = null;
  sandbox.GM_xmlhttpRequest = (options) => {
    requestOptions = options;
    setTimeout(() => {
      options.onload({
        status: 401,
        responseText: JSON.stringify({ message: "Bad credentials" }),
      });
    }, 0);
    return { abort() {} };
  };

  await assert.rejects(
    hooks.fetchRemoteData({
      metadataOnly: true,
      settingsSnapshot: {
        syncRemoteGistId: "candidate-gist",
        syncRemotePat: "candidate-pat",
      },
    }),
    (error) => {
      assert.equal(error.code, "REMOTE_SYNC_AUTH_REJECTED");
      assert.equal(error.status, 401);
      return true;
    }
  );
  assert.equal(
    requestOptions?.headers?.Authorization,
    "Bearer candidate-pat",
    "Candidate validation must use the unsaved Token rather than persisted settings."
  );
};

const testSaveIsAfterCandidateValidation = () => {
  const candidateValidation = sourceCode.indexOf(
    "settingsSnapshot: currentSettings"
  );
  const settingsSave = sourceCode.indexOf("saveSettings(currentSettings, {");

  assert.ok(candidateValidation >= 0, "Missing candidate-token validation path.");
  assert.ok(settingsSave >= 0, "Missing sync settings save path.");
  assert.ok(
    candidateValidation < settingsSave,
    "A changed Token must be validated before settings are persisted."
  );
  assert.match(
    sourceCode,
    /Token 验证未完成[\s\S]*未保存。请确认网络正常后重试/,
    "Token validation failures must leave the previous credentials intact."
  );
  assert.match(
    sourceCode,
    /新 Token 验证失败：Token 已失效或已过期，未保存/,
    "Authentication failures need an actionable, non-persisting message."
  );
};

const testReminderActionsAreTruthful = () => {
  const reminderBlock =
    sourceCode.match(
      /const checkTokenExpiry = \(\) => \{[\s\S]*?\n  \};\n\n  const S1P_INITIALIZATION_ERROR_LABEL_FIELD/
    )?.[0] || "";
  assert.ok(reminderBlock, "Missing Token expiry reminder implementation.");
  assert.match(
    reminderBlock,
    /text: "打开同步设置"[\s\S]*更新 Token 和有效期/,
    "The expiry reminder action must open settings rather than claim it already updated the Token."
  );
  assert.doesNotMatch(
    reminderBlock,
    /text: "已更新"/,
    "The reminder must not present a no-op action as if the Token were already updated."
  );
};

const main = async () => {
  testCalendarDayExpirySemantics();
  testAuthRejectionContract();
  await testCandidateTokenIsUsedForRemoteValidation();
  testSaveIsAfterCandidateValidation();
  testReminderActionsAreTruthful();
  console.log("[token-expiry-interaction] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
