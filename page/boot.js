// magpie 托管的带路页：把框架导航到本机服务。
//
// 优先用 window.magpie.service（magpie web 在自己域名下转发），桌面窗口没有它，
// 回退 http://127.0.0.1:<port>/。端口从插件选项读，跟服务启动时用的是同一个值。
// 页面不探测服务（带路页的 CSP 是 connect-src 'none'），所以进度条只由桥接握手驱动。
(async () => {
  const DEFAULT_PORT = 3491;
  const words = {
    zh: {
      title: "TokenTracker 用量",
      bridging: "正在连接宿主桥接…",
      err: (m) => `桥接未响应：${m} —— 直接打开本机看板…`,
      nobridge: "未检测到宿主桥接，直接打开本机看板…",
      ready: "已定位看板服务，正在跳转…",
      readyLocal: "已就绪，正在打开本机看板…",
    },
    en: {
      title: "TokenTracker",
      bridging: "Connecting to the host bridge…",
      err: (m) => `Bridge did not respond: ${m} — opening the local board…`,
      nobridge: "No host bridge detected — opening the local board…",
      ready: "Board located, navigating…",
      readyLocal: "Ready — opening the local board…",
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
    if (!bar) return;
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
    say(service ? w.ready : w.readyLocal);
  }

  let target = service || `http://127.0.0.1:${port}/`;
  try {
    const u = new URL(target, location.href);
    u.searchParams.set("lang", lang);
    if (theme) u.searchParams.set("theme", theme);
    target = u.href;
  } catch {
    target += (target.includes("?") ? "&" : "?") + "lang=" + lang + (theme ? "&theme=" + theme : "");
  }
  setTimeout(() => {
    try {
      location.replace(target);
    } catch {
      // 下面的 meta refresh 兜底
    }
  }, 300);
})();
