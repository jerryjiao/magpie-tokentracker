// 纯函数的测试：日期边界、聚合口径、趋势补齐、配额/热力图/成就整理。
// fixtures 是 2026-11-16 / 2026-11-17 从本机 TokenTracker 1.5.22 真实响应里存下来的。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addDays,
  achievementRows,
  buildPayload,
  dateInZone,
  heatmapCells,
  limitsRows,
  normalizePeriod,
  periodRange,
  providerName,
  seriesPoints,
  sourceName,
} from "../lib/usage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(path.join(HERE, "fixtures", name), "utf8"));

const summary7d = fixture("summary-7d.json");
const breakdown30d = fixture("model-breakdown-30d.json");
const daily7d = fixture("daily-7d.json");
const hourlyToday = fixture("hourly-today.json");
const limits = fixture("limits.json");
const heatmap = fixture("heatmap.json");
const achievements = fixture("achievements.json");

test("dateInZone 按给定时区取日期", () => {
  // 2026-11-16T15:30Z = 上海 23:30，仍是 16 日；UTC 侧是 16 日，Kiritimati(+14) 已是 17 日
  const when = new Date("2026-11-16T15:30:00Z");
  assert.equal(dateInZone("Asia/Shanghai", when), "2026-11-16");
  assert.equal(dateInZone("UTC", when), "2026-11-16");
  assert.equal(dateInZone("Pacific/Kiritimati", when), "2026-11-17");
  // 2026-11-16T16:30Z = 上海 17 日 00:30
  assert.equal(dateInZone("Asia/Shanghai", new Date("2026-11-16T16:30:00Z")), "2026-11-17");
});

test("addDays 跨月跨年", () => {
  assert.equal(addDays("2026-11-16", -7), "2026-11-09");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("periodRange 三种周期的起止", () => {
  const now = new Date("2026-11-16T04:00:00Z"); // 上海 12:00
  assert.deepEqual(periodRange("today", { timeZone: "Asia/Shanghai", now }), {
    from: "2026-11-16",
    to: "2026-11-16",
    days: 1,
  });
  assert.deepEqual(periodRange("7d", { timeZone: "Asia/Shanghai", now }), {
    from: "2026-11-10",
    to: "2026-11-16",
    days: 7,
  });
  assert.deepEqual(periodRange("30d", { timeZone: "Asia/Shanghai", now }), {
    from: "2026-10-18",
    to: "2026-11-16",
    days: 30,
  });
  assert.throws(() => periodRange("90d"), /unknown period/);
});

test("normalizePeriod 不认识的值回落到 today", () => {
  assert.equal(normalizePeriod("7d"), "7d");
  assert.equal(normalizePeriod("30D"), "30d");
  assert.equal(normalizePeriod(""), "today");
  assert.equal(normalizePeriod("nope"), "today");
  assert.equal(normalizePeriod(null, "7d"), "7d");
});

test("sourceName 把 source 标识换成人能读的名字", () => {
  assert.equal(sourceName("claude"), "Claude Code");
  assert.equal(sourceName("dsh"), "DSH");
  assert.equal(sourceName("workbuddy"), "WorkBuddy");
  assert.equal(sourceName("zcode"), "ZCode");
  assert.equal(sourceName("some-new-tool"), "Some-new-tool");
  assert.equal(sourceName(""), "未知");
});

test("buildPayload 用真实 7 天数据算出卡片、工具、模型和趋势", () => {
  const range = { from: "2026-11-10", to: "2026-11-16", days: 7 };
  const payload = buildPayload({
    period: "7d",
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-16T14:00:00Z"),
    range,
    summary: summary7d,
    breakdown: breakdown30d,
    seriesKind: "daily",
    seriesRaw: daily7d,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.from, "2026-11-10");
  assert.equal(payload.to, "2026-11-16");
  assert.equal(payload.cards.tokens, 1193001134);
  assert.equal(payload.cards.input, 84711248);
  assert.equal(payload.cards.output, 7120521);
  assert.equal(payload.cards.cacheRead, 1095933467);
  assert.equal(payload.cards.cacheWrite, 4794741);
  assert.equal(payload.cards.conversations, 13259);
  assert.equal(payload.cards.activeDays, 7);
  assert.ok(Math.abs(payload.cards.costUsd - 26.984998) < 1e-9);
  assert.ok(payload.cards.cacheHitRate > 0.91 && payload.cards.cacheHitRate < 0.92);
  assert.equal(payload.cards.rolling.last30d.tokens, 3234778601);

  // 30 天的 breakdown 有 4 个工具，按 token 降序，份额加起来约等于 1
  assert.equal(payload.sources.length, 4);
  assert.equal(payload.sources[0].id, "claude");
  assert.equal(payload.sources[0].name, "Claude Code");
  const shareSum = payload.sources.reduce((sum, s) => sum + s.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9);
  assert.deepEqual(
    payload.sources.map((s) => s.id),
    ["claude", "dsh", "workbuddy", "zcode"],
  );

  // 模型取前 10，全局按 token 降序
  assert.equal(payload.models.length, 10);
  assert.equal(payload.models[0].id, "smart-split");
  assert.equal(payload.models[0].sourceName, "DSH");
  for (let i = 1; i < payload.models.length; i += 1) {
    assert.ok(payload.models[i - 1].tokens >= payload.models[i].tokens);
  }

  // 7 天的 daily 序列补齐成 7 个点，首尾和总量都对
  assert.equal(payload.series.kind, "daily");
  assert.equal(payload.series.points.length, 7);
  assert.equal(payload.series.points[0].label, "11-10");
  assert.equal(payload.series.points[0].tokens, 215036010);
  assert.equal(payload.series.points[6].label, "11-16");
  assert.equal(payload.series.total, 1193001134);
  assert.equal(payload.series.peak, 254885775);
});

test("seriesPoints 把今天的小时序列补齐成 24 个点", () => {
  const points = seriesPoints("hourly", hourlyToday, { from: "2026-11-16", to: "2026-11-16" });
  assert.equal(points.length, 24);
  assert.deepEqual(
    points.map((p) => p.label),
    Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`),
  );
  const realSum = hourlyToday.data.reduce((sum, row) => sum + row.total_tokens, 0);
  assert.equal(
    points.reduce((sum, p) => sum + p.tokens, 0),
    realSum,
  );
  // 没有用量的小时是 0，不是缺失
  assert.equal(points[2].tokens, 0);
});

test("seriesPoints 在 daily 模式下把没用的日子补 0", () => {
  const raw = { data: [{ day: "2026-11-10", total_tokens: 100 }, { day: "2026-11-12", total_tokens: 50 }] };
  const points = seriesPoints("daily", raw, { from: "2026-11-10", to: "2026-11-13" });
  assert.deepEqual(
    points.map((p) => [p.key, p.tokens]),
    [
      ["2026-11-10", 100],
      ["2026-11-11", 0],
      ["2026-11-12", 50],
      ["2026-11-13", 0],
    ],
  );
});

test("buildPayload 对空数据不炸", () => {
  const payload = buildPayload({
    period: "today",
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-16T04:00:00Z"),
    summary: { totals: {}, rolling: {} },
    breakdown: { sources: [] },
    seriesKind: "hourly",
    seriesRaw: { data: [] },
  });
  assert.equal(payload.cards.tokens, 0);
  assert.equal(payload.cards.cacheHitRate, 0);
  assert.equal(payload.sources.length, 0);
  assert.equal(payload.models.length, 0);
  assert.equal(payload.series.points.length, 24);
  assert.equal(payload.series.peak, 0);
});

test("providerName：已知 id 给展示名，未知 id 首字母大写兜底", () => {
  assert.equal(providerName("claude"), "Claude");
  assert.equal(providerName("codex"), "Codex CLI");
  assert.equal(providerName("zcode"), "ZCode");
  assert.equal(providerName("kimikodi"), "Kimi");
  assert.equal(providerName("trae"), "TRAE");
  assert.equal(providerName("brand-new-tool"), "Brand-new-tool");
  assert.equal(providerName(""), "未知");
});

test("limitsRows 用真实数据整理配额：只留 configured，按用量排序", () => {
  const rows = limitsRows(limits);
  // 实测 fixture：configured=true 的只有 zcode / claude / codex / workbuddy；
  // 有窗口百分比的排前面（codex 这版响应 primary_window 为 null，落到 no_data）。
  assert.deepEqual(
    rows.map((r) => r.id),
    ["zcode", "claude", "codex", "workbuddy"],
  );

  const zcode = rows[0];
  assert.equal(zcode.name, "ZCode");
  assert.equal(zcode.status, "ok");
  assert.deepEqual(
    zcode.windows.map((w) => w.label),
    ["5h", "Tools"], // buckets 的 show_name 优先，且与顶层窗口去重
  );
  assert.deepEqual(
    zcode.windows.map((w) => w.usedPercent),
    limits.zcode.buckets.map((b) => b.window.used_percent),
  );
  assert.equal(zcode.windows[0].resetsText, "11-17 05:30"); // ISO reset_at 截短

  // claude 配置了但 limits_status=not_applicable：没有窗口，给 no_data 说明
  const claude = rows.find((r) => r.id === "claude");
  assert.equal(claude.status, "no_data");
  assert.ok(claude.statusText.includes("配额"));
  assert.equal(claude.windows.length, 0);

  // codex 这版响应窗口全为 null：同样是 no_data，而不是报错
  const codex = rows.find((r) => r.id === "codex");
  assert.equal(codex.name, "Codex CLI");
  assert.equal(codex.status, "no_data");

  // workbuddy 配置了但上游报错
  const workbuddy = rows.find((r) => r.id === "workbuddy");
  assert.equal(workbuddy.status, "error");
  assert.ok(workbuddy.detail.includes("WorkBuddy"));
  assert.ok(workbuddy.statusText.includes("读取失败"));
});

test("limitsRows 空输入、未配置、缺字段、未知 id 都不炸", () => {
  assert.deepEqual(limitsRows(null), []);
  assert.deepEqual(limitsRows({}), []);
  assert.deepEqual(limitsRows({ fetched_at: "2026-11-17", nope: { configured: false } }), []);

  // 未知 provider id 兜底；epoch 秒的 reset_at 也能给掩码时间
  const rows = limitsRows({
    "new-tool": {
      configured: true,
      primary_window: { used_percent: 12.5, limit_window_seconds: 3600, reset_at: 1795066448 },
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "New-tool");
  assert.equal(rows[0].windows[0].usedPercent, 12.5);
  assert.equal(rows[0].windows[0].label, "1h");
  assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(rows[0].windows[0].resetsText));

  // used_percent 缺失的窗口直接跳过；一个窗口都没有 → no_data
  const missing = limitsRows({ x: { configured: true, primary_window: { label: "5h" } } });
  assert.equal(missing[0].windows.length, 0);
  assert.equal(missing[0].status, "no_data");
});

test("heatmapCells 用真实数据透传分档并算月份标签", () => {
  const cells = heatmapCells(heatmap);
  assert.equal(cells.weeks.length, 10); // fixture 保留了最近 10 周
  const flat = cells.weeks.flat();
  assert.ok(flat.length >= 60 && flat.length <= 70);
  assert.ok(flat.every((c) => Number.isInteger(c.level) && c.level >= 0 && c.level <= 4));
  assert.ok(flat.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  assert.ok(flat.some((c) => c.tokens > 0));
  // months：第一列必有标签，且后续标签跟列里第一格的月份一致
  assert.equal(cells.months[0].index, 0);
  assert.equal(cells.months[0].label, cells.weeks[0][0].date.slice(0, 7));
  assert.ok(cells.months.length >= 2);
  for (const m of cells.months) {
    assert.equal(m.label, cells.weeks[m.index][0].date.slice(0, 7));
  }
  assert.ok(cells.activeDays >= 1);
  assert.equal(typeof cells.streakDays, "number");
  assert.equal(cells.from, heatmap.from);
  assert.equal(cells.to, heatmap.to);
});

test("heatmapCells 只保留最近 N 周、缺 level 按峰值分档、空输入不炸", () => {
  const cells = heatmapCells(heatmap);
  const trimmed = heatmapCells(heatmap, { weeks: 4 });
  assert.equal(trimmed.weeks.length, 4);
  assert.equal(trimmed.weeks[0][0].date, cells.weeks[6][0].date);

  const raw = {
    weeks: [
      [
        { day: "2026-11-10", total_tokens: 0 },
        { day: "2026-11-11", total_tokens: 100 },
        { day: "2026-11-12", total_tokens: 400 },
        { day: "2026-11-13", total_tokens: 800 },
        { day: "2026-11-14", total_tokens: 900 },
      ],
    ],
  };
  // 峰值 900：0→0，100→1，400（>25%）→2，800/900（>75%）→4
  assert.deepEqual(
    heatmapCells(raw).weeks[0].map((c) => c.level),
    [0, 1, 2, 4, 4],
  );

  assert.deepEqual(heatmapCells(null).weeks, []);
  assert.deepEqual(heatmapCells({ weeks: [] }).months, []);
  // 非数组的周保留成空列（列号不挪，月份标签定位才不会错位）
  assert.deepEqual(heatmapCells({ weeks: [null, "x", [{ day: "2026-01-01" }]] }).weeks, [
    [],
    [],
    [{ date: "2026-01-01", tokens: 0, level: 0 }],
  ]);
});

test("achievementRows 用真实数据整理徽章行", () => {
  const rows = achievementRows(achievements);
  assert.equal(rows.length, 3);

  const hopper = rows.find((r) => r.id === "project_hopper");
  assert.equal(hopper.name, "项目跳客");
  assert.equal(hopper.tier, 3);
  assert.equal(hopper.tierName, "gold");
  assert.equal(hopper.progressText, "11 / 20");
  assert.equal(hopper.nextThreshold, 20);
  assert.equal(hopper.tiers.bronze, "2026-06-21T07:00:00.000Z");
  assert.equal(hopper.tiers.silver, "2026-08-16T06:30:00.000Z");
  assert.equal(hopper.tiers.gold, "2026-09-14T06:30:00.000Z");
  assert.equal(hopper.tiers.diamond, null);

  const devotion = rows.find((r) => r.id === "project_devotion");
  assert.equal(devotion.name, "项目深耕");
  assert.equal(devotion.tier, 4);
  assert.equal(devotion.tierName, "diamond");
  assert.equal(devotion.nextThreshold, null);
  assert.equal(devotion.progressText, "71.61亿"); // 7161457251
  assert.equal(devotion.tiers.diamond, "2026-08-18T05:30:00.000Z");

  const night = rows.find((r) => r.id === "night_owl");
  assert.equal(night.name, "夜猫子");
  assert.equal(night.progressText, "555");
});

test("achievementRows 空输入、未知 id、越界 tier 都兜底", () => {
  assert.deepEqual(achievementRows(null), []);
  assert.deepEqual(achievementRows({ achievements: [] }), []);

  const rows = achievementRows({
    achievements: [
      { id: "mystery_badge", tier: 2, metric_value: 5, thresholds: [1, 2, 3, 4], next_threshold: 10, achieved: {} },
      { id: "weird", tier: 99, metric_value: "abc", achieved: { bronze: 42 } },
    ],
  });
  assert.equal(rows[0].name, "mystery_badge"); // 认不出的保留原 id
  assert.equal(rows[0].tierName, "silver");
  assert.equal(rows[0].progressText, "5 / 10");
  assert.deepEqual(rows[0].tiers, { bronze: null, silver: null, gold: null, diamond: null });
  assert.equal(rows[1].tier, 4); // 越界收到 diamond
  assert.equal(rows[1].tierName, "diamond");
  assert.equal(rows[1].progressText, "0"); // 非数字指标按 0
});
