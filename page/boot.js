// magpie 托管的带路页：把框架导航到本机服务。
//
// 优先用 window.magpie.service（magpie web 在自己域名下转发），桌面窗口没有它，
// 回退 http://127.0.0.1:<port>/。端口从插件选项读，跟服务启动时用的是同一个值。
//
// 探活只在 service 转发模式（magpie web）下做：那是同源请求，结果可信。
// 桌面窗口的带路页 CSP 会把跨源 fetch 和 <script> 全部拦掉（0.1.4345 实测），
// 双失败和服务真死无法区分——在桌面版里做跨源探测只会把活服务误判成死服务，
// 所以桌面版保持原来的直接跳转：跳转本身就是最快的验证。
(async () => {
  const DEFAULT_PORT = 3491;
  const words = {
    zh: {
      title: "TokenTracker 用量",
      bridging: "正在连接宿主桥接…",
      err: (m) => `桥接未响应：${m} —— 直接打开本机看板…`,
      nobridge: "未检测到宿主桥接，直接打开本机看板…",
      probing: "正在检查看板服务…",
      ready: "已定位看板服务，正在跳转…",
      readyLocal: "已就绪，正在打开本机看板…",
      down: "看板服务没有启动：重启 magpie 后再试，或点下面的重试。",
      retrying: "正在重试…",
      retry: "重试",
    },
    en: {
      title: "TokenTracker",
      bridging: "Connecting to the host bridge…",
      err: (m) => `Bridge did not respond: ${m} — opening the local board…`,
      nobridge: "No host bridge detected — opening the local board…",
      probing: "Checking the board service…",
      ready: "Board located, navigating…",
      readyLocal: "Ready — opening the local board…",
      down: "The board service is not running. Restart magpie and try again, or click retry.",
      retrying: "Retrying…",
      retry: "Retry",
    },
  };
  let lang = String(navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  let port = DEFAULT_PORT;
  let theme = "";
  const bar = document.getElementById("bar");
  const msg = document.getElementById("msg");
  const say = (text, bad) => {
    if (!msg) return;
    msg.textContent = text;
    msg.classList.toggle("bad", !!bad);
  };
  const setBar = (pct, bad) => {
    bar.style.width = pct + "%";
    if (bar.parentElement) bar.parentElement.classList.toggle("bad", !!bad);
  };
  setBar(18);
  const creep = setInterval(() => setBar(Math.min(38, (parseFloat(bar?.style.width) || 18) + 2.5)), 350);

  let service = "";
  let bridgeError = "";
  const hasBridge = !!window.magpie;
  try {
    const current = await window.magpie?.ready;
    if (current) {
      if (typeof current.lang === "string" && current.lang) {
        lang = current.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
      }
      if (typeof current.dark === "boolean") theme = current.dark ? "dark" : "light";
    }
  } catch (error) {
    bridgeError = (error && error.message) || "bridge handshake failed";
  }
  try {
    const options = await window.magpie?.options?.get?.();
    const n = Number(options?.port);
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
  } catch {
    // 用声明的默认端口
  }
  try {
    const s = window.magpie?.service;
    if (typeof s === "string" && /^https?:\/\//.test(s)) service = s;
  } catch {
    // 桌面窗口直接走回环
  }

  clearInterval(creep);
  const w = words[lang];
  document.title = w.title;
  const head = document.querySelector(".box b");
  if (head) head.textContent = w.title;
  if (bridgeError) {
    setBar(30, true);
    say(w.err(bridgeError), true);
  } else if (!hasBridge) {
    setBar(72);
    say(w.nobridge);
  } else {
    setBar(72);
    say(w.probing);
  }

  const base = service || `http://127.0.0.1:${port}`;

  // 探活：只该在 service 转发模式（同源，结果可信）下调用。
  async function probeService(root) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${root}/api/healthz`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // 转发路径也不通
    }
    return false;
  }

  function addRetry(onRetry) {
    if (document.querySelector(".box button")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = w.retry;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      say(w.retrying);
      const ok = await probeService(base);
      if (ok === false) {
        btn.disabled = false;
        say(w.down, true);
        return;
      }
      onRetry();
    });
    (document.querySelector(".box") || document.body).appendChild(btn);
  }

  function gotoBoard() {
    let target = service || `${base}/`;
    try {
      const u = new URL(target, location.href);
      u.searchParams.set("lang", lang);
      if (theme) u.searchParams.set("theme", theme);
      target = u.href;
    } catch {
      target += (target.includes("?") ? "&" : "?") + "lang=" + lang + (theme ? "&theme=" + theme : "");
    }
    setBar(96);
    say(service ? w.ready : w.readyLocal);
    setTimeout(() => {
      try {
        location.replace(target);
      } catch {
        // 下面的 meta refresh 兜底
      }
    }, 200);
  }

  if (bridgeError) {
    // 桥接都没握上：保留原行为，直接跳，让目标侧自己兜底。
    gotoBoard();
    return;
  }

  if (service) {
    // magpie.web：转发是同源请求，探活结果可信，失败再拦。
    say(w.probing);
    setBar(84);
    const alive = await probeService(service);
    if (alive === false) {
      setBar(100, true);
      say(w.down, true);
      addRetry(gotoBoard);
      return;
    }
  }
  // 桌面窗口：跨源探测会被 CSP 全拦、与服务真死无法区分，直接跳转。
  gotoBoard();
})();
