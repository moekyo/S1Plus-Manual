#!/usr/bin/env node
"use strict";

// [ARCH-INV-1] 基线溯源的行为测试：
// 真实跑 performAutoSync 的推送路径，并在 PATCH 期间写入内容，
// 断言基线记录的是“被推送快照的代数”，而不是“写基线时的现场代数”。
// 这是静态断言无法覆盖的部分（文本看不出传了哪个变量）。

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  toPlainObject,
} = require("./s1plus-test-helpers");

const createHarness = (options = {}) =>
  createBaseHarness({
    hookErrorMessage: "未能从 S1Plus.js 暴露基线溯源测试钩子。",
    ...options,
  });

const makeProgress = (floor) => ({
  123456: {
    postId: "70000001",
    page: "1",
    lastReadFloor: String(floor),
    timestamp: 1700000000000,
  },
});

const enableGistSync = (harness) => {
  harness.hooks.saveSettings(
    Object.assign(harness.hooks.getSettings(), {
      syncRemoteEnabled: true,
      syncAutoEnabled: true,
      syncDeviceId: "dev-local",
      syncRemoteGistId: "gist-id",
      syncRemotePat: "pat-token",
      syncLanEnabled: false,
    })
  );
};

const buildRemoteGist = async (harness) => {
  const local = await harness.hooks.exportLocalDataObject({
    useFreshSnapshot: true,
  });
  return {
    version: 5.0,
    lastUpdated: local.lastUpdated,
    contentHash: local.contentHash,
    baseContentHash: local.baseContentHash,
    data: local.data,
  };
};

// 让 GM_xmlhttpRequest 按方法返回 GET/PATCH；onPatch 可在 PATCH 处理期间插入写入。
const installGistTransport = (harness, remoteObject, onPatch = () => {}) => {
  const { sandbox } = harness;
  let patched = false;
  sandbox.GM_xmlhttpRequest = (options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const respond = (status, body) =>
      options.onload &&
      options.onload({
        status,
        responseText: JSON.stringify(body),
      });
    if (method === "GET") {
      respond(200, {
        updated_at: "2026-01-01T00:00:00Z",
        files: {
          "s1plus_sync.json": { content: JSON.stringify(remoteObject) },
        },
      });
      return { abort() {} };
    }
    if (method === "PATCH") {
      patched = true;
      onPatch();
      respond(200, { updated_at: "2026-01-01T00:01:00Z" });
      return { abort() {} };
    }
    respond(200, {});
    return { abort() {} };
  };
  return () => patched;
};

const seedBaselineAtCurrentContent = async (harness) => {
  const remote = await buildRemoteGist(harness);
  harness.hooks.commitSyncedBaseline({
    syncBaseline: harness.hooks.buildSyncBaselineStateForDataPair({
      localDataObject: await harness.hooks.exportLocalDataObject({
        useFreshSnapshot: true,
      }),
      remoteDataObject: remote,
      remoteUpdatedAt: "2026-01-01T00:00:00Z",
    }),
    coveredContentGeneration: harness.hooks.getLocalContentGeneration(),
    reason: "test_seed",
  });
  return remote;
};

const runPushWithConcurrentWrite = async ({ writeDuringPatch }) => {
  const harness = createHarness();
  enableGistSync(harness);
  harness.hooks.s1pCoreBusinessData.write("readProgress", makeProgress(10));
  const remote = await seedBaselineAtCurrentContent(harness);

  // 让本地内容真实变化 → 触发 push
  harness.hooks.s1pCoreBusinessData.write("readProgress", makeProgress(20));
  const dirtyBefore = harness.hooks.isLocalContentDirtySinceBaseline();
  assert.equal(dirtyBefore.dirty, true, "前置：本地必须已脏");

  let concurrentGeneration = 0;
  const wasPatched = installGistTransport(harness, remote, () => {
    if (!writeDuringPatch) return;
    harness.hooks.s1pCoreBusinessData.write("readProgress", makeProgress(30));
    concurrentGeneration = harness.hooks.getLocalContentGeneration();
  });

  const result = await harness.hooks.performAutoSync(
    "background",
    null,
    "background_push"
  );
  assert.equal(wasPatched(), true, "前置：必须真的走到 PATCH");
  assert.equal(result.status, "success", `推送应成功，实际 ${result.status}`);
  assert.equal(result.action, "pushed");

  const baseline = harness.hooks.getSyncBaselineState();
  const currentGeneration = harness.hooks.getLocalContentGeneration();
  const dirtyAfter = harness.hooks.isLocalContentDirtySinceBaseline();

  if (writeDuringPatch) {
    assert.ok(
      concurrentGeneration > 0,
      "前置：PATCH 期间必须发生过写入"
    );
    assert.notEqual(
      baseline.localContentGeneration,
      currentGeneration,
      "基线不得记录写基线时的现场代数"
    );
    assert.equal(
      dirtyAfter.dirty,
      true,
      "PATCH 期间写入的内容未被推送，必须判脏（不得被吸收成已同步）"
    );
  } else {
    assert.equal(
      baseline.localContentGeneration,
      currentGeneration,
      "无并发写入时，基线代数应等于当前代数"
    );
    assert.equal(dirtyAfter.dirty, false, "无并发写入时推送后应判干净");
  }
  return { harness, baseline, currentGeneration, dirtyAfter };
};

const run = async () => {
  await runPushWithConcurrentWrite({ writeDuringPatch: false });
  await runPushWithConcurrentWrite({ writeDuringPatch: true });
  console.log(
    "[sync-baseline-provenance] 推送路径的覆盖代数溯源（含 PATCH 期间写入）已验证。"
  );
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
