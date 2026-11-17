// TokenTracker 用量看板。零依赖，全部逻辑在这个文件里。
// 数据来自同机服务（server.mjs）的只读接口，页面本身不碰 TokenTracker。
// 服务端会把下面的 __SERVICE_BASE__ 替换成 http://127.0.0.1:<端口> 后内联进页面；
// magpie 的沙盒 frame 是 opaque origin，fetch 必须用绝对地址。
(function () {
  "use strict";

  const SERVICE_BASE = "__SERVICE_BASE__";
  const base = SERVICE_BASE.indexOf("__SERVICE_BASE") === 0 ? "" : SERVICE_BASE;

  const params = new URLSearchParams(location.search);
  const langParam = params.get("lang");
  const lang = langParam === "zh" || langParam === "en"
    ? langParam
    : (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  const zh = lang === "zh";
  // boot.js 会把 magpie 的深浅设置以 ?theme=dark|light 传进来；缺省保持浅色。
  const themeParam = params.get("theme");
  if (themeParam === "dark" || themeParam === "light") {
    document.documentElement.dataset.theme = themeParam;
  }

  const TEXT = {
    zh: {
      title: "TokenTracker 用量",
      sub: "本机 TokenTracker 追踪的 token 与花费",
      today: "今天", d7: "7 天", d30: "30 天",
      refresh: "刷新", cloud: "云同步",
      back: "← 返回插件页",
      cloudHint: "官方账号登录、云同步和排行榜",
      cloudOpenBlocked: "这个窗口打不开外链。直接跳过去会变成白屏，也回不来。把下面的地址复制到浏览器打开，看板留在这里。",
      tokens: "总 Token", cost: "花费", cache: "缓存读取", sessions: "会话",
      input: "输入", output: "输出", cacheWrite: "缓存写入", cacheRead: "缓存读取",
      perSession: "均 / 会话", cacheHit: "命中率", sessionsHint: "有用量的会话",
      byTool: "按编程工具", byModel: "按模型",
      trendToday: "今天 · 每小时", trendDays: "每日趋势",
      empty: "这段时间没有用量",
      limits: "订阅配额",
      heat: "近一年活跃", heatHint: "活跃 {active} 天 · 连续 {streak} 天",
      achievements: "成就", maxed: "已满级",
      unavailable: "暂不可用",
      cloudTitle: "云同步与排行榜",
      cloudOutLead: "本地数据不上传。想在网页看、多设备聚合或上全球排行，需要登录 TokenTracker 官方账号。",
      cloudOutWay1: "打开本机 TokenTracker 看板 → Settings → Account 登录",
      cloudOpenLocal: "打开本机看板",
      cloudOutWay2: "或在终端执行：",
      cloudFine: "官方 Cloud 为付费服务（$4.99/月）",
      cloudLearn: "了解 Cloud",
      cloudInLead: "已登录官方账号（ID: {id}）",
      cloudInNote: "免费账号可用全球排行榜与单设备社区上传；多设备聚合与网页历史查看需官方 Cloud。",
      cloudOpenWeb: "打开 tokentracker.cc",
      offlineTitle: "连不上本机 TokenTracker",
      offlineText: "看板读的是本机 TokenTracker 的回环接口。装好并启动后，用量会自动出现。",
      offlineRetry: "重试",
      statusOk: "已连接", statusWarn: "正在连接", statusBad: "未连接",
      updated: "更新于",
      loading: "读取中…",
    },
    en: {
      title: "TokenTracker",
      sub: "Token usage and cost tracked by the local TokenTracker",
      today: "Today", d7: "7 days", d30: "30 days",
      refresh: "Refresh", cloud: "Cloud",
      back: "← Back",
      cloudHint: "Official account, cloud sync, and the leaderboard",
      cloudOpenBlocked: "This window can't open outside links. Leaving this page turns it into a blank screen with no way back. Copy the address below into a browser. This board stays here.",
      tokens: "Total tokens", cost: "Cost", cache: "Cache read", sessions: "Sessions",
      input: "input", output: "output", cacheWrite: "cache write", cacheRead: "cache read",
      perSession: "avg / session", cacheHit: "hit rate", sessionsHint: "sessions with usage",
      byTool: "By coding tool", byModel: "By model",
      trendToday: "Today · hourly", trendDays: "Daily trend",
      empty: "No usage in this period",
      limits: "Subscription quota",
      heat: "Activity · last year", heatHint: "{active} active days · {streak}-day streak",
      achievements: "Achievements", maxed: "maxed",
      unavailable: "Unavailable",
      cloudTitle: "Cloud sync & leaderboard",
      cloudOutLead: "Local data stays local. Sign in to a TokenTracker account to view it on the web, aggregate across devices, or join the global leaderboard.",
      cloudOutWay1: "Open the local TokenTracker dashboard → Settings → Account",
      cloudOpenLocal: "Open local dashboard",
      cloudOutWay2: "Or run in a terminal:",
      cloudFine: "Official Cloud is a paid service ($4.99/month)",
      cloudLearn: "Learn about Cloud",
      cloudInLead: "Signed in to the official account (ID: {id})",
      cloudInNote: "Free accounts get the global leaderboard and single-device community uploads. Multi-device aggregation and web history need official Cloud.",
      cloudOpenWeb: "Open tokentracker.cc",
      offlineTitle: "Can't reach the local TokenTracker",
      offlineText: "This board reads the local TokenTracker's loopback API. Install and start it, and usage shows up automatically.",
      offlineRetry: "Retry",
      statusOk: "connected", statusWarn: "connecting", statusBad: "not connected",
      updated: "updated",
      loading: "loading…",
    },
  };
  const T = TEXT[lang];

  const $ = (id) => document.getElementById(id);
  // magpie 的页面 frame 是 sandbox="allow-scripts"（opaque origin）：裸碰 localStorage
  // 直接抛 SecurityError，会炸掉整个脚本、页面停在骨架屏。包一层降级成无记忆，
  // 代价只是沙盒里记不住上次选的周期。
  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* opaque origin：放弃记忆 */ }
    },
  };
  const PERIODS = ["today", "7d", "30d"];
  // URL ?period= 优先（boot/分享链接直达），其次记住的选择，默认「今天」。
  const periodParam = params.get("period");
  const savedPeriod = store.get("magpie-tokentracker-period");
  const state = {
    period: PERIODS.includes(periodParam) ? periodParam : PERIODS.includes(savedPeriod) ? savedPeriod : "today",
    data: null,
    loading: false,
    timer: null,
  };
  // 三个低频面板各自一份状态：quota 60 秒、热力图/成就 5 分钟；force 刷新绕过。
  const panels = {
    limits: { ttl: 60000, at: 0, loading: false, data: null },
    heatmap: { ttl: 300000, at: 0, loading: false, data: null },
    achievements: { ttl: 300000, at: 0, loading: false, data: null },
  };
  // 官方云登录态：页面加载拉一次，点「云」按钮时还没有数据再拉。
  const cloud = { data: null, loading: false };

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e8) return zh ? (v / 1e8).toFixed(2).replace(/\.00$/, "") + " 亿" : (v / 1e9).toFixed(2) + "B";
    if (v >= 1e4) {
      if (zh) {
        const wan = v / 1e4;
        return (wan >= 1000 ? Math.round(wan).toLocaleString("zh-CN") : wan.toFixed(1).replace(/\.0$/, "")) + " 万";
      }
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      return Math.round(v / 1e3) + "K";
    }
    return Math.round(v).toLocaleString(zh ? "zh-CN" : "en-US");
  }

  function fmtCost(n) {
    const v = Number(n) || 0;
    if (v === 0) return "$0";
    if (v < 0.01) return "<$0.01";
    return "$" + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  }

  function fmtPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return (v * 100).toFixed(1).replace(/\.0$/, "") + "%";
  }

  function fmtInt(n) {
    return Math.round(Number(n) || 0).toLocaleString(zh ? "zh-CN" : "en-US");
  }

  // 配额百分比：1 位小数，整数不带小数。
  function fmtUsed(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(1).replace(/\.0$/, "") + "%";
  }

  // 配额色阶：<70 绿、70–85 橙、>85 红。
  function quotaTone(percent) {
    const v = Number(percent);
    if (!Number.isFinite(v)) return "";
    if (v > 85) return "bad";
    if (v >= 70) return "warn";
    return "ok";
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function setText() {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    document.title = T.title;
    $("title").textContent = T.title;
    $("sub").textContent = T.sub;
    $("refresh").textContent = T.refresh;
    $("back").textContent = T.back;
    $("cloud-btn").textContent = T.cloud;
    $("cloud-btn").title = T.cloudHint;
    $("cloud-open-text").textContent = T.cloudOpenBlocked;
    $("offline-title").textContent = T.offlineTitle;
    $("offline-text").textContent = T.offlineText;
    $("offline-retry").textContent = T.offlineRetry;
    $("sources-title").textContent = T.byTool;
    $("models-title").textContent = T.byModel;
    $("limits-title").textContent = T.limits;
    $("heatmap-title").textContent = T.heat;
    $("achievements-title").textContent = T.achievements;
    $("cloud-title").textContent = T.cloudTitle;
    document.querySelectorAll("[data-k]").forEach((el) => {
      el.textContent = T[el.dataset.k] || "";
    });
    const labels = { today: T.today, "7d": T.d7, "30d": T.d30 };
    document.querySelectorAll("#periods button").forEach((b) => {
      b.textContent = labels[b.dataset.period];
    });
  }

  function setStatus(kind) {
    const el = $("status");
    el.dataset.state = kind;
    el.title = kind === "ok" ? T.statusOk : kind === "bad" ? T.statusBad : T.statusWarn;
  }

  function renderBars(target, rows, valueOf, labelOf) {
    const el = $(target);
    if (!rows || !rows.length) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.empty)}</p>`;
      return;
    }
    const max = Math.max(...rows.map(valueOf), 1);
    el.innerHTML = rows
      .map((row) => {
        const pct = Math.max(2, Math.round((valueOf(row) / max) * 100));
        return `<div class="bar-row" title="${escapeHtml(row.title || "")}">
          <span class="bar-name">${escapeHtml(labelOf(row))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
          <span class="bar-value">${escapeHtml(fmtTokens(valueOf(row)))}</span>
        </div>`;
      })
      .join("");
  }

  function renderChart(series) {
    const el = $("chart");
    const points = (series && series.points) || [];
    $("trend-title").textContent = series && series.kind === "hourly" ? T.trendToday : T.trendDays;
    if (!points.length || points.every((p) => !p.tokens)) {
      $("trend-hint").textContent = "";
      el.innerHTML = `<p class="empty">${escapeHtml(T.empty)}</p>`;
      return;
    }
    const max = Math.max(...points.map((p) => p.tokens), 1);
    $("trend-hint").textContent = fmtTokens(points.reduce((s, p) => s + p.tokens, 0));
    el.innerHTML = `<div class="chart-bars">${points
      .map((p) => {
        const h = Math.max(p.tokens ? 3 : 0, Math.round((p.tokens / max) * 100));
        return `<div class="col" title="${escapeHtml(p.label)} · ${escapeHtml(fmtTokens(p.tokens))}">
          <span class="col-bar" style="height:${h}%"></span>
          <span class="col-label">${escapeHtml(p.label)}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function render(data) {
    const c = data.cards;
    $("v-tokens").textContent = fmtTokens(c.tokens);
    $("m-tokens").textContent = `${T.input} ${fmtTokens(c.inputTokens)} · ${T.output} ${fmtTokens(c.outputTokens)}`;
    $("v-cost").textContent = fmtCost(c.costUsd);
    $("m-cost").textContent = c.sessions ? `${fmtCost(c.costUsd / c.sessions)} ${T.perSession}` : "";
    $("v-cache").textContent = fmtTokens(c.cacheReadTokens);
    $("m-cache").textContent = `${T.cacheHit} ${fmtPct(c.cacheHitRatio)} · ${T.cacheWrite} ${fmtTokens(c.cacheWriteTokens)}`;
    $("v-sessions").textContent = fmtInt(c.sessions);
    $("m-sessions").textContent = T.sessionsHint;

    renderBars("source-bars", data.sources, (r) => r.tokens, (r) => r.name);
    renderBars(
      "model-bars",
      data.models,
      (r) => r.tokens,
      (r) => r.name,
    );
    renderChart(data.series);

    const tt = data.tokentracker || {};
    $("foot-source").textContent = tt.version ? `TokenTracker ${tt.version}` : "TokenTracker";
    const when = data.generatedAt ? new Date(data.generatedAt) : null;
    $("foot-updated").textContent = when
      ? `${T.updated} ${when.toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}`
      : "";
    setStatus("ok");
  }

  function showOffline(payload) {
    setStatus("bad");
    $("offline").hidden = false;
    document.body.classList.add("offline");
    const hint = (payload && payload.hint) || {};
    $("offline-command").textContent = hint.command || "npx tokentracker serve";
    $("offline-detail").textContent = hint.base ? `${hint.base} · ${payload.detail || ""}` : payload && payload.detail ? payload.detail : "";
  }

  function hideOffline() {
    $("offline").hidden = true;
    document.body.classList.remove("offline");
  }

  // ---------- 配额 ----------

  function renderLimits(data) {
    const el = $("limit-rows");
    if (!data || data.ok === false) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.unavailable)}</p>`;
      return;
    }
    const rows = data.rows || [];
    if (!rows.length) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.empty)}</p>`;
      return;
    }
    el.innerHTML = rows
      .map((row) => {
        const windows = (row.windows || [])
          .map((w) => {
            const pct = Math.max(0, Math.min(100, Number(w.usedPercent) || 0));
            const tone = quotaTone(w.usedPercent);
            const label = [w.label, w.resetsText].filter(Boolean).join(" · ");
            return `<div class="quota-window">
              <progress class="quota-bar" max="100" value="${pct}" data-tone="${tone}" aria-label="${escapeHtml(row.name)} ${escapeHtml(w.label || "")}"></progress>
              <span class="quota-meta">${escapeHtml(label)} <b>${escapeHtml(fmtUsed(w.usedPercent))}</b></span>
            </div>`;
          })
          .join("");
        const note = row.windows && row.windows.length ? "" : `<span class="quota-note">${escapeHtml(row.statusText || "")}</span>`;
        return `<div class="quota">
          <span class="quota-name">${escapeHtml(row.name)}</span>
          <div class="quota-body">${windows}${note}</div>
        </div>`;
      })
      .join("");
  }

  // ---------- 热力图 ----------

  function renderHeatmap(data) {
    const el = $("heat-scroll");
    const hint = $("heatmap-hint");
    if (!data || data.ok === false) {
      hint.textContent = "";
      el.innerHTML = `<p class="empty">${escapeHtml(T.unavailable)}</p>`;
      return;
    }
    const weeks = data.weeks || [];
    if (!weeks.length) {
      hint.textContent = "";
      el.innerHTML = `<p class="empty">${escapeHtml(T.empty)}</p>`;
      return;
    }
    hint.textContent = T.heatHint
      .replace("{active}", fmtInt(data.activeDays))
      .replace("{streak}", fmtInt(data.streakDays));
    const monthAt = new Map((data.months || []).map((m) => [m.index, m.label]));
    // 371 个格子一次拼完，不逐格操作 DOM。
    const cols = weeks
      .map((week, index) => {
        const cells = (week || [])
          .map((cell) => {
            const level = Math.max(0, Math.min(4, Number(cell.level) || 0));
            const title = `${cell.date || ""} · ${fmtTokens(cell.tokens)}`;
            return `<i class="heat-cell" data-level="${level}" title="${escapeHtml(title)}"></i>`;
          })
          .join("");
        const month = monthAt.get(index);
        const label = month ? `<span class="heat-month">${escapeHtml(month.slice(5))}</span>` : "";
        return `<div class="heat-col">${label}${cells}</div>`;
      })
      .join("");
    el.innerHTML = `<div class="heat">${cols}</div>`;
  }

  // ---------- 成就 ----------

  function renderAchievements(data) {
    const el = $("badge-rows");
    if (!data || data.ok === false) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.unavailable)}</p>`;
      return;
    }
    const rows = data.rows || [];
    if (!rows.length) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.empty)}</p>`;
      return;
    }
    el.innerHTML = rows
      .map((row) => {
        const tier = row.tierName || "bronze";
        const progress = row.nextThreshold === null ? `${row.progressText} · ${T.maxed}` : row.progressText;
        const got = row.tiers || {};
        const title = ["bronze", "silver", "gold", "diamond"]
          .map((key) => `${key}: ${got[key] ? String(got[key]).slice(0, 10) : "—"}`)
          .join("\n");
        return `<div class="badge" data-tier="${escapeHtml(tier)}" title="${escapeHtml(title)}">
          <span class="badge-name">${escapeHtml(row.name)}</span>
          <span class="badge-progress">${escapeHtml(progress)}</span>
        </div>`;
      })
      .join("");
  }

  // ---------- 云同步 ----------

  // 沙盒 frame 里外链用 location.href 导航，不用 window.open。
  function go(url) {
    if (!url) return;
    // 沙盒 frame 通常没有弹窗权限，window.open 返回 null。
    // 绝不能 location.href：那会把看板整页换成外链。7680 没起来就是白屏，而且没有返回。
    let popup = null;
    try {
      popup = window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      popup = null;
    }
    if (popup) return;
    const box = $("cloud-open");
    const input = $("cloud-open-url");
    if (!box || !input) return;
    input.value = url;
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
    input.focus();
    input.select();
  }

  function renderCloud(data) {
    const el = $("cloud-body");
    if (!data || data.ok === false) {
      el.innerHTML = `<p class="empty">${escapeHtml(T.unavailable)}</p>`;
      return;
    }
    const links = data.links || {};
    if (data.official && data.official.loggedIn) {
      el.innerHTML = `<p class="cloud-lead">${escapeHtml(T.cloudInLead.replace("{id}", data.official.userId || ""))}</p>
        <p class="cloud-note">${escapeHtml(T.cloudInNote)}</p>
        <div class="cloud-actions">
          <button type="button" class="ghost" data-go="${escapeHtml(links.web)}">${escapeHtml(T.cloudOpenWeb)}</button>
          <button type="button" class="ghost" data-go="${escapeHtml(links.cloud)}">${escapeHtml(T.cloudLearn)}</button>
        </div>`;
    } else {
      el.innerHTML = `<p class="cloud-lead">${escapeHtml(T.cloudOutLead)}</p>
        <p class="cloud-note">${escapeHtml(T.cloudOutWay1)}</p>
        <div class="cloud-actions">
          <button type="button" class="ghost" data-go="${escapeHtml(links.localDashboard)}">${escapeHtml(T.cloudOpenLocal)}</button>
        </div>
        <p class="cloud-note">${escapeHtml(T.cloudOutWay2)}</p>
        <pre class="cloud-command">${escapeHtml(data.loginCommand || "")}</pre>
        <p class="cloud-fine">${escapeHtml(T.cloudFine)} · <button type="button" class="link" data-go="${escapeHtml(links.cloud)}">${escapeHtml(T.cloudLearn)}</button></p>`;
    }
    el.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => go(btn.dataset.go));
    });
  }

  // ---------- 数据加载 ----------

  async function loadPanel(name, { force = false } = {}) {
    const panel = panels[name];
    if (panel.loading) return;
    if (!force && panel.data && Date.now() - panel.at < panel.ttl) return;
    panel.loading = true;
    const renderers = { limits: renderLimits, heatmap: renderHeatmap, achievements: renderAchievements };
    try {
      const res = await fetch(`${base}/api/${name}${force ? "?force=1" : ""}`);
      const data = await res.json();
      panel.data = data;
      panel.at = Date.now();
      renderers[name](data);
    } catch {
      // 单个面板失败不影响主用量区：就地显示「暂不可用」。
      renderers[name]({ ok: false });
    } finally {
      panel.loading = false;
    }
  }

  async function loadCloud() {
    if (cloud.loading || cloud.data) return;
    cloud.loading = true;
    try {
      const res = await fetch(`${base}/api/cloud`);
      cloud.data = await res.json();
    } catch {
      cloud.data = { ok: false };
    } finally {
      cloud.loading = false;
    }
    if (!$("cloud-panel").hidden) renderCloud(cloud.data);
  }

  async function load({ force = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    $("refresh").disabled = true;
    if (!state.data) setStatus("warn");
    try {
      const res = await fetch(`${base}/api/usage?period=${encodeURIComponent(state.period)}${force ? "&force=1" : ""}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        showOffline(data);
        return;
      }
      state.data = data;
      hideOffline();
      render(data);
    } catch (error) {
      showOffline({ detail: String(error && error.message ? error.message : error) });
    } finally {
      state.loading = false;
      $("refresh").disabled = false;
    }
  }

  function selectPeriod(period) {
    state.period = period;
    store.set("magpie-tokentracker-period", period);
    document.querySelectorAll("#periods button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.period === period));
    });
    load({ force: true });
  }

  function toggleCloud() {
    const panel = $("cloud-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("cloud-btn").setAttribute("aria-expanded", String(open));
    $("cloud-btn").classList.toggle("is-on", open);
    if (!open) return;
    if (cloud.data) renderCloud(cloud.data);
    else {
      $("cloud-body").innerHTML = `<p class="empty">${escapeHtml(T.loading)}</p>`;
      loadCloud();
    }
    // 面板在头部下面。视口被滚到底时点「云同步」看不到它，会以为按钮没反应。
    window.scrollTo({ top: 0, behavior: "smooth" });
    panel.scrollIntoView({ block: "nearest" });
  }

  function startTimer() {
    if (state.timer) clearInterval(state.timer);
    // 20 秒只刷主用量；三个低频面板按各自 TTL 顺带检查一次。
    state.timer = setInterval(() => {
      if (document.hidden) return;
      load();
      for (const name of Object.keys(panels)) loadPanel(name);
    }, 20000);
  }

  setText();
  selectPeriod(state.period);
  document.querySelectorAll("#periods button").forEach((b) => {
    b.addEventListener("click", () => selectPeriod(b.dataset.period));
  });
  $("refresh").addEventListener("click", () => {
    load({ force: true });
    for (const name of Object.keys(panels)) loadPanel(name, { force: true });
  });
  // 看板是插件页 frame 里跳过来的，回退一页就是 magpie 里的带路页。
  // 直接用浏览器打开时 frame 没有上一页，隐藏按钮。
  const back = $("back");
  if (back) {
    if (history.length > 1) {
      back.hidden = false;
      back.addEventListener("click", () => history.back());
    } else {
      back.hidden = true;
    }
  }
  $("cloud-btn").addEventListener("click", toggleCloud);
  $("offline-retry").addEventListener("click", () => load({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
  for (const name of Object.keys(panels)) loadPanel(name);
  loadCloud();
  startTimer();
})();
