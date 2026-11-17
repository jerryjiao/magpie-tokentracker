// 服务层测试：用一个假的 TokenTracker 回环服务喂真实形状的响应，
// 检查我们的服务端路由、鉴权边界、静态文件和「连不上」的降级路径。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../server.mjs";
import { resolveCommand } from "../lib/tokentracker.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(path.join(HERE, "fixtures", name), "utf8"));

const summary = fixture("summary-7d.json");
const breakdown = fixture("model-breakdown-30d.json");
const daily = fixture("daily-7d.json");
const hourly = fixture("hourly-today.json");
const limits = fixture("limits.json");
const heatmap = fixture("heatmap.json");
const achievements = fixture("achievements.json");

async function startFakeTracker() {
  // hits：每个 function 接口被打了几次，用来断言缓存合并
  const hits = { summary: 0, breakdown: 0, daily: 0, hourly: 0, limits: 0, heatmap: 0, achievements: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/local-auth") {
      res.end(JSON.stringify({ token: "fake-token", serverVersion: "9.9.9" }));
      return;
    }
    const map = {
      "/functions/tokentracker-usage-summary": ["summary", summary],
      "/functions/tokentracker-usage-model-breakdown": ["breakdown", breakdown],
      "/functions/tokentracker-usage-daily": ["daily", daily],
      "/functions/tokentracker-usage-hourly": ["hourly", hourly],
      "/functions/tokentracker-usage-limits": ["limits", limits],
      "/functions/tokentracker-usage-heatmap": ["heatmap", heatmap],
      "/functions/tokentracker-achievements": ["achievements", achievements],
    };
    const entry = map[url.pathname];
    if (!entry) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    hits[entry[0]] += 1;
    res.end(JSON.stringify(entry[1]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
    hits,
  };
}

test("服务端：/api/usage 与三个 TokenTracker 接口合流", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false, timeZone: "Asia/Shanghai" });
  t.after(async () => {
    board.close();
    await tracker.close();
  });

  const res = await fetch(`http://127.0.0.1:${board.port}/api/usage?period=7d`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.period, "7d");
  assert.equal(data.cards.tokens, 1193001134);
  assert.equal(data.sources.length, 4);
  assert.equal(data.series.points.length, 7);
  assert.equal(data.tokentracker.reachable, true);
  assert.equal(data.tokentracker.version, "9.9.9");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("服务端：今天用 hourly，卡片与序列一致", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false });
  t.after(async () => {
    board.close();
    await tracker.close();
  });
  const res = await fetch(`http://127.0.0.1:${board.port}/api/usage?period=today`);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.series.kind, "hourly");
  assert.equal(data.series.points.length, 24);
});

test("服务端：页面、静态资源和 CSP", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false });
  t.after(async () => {
    board.close();
    await tracker.close();
  });
  const page = await fetch(`http://127.0.0.1:${board.port}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const csp = page.headers.get("content-security-policy") || "";
  // 沙盒 frame 是 opaque origin：CSP 里不许再出现匹配不到来源的 'self'，
  // 也不许有外链 css/js —— 看板必须全内联。
  assert.doesNotMatch(csp, /'self'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  const html = await page.text();
  assert.match(html, /TokenTracker 用量/);
  assert.match(html, /<style>/);
  assert.match(html, /<script>/);
  assert.doesNotMatch(html, /<link rel="stylesheet"/);
  assert.doesNotMatch(html, /<script src=/);
  assert.match(html, /const SERVICE_BASE = "http:\/\/127\.0\.0\.1:\d+"/);

  const js = await fetch(`http://127.0.0.1:${board.port}/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);

  const css = await fetch(`http://127.0.0.1:${board.port}/style.css`);
  assert.equal(css.status, 200);

  const icon = await fetch(`http://127.0.0.1:${board.port}/icon.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type"), /image\/svg/);

  const missing = await fetch(`http://127.0.0.1:${board.port}/nope`);
  assert.equal(missing.status, 404);
});

test("服务端：只认回环 Host，也只收 GET", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false });
  t.after(async () => {
    board.close();
    await tracker.close();
  });

  // fetch/undici 会丢掉禁止改写的 Host，这里用原始 http 请求伪造 Host。
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: board.port, path: "/api/usage", headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);

  const post = await fetch(`http://127.0.0.1:${board.port}/api/usage`, { method: "POST" });
  assert.equal(post.status, 405);
});

test("服务端：TokenTracker 不在时给 503 + 启动命令", async (t) => {
  const tracker = await startFakeTracker();
  const deadPort = tracker.port;
  await tracker.close();
  const board = await startServer({ port: 0, tokentrackerPort: deadPort, autoStart: false });
  t.after(() => board.close());

  const res = await fetch(`http://127.0.0.1:${board.port}/api/usage?period=today`);
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, "tokentracker_unreachable");
  assert.equal(data.hint.command, "npx tokentracker serve");

  const status = await (await fetch(`http://127.0.0.1:${board.port}/api/status`)).json();
  assert.equal(status.tokentracker.reachable, false);
});

test("resolveCommand：用户命令优先，其次 PATH，最后 npx", () => {
  const custom = resolveCommand("/opt/bin/tokentracker --no-sync", 7000);
  assert.equal(custom.bin, "/opt/bin/tokentracker");
  assert.deepEqual(custom.args, ["--no-sync", "serve", "--no-open", "--port", "7000"]);

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent-dir";
    const npx = resolveCommand("", 7001);
    // 机器上没有 PATH 时只能给空
    assert.equal(typeof npx.bin, "string");
    assert.ok(npx.bin === "" || npx.args.includes("tokentracker-cli"));
  } finally {
    process.env.PATH = originalPath;
  }
});

test("服务端：/api/limits /api/heatmap /api/achievements 透传 + 缓存合并", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false, timeZone: "Asia/Shanghai" });
  t.after(async () => {
    board.close();
    await tracker.close();
  });
  const base = `http://127.0.0.1:${board.port}`;

  // limits：整理成 rows，60 秒缓存内第二次请求不打上游
  const limitsRes = await fetch(`${base}/api/limits`);
  assert.equal(limitsRes.status, 200);
  const limitsData = await limitsRes.json();
  assert.equal(limitsData.ok, true);
  assert.deepEqual(
    limitsData.rows.map((r) => r.id),
    ["zcode", "claude", "codex", "workbuddy"],
  );
  assert.deepEqual(
    limitsData.rows[0].windows.map((w) => w.label),
    ["5h", "Tools"],
  );
  assert.equal(tracker.hits.limits, 1);
  await fetch(`${base}/api/limits`);
  assert.equal(tracker.hits.limits, 1);

  // heatmap：并发请求合并成一次上游调用；weeks/months 已经是页面要的形状
  const [heatRes1, heatRes2] = await Promise.all([fetch(`${base}/api/heatmap`), fetch(`${base}/api/heatmap`)]);
  assert.equal(heatRes1.status, 200);
  assert.equal(heatRes2.status, 200);
  const heat = await heatRes1.json();
  assert.equal(heat.ok, true);
  assert.equal(heat.weeks.length, 10);
  assert.ok(Array.isArray(heat.months) && heat.months.length >= 2);
  assert.equal(heat.months[0].index, 0);
  assert.equal(heat.months[0].label, heat.weeks[0][0].date.slice(0, 7));
  assert.ok(heat.activeDays >= 1);
  assert.equal(tracker.hits.heatmap, 1);

  // achievements：整理成 rows
  const achRes = await fetch(`${base}/api/achievements`);
  assert.equal(achRes.status, 200);
  const ach = await achRes.json();
  assert.equal(ach.ok, true);
  assert.equal(ach.rows.length, 3);
  assert.equal(ach.rows.find((r) => r.id === "night_owl").name, "夜猫子");
  assert.equal(tracker.hits.achievements, 1);

  // force=1 绕过缓存
  await fetch(`${base}/api/achievements?force=1`);
  assert.equal(tracker.hits.achievements, 2);

  // 新接口一样只认回环 Host
  const badHost = await new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: board.port, path: "/api/limits", headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHost, 403);
});

test("服务端：TokenTracker 不在时三个新接口也回 503 + 提示", async (t) => {
  const tracker = await startFakeTracker();
  const deadPort = tracker.port;
  await tracker.close();
  const board = await startServer({ port: 0, tokentrackerPort: deadPort, autoStart: false });
  t.after(() => board.close());

  const results = await Promise.all(
    ["/api/limits", "/api/heatmap", "/api/achievements"].map(async (path) => {
      const res = await fetch(`http://127.0.0.1:${board.port}${path}`);
      return { path, status: res.status, body: await res.json() };
    }),
  );
  for (const { path, status, body } of results) {
    assert.equal(status, 503, path);
    assert.equal(body.ok, false, path);
    assert.equal(body.error, "tokentracker_unreachable", path);
    assert.ok(body.hint.command.includes("tokentracker serve"), path);
  }
});

test("服务端：/api/cloud 读本机官方配置返回登录态与链接", async (t) => {
  const tracker = await startFakeTracker();
  const board = await startServer({ port: 0, tokentrackerPort: tracker.port, autoStart: false });
  t.after(async () => {
    board.close();
    await tracker.close();
  });

  // 只断言形状：登录态取决于本机 ~/.tokentracker 的真实文件，两种都合法
  const res = await fetch(`http://127.0.0.1:${board.port}/api/cloud`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.official.loggedIn, "boolean");
  assert.equal(typeof data.official.userId, "string");
  if (data.official.loggedIn) assert.ok(data.official.userId.length > 0);
  else assert.equal(data.official.userId, "");
  assert.deepEqual(data.links, {
    localDashboard: "http://127.0.0.1:7680",
    web: "https://www.tokentracker.cc",
    cloud: "https://www.tokentracker.cc/cloud",
  });
  assert.equal(data.loginCommand, "tokentracker device-login");

  const badHost = await new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: board.port, path: "/api/cloud", headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHost, 403);
});
