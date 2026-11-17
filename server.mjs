// magpie 窗口里的 TokenTracker 用量页面：本机零依赖服务。
//
// 做两类事：
//   1. 读本机 TokenTracker 的回环接口与本机文件，整理成页面用的 JSON：
//      /api/usage（主用量）、/api/limits（配额）、/api/heatmap（近一年热力图）、
//      /api/achievements（成就）、/api/cloud（官方云登录态），各自带缓存与并发合并。
//   2. 把 page/ 里的看板静态文件发出去（看板是全内联单页）。
// 服务只绑 127.0.0.1，Host 非回环直接拒绝；CORS 只放 opaque origin（Origin: null）
// 与本服务自己的回环来源，别的网站读不到内容。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  buildPayload,
  dateInZone,
  normalizePeriod,
  periodRange,
  achievementRows,
  heatmapCells,
  limitsRows,
  DEFAULT_TIME_ZONE,
} from "./lib/usage.mjs";
import { readOfficialStatus } from "./lib/official.mjs";
import { apiGet, ensureRunning, probe, resolvePort, baseUrl } from "./lib/tokentracker.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_NAME = "magpie-tokentracker";
const BUILD = 4; // 服务行为变了就 +1：端口被占时老 build 不复用，等它退
const REBIND_MS = 20000; // magpie 自升级交接时旧宿主几秒内退出，等它即可
const REBIND_STEP_MS = 1000;
const PAGE_DIR = path.join(HERE, "page");
export const DEFAULT_PAGE_PORT = 3491;
const USAGE_TTL_MS = 8000;
const LIMITS_TTL_MS = 60000; // 配额上游本身就是慢变量，60 秒够新鲜
const PANEL_TTL_MS = 300000; // 热力图 / 成就：5 分钟
const HEATMAP_BACK_DAYS = 364; // 近一年：今天（当前时区）往前推 364 天，含首尾 365 天
const TT_DOC = "https://github.com/xiufengsun/TokenTracker";
const OFFICIAL_CONFIG_PATH = path.join(os.homedir(), ".tokentracker", "tracker", "config.json");
const OFFICIAL_LINKS = {
  localDashboard: "http://127.0.0.1:7680",
  web: "https://www.tokentracker.cc",
  cloud: "https://www.tokentracker.cc/cloud",
};
const OFFICIAL_LOGIN_COMMAND = "tokentracker device-login";

const STATIC = new Map([
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8" }],
  ["/icon.svg", { file: "icon.svg", type: "image/svg+xml" }],
  ["/favicon.ico", { file: "icon.svg", type: "image/svg+xml" }],
]);

function hostIsLoopback(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const name = (host.match(/^(\[[^\]]+\]|[^:]+)/) || [])[1] || "";
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function guardHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

// magpie 的页面 frame 是 sandbox="allow-scripts"（opaque origin，Origin: null）。
// 看板从该 frame 里 fetch 本服务的 /api/* 是跨源请求，必须回 ACAO: null 才能读到；
// 其它网站发来的 Origin 一律拒绝。顶层导航不带 Origin，不受影响。
function loopbackOrigin(origin, boundPort) {
  if (!boundPort) return false;
  return (
    origin === `http://127.0.0.1:${boundPort}` ||
    origin === `http://localhost:${boundPort}` ||
    origin === `http://[::1]:${boundPort}`
  );
}

function applyCors(req, res, boundPort) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "null") {
    res.setHeader("Access-Control-Allow-Origin", "null");
    res.setHeader("Vary", "Origin");
    return true;
  }
  if (loopbackOrigin(origin, boundPort)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    return true;
  }
  return false;
}

// TokenTracker 不在时新接口的统一降级载荷（回 503）。
function unreachablePayload(tt) {
  return {
    ok: false,
    error: "tokentracker_unreachable",
    detail: tt.error || "unreachable",
    hint: { base: tt.base, command: "npx tokentracker serve", doc: TT_DOC },
  };
}

// 探活 + 必要时拉起 TokenTracker，所有 loader 共用一份：
// 并发请求只走一次启动流程（别各拉一个子进程），拉起失败后冷却 60 秒，
// 避免每 20 秒的自动刷新反复 spawn。
function createEnsureOnce(options) {
  let starting = null;
  let failedAt = 0; // 拉起失败后冷却一段时间
  const FAIL_BACKOFF_MS = 60000;

  return async function ensureOnce(ttPort) {
    if (!starting) {
      if (failedAt && Date.now() - failedAt < FAIL_BACKOFF_MS) {
        return { reachable: false, base: baseUrl(ttPort), error: "not running (backoff)" };
      }
      starting = ensureRunning({
        port: ttPort,
        autoStart: options.autoStart !== false,
        command: options.command,
        log: options.log,
      }).then((tt) => {
        // 只有真的试过拉起才进冷却；关掉自动拉起时不需要
        if (!tt.reachable && options.autoStart !== false) failedAt = Date.now();
        else failedAt = 0;
        return tt;
      }).finally(() => {
        starting = null;
      });
    }
    return starting;
  };
}

// 一个周期一次请求 = 三个 TokenTracker 接口；8 秒内复用，挡住页面自动刷新的抖动。
function createUsageLoader(options, ensureOnce) {
  const cache = new Map();
  let inflight = null;

  return async function loadUsage(period, { force = false } = {}) {
    const key = period;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.payload;
    if (!force && inflight) return inflight;

    const task = (async () => {
      const tz = options.timeZone || DEFAULT_TIME_ZONE;
      const now = new Date();
      const range = periodRange(period, { timeZone: tz, now });
      const ttPort = resolvePort(options.tokentrackerPort);
      const tt = await ensureOnce(ttPort);
      if (!tt.reachable) {
        return {
          ok: false,
          period,
          timeZone: tz,
          from: range.from,
          to: range.to,
          generatedAt: now.toISOString(),
          error: "tokentracker_unreachable",
          detail: tt.error || "unreachable",
          hint: {
            base: tt.base,
            command: "npx tokentracker serve",
            doc: TT_DOC,
          },
        };
      }
      const common = { from: range.from, to: range.to, tz };
      const seriesKind = period === "today" ? "hourly" : "daily";
      const [summary, breakdown, series] = await Promise.all([
        apiGet(tt.base, "tokentracker-usage-summary", { ...common, rolling: 1 }),
        apiGet(tt.base, "tokentracker-usage-model-breakdown", common),
        apiGet(tt.base, `tokentracker-usage-${seriesKind}`, common),
      ]);
      const payload = buildPayload({
        period,
        timeZone: tz,
        now,
        range,
        summary,
        breakdown,
        seriesKind,
        seriesRaw: series,
      });
      payload.tokentracker = {
        reachable: true,
        base: tt.base,
        version: tt.version || "",
        autoStarted: !!tt.started,
      };
      cache.set(key, { at: Date.now(), payload });
      return payload;
    })();

    inflight = task;
    try {
      return await task;
    } finally {
      inflight = null;
    }
  };
}

// 低频面板接口的通用 loader：单槽缓存 + 同键并发合并 + force 绕过；
// 失败不缓存（探活/拉起的冷却由共用的 ensureOnce 管）。
function createPanelLoader({ ttlMs, ensureOnce, options, fetchPayload }) {
  let cache = null;
  let inflight = null;

  return async function load({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < ttlMs) return cache.payload;
    if (!force && inflight) return inflight;

    const task = (async () => {
      const now = new Date();
      const ttPort = resolvePort(options.tokentrackerPort);
      const tt = await ensureOnce(ttPort);
      if (!tt.reachable) return unreachablePayload(tt);
      try {
        const payload = await fetchPayload({
          base: tt.base,
          timeZone: options.timeZone || DEFAULT_TIME_ZONE,
          now,
        });
        cache = { at: Date.now(), payload };
        return payload;
      } catch (error) {
        // TokenTracker 活着但单个接口出错（老版本没有这个 slug 等）：
        // 不缓存，下次再试，页面把这块面板降级成「暂不可用」。
        return { ok: false, error: "tokentracker_error", detail: String(error?.message || error) };
      }
    })();

    inflight = task;
    try {
      return await task;
    } finally {
      inflight = null;
    }
  };
}

function createLimitsLoader(options, ensureOnce) {
  return createPanelLoader({
    ttlMs: LIMITS_TTL_MS,
    ensureOnce,
    options,
    fetchPayload: async ({ base }) => {
      const raw = await apiGet(base, "tokentracker-usage-limits");
      return { ok: true, fetchedAt: String(raw?.fetched_at || ""), rows: limitsRows(raw) };
    },
  });
}

function createHeatmapLoader(options, ensureOnce) {
  return createPanelLoader({
    ttlMs: PANEL_TTL_MS,
    ensureOnce,
    options,
    fetchPayload: async ({ base, timeZone, now }) => {
      const today = dateInZone(timeZone, now);
      const from = addDays(today, -HEATMAP_BACK_DAYS);
      const raw = await apiGet(base, "tokentracker-usage-heatmap", { from, to: today });
      const heat = heatmapCells(raw);
      return {
        ok: true,
        from: heat.from || from,
        to: heat.to || today,
        activeDays: heat.activeDays,
        streakDays: heat.streakDays,
        weeks: heat.weeks,
        months: heat.months,
      };
    },
  });
}

function createAchievementsLoader(options, ensureOnce) {
  return createPanelLoader({
    ttlMs: PANEL_TTL_MS,
    ensureOnce,
    options,
    fetchPayload: async ({ base }) => {
      const raw = await apiGet(base, "tokentracker-achievements");
      return { ok: true, generatedAt: String(raw?.generated_at || ""), rows: achievementRows(raw) };
    },
  });
}

async function sendFile(res, file, type) {
  try {
    const data = await readFile(path.join(PAGE_DIR, file));
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "Content-Length": data.length,
    });
    res.end(data);
  } catch {
    json(res, 404, { ok: false, error: "not found" });
  }
}

function asBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

// 选项来自 magpie 的 plugins.json；手动 `node index.mjs` 时用环境变量兜底。
function resolveOptions(options) {
  const env = process.env;
  return {
    ...options,
    port:
      options.port !== undefined && options.port !== null
        ? options.port
        : env.MAGPIE_TOKENTRACKER_PORT !== undefined && env.MAGPIE_TOKENTRACKER_PORT !== ""
          ? Number(env.MAGPIE_TOKENTRACKER_PORT)
          : DEFAULT_PAGE_PORT,
    tokentrackerPort: options.tokentrackerPort || env.MAGPIE_TOKENTRACKER_TT_PORT || undefined,
    autoStart: asBool(options.autoStart, asBool(env.MAGPIE_TOKENTRACKER_AUTOSTART, true)),
    command: options.command || env.MAGPIE_TOKENTRACKER_COMMAND || "",
    timeZone: options.timeZone || env.MAGPIE_TOKENTRACKER_TZ || "",
  };
}

function resolvePagePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PAGE_PORT;
}

export async function startServer(rawOptions = {}) {
  const options = resolveOptions(rawOptions);
  const log = options.log || ((line) => console.error(`[magpie-tokentracker] ${line}`));
  const ensureOnce = createEnsureOnce({ ...options, log });
  const loadUsage = createUsageLoader({ ...options, log }, ensureOnce);
  const loadLimits = createLimitsLoader({ ...options, log }, ensureOnce);
  const loadHeatmap = createHeatmapLoader({ ...options, log }, ensureOnce);
  const loadAchievements = createAchievementsLoader({ ...options, log }, ensureOnce);
  // 0 = 让系统随便给一个口（测试用）；其余值归一到合法端口。
  // 注意这里不能用 lib 的 resolvePort：它的兜底是 TokenTracker 的 7680。
  const port = options.port === 0 ? 0 : resolvePagePort(options.port);
  const host = "127.0.0.1";

  const server = createServer(async (req, res) => {
    guardHeaders(res);
    try {
      if (!hostIsLoopback(req)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("loopback hosts only");
        return;
      }
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const route = url.pathname;
      const boundPort = server.address()?.port || port;

      if (route.startsWith("/api/")) {
        if (req.method === "OPTIONS") {
          if (!applyCors(req, res, boundPort)) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("cross-origin reads not allowed");
            return;
          }
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Accept, Content-Type",
            "Access-Control-Max-Age": "86400",
          });
          res.end();
          return;
        }
        if (!applyCors(req, res, boundPort)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("cross-origin reads not allowed");
          return;
        }
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { ok: false, error: "method not allowed" });
        return;
      }

      if (route === "/" || route === "/index.html") {
        // 看板打成全内联单文件：magpie 的沙盒 frame 是 opaque origin，
        // CSP 里 'self' 匹配不到任何来源，外链 css/js 一律会被拦。
        // 服务端把 style/app 内联进模板，并把 __SERVICE_BASE__ 注入成绝对地址。
        const [tpl, css, js] = await Promise.all([
          readFile(path.join(PAGE_DIR, "board.html"), "utf8"),
          readFile(path.join(PAGE_DIR, "style.css"), "utf8"),
          readFile(path.join(PAGE_DIR, "app.js"), "utf8"),
        ]);
        const serviceBase = `http://127.0.0.1:${boundPort}`;
        const html = tpl
          .replace("<!--__INLINE_STYLE__-->", `<style>\n${css}\n</style>`)
          .replace(
            "<!--__INLINE_SCRIPT__-->",
            `<script>\n${js.replaceAll("__SERVICE_BASE__", serviceBase)}\n<` + "/script>",
          );
        const body = Buffer.from(html, "utf8");
        // connect-src 显式写本机来源：沙盒 frame 里 'self' 匹配不到任何来源。
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; ` +
            `img-src data:; ` +
            `connect-src http://127.0.0.1:${boundPort} http://localhost:${boundPort} http://[::1]:${boundPort}; ` +
            `object-src 'none'; base-uri 'none'; form-action 'none'`,
          "Content-Length": body.length,
        });
        res.end(body);
        return;
      }

      const asset = STATIC.get(route);
      if (asset) {
        await sendFile(res, asset.file, asset.type);
        return;
      }

      if (route === "/api/usage") {
        const period = normalizePeriod(url.searchParams.get("period"));
        const force = url.searchParams.get("force") === "1";
        const payload = await loadUsage(period, { force });
        json(res, payload.ok === false ? 503 : 200, payload);
        return;
      }

      if (route === "/api/limits") {
        const payload = await loadLimits({ force: url.searchParams.get("force") === "1" });
        json(res, payload.ok === false ? 503 : 200, payload);
        return;
      }

      if (route === "/api/heatmap") {
        const payload = await loadHeatmap({ force: url.searchParams.get("force") === "1" });
        json(res, payload.ok === false ? 503 : 200, payload);
        return;
      }

      if (route === "/api/achievements") {
        const payload = await loadAchievements({ force: url.searchParams.get("force") === "1" });
        json(res, payload.ok === false ? 503 : 200, payload);
        return;
      }

      if (route === "/api/cloud") {
        // 官方云登录态：读本机配置文件，纯本地只读，无需缓存。
        const official = await readOfficialStatus(OFFICIAL_CONFIG_PATH);
        json(res, 200, {
          ok: true,
          official,
          links: OFFICIAL_LINKS,
          loginCommand: OFFICIAL_LOGIN_COMMAND,
        });
        return;
      }

      if (route === "/api/status") {
        const ttPort = resolvePort(options.tokentrackerPort);
        const base = baseUrl(ttPort);
        const tt = await probe(base);
        json(res, 200, {
          ok: true,
          service: { ok: true, port: server.address()?.port || port },
          tokentracker: { reachable: tt.reachable, base, version: tt.version || "", error: tt.error || "" },
        });
        return;
      }

      if (route === "/api/healthz") {
        // 指纹给「端口被占时复用还是等它退」的判定用
        json(res, 200, { ok: true, service: SERVICE_NAME, build: BUILD });
        return;
      }

      json(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      log(`request failed: ${error?.stack || error}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: String(error?.message || error) });
      else res.end();
    }
  });

  // 端口被占时（magpie 自升级交接、双实例、手动跑过一份）：同款服务连续两次探活
  // 成功 → 直接复用；否则等旧实例退出再绑（升级交接里旧宿主几秒内就退）。
  const listenOnce = () =>
    new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });

  const probeFingerprint = async (probePort) => {
    try {
      const res = await fetch(`http://127.0.0.1:${probePort}/api/healthz`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.service === SERVICE_NAME ? { build: Number(body?.build) || 0, port: probePort } : null;
    } catch {
      return null;
    }
  };

  let bound = null;
  if (port !== 0) {
    for (let waited = 0; ; waited += REBIND_STEP_MS) {
      const first = await probeFingerprint(port);
      if (first) {
        const second = await probeFingerprint(port);
        if (second) {
          if (first.build !== BUILD) log(`found same service (build ${first.build} != ${BUILD}) on ${port}; reusing it`);
          else log(`same service already on ${port}; reusing it`);
          server.close(); // 没绑成，把没用的 server 对象丢掉
          log(`board on http://127.0.0.1:${port}/ (reused; TokenTracker ${baseUrl(options.tokentrackerPort)})`);
          return { port, server: null, close: () => {}, reused: true };
        }
      }
      try {
        await listenOnce();
        bound = server.address()?.port || port;
        break;
      } catch (error) {
        if (error?.code !== "EADDRINUSE" || waited + REBIND_STEP_MS > REBIND_MS) throw error;
        await new Promise((r) => setTimeout(r, REBIND_STEP_MS));
      }
    }
  } else {
    await listenOnce();
    bound = server.address()?.port || port;
  }
  log(`board on http://127.0.0.1:${bound}/ (TokenTracker ${baseUrl(options.tokentrackerPort)})`);
  return { port: bound, server, close: () => server.close() };
}
