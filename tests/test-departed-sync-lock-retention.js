#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const GLOBAL_SYNC_LOCK_KEY = "s1p_sync_global_lock";
const STARTUP_SYNC_LOCK_KEY = "s1p_startup_sync_lock";
const DEPARTED_SYNC_LOCK_RETAIN_TTL_MS = 45 * 1000;
const RETAIN_TOLERANCE_MS = 2000;

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const buildRealBackgroundLockAdapter = (hooks) => {
  let authorityToken = "";
  return {
    acquire: async () => {
      const authority = await hooks.acquireModeSyncLock("startup", {
        returnAuthority: true,
      });
      authorityToken = authority?.token || "";
      return Boolean(authority);
    },
    startHeartbeat: () => {},
    stopHeartbeat: () => {},
    release: (reason = "execution_settled") => {
      const expectedToken = authorityToken;
      authorityToken = "";
      return hooks.releaseModeSyncLock("startup", expectedToken, reason);
    },
  };
};

const findEvidenceRow = (rows, key) =>
  rows.find((row) => row.key === key) || null;

// 离场持有者只保留「在途请求窗口」：模式锁与全局锁都要被压缩，而且压缩值
// 必须被所有有效性判断、锁快照和后续唤醒定时器看到。
const testDepartedOwnerLocksAreShortenedToRetainWindow = async () => {
  const { hooks, store } = createHarness();
  const captured = {};

  const result = await hooks.runRunningSync({
    mode: "startup",
    lockAdapter: buildRealBackgroundLockAdapter(hooks),
    runTransaction: async () => {
      const beforeModeLock = store.get(STARTUP_SYNC_LOCK_KEY);
      assert.equal(
        Number(beforeModeLock.retainUntil) || 0,
        0,
        "运行中的锁不应预先携带保留窗口"
      );
      const now = Date.now();
      captured.retention = toPlainObject(
        hooks.s1pRetainDepartedSyncLocksUntil(now, {
          retainTtlMs: DEPARTED_SYNC_LOCK_RETAIN_TTL_MS,
        })
      );
      captured.now = now;
      captured.modeLock = toPlainObject(store.get(STARTUP_SYNC_LOCK_KEY));
      captured.globalLock = toPlainObject(store.get(GLOBAL_SYNC_LOCK_KEY));
      captured.evidence = toPlainObject(hooks.s1pReadSyncLockEvidence());
      captured.snapshot = toPlainObject(hooks.getActiveSyncLockSnapshot());
      captured.expiredSnapshot = hooks.getActiveSyncLockSnapshot(
        captured.modeLock.retainUntil + 1
      );
      // 续租必须清除保留窗口：会话历史/bfcache 恢复的页面不能被提前判过期。
      captured.renewResult = hooks.refreshModeSyncLock(
        "startup",
        captured.modeLock.token
      );
      captured.modeLockAfterRenew = toPlainObject(
        store.get(STARTUP_SYNC_LOCK_KEY)
      );
      captured.globalLockAfterRenew = toPlainObject(
        store.get(GLOBAL_SYNC_LOCK_KEY)
      );
      return { status: "success" };
    },
  });

  assert.deepStrictEqual(toPlainObject(result), { status: "success" });

  const expectedRetainUntil = captured.now + DEPARTED_SYNC_LOCK_RETAIN_TTL_MS;
  assert.equal(captured.retention.status, "retained");
  assert.equal(captured.retention.count, 1);
  assert.deepStrictEqual(captured.retention.modes, ["startup"]);
  assert.ok(
    Math.abs(captured.retention.retainUntil - expectedRetainUntil) <=
      RETAIN_TOLERANCE_MS,
    "保留窗口应按离场时刻 + 45s 计算"
  );
  assert.ok(
    captured.modeLock.timestamp + 3 * 60 * 1000 > captured.retention.retainUntil,
    "启动同步锁的自然 TTL 必须长于保留窗口，否则压缩没有意义"
  );

  assert.ok(
    Math.abs(captured.modeLock.retainUntil - expectedRetainUntil) <=
      RETAIN_TOLERANCE_MS,
    "模式锁记录必须写入 retainUntil"
  );
  assert.equal(
    captured.modeLock.retainUntil,
    captured.retention.retainUntil,
    "模式锁与全局锁必须共享同一个保留时刻"
  );
  assert.equal(
    captured.globalLock.retainUntil,
    captured.retention.retainUntil,
    "全局锁记录必须写入 retainUntil"
  );

  const modeEvidence = findEvidenceRow(
    captured.evidence,
    STARTUP_SYNC_LOCK_KEY
  );
  const globalEvidence = findEvidenceRow(captured.evidence, GLOBAL_SYNC_LOCK_KEY);
  assert.ok(modeEvidence, "锁证据必须包含模式锁");
  assert.ok(globalEvidence, "锁证据必须包含全局锁");
  assert.equal(modeEvidence.expiresAt, captured.retention.retainUntil);
  assert.equal(globalEvidence.expiresAt, captured.retention.retainUntil);
  assert.ok(
    modeEvidence.remainingMs <= DEPARTED_SYNC_LOCK_RETAIN_TTL_MS,
    "模式锁剩余时间不得超过保留窗口"
  );

  assert.equal(captured.snapshot.mode, "startup");
  assert.equal(captured.snapshot.expiresAt, captured.retention.retainUntil);
  assert.ok(
    captured.snapshot.remainingMs <= DEPARTED_SYNC_LOCK_RETAIN_TTL_MS,
    "手动等待方使用的最新锁快照必须看到压缩后的失效时间"
  );
  assert.equal(
    captured.expiredSnapshot,
    null,
    "保留窗口结束后锁必须立即被视为失效"
  );

  assert.equal(
    hooks.getSyncLockEffectiveExpiresAt(captured.modeLock, 3 * 60 * 1000),
    captured.retention.retainUntil,
    "有效失效时间应取 retainUntil 与模式 TTL 的较小值"
  );

  assert.equal(captured.renewResult, true, "持有者仍可续租");
  assert.equal(
    Number(captured.modeLockAfterRenew.retainUntil) || 0,
    0,
    "续租必须清除模式锁的保留窗口"
  );
  assert.equal(
    Number(captured.globalLockAfterRenew.retainUntil) || 0,
    0,
    "续租必须清除全局锁的保留窗口"
  );
  assert.ok(
    hooks.getSyncLockEffectiveExpiresAt(
      captured.modeLockAfterRenew,
      3 * 60 * 1000
    ) > captured.retention.retainUntil,
    "续租后的有效失效时间应回到完整模式 TTL"
  );

  assert.equal(
    store.has(STARTUP_SYNC_LOCK_KEY),
    false,
    "事务结束仍应正常释放模式锁"
  );
  assert.equal(
    store.has(GLOBAL_SYNC_LOCK_KEY),
    false,
    "事务结束仍应正常释放全局锁"
  );
};

// 事务尚未开始的临时锁由取消路径释放，不能被压缩逻辑接管。
const testProvisionalLocksAreNotShortenedByRetention = async () => {
  const { hooks, store } = createHarness();
  const authority = await hooks.acquireModeSyncLock("startup", {
    returnAuthority: true,
  });
  assert.ok(authority, "启动同步锁应能取得");

  const startupLockBefore = store.get(STARTUP_SYNC_LOCK_KEY);
  const globalLockBefore = store.get(GLOBAL_SYNC_LOCK_KEY);
  assert.equal(
    Number(startupLockBefore.retainUntil) || 0,
    0,
    "临时锁不应携带保留窗口"
  );

  const retention = toPlainObject(hooks.s1pRetainDepartedSyncLocksUntil());
  assert.equal(retention.status, "skipped");
  assert.equal(retention.count, 0);
  assert.equal(retention.reason, "no_running_lock");
  assert.equal(
    Number(store.get(STARTUP_SYNC_LOCK_KEY).retainUntil) || 0,
    0,
    "临时锁保留窗口不应被写入"
  );
  assert.equal(
    Number(store.get(GLOBAL_SYNC_LOCK_KEY).retainUntil) || 0,
    0,
    "临时锁对应的全局锁不应被写入保留窗口"
  );
  assert.ok(
    globalLockBefore.mode === "startup" &&
      globalLockBefore.owner === store.get(STARTUP_SYNC_LOCK_KEY).owner,
    "全局锁与模式锁必须属于同一持有者"
  );

  hooks.releaseModeSyncLock("startup", authority.token, "test_cleanup");
};

// 只有真正离开的 pagehide 才压缩窗口：beforeunload 可能被取消，bfcache 会恢复。
const testOnlyRealPageHideShortensRetention = async () => {
  expectMatch(
    /const DEPARTED_SYNC_LOCK_RETAIN_TTL_MS = 45 \* 1000;/,
    "离场锁保留窗口常量必须存在"
  );
  expectMatch(
    /phase === "pagehide" && options\.persisted !== true/,
    "只有真实 pagehide 才能压缩保留窗口"
  );
  expectMatch(
    /window\.addEventListener\("pagehide", \(event\) =>\s*recordRuntimeUnload\("pagehide", \{ persisted: event\?\.persisted === true \}\)/,
    "pagehide 监听器必须把 persisted 状态传给离场处理"
  );
  expectMatch(
    /if \(isDepartedPageHide\) \{\s*try \{\s*departedRetention = s1pRetainDepartedSyncLocksUntil\(\);/,
    "离场处理必须调用保留窗口压缩"
  );
  assert.doesNotMatch(
    sourceCode,
    /beforeunload[^;]*s1pRetainDepartedSyncLocksUntil/,
    "beforeunload 不得压缩保留窗口"
  );
};

const run = async () => {
  await testDepartedOwnerLocksAreShortenedToRetainWindow();
  await testProvisionalLocksAreNotShortenedByRetention();
  await testOnlyRealPageHideShortensRetention();
  console.log("test-departed-sync-lock-retention: all assertions passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
