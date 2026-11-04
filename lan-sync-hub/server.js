#!/usr/bin/env node
"use strict";

/**
 * S1 Plus LAN sync hub.
 *
 * 局域网同步中枢：保存一份带版本号的 S1 Plus 同步快照，向所有在线设备推送
 * “版本变了”的事件。合并逻辑仍然留在客户端（userscript），中枢只负责：
 *   - 单写者串行化（baseVersion / If-Match，冲突返回 409）
 *   - 版本号 + contentHash 作为一致性凭据
 *   - 长轮询 /wait（供 GM_xmlhttpRequest）与 SSE /events（供浏览器原生 EventSource）
 *   - presence：哪台设备最后同步到哪一版
 *   - 原子落盘 + 有限历史版本，便于排查冲突
 *
 * 环境变量：
 *   HUB_TOKEN          必填，设备访问令牌
 *   HUB_PORT           监听端口，默认 5180
 *   HUB_HOST           监听地址，默认 0.0.0.0
 *   HUB_DATA_DIR       数据目录，默认 /data
 *   HUB_HISTORY        保留的历史版本数，默认 10（0 = 不保留）
 *   HUB_MAX_BODY_BYTES 请求体上限，默认 8 MiB
 *   HUB_LONG_POLL_TIMEOUT_MS 长轮询默认挂起时长，默认 25000
 *   HUB_SSE_TIMEOUT_MS SSE 单连接最长时长，默认 5 分钟
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const CONFIG = {
  host: process.env.HUB_HOST || "0.0.0.0",
  port: clamp(Number(process.env.HUB_PORT || 5180), 1, 65535),
  dataDir: process.env.HUB_DATA_DIR || "/data",
  token: String(process.env.HUB_TOKEN || "").trim(),
  historyLimit: clamp(Number(process.env.HUB_HISTORY ?? 10), 0, 200),
  maxBodyBytes: Math.max(1024, Number(process.env.HUB_MAX_BODY_BYTES || 8 * 1024 * 1024)),
  longPollTimeoutMs: clamp(
    Number(process.env.HUB_LONG_POLL_TIMEOUT_MS || 25000),
    1000,
    120000
  ),
  sseTimeoutMs: clamp(
    Number(process.env.HUB_SSE_TIMEOUT_MS || 5 * 60 * 1000),
    10000,
    15 * 60 * 1000
  ),
  presenceTtlMs: 10 * 60 * 1000,
};

if (!CONFIG.token) {
  console.error(
    "[hub] HUB_TOKEN is required. Generate one with: openssl rand -hex 24"
  );
  process.exit(1);
}

const SNAPSHOT_FILE = path.join(CONFIG.dataDir, "snapshot.json");
const HISTORY_DIR = path.join(CONFIG.dataDir, "history");
const STATIC_DIR = __dirname;

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

const state = {
  version: 0,
  updatedAt: 0,
  contentHash: "",
  payload: null,
};

/** @type {Set<{finish: (meta: object) => void, timer: NodeJS.Timeout}>} */
const waiters = new Set();
/** @type {Set<{res: http.ServerResponse, push: (meta: object) => void}>} */
const sseClients = new Set();
/** @type {Map<string, {deviceId: string, version: number, at: number}>} */
const presence = new Map();

let mutationChain = Promise.resolve();

const currentMeta = () => ({
  version: state.version,
  updatedAt: state.updatedAt,
  contentHash: state.contentHash,
});

const log = (level, msg, extra = {}) => {
  console.log(
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })
  );
};

// ---------------------------------------------------------------------------
// 鉴权（对 token 取 sha256 后做定长比较）
// ---------------------------------------------------------------------------

const TOKEN_DIGEST = crypto
  .createHash("sha256")
  .update(CONFIG.token)
  .digest();

const tokenMatches = (candidate) => {
  if (!candidate) return false;
  const digest = crypto
    .createHash("sha256")
    .update(String(candidate))
    .digest();
  return crypto.timingSafeEqual(digest, TOKEN_DIGEST);
};

const readToken = (req, url) => {
  const header = req.headers["authorization"];
  if (typeof header === "string" && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, "").trim();
  }
  const xToken = req.headers["x-sync-token"];
  if (typeof xToken === "string" && xToken.trim()) return xToken.trim();
  return url.searchParams.get("token") || "";
};

const isAuthorized = (req, url) => tokenMatches(readToken(req, url));

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

const hashPayload = (payload) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);

const ensureDirs = async () => {
  await fsp.mkdir(CONFIG.dataDir, { recursive: true });
  await fsp.mkdir(HISTORY_DIR, { recursive: true });
};

const loadState = async () => {
  let raw;
  try {
    raw = await fsp.readFile(SNAPSHOT_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    !Number.isInteger(parsed.version) ||
    (parsed.payload !== null && typeof parsed.payload !== "object")
  ) {
    throw new Error(`invalid snapshot file: ${SNAPSHOT_FILE}`);
  }
  state.version = parsed.version;
  state.updatedAt = Number(parsed.updatedAt) || 0;
  state.contentHash = String(parsed.contentHash || "");
  state.payload = parsed.payload === undefined ? null : parsed.payload;
  log("info", "snapshot_loaded", { version: state.version });
};

const writeAtomic = async (file, text) => {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
};

const persistSnapshot = async (nextState) => {
  await writeAtomic(
    SNAPSHOT_FILE,
    JSON.stringify({
      version: nextState.version,
      updatedAt: nextState.updatedAt,
      contentHash: nextState.contentHash,
      payload: nextState.payload,
    })
  );
};

const pruneHistory = async () => {
  if (!CONFIG.historyLimit) return;
  let entries;
  try {
    entries = await fsp.readdir(HISTORY_DIR);
  } catch {
    return;
  }
  const versions = entries
    .map((name) => /^(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => b - a);
  const stale = versions.slice(CONFIG.historyLimit);
  await Promise.all(
    stale.map((version) =>
      fsp
        .rm(path.join(HISTORY_DIR, `${version}.json`), { force: true })
        .catch(() => {})
    )
  );
};

const writeHistory = async (snapshot) => {
  if (!CONFIG.historyLimit) return;
  try {
    await writeAtomic(
      path.join(HISTORY_DIR, `${snapshot.version}.json`),
      JSON.stringify(snapshot)
    );
    await pruneHistory();
  } catch (error) {
    log("warn", "history_write_failed", { message: error.message });
  }
};

// ---------------------------------------------------------------------------
// 变更串行化：同一时间只允许一个写者推进版本
// ---------------------------------------------------------------------------

const withMutation = (fn) => {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.catch(() => {});
  return run;
};

// ---------------------------------------------------------------------------
// 广播
// ---------------------------------------------------------------------------

const broadcast = () => {
  const meta = currentMeta();
  for (const waiter of [...waiters]) waiter.finish(meta);
  for (const client of [...sseClients]) client.push(meta);
};

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

// 默认不发送 CORS 头：测试页由 hub 同源提供，userscript 走 GM_xmlhttpRequest 也不受 CORS 限制。
// 只有显式配置 HUB_CORS_ORIGIN 时才允许指定来源跨域访问（公开仓库默认保持关闭）。
const CORS_HEADERS = (() => {
  const origin = String(process.env.HUB_CORS_ORIGIN || "").trim();
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Sync-Token",
    "Access-Control-Max-Age": "600",
  };
})();

const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > CONFIG.maxBodyBytes) {
        reject(
          Object.assign(new Error("request body too large"), { statusCode: 413 })
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(
          Object.assign(new Error("invalid JSON body"), { statusCode: 400 })
        );
      }
    });
    req.on("error", reject);
  });

const serveStatic = async (res, fileName) => {
  try {
    const file = path.join(STATIC_DIR, fileName);
    const body = await fsp.readFile(file);
    const type = fileName.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, {
      ...CORS_HEADERS,
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
};

// ---------------------------------------------------------------------------
// 业务处理
// ---------------------------------------------------------------------------

const handleSnapshotGet = (req, res, url) => {
  const since = Number(url.searchParams.get("since"));
  if (Number.isFinite(since) && since >= state.version && state.version > 0) {
    return sendJson(res, 200, { ...currentMeta(), unchanged: true });
  }
  return sendJson(res, 200, {
    ...currentMeta(),
    payload: state.payload,
  });
};

const handleSnapshotPost = async (req, res) => {
  const body = await readJsonBody(req);
  const headerVersion = Number(req.headers["if-match"]);
  const baseVersion = Number.isInteger(body.baseVersion)
    ? body.baseVersion
    : headerVersion;
  const nextPayload = body.payload;

  const result = await withMutation(async () => {
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      return {
        status: 400,
        body: {
          error: "bad_request",
          message: "baseVersion (or If-Match header) is required",
        },
      };
    }
    if (
      nextPayload === null ||
      typeof nextPayload !== "object" ||
      Array.isArray(nextPayload)
    ) {
      return {
        status: 400,
        body: { error: "bad_request", message: "payload must be an object" },
      };
    }
    if (baseVersion !== state.version) {
      return {
        status: 409,
        body: {
          error: "version_conflict",
          message: "snapshot changed, pull and merge, then retry",
          ...currentMeta(),
        },
      };
    }
    const contentHash = hashPayload(nextPayload);
    if (contentHash === state.contentHash) {
      return {
        status: 200,
        body: { ...currentMeta(), deduped: true },
      };
    }
    const nextState = {
      version: state.version + 1,
      updatedAt: Date.now(),
      contentHash,
      payload: nextPayload,
    };
    await persistSnapshot(nextState);
    await writeHistory(nextState);
    state.version = nextState.version;
    state.updatedAt = nextState.updatedAt;
    state.contentHash = nextState.contentHash;
    state.payload = nextState.payload;
    if (body.deviceId) updatePresence(String(body.deviceId), state.version);
    return {
      status: 200,
      body: {
        version: state.version,
        updatedAt: state.updatedAt,
        contentHash: state.contentHash,
        deduped: false,
      },
      broadcast: true,
    };
  });

  if (result.broadcast) broadcast();
  sendJson(res, result.status, result.body);
};

const handleWait = (req, res, url) => {
  const since = Number(url.searchParams.get("since") || 0);
  const timeoutMs = clamp(
    Number(url.searchParams.get("timeout") || CONFIG.longPollTimeoutMs),
    1000,
    120000
  );
  if (state.version > since) {
    return sendJson(res, 200, { ...currentMeta(), timeout: false });
  }
  let done = false;
  const waiter = {
    timer: null,
    finish(meta) {
      if (done) return;
      done = true;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      sendJson(res, 200, { ...meta, timeout: false });
    },
  };
  waiter.timer = setTimeout(() => {
    if (done) return;
    done = true;
    waiters.delete(waiter);
    sendJson(res, 200, { ...currentMeta(), timeout: true });
  }, timeoutMs);
  waiters.add(waiter);
  req.on("close", () => {
    if (done) return;
    done = true;
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
  });
};

const handleEvents = (req, res, url) => {
  const since = Number(url.searchParams.get("since") || 0);
  res.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const client = {
    res,
    push(meta) {
      try {
        res.write(`event: snapshot\ndata: ${JSON.stringify(meta)}\n\n`);
      } catch {
        /* 连接已断开，close 事件会清理 */
      }
    },
  };
  sseClients.add(client);
  if (state.version > since) client.push(currentMeta());
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 20000);
  const close = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };
  const closeTimer = setTimeout(close, CONFIG.sseTimeoutMs);
  req.on("close", () => {
    clearTimeout(closeTimer);
    close();
  });
};

const prunePresence = () => {
  const now = Date.now();
  for (const [deviceId, item] of presence) {
    if (now - item.at > CONFIG.presenceTtlMs) presence.delete(deviceId);
  }
};

const updatePresence = (deviceId, version) => {
  const normalized = String(deviceId || "").trim().slice(0, 64);
  if (!normalized) return;
  presence.set(normalized, {
    deviceId: normalized,
    version: Number.isInteger(version) ? version : state.version,
    at: Date.now(),
  });
};

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const route = async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url || "/", `http://${req.headers.host || "hub"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  let statusForLog = 200;

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        version: state.version,
        updatedAt: state.updatedAt,
        waiters: waiters.size,
        sseClients: sseClients.size,
        presence: presence.size,
        now: Date.now(),
      });
    }

    const isStatic =
      req.method === "GET" &&
      (pathname === "/" || pathname === "/test-client.html");
    if (isStatic) {
      return await serveStatic(res, "test-client.html");
    }

    if (!isAuthorized(req, url)) {
      statusForLog = 401;
      return sendJson(res, 401, { error: "unauthorized" });
    }

    if (pathname === "/snapshot") {
      if (req.method === "GET") return handleSnapshotGet(req, res, url);
      if (req.method === "POST") return await handleSnapshotPost(req, res);
      statusForLog = 405;
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    if (req.method === "GET" && pathname === "/wait") {
      return handleWait(req, res, url);
    }

    if (req.method === "GET" && pathname === "/events") {
      return handleEvents(req, res, url);
    }

    if (pathname === "/presence") {
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        updatePresence(body.deviceId, body.version);
        return sendJson(res, 200, {
          ok: true,
          deviceId: String(body.deviceId || "").slice(0, 64),
          version: state.version,
        });
      }
      if (req.method === "GET") {
        prunePresence();
        return sendJson(res, 200, {
          devices: [...presence.values()].sort((a, b) => b.at - a.at),
          version: state.version,
        });
      }
      statusForLog = 405;
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    statusForLog = 404;
    return sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    statusForLog = status;
    if (status >= 500) log("error", "request_failed", { message: error.message });
    return sendJson(res, status, {
      error: status === 500 ? "internal_error" : "bad_request",
      message: status === 500 ? "internal error" : error.message,
    });
  } finally {
    log("info", "request", {
      method: req.method,
      path: pathname,
      status: statusForLog,
      ms: Date.now() - startedAt,
    });
  }
};

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

const main = async () => {
  await ensureDirs();
  await loadState();
  const server = http.createServer((req, res) => {
    void route(req, res);
  });
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 0;
  server.on("error", (error) => {
    log("error", "server_error", { message: error.message });
    process.exit(1);
  });
  server.listen(CONFIG.port, CONFIG.host, () => {
    log("info", "hub_started", {
      host: CONFIG.host,
      port: CONFIG.port,
      version: state.version,
      historyLimit: CONFIG.historyLimit,
    });
  });
  const shutdown = (signal) => {
    log("info", "hub_stopping", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

main().catch((error) => {
  console.error(`[hub] failed to start: ${error.message}`);
  process.exit(1);
});
