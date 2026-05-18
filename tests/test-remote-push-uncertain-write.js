#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, toPlainObject } = require("./s1plus-test-helpers");

const readySyncSettings = {
  syncRemoteEnabled: true,
  syncAutoEnabled: true,
  syncRemoteGistId: "gist-id",
  syncRemotePat: "pat-token",
  syncDeviceId: "device-a",
};

const installReadySettings = (sandbox) => {
  sandbox.GM_setValue("s1p_settings", readySyncSettings);
};

const createGistResponse = (remoteObject, updatedAt) => ({
  status: 200,
  responseText: JSON.stringify({
    updated_at: updatedAt,
    files: {
      "s1plus_sync.json": {
        content: JSON.stringify(remoteObject),
        truncated: false,
      },
    },
  }),
});

const createMetadataResponse = (updatedAt) => ({
  status: 200,
  responseText: JSON.stringify({
    updated_at: updatedAt,
    files: {
      "s1plus_sync.json": {
        truncated: false,
      },
    },
  }),
});

const testPatchTimeoutIsConfirmedWhenRemoteContentMatchesPayload = async () => {
  const { sandbox, hooks } = createHarness({
    hookErrorMessage: "未能暴露远程推送不确定写入测试钩子。",
  });
  installReadySettings(sandbox);
  sandbox.GM_setValue("s1p_blocked_threads", {
    123: { title: "local", blockedAt: 1779110586194 },
  });
  sandbox.GM_setValue("s1p_last_modified", 1779110586194);

  const localData = await hooks.exportLocalDataObject({
    useFreshSnapshot: true,
    compactBookmarksForSync: false,
    compactBlockedPostsForSync: false,
  });
  let remoteObject = null;
  let patchAttempts = 0;
  let verificationFetches = 0;

  sandbox.GM_xmlhttpRequest = (request) => {
    if (request.method === "GET") {
      if (remoteObject) {
        verificationFetches += 1;
        request.onload(createGistResponse(remoteObject, "2026-05-18T13:23:18Z"));
        return;
      }
      request.onload(createMetadataResponse("2026-05-18T11:12:22Z"));
      return;
    }

    if (request.method === "PATCH") {
      patchAttempts += 1;
      const payload = JSON.parse(request.data);
      remoteObject = JSON.parse(payload.files["s1plus_sync.json"].content);
      request.ontimeout();
      return;
    }

    throw new Error(`Unexpected request method: ${request.method}`);
  };

  const result = await hooks.pushRemoteData(localData, {
    expectedRemoteUpdatedAt: "2026-05-18T11:12:22Z",
    writerContext: {
      action: "pushed",
      syncMode: "background",
      threadId: "123",
    },
    settingsSnapshot: readySyncSettings,
  });

  assert.equal(result.success, true);
  assert.equal(result.updatedAt, "2026-05-18T13:23:18Z");
  assert.equal(patchAttempts, 3, "PATCH timeout still follows the existing retry budget.");
  assert.equal(verificationFetches, 1, "After uncertain PATCH failure, push should verify once.");
  assert.equal(remoteObject.contentHash, localData.contentHash);
  assert.deepEqual(toPlainObject(remoteObject.data), toPlainObject(localData.data));
};

const testMetadataOnlyFetchDoesNotReportRemoteEmpty = async () => {
  const { sandbox, hooks } = createHarness({
    hookErrorMessage: "未能暴露远程元数据日志测试钩子。",
  });
  installReadySettings(sandbox);
  hooks.resetSyncDiagnostics();

  sandbox.GM_xmlhttpRequest = (request) => {
    assert.equal(request.method, "GET");
    request.onload(createMetadataResponse("2026-05-18T11:12:22Z"));
  };

  await hooks.fetchRemoteData({ metadataOnly: true });

  const diagnostics = hooks.getSyncDiagnostics();
  const doneEvent = diagnostics.syncTraceEvents.find((event) =>
    event.includes("云端元数据读取完成")
  );
  assert.ok(doneEvent, "metadata-only fetch should record a completion trace.");
  assert.match(doneEvent, /有同步文件=是/);
  assert.doesNotMatch(
    doneEvent,
    /云端为空=/,
    "metadata-only fetch does not inspect file content, so it must not report remoteEmpty."
  );
};

const main = async () => {
  await testPatchTimeoutIsConfirmedWhenRemoteContentMatchesPayload();
  await testMetadataOnlyFetchDoesNotReportRemoteEmpty();
  console.log("[remote-push-uncertain-write] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
