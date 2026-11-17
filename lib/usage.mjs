// 纯函数：把 TokenTracker 的原始响应整理成页面需要的形状。
// 这里不碰网络、不碰文件，测试直接喂 test/fixtures 里的真实响应。

export const PERIODS = ["today", "7d", "30d"];
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

// TokenTracker 的 source 标识 → 页面上的名字。
const SOURCE_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  dsh: "DSH",
  zcode: "ZCode",
  workbuddy: "WorkBuddy",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  kimi: "Kimi",
  kiro: "Kiro",
  copilot: "Copilot",
  aider: "Aider",
  grok: "Grok",
  cline: "Cline",
  qwen: "Qwen Code",
  amp: "Amp",
  continue: "Continue",
  devin: "Devin",
  windsurf: "Windsurf",
  trae: "Trae",
  "every-code": "Every Code",
  "mimo-code": "MiMo Code",
  "minimax-code": "MiniMax Code",
  "kiro-cli": "Kiro CLI",
  "claude-code": "Claude Code",
};

export function sourceName(id) {
  const key = String(id || "").trim();
  if (!key) return "未知";
  if (SOURCE_NAMES[key]) return SOURCE_NAMES[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// 某一时区里的今天（YYYY-MM-DD）。en-CA 的短日期就是 ISO 顺序。
export function dateInZone(timeZone, when = new Date()) {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

// 在日期字符串上 +/- 天数。日期本身没有时区，用 UTC 做算术最稳。
export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad date: ${isoDate}`);
  const base = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(base);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 周期 → TokenTracker 的 from/to 日期，两端都含。
export function periodRange(period, { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const today = dateInZone(timeZone, now);
  if (period === "today") return { from: today, to: today, days: 1 };
  if (period === "7d") return { from: addDays(today, -6), to: today, days: 7 };
  if (period === "30d") return { from: addDays(today, -29), to: today, days: 30 };
  throw new Error(`unknown period: ${period}`);
}

export function normalizePeriod(period, fallback = "today") {
  const key = String(period || "").trim().toLowerCase();
  return PERIODS.includes(key) ? key : fallback;
}

function cardsFromSummary(summary) {
  const totals = summary?.totals || {};
  const tokens = num(totals.total_tokens);
  const cacheRead = num(totals.cached_input_tokens);
  const rolling = summary?.rolling || {};
  const last7 = rolling.last_7d?.totals || {};
  const last30 = rolling.last_30d?.totals || {};
  return {
    tokens,
    billable: num(totals.billable_total_tokens),
    costUsd: num(totals.total_cost_usd),
    input: num(totals.input_tokens),
    output: num(totals.output_tokens),
    cacheRead,
    cacheWrite: num(totals.cache_creation_input_tokens),
    reasoning: num(totals.reasoning_output_tokens),
    conversations: num(totals.conversation_count),
    cacheHitRate: tokens > 0 ? cacheRead / tokens : 0,
    activeDays: num(summary?.days),
    rolling: {
      last7d: {
        tokens: num(last7.billable_total_tokens),
        conversations: num(last7.conversation_count),
        activeDays: num(rolling.last_7d?.active_days),
        from: rolling.last_7d?.from || "",
        to: rolling.last_7d?.to || "",
      },
      last30d: {
        tokens: num(last30.billable_total_tokens),
        conversations: num(last30.conversation_count),
        activeDays: num(rolling.last_30d?.active_days),
        from: rolling.last_30d?.from || "",
        to: rolling.last_30d?.to || "",
        avgPerActiveDay: num(rolling.last_30d?.avg_per_active_day),
      },
    },
  };
}

// model-breakdown：sources[] → 按工具的行 + 扁平化后的模型行。
export function breakdownRows(breakdown, { modelLimit = 10 } = {}) {
  const sources = Array.isArray(breakdown?.sources) ? breakdown.sources : [];
  const totalTokens = sources.reduce((sum, s) => sum + num(s?.totals?.total_tokens), 0);
  const sourceRows = sources
    .map((s) => ({
      id: String(s?.source || ""),
      name: sourceName(s?.source),
      tokens: num(s?.totals?.total_tokens),
      billable: num(s?.totals?.billable_total_tokens),
      costUsd: num(s?.totals?.total_cost_usd),
      cacheRead: num(s?.totals?.cached_input_tokens),
      input: num(s?.totals?.input_tokens),
      output: num(s?.totals?.output_tokens),
      conversations: num(s?.totals?.conversation_count),
      models: Array.isArray(s?.models) ? s.models.length : 0,
      share: totalTokens > 0 ? num(s?.totals?.total_tokens) / totalTokens : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const models = [];
  for (const s of sources) {
    for (const m of Array.isArray(s?.models) ? s.models : []) {
      const tokens = num(m?.totals?.total_tokens);
      if (tokens <= 0) continue;
      models.push({
        id: String(m?.model || m?.model_id || "unknown"),
        source: String(s?.source || ""),
        sourceName: sourceName(s?.source),
        tokens,
        costUsd: num(m?.totals?.total_cost_usd),
        input: num(m?.totals?.input_tokens),
        output: num(m?.totals?.output_tokens),
        cacheRead: num(m?.totals?.cached_input_tokens),
        share: totalTokens > 0 ? tokens / totalTokens : 0,
      });
    }
  }
  models.sort((a, b) => b.tokens - a.tokens);
  return { sourceRows, modelRows: models.slice(0, modelLimit), totalTokens };
}

// hourly / daily 响应 → 趋势点。TokenTracker 只返回有用量的时段，这里按周期补齐空档，
// 否则柱子会被压缩成「连续有量」的假象。hourly 的 hour 是「该时区里的墙上时间」。
export function seriesPoints(kind, raw, range) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  if (kind === "hourly") {
    const day = range?.from || String(rows[0]?.hour || "").slice(0, 10);
    const byHour = new Map();
    for (const row of rows) byHour.set(String(row?.hour || "").slice(0, 13), row);
    const points = [];
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, "0");
      const key = `${day}T${hh}:00:00`;
      const row = byHour.get(key.slice(0, 13));
      points.push({
        label: `${hh}:00`,
        key,
        tokens: num(row?.total_tokens),
        costUsd: num(row?.total_cost_usd),
      });
    }
    return points;
  }
  const byDay = new Map(rows.map((row) => [String(row?.day || ""), row]));
  if (range?.from && range?.to) {
    const points = [];
    let cursor = range.from;
    while (cursor <= range.to) {
      const row = byDay.get(cursor);
      points.push({
        label: cursor.slice(5),
        key: cursor,
        tokens: num(row?.total_tokens),
        costUsd: num(row?.total_cost_usd),
      });
      cursor = addDays(cursor, 1);
    }
    return points;
  }
  return rows.map((row) => ({
    label: String(row?.day || "").slice(5) || String(row?.day || ""),
    key: String(row?.day || ""),
    tokens: num(row?.total_tokens),
    costUsd: num(row?.total_cost_usd),
  }));
}

// ---------- 配额（tokentracker-usage-limits） ----------

// limits 接口的 provider id → 展示名。实测 1.5.22 的 id 集合见 test/fixtures/limits.json；
// 认不出的 id 用首字母大写兜底。
const PROVIDER_NAMES = {
  claude: "Claude",
  codex: "Codex CLI",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  kiro: "Kiro",
  "kiro-cli": "Kiro CLI",
  grok: "Grok",
  copilot: "Copilot",
  zcode: "ZCode",
  opencode: "OpenCode",
  qoder: "Qoder",
  kimikodi: "Kimi",
  kimi: "Kimi",
  antigravity: "Antigravity",
  devin: "Devin",
  trae: "TRAE",
  deepseek: "DeepSeek",
  workbuddy: "WorkBuddy",
};

export function providerName(id) {
  const key = String(id || "").trim();
  if (!key) return "未知";
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// 窗口标签：优先 buckets 里的 show_name（如 zcode 的 5h / Tools），
// 其次按 limit_window_seconds 猜常见口径（5h / weekly / 30d），猜不出给空（页面就不显示标签）。
function windowLabelFromSeconds(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s === 18000) return "5h";
  if (s === 604800) return "weekly";
  if (s === 2592000) return "30d";
  if (s === 86400) return "daily";
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  return `${Math.round(s / 60)}m`;
}

// 重置说明：有相对秒数给倒计时（2d3h），有 ISO/epoch 时间给短日期（11-17 05:30，UTC 口径）。
function resetsTextOf(window) {
  const after = Number(window?.reset_after_seconds);
  if (Number.isFinite(after) && after > 0) {
    const d = Math.floor(after / 86400);
    const h = Math.floor((after % 86400) / 3600);
    const m = Math.floor((after % 3600) / 60);
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
  }
  const at = window?.reset_at;
  if (typeof at === "string" && at.length >= 16) return `${at.slice(5, 10)} ${at.slice(11, 16)}`;
  const epoch = Number(at);
  if (Number.isFinite(epoch) && epoch > 0) {
    const iso = new Date(epoch * 1000).toISOString();
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }
  return "";
}

// limits 原始响应 → 配额行。只留 configured=true 的 provider；有窗口百分比的给 windows，
// 没有的（limits_status 非 ok、上游报错）给 status/statusText 说明，页面照常渲染一行。
// status 是机器码（页面双语时用它），statusText 是中文兜底文案。
export function limitsRows(raw) {
  const rows = [];
  for (const [id, provider] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    if (id === "fetched_at") continue;
    if (!provider || typeof provider !== "object" || provider.configured !== true) continue;
    // 窗口有两种实测形态：codex 的 primary/secondary/tertiary_window（百分比在顶层），
    // zcode 的 buckets[].window（百分比再套一层，show_name 当标签）。按出现顺序逐个取。
    const windows = [];
    const candidates = [];
    const buckets = Array.isArray(provider.buckets) ? provider.buckets : [];
    // 带标签的 buckets 放前面：同一条数据的无标签拷贝会被去重丢掉。
    for (const bucket of buckets) {
      if (bucket?.window) candidates.push({ window: bucket.window, label: String(bucket.show_name || "") });
    }
    for (const key of ["primary_window", "secondary_window", "tertiary_window"]) {
      if (provider[key]) candidates.push({ window: provider[key], label: "" });
    }
    const seen = new Set();
    for (const { window, label } of candidates) {
      const pct = Number(window?.used_percent);
      if (!Number.isFinite(pct)) continue;
      // 顶层窗口和 buckets[].window 经常是同一条数据的两份拷贝，按数值去重，
      // 带标签的那份优先（标签更可读）。
      const key = `${pct}|${window.reset_at ?? ""}|${window.reset_after_seconds ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const labeled = label || windowLabelFromSeconds(window.limit_window_seconds);
      windows.push({ label: labeled, usedPercent: pct, resetsText: resetsTextOf(window) });
    }
    let status = "ok";
    let statusText = "";
    if (!windows.length) {
      if (provider.error) {
        status = "error";
        statusText = `读取失败：${provider.error}`;
      } else {
        status = "no_data";
        statusText = "未上报配额百分比";
      }
    }
    rows.push({
      id,
      name: providerName(id),
      configured: true,
      status,
      statusText,
      detail: provider.error ? String(provider.error) : "",
      windows,
      topPercent: windows.reduce((m, w) => Math.max(m, w.usedPercent), 0),
    });
  }
  // 有百分比的工具按用量高的在前，其余（未上报/报错）按名字排后面。
  rows.sort((a, b) => {
    if ((a.windows.length > 0) !== (b.windows.length > 0)) return a.windows.length > 0 ? -1 : 1;
    if (a.windows.length > 0 && a.topPercent !== b.topPercent) return b.topPercent - a.topPercent;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

// ---------- 热力图（tokentracker-usage-heatmap） ----------

// heatmap 原始响应 → 页面格子。level 字段（0-4）直接透传；缺失时按当日 tokens 占峰值
// 的比例分 5 档（>75% 峰值 → 4，>50% → 3，>25% → 2，>0 → 1，0 → 0）。
// opts.weeks 只保留最近 N 周（从尾部截）。months 用于月份标签定位：每列第一格换了月份记一笔。
export function heatmapCells(raw, { weeks: maxWeeks } = {}) {
  const source = Array.isArray(raw?.weeks) ? raw.weeks : [];
  const trimmed =
    Number.isInteger(maxWeeks) && maxWeeks > 0 && maxWeeks < source.length ? source.slice(-maxWeeks) : source;
  const flat = [];
  for (const week of trimmed) {
    for (const cell of Array.isArray(week) ? week : []) flat.push(cell);
  }
  const peak = flat.reduce((max, cell) => Math.max(max, num(cell?.total_tokens)), 0);
  const levelOf = (cell) => {
    const level = Number(cell?.level);
    if (Number.isFinite(level)) return Math.min(4, Math.max(0, Math.round(level)));
    const tokens = num(cell?.total_tokens);
    if (tokens <= 0 || peak <= 0) return 0;
    if (tokens > peak * 0.75) return 4;
    if (tokens > peak * 0.5) return 3;
    if (tokens > peak * 0.25) return 2;
    return 1;
  };
  const weeks = trimmed.map((week) =>
    (Array.isArray(week) ? week : []).map((cell) => ({
      date: String(cell?.day || ""),
      tokens: num(cell?.total_tokens),
      level: levelOf(cell),
    })),
  );
  const months = [];
  let lastMonth = "";
  weeks.forEach((week, index) => {
    const month = (week[0]?.date || "").slice(0, 7);
    if (month && month !== lastMonth) {
      months.push({ index, label: month });
      lastMonth = month;
    }
  });
  return {
    weeks,
    months,
    from: String(raw?.from || ""),
    to: String(raw?.to || ""),
    activeDays: num(raw?.active_days),
    streakDays: num(raw?.streak_days),
  };
}

// ---------- 成就（tokentracker-achievements） ----------

const TIER_NAMES = { 1: "bronze", 2: "silver", 3: "gold", 4: "diamond" };

// 成就 id → 展示名（实测集合见 fixtures；认不出的保留原 id 兜底）。
const ACHIEVEMENT_NAMES = {
  project_hopper: "项目跳客",
  project_devotion: "项目深耕",
  night_owl: "夜猫子",
  early_bird: "早鸟人",
  streak_keeper: "连击手",
};

// 大数的紧凑可读形式（与看板 fmtTokens 同口径：万 / 亿）。
function abbrevNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}亿`;
  if (n >= 1e4) {
    const wan = n / 1e4;
    if (wan >= 1000) return `${Math.round(wan).toLocaleString("zh-CN")}万`;
    return `${wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return String(Math.round(n));
}

// achievements 原始响应 → 徽章行。tier 数字 1-4 对应 bronze/silver/gold/diamond；
// next_threshold 为空表示已到顶，progressText 只给当前值（页面上再补「已满级」）。
export function achievementRows(raw) {
  const list = Array.isArray(raw?.achievements) ? raw.achievements : [];
  return list.map((a) => {
    const tier = Math.min(4, Math.max(1, Math.round(Number(a?.tier) || 1)));
    const metric = num(a?.metric_value);
    const hasNext = a?.next_threshold !== null && a?.next_threshold !== undefined;
    const next = hasNext ? num(a.next_threshold) : null;
    const achieved = a?.achieved && typeof a.achieved === "object" ? a.achieved : {};
    const pick = (key) => (typeof achieved[key] === "string" ? achieved[key] : null);
    const id = String(a?.id || "");
    return {
      id,
      name: ACHIEVEMENT_NAMES[id] || id,
      tier,
      tierName: TIER_NAMES[tier],
      progressText: next === null ? abbrevNumber(metric) : `${abbrevNumber(metric)} / ${abbrevNumber(next)}`,
      nextThreshold: next,
      tiers: { bronze: pick("bronze"), silver: pick("silver"), gold: pick("gold"), diamond: pick("diamond") },
    };
  });
}

// 主入口：把三个响应合成页面要的一份 JSON。
export function buildPayload({
  period,
  timeZone,
  now = new Date(),
  range,
  summary,
  breakdown,
  seriesKind,
  seriesRaw,
}) {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const span = range || periodRange(period, { timeZone: tz, now });
  const cards = cardsFromSummary(summary);
  const { sourceRows, modelRows } = breakdownRows(breakdown);
  const points = seriesPoints(seriesKind, seriesRaw, span);
  const totalForShare = points.reduce((sum, p) => sum + p.tokens, 0);
  const peak = points.reduce((max, p) => Math.max(max, p.tokens), 0);
  return {
    ok: true,
    period,
    timeZone: tz,
    from: span.from,
    to: span.to,
    days: span.days || 1,
    generatedAt: now.toISOString(),
    cards,
    sources: sourceRows,
    models: modelRows,
    series: {
      kind: seriesKind,
      points,
      peak,
      total: totalForShare,
    },
  };
}
