"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const TOKEN = "test-token-0123456789";
const SERVER = path.join(__dirname, "..", "server.js");

let hub;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const auth = (token = TOKEN) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const getHealth = async () => {
  const response = await fetch(`${hub.base}/health`);
  assert.equal(response.status, 200);
  return response.json();
};

const getSnapshot = async (query = "") => {
  const response = await fetch(`${hub.base}/snapshot${query}`, {
    headers: auth(),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const pushSnapshot = async ({ baseVersion, payload, deviceId = "test-device" }) => {
  const response = await fetch(`${hub.base}/snapshot`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ baseVersion, payload, deviceId }),
  });
  const body = await response.json();
  return { status: response.status, body };
};

async function startHub(extraEnv = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "s1p-hub-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      HUB_HOST: "127.0.0.1",
      HUB_PORT: String(port),
      HUB_TOKEN: TOKEN,
      HUB_DATA_DIR: dataDir,
      HUB_HISTORY: "5",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", () => {});
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { child, base, dataDir, stderr: () => stderr };
    } catch {
      /* not ready */
    }
    await sleep(50);
  }
  child.kill("SIGKILL");
  throw new Error(`hub failed to start: ${stderr}`);
}

before(async () => {
  hub = await startHub();
});

after(async () => {
  if (hub?.child) hub.child.kill("SIGTERM");
  if (hub?.dataDir) await fs.rm(hub.dataDir, { recursive: true, force: true });
});

test("health 无需鉴权", async () => {
  const health = await getHealth();
  assert.equal(health.ok, true);
  assert.equal(health.version, 0);
});

test("快照接口拒绝缺失或错误的 token", async () => {
  const missing = await fetch(`${hub.base}/snapshot`);
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${hub.base}/snapshot`, { headers: auth("wrong-token") });
  assert.equal(wrong.status, 401);
});

test("初始快照为空、版本为 0", async () => {
  const snapshot = await getSnapshot();
  assert.equal(snapshot.version, 0);
  assert.equal(snapshot.payload, null);
});

test("首次推送生成 v1，且 GET 返回同一 payload", async () => {
  const payload = { version: 5, data: { read_progress: { 1234567: { page: "2", lastReadFloor: "48" } } } };
  const result = await pushSnapshot({ baseVersion: 0, payload });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.match(result.body.contentHash, /^[0-9a-f]{16}$/);
  const snapshot = await getSnapshot();
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.payload, payload);
});

test("相同内容重复推送不推进版本（去重）", async () => {
  const payload = { version: 5, data: { read_progress: { 1234567: { page: "2", lastReadFloor: "48" } } } };
  const result = await pushSnapshot({ baseVersion: 1, payload });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.deduped, true);
});

test("过期 baseVersion 返回 409 与当前版本", async () => {
  const result = await pushSnapshot({
    baseVersion: 0,
    payload: { data: { read_progress: { 1: { page: "1" } } } },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "version_conflict");
  assert.equal(result.body.version, 1);
});

test("大快照按 Accept-Encoding 返回 gzip", async () => {
  const current = await getSnapshot();
  const readProgress = {};
  for (let i = 0; i < 400; i += 1) {
    readProgress[`thread_${i}`] = {
      page: "1",
      lastReadFloor: String(i),
      title: "标题".repeat(8),
    };
  }
  const payload = { data: { read_progress: readProgress } };
  const push = await pushSnapshot({ baseVersion: current.version, payload });
  assert.equal(push.status, 200);

  const compressed = await fetch(`${hub.base}/snapshot`, {
    headers: { ...auth(), "Accept-Encoding": "gzip" },
  });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.deepEqual((await compressed.json()).payload, payload);

  const plain = await fetch(`${hub.base}/snapshot`, {
    headers: { ...auth(), "Accept-Encoding": "identity" },
  });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.deepEqual((await plain.json()).payload, payload);
});

test("长轮询在版本变化时被唤醒", async () => {
  const current = await getSnapshot();
  const waitPromise = fetch(`${hub.base}/wait?since=${current.version}&timeout=5000`, {
    headers: auth(),
  });
  await sleep(150);
  const nextPayload = { data: { read_progress: { 1: { page: "2", lastReadFloor: "99" } } } };
  const push = await pushSnapshot({ baseVersion: current.version, payload: nextPayload });
  assert.equal(push.status, 200);
  const waitResponse = await waitPromise;
  assert.equal(waitResponse.status, 200);
  const event = await waitResponse.json();
  assert.equal(event.timeout, false);
  assert.equal(event.version, current.version + 1);
  assert.equal(event.contentHash, push.body.contentHash);
});

test("presence 上报与读取", async () => {
  const response = await fetch(`${hub.base}/presence`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ deviceId: "mac", version: 2 }),
  });
  assert.equal(response.status, 200);
  const presence = await fetch(`${hub.base}/presence`, { headers: auth() });
  const body = await presence.json();
  const mac = body.devices.find((item) => item.deviceId === "mac");
  assert.ok(mac, "mac presence should be tracked");
  assert.equal(mac.version, 2);
});

test("SSE 连接收到 snapshot 事件", async () => {
  const current = await getSnapshot();
  const controller = new AbortController();
  const response = await fetch(
    `${hub.base}/events?since=${current.version}&token=${TOKEN}`,
    { signal: controller.signal }
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read(); // 吃掉 retry 提示
  const push = await pushSnapshot({
    baseVersion: current.version,
    payload: { data: { read_progress: { sse: { page: "1" } } } },
    deviceId: "sse-test",
  });
  assert.equal(push.status, 200);
  let buffer = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !buffer.includes("event: snapshot")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  controller.abort();
  assert.match(buffer, /event: snapshot/);
});

// ---------------------------------------------------------------------------
// NAS 端 Gist 镜像
// ---------------------------------------------------------------------------

const stableStringifyMirror = (value) => {
  const sort = (item) => {
    if (typeof item !== "object" || item === null) return item;
    if (Array.isArray(item)) return item.map(sort);
    const out = {};
    Object.keys(item).sort().forEach((key) => {
      out[key] = sort(item[key]);
    });
    return out;
  };
  return JSON.stringify(sort(value));
};

const hashMirrorData = (data) =>
  crypto
    .createHash("sha256")
    .update(stableStringifyMirror(data))
    .digest("hex");

const buildSyncPayload = (data) => ({
  version: 5.0,
  lastUpdated: Date.now(),
  data,
  contentHash: hashMirrorData(data),
  baseContentHash: null,
});

async function startFakeGist() {
  let fileContent = null;
  let updatedAt = "2026-01-01T00:00:00.000Z";
  let lastAuth = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://fake");
    if (!url.pathname.startsWith("/gists/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    lastAuth = req.headers.authorization || "";
    if (req.method === "GET") {
      const files = fileContent
        ? {
            "s1plus_sync.json": {
              content: fileContent,
              truncated: false,
              raw_url: "",
            },
          }
        : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files, updated_at: updatedAt }));
      return;
    }
    if (req.method === "PATCH") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        fileContent = parsed.files["s1plus_sync.json"].content;
        updatedAt = new Date().toISOString();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ updated_at: updatedAt }));
      });
      return;
    }
    res.writeHead(405);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    getContent: () => (fileContent ? JSON.parse(fileContent) : null),
    setContent: (payload) => {
      fileContent = payload ? JSON.stringify(payload) : null;
    },
    getAuth: () => lastAuth,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Gist 镜像：NAS 定时配置、种子写入、合并与冲突保护", async (t) => {
  const fakeGist = await startFakeGist();
  const mirrorHub = await startHub({
    HUB_GIST_MIRROR_GIST_ID: "gist-123",
    HUB_GIST_MIRROR_TOKEN: "mirror-token",
    HUB_GIST_API_BASE: fakeGist.base,
    HUB_GIST_MIRROR_ENABLED: "0",
  });
  t.after(async () => {
    mirrorHub.child.kill("SIGTERM");
    await fs.rm(mirrorHub.dataDir, { recursive: true, force: true });
    await fakeGist.close();
  });

  const base = mirrorHub.base;
  const headers = auth();
  const data = {
    settings: {},
    blockedUsers: { u1: 1 },
    read_progress: {
      t1: { page: "2", lastReadFloor: "10", timestamp: 1000 },
    },
  };
  const payload = buildSyncPayload(data);
  const push = await fetch(`${base}/snapshot`, {
    method: "POST",
    headers,
    body: JSON.stringify({ baseVersion: 0, payload, deviceId: "lan-device" }),
  });
  assert.equal(push.status, 200);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.gistMirror.configured, true);
  assert.equal(health.gistMirror.enabled, false);
  assert.ok(
    !JSON.stringify(health).includes("mirror-token"),
    "health 不能泄露 Gist token"
  );

  const unauthorized = await fetch(`${base}/mirror`);
  assert.equal(unauthorized.status, 401);

  const configResponse = await fetch(`${base}/mirror/config`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ enabled: true, schedule: "daily", dailyTime: "3:05" }),
  });
  assert.equal(configResponse.status, 200);
  const configBody = await configResponse.json();
  assert.equal(configBody.gistMirror.enabled, true);
  assert.equal(configBody.gistMirror.schedule, "daily");
  assert.equal(configBody.gistMirror.dailyTime, "03:05");

  const seed = await fetch(`${base}/mirror`, { method: "POST", headers });
  assert.equal(seed.status, 200);
  const seedBody = await seed.json();
  assert.equal(seedBody.result.status, "success");
  assert.equal(seedBody.result.action, "seed");
  assert.equal(fakeGist.getAuth(), "Bearer mirror-token");
  assert.deepEqual(fakeGist.getContent().data, data);

  // 模拟第三台设备往 Gist 写入了更新的阅读进度（核心数据相同）。
  const updatedData = {
    ...data,
    read_progress: {
      t1: { page: "6", lastReadFloor: "120", timestamp: 2000 },
      t2: { page: "1", lastReadFloor: "3", timestamp: 1500 },
    },
  };
  fakeGist.setContent(buildSyncPayload(updatedData));
  const mergeResponse = await fetch(`${base}/mirror`, {
    method: "POST",
    headers,
  });
  assert.equal(mergeResponse.status, 200);
  const mergeBody = await mergeResponse.json();
  assert.equal(mergeBody.result.status, "success");
  assert.equal(mergeBody.result.action, "merged");
  const mergedGistData = fakeGist.getContent().data;
  assert.equal(mergedGistData.read_progress.t1.page, "6");
  assert.equal(mergedGistData.read_progress.t2.page, "1");
  assert.equal(mergedGistData.blockedUsers.u1, 1);

  const hubSnapshot = await (await fetch(`${base}/snapshot`, { headers })).json();
  assert.equal(hubSnapshot.payload.data.read_progress.t1.page, "6");
  assert.equal(hubSnapshot.payload.data.read_progress.t2.page, "1");
  assert.ok(hubSnapshot.version >= 2, "合并后 Hub 版本应推进");

  // 核心数据冲突：只提示、不覆盖 Gist / Hub。
  const conflictData = {
    ...data,
    extraCoreMarker: "different",
    read_progress: {},
  };
  const conflictPayload = buildSyncPayload(conflictData);
  fakeGist.setContent(conflictPayload);
  const conflictResponse = await fetch(`${base}/mirror`, {
    method: "POST",
    headers,
  });
  assert.equal(conflictResponse.status, 200);
  const conflictBody = await conflictResponse.json();
  assert.equal(conflictBody.result.status, "conflict");
  assert.deepEqual(fakeGist.getContent().data, conflictData);
  const statusAfterConflict = await (await fetch(`${base}/mirror`, { headers })).json();
  assert.equal(statusAfterConflict.gistMirror.lastStatus, "conflict");

  const normalizedConfig = await fetch(`${base}/mirror/config`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ schedule: "every6h", dailyTime: "23:59" }),
  });
  const normalizedBody = await normalizedConfig.json();
  assert.equal(normalizedBody.gistMirror.schedule, "every6h");
  assert.equal(normalizedBody.gistMirror.dailyTime, "23:59");
  assert.equal(normalizedBody.gistMirror.enabled, true);
});
