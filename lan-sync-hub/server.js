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
const zlib = require("node:zlib");

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
  // 旧版 userscript 用 GM_xmlhttpRequest 长轮询 /wait；长连接会占住请求通道，
  // 把同浏览器的拉取/推送排在后面。这里给旧客户端一个很短的挂起上限，
  // 最坏阻塞窗口从 25s 降到 5s（新客户端已改用 /health 短轮询）。
  longPollMaxTimeoutMs: clamp(
    Number(process.env.HUB_LONG_POLL_MAX_TIMEOUT_MS || 5000),
    1000,
    120000
  ),
  sseTimeoutMs: clamp(
    Number(process.env.HUB_SSE_TIMEOUT_MS || 5 * 60 * 1000),
    10000,
    15 * 60 * 1000
  ),
  presenceTtlMs: 10 * 60 * 1000,
  // Gist 镜像：凭证只放 NAS 环境变量；调度配置由设置页通过 /mirror/config 写入 data 目录。
  gistMirror: {
    gistId: String(process.env.HUB_GIST_MIRROR_GIST_ID || "").trim(),
    token: String(process.env.HUB_GIST_MIRROR_TOKEN || "").trim(),
    apiBase: String(
      process.env.HUB_GIST_API_BASE || "https://api.github.com"
    ).replace(/\/+$/, ""),
    enabledByDefault:
      String(process.env.HUB_GIST_MIRROR_ENABLED || "").trim() === "1",
  },
};

if (!CONFIG.token) {
  console.error(
    "[hub] HUB_TOKEN is required. Generate one with: openssl rand -hex 24"
  );
  process.exit(1);
}

const SNAPSHOT_FILE = path.join(CONFIG.dataDir, "snapshot.json");
const HISTORY_DIR = path.join(CONFIG.dataDir, "history");
const GIST_MIRROR_CONFIG_FILE = path.join(
  CONFIG.dataDir,
  "gist-mirror-config.json"
);
const GIST_MIRROR_STATE_FILE = path.join(
  CONFIG.dataDir,
  "gist-mirror-state.json"
);
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

const GZIP_MIN_BYTES = 4096;

// 快照 JSON 动辄 200KB+，在 Wi-Fi / 多跳链路上丢一个包就会带来十几秒的
// TCP 重传等待。gzip 后通常只有原来的 1/8，包数大幅减少，浏览器会透明解压。
const sendJson = (res, status, body) => {
  const req = res.req || null;
  const text = JSON.stringify(body);
  const rawLength = Buffer.byteLength(text);
  const acceptsGzip =
    rawLength >= GZIP_MIN_BYTES &&
    /\bgzip\b/i.test(String(req?.headers?.["accept-encoding"] || ""));
  if (acceptsGzip) {
    const compressed = zlib.gzipSync(text);
    res.writeHead(status, {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Content-Length": compressed.length,
      "Cache-Control": "no-store",
      Vary: "Accept-Encoding",
    });
    res.end(compressed);
    return;
  }
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": rawLength,
    "Cache-Control": "no-store",
    ...(rawLength >= GZIP_MIN_BYTES ? { Vary: "Accept-Encoding" } : {}),
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

// ---------------------------------------------------------------------------
// Gist 镜像（NAS 端执行；浏览器只负责配置与状态展示）
//
// Hub 是唯一拥有最新局域网快照的进程，由它定时把快照安全合并到 Gist：
// - 只有阅读进度差异：逐条合并后写 Gist，并把合并结果写回 Hub（版本 +1）
// - 核心数据有差异：跳过并记录状态，不覆盖任何一端
// 凭证（Gist ID / Token）只从环境变量读取，不进入浏览器、不写日志。
// ---------------------------------------------------------------------------

const GIST_MIRROR_SYNC_FILENAME = "s1plus_sync.json";
const GIST_MIRROR_SCHEDULES = Object.freeze(["hourly", "every6h", "daily"]);
const GIST_MIRROR_INTERVAL_MS = Object.freeze({
  hourly: 60 * 60 * 1000,
  every6h: 6 * 60 * 60 * 1000,
});
const GIST_MIRROR_RECHECK_MS = 60 * 1000;
const GIST_MIRROR_MIN_DELAY_MS = 5000;

const gistMirror = {
  configured: Boolean(CONFIG.gistMirror.gistId && CONFIG.gistMirror.token),
  config: {
    enabled: CONFIG.gistMirror.enabledByDefault === true,
    schedule: "hourly",
    dailyTime: "04:00",
  },
  state: {
    lastAt: 0,
    lastStatus: "",
    lastMessage: "",
    lastGistHash: "",
    lastHubVersion: 0,
  },
  running: false,
  timer: null,
};

const normalizeGistMirrorDailyTime = (value) => {
  const raw = String(value || "").trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw) ? raw.padStart(5, "0") : "04:00";
};

const publicGistMirrorStatus = () => ({
  configured: gistMirror.configured,
  enabled: gistMirror.config.enabled,
  schedule: gistMirror.config.schedule,
  dailyTime: gistMirror.config.dailyTime,
  running: gistMirror.running,
  lastAt: gistMirror.state.lastAt,
  lastStatus: gistMirror.state.lastStatus,
  lastMessage: gistMirror.state.lastMessage,
  lastGistHash: gistMirror.state.lastGistHash,
});

const persistGistMirrorConfig = async () => {
  try {
    await writeAtomic(
      GIST_MIRROR_CONFIG_FILE,
      JSON.stringify(gistMirror.config)
    );
  } catch (error) {
    log("warn", "gist_mirror_config_write_failed", {
      message: error.message,
    });
  }
};

const persistGistMirrorState = async () => {
  try {
    await writeAtomic(GIST_MIRROR_STATE_FILE, JSON.stringify(gistMirror.state));
  } catch (error) {
    log("warn", "gist_mirror_state_write_failed", { message: error.message });
  }
};

const loadGistMirrorFiles = async () => {
  try {
    const rawConfig = await fsp.readFile(GIST_MIRROR_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(rawConfig);
    if (parsed && typeof parsed === "object") {
      gistMirror.config.enabled =
        parsed.enabled === true
          ? true
          : parsed.enabled === false
            ? false
            : gistMirror.config.enabled;
      if (GIST_MIRROR_SCHEDULES.includes(parsed.schedule)) {
        gistMirror.config.schedule = parsed.schedule;
      }
      gistMirror.config.dailyTime = normalizeGistMirrorDailyTime(
        parsed.dailyTime
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      log("warn", "gist_mirror_config_load_failed", { message: error.message });
    }
  }
  try {
    const rawState = await fsp.readFile(GIST_MIRROR_STATE_FILE, "utf8");
    const parsed = JSON.parse(rawState);
    if (parsed && typeof parsed === "object") {
      gistMirror.state.lastAt = Number(parsed.lastAt) || 0;
      gistMirror.state.lastStatus = String(parsed.lastStatus || "");
      gistMirror.state.lastMessage = String(parsed.lastMessage || "");
      gistMirror.state.lastGistHash = String(parsed.lastGistHash || "");
      gistMirror.state.lastHubVersion = Number(parsed.lastHubVersion) || 0;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      log("warn", "gist_mirror_state_load_failed", { message: error.message });
    }
  }
};

const syncGistMirrorConfig = async (patch = {}) => {
  const source = patch && typeof patch === "object" ? patch : {};
  if (typeof source.enabled === "boolean") {
    gistMirror.config.enabled = source.enabled;
  }
  if (GIST_MIRROR_SCHEDULES.includes(source.schedule)) {
    gistMirror.config.schedule = source.schedule;
  }
  if (
    Object.prototype.hasOwnProperty.call(source, "dailyTime") &&
    source.dailyTime !== undefined &&
    source.dailyTime !== null
  ) {
    gistMirror.config.dailyTime = normalizeGistMirrorDailyTime(
      source.dailyTime
    );
  }
  await persistGistMirrorConfig();
  scheduleGistMirrorTimer();
  return publicGistMirrorStatus();
};

const deterministicSortMirror = (value) => {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deterministicSortMirror);
  }
  const sorted = Object.create(null);
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = deterministicSortMirror(value[key]);
    });
  return sorted;
};

const stableStringifyMirror = (value) =>
  JSON.stringify(deterministicSortMirror(value));

const hashMirrorData = (data) =>
  crypto
    .createHash("sha256")
    .update(stableStringifyMirror(data))
    .digest("hex");

const mirrorWithoutReadProgress = (data) => {
  const copy = { ...(data && typeof data === "object" ? data : {}) };
  delete copy.read_progress;
  return copy;
};

const parseMirrorOrderNumber = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const compareMirrorProgressRecords = (left, right) => {
  const leftPage = parseMirrorOrderNumber(left?.page);
  const rightPage = parseMirrorOrderNumber(right?.page);
  if (leftPage !== rightPage) return leftPage - rightPage;
  const leftFloor = parseMirrorOrderNumber(left?.lastReadFloor);
  const rightFloor = parseMirrorOrderNumber(right?.lastReadFloor);
  if (leftFloor !== rightFloor) return leftFloor - rightFloor;
  const leftTs = Number(left?.timestamp) || 0;
  const rightTs = Number(right?.timestamp) || 0;
  return leftTs - rightTs;
};

const mergeMirrorReadProgress = (localProgress, remoteProgress) => {
  const local =
    localProgress && typeof localProgress === "object" ? localProgress : {};
  const remote =
    remoteProgress && typeof remoteProgress === "object" ? remoteProgress : {};
  const merged = { ...remote };
  Object.keys(local).forEach((threadId) => {
    const localRecord = local[threadId];
    const remoteRecord = merged[threadId];
    if (!remoteRecord || compareMirrorProgressRecords(localRecord, remoteRecord) >= 0) {
      merged[threadId] = localRecord;
    }
  });
  return merged;
};

const buildMirrorPayload = (basePayload, data) => {
  const contentHash = hashMirrorData(data);
  const lastUpdated = Math.max(
    Number(basePayload?.lastUpdated) || 0,
    Date.now()
  );
  const payload = {
    version: 5.0,
    lastUpdated,
    lastUpdatedFormatted: new Date(lastUpdated).toLocaleString("zh-CN", {
      hour12: false,
    }),
    data,
    contentHash,
    baseContentHash: String(basePayload?.baseContentHash || "") || null,
  };
  if (basePayload?.syncMeta && typeof basePayload.syncMeta === "object") {
    payload.syncMeta = basePayload.syncMeta;
  }
  return payload;
};

const validateMirrorPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Gist 同步内容为空或格式无效");
  }
  if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new Error("Gist 同步内容缺少 data（可能是旧版格式，请先用浏览器同步一次）");
  }
  const hash = hashMirrorData(payload.data);
  if (payload.contentHash && payload.contentHash !== hash) {
    throw new Error("Gist 同步内容哈希校验失败，已跳过镜像");
  }
  return { data: payload.data, hash };
};

const mirrorGistRequest = async (pathname, init = {}) => {
  const response = await fetch(`${CONFIG.gistMirror.apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CONFIG.gistMirror.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "s1plus-lan-hub",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error(
      `GitHub API ${response.status}: ${json?.message || "request failed"}`
    );
    error.status = response.status;
    throw error;
  }
  return json;
};

const readGistMirrorPayload = async () => {
  const gistId = encodeURIComponent(CONFIG.gistMirror.gistId);
  const gist = await mirrorGistRequest(`/gists/${gistId}`);
  const file = gist?.files?.[GIST_MIRROR_SYNC_FILENAME];
  if (!file) {
    return { empty: true, updatedAt: gist?.updated_at || null };
  }
  let content = typeof file.content === "string" ? file.content : "";
  if (file.truncated || !content.trim()) {
    if (!file.raw_url) {
      throw new Error("Gist 文件被截断且缺少 raw_url");
    }
    const rawResponse = await fetch(file.raw_url, {
      headers: {
        Authorization: `Bearer ${CONFIG.gistMirror.token}`,
        "User-Agent": "s1plus-lan-hub",
      },
    });
    if (!rawResponse.ok) {
      throw new Error(`读取 Gist 原始内容失败（${rawResponse.status}）`);
    }
    content = await rawResponse.text();
  }
  let payload = null;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error("Gist 同步内容不是合法 JSON");
  }
  return { empty: false, payload, updatedAt: gist?.updated_at || null };
};

const writeGistMirrorPayload = async (payload) => {
  const gistId = encodeURIComponent(CONFIG.gistMirror.gistId);
  const gist = await mirrorGistRequest(`/gists/${gistId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: {
        [GIST_MIRROR_SYNC_FILENAME]: { content: JSON.stringify(payload) },
      },
    }),
  });
  return gist?.updated_at || null;
};

const setGistMirrorState = async (patch = {}) => {
  gistMirror.state = {
    ...gistMirror.state,
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  await persistGistMirrorState();
};

const runGistMirror = async (reason = "scheduled") => {
  if (!gistMirror.configured) {
    await setGistMirrorState({
      lastAt: Date.now(),
      lastStatus: "skipped",
      lastMessage: "未配置 HUB_GIST_MIRROR_GIST_ID / TOKEN",
    });
    return { status: "skipped", reason: "not_configured" };
  }
  if (gistMirror.running) {
    return { status: "skipped", reason: "running" };
  }
  if (reason !== "manual" && gistMirror.config.enabled !== true) {
    return { status: "skipped", reason: "disabled" };
  }
  gistMirror.running = true;
  const startedAt = Date.now();
  try {
    if (
      !state.payload ||
      typeof state.payload !== "object" ||
      !state.payload.data ||
      typeof state.payload.data !== "object"
    ) {
      await setGistMirrorState({
        lastAt: Date.now(),
        lastStatus: "skipped",
        lastMessage: "Hub 还没有可镜像的同步快照",
      });
      return { status: "skipped", reason: "no_snapshot" };
    }
    const localVersion = state.version;
    const localPayload = state.payload;
    const localData = localPayload.data;
    const gist = await readGistMirrorPayload();
    if (gist.empty) {
      const payload = buildMirrorPayload(localPayload, localData);
      await writeGistMirrorPayload(payload);
      await setGistMirrorState({
        lastAt: Date.now(),
        lastStatus: "success",
        lastMessage: "已把 Hub 快照初始化到 Gist",
        lastGistHash: payload.contentHash,
        lastHubVersion: localVersion,
      });
      log("info", "gist_mirror_done", {
        reason,
        action: "seed",
        ms: Date.now() - startedAt,
      });
      return { status: "success", action: "seed" };
    }

    const validated = validateMirrorPayload(gist.payload);
    const localHash = hashMirrorData(localData);
    if (localHash === validated.hash) {
      await setGistMirrorState({
        lastAt: Date.now(),
        lastStatus: "no_change",
        lastMessage: "Gist 与 Hub 一致",
        lastGistHash: localHash,
        lastHubVersion: localVersion,
      });
      return { status: "success", action: "no_change" };
    }

    const localCore = stableStringifyMirror(
      mirrorWithoutReadProgress(localData)
    );
    const gistCore = stableStringifyMirror(
      mirrorWithoutReadProgress(validated.data)
    );
    if (localCore !== gistCore) {
      await setGistMirrorState({
        lastAt: Date.now(),
        lastStatus: "conflict",
        lastMessage:
          "Gist 与 Hub 存在核心数据差异，镜像已跳过；请在浏览器里手动同步处理",
        lastHubVersion: localVersion,
      });
      log("warn", "gist_mirror_conflict", { reason });
      return { status: "conflict", reason: "core_data_differs" };
    }

    const mergedData = {
      ...localData,
      read_progress: mergeMirrorReadProgress(
        localData.read_progress,
        validated.data.read_progress
      ),
    };
    const mergedHash = hashMirrorData(mergedData);
    if (mergedHash !== validated.hash) {
      await writeGistMirrorPayload(buildMirrorPayload(localPayload, mergedData));
    }

    const hubApply = await withMutation(async () => {
      if (state.version !== localVersion) {
        return { applied: false, reason: "hub_changed" };
      }
      const nextPayload = buildMirrorPayload(localPayload, mergedData);
      const nextState = {
        version: state.version + 1,
        updatedAt: Date.now(),
        contentHash: hashPayload(nextPayload),
        payload: nextPayload,
      };
      await persistSnapshot(nextState);
      await writeHistory(nextState);
      state.version = nextState.version;
      state.updatedAt = nextState.updatedAt;
      state.contentHash = nextState.contentHash;
      state.payload = nextState.payload;
      return { applied: true };
    });
    if (hubApply.applied) {
      broadcast();
    }
    const message = hubApply.applied
      ? mergedHash === validated.hash
        ? "Gist 已是最新，Hub 已对齐"
        : "已合并阅读进度并写回 Gist / Hub"
      : "Gist 已更新；Hub 在镜像期间有新写入，下一轮再收敛";
    await setGistMirrorState({
      lastAt: Date.now(),
      lastStatus: "success",
      lastMessage: message,
      lastGistHash: mergedHash,
      lastHubVersion: hubApply.applied ? state.version : localVersion,
    });
    log("info", "gist_mirror_done", {
      reason,
      action: hubApply.applied ? "merged" : "gist_only",
      gistChanged: mergedHash !== validated.hash,
      hubApplied: hubApply.applied,
      ms: Date.now() - startedAt,
    });
    return {
      status: "success",
      action: hubApply.applied ? "merged" : "gist_only",
      message,
    };
  } catch (error) {
    const message = String(error?.message || error || "Gist 镜像失败");
    await setGistMirrorState({
      lastAt: Date.now(),
      lastStatus: "failure",
      lastMessage: message,
    });
    log("warn", "gist_mirror_failed", {
      reason,
      message,
      status: Number(error?.status) || 0,
    });
    return { status: "failure", message };
  } finally {
    gistMirror.running = false;
  }
};

const computeGistMirrorDueAt = (now = Date.now()) => {
  if (!gistMirror.configured || gistMirror.config.enabled !== true) {
    return 0;
  }
  const lastAt = gistMirror.state.lastAt || 0;
  if (gistMirror.config.schedule === "daily") {
    const [hours, minutes] = gistMirror.config.dailyTime.split(":").map(Number);
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    if (lastAt >= todayStart.getTime()) {
      return candidate.getTime() + 24 * 60 * 60 * 1000;
    }
    return now >= candidate.getTime() ? now : candidate.getTime();
  }
  const intervalMs =
    GIST_MIRROR_INTERVAL_MS[gistMirror.config.schedule] ||
    GIST_MIRROR_INTERVAL_MS.hourly;
  return lastAt ? lastAt + intervalMs : now + GIST_MIRROR_RECHECK_MS;
};

const scheduleGistMirrorTimer = () => {
  if (gistMirror.timer) {
    clearTimeout(gistMirror.timer);
    gistMirror.timer = null;
  }
  const now = Date.now();
  const dueAt = computeGistMirrorDueAt(now);
  if (!dueAt) {
    return;
  }
  const delayMs = Math.max(GIST_MIRROR_MIN_DELAY_MS, dueAt - now);
  gistMirror.timer = setTimeout(() => {
    gistMirror.timer = null;
    void runGistMirror("scheduled").finally(() => scheduleGistMirrorTimer());
  }, delayMs);
  log("info", "gist_mirror_scheduled", {
    dueAt,
    delayMs,
    schedule: gistMirror.config.schedule,
    dailyTime: gistMirror.config.dailyTime,
  });
};

const handleGistMirrorConfig = async (req, res) => {
  const body = await readJsonBody(req);
  const patch = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.schedule !== undefined) patch.schedule = body.schedule;
  if (body.dailyTime !== undefined) patch.dailyTime = body.dailyTime;
  const status = await syncGistMirrorConfig(patch);
  return sendJson(res, 200, { ok: true, gistMirror: status });
};

const handleWait = (req, res, url) => {
  const since = Number(url.searchParams.get("since") || 0);
  const timeoutMs = clamp(
    Number(url.searchParams.get("timeout") || CONFIG.longPollTimeoutMs),
    1000,
    Math.min(CONFIG.longPollTimeoutMs, CONFIG.longPollMaxTimeoutMs)
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
        gistMirror: publicGistMirrorStatus(),
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

    if (pathname === "/mirror" || pathname === "/mirror/config") {
      if (req.method === "GET" && pathname === "/mirror") {
        return sendJson(res, 200, {
          ok: true,
          gistMirror: publicGistMirrorStatus(),
        });
      }
      if (req.method === "PUT" && pathname === "/mirror/config") {
        return await handleGistMirrorConfig(req, res);
      }
      if (
        req.method === "POST" &&
        (pathname === "/mirror" || pathname === "/mirror/run")
      ) {
        const result = await runGistMirror("manual");
        return sendJson(res, result.status === "failure" ? 502 : 200, {
          ok: result.status !== "failure",
          result,
          gistMirror: publicGistMirrorStatus(),
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
  await loadGistMirrorFiles();
  scheduleGistMirrorTimer();
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
    if (gistMirror.timer) {
      clearTimeout(gistMirror.timer);
      gistMirror.timer = null;
    }
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
