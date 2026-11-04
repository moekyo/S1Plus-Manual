"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
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

async function startHub() {
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
