// magpie 托管的带路页：把框架导航到本机服务。
//
// 优先用 window.magpie.service（magpie web 在自己域名下转发），桌面窗口没有它，
// 回退 http://127.0.0.1:<port>/。端口从插件选项读，跟服务启动时用的是同一个值。
//
// 探活只在 service 转发模式（magpie web）下做：那是同源请求，结果可信。
// 桌面窗口的带路页 CSP 会把跨源 fetch 和 <script> 全部拦掉（0.1.4345 实测），
// 双失败和服务真死无法区分——在桌面版里做跨源探测只会把活服务误判成死服务，
// 所以桌面版不做探测，用「多跳几次」代替：服务没起来时导航会失败、本页还在，
// 等一会儿再跳，跳到成功为止（服务起来只是几秒的事，详见 gotoBoard 的注释）。
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
      readyLocal: "正在打开本机看板…",
      waiting: (n) => `看板服务还没起来，正在重试（第 ${n} 次）…`,
      waitingHint: "magpie 重启插件宿主或升级后，本机看板服务要几秒才回来，等它一下就好。",
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
      readyLocal: "Opening the local board…",
      waiting: (n) => `The board service is not up yet — retrying (try ${n})…`,
      waitingHint: "After a magpie restart or update the local service needs a few seconds — it will come back.",
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

  // 重试按钮。probe=true 时先探活（只用于 service 转发模式：同源、结果可信）；
  // 桌面窗口探不了（见文件头），按下去就立刻再跳一次。
  function addRetry(onRetry, probe = true) {
    if (document.querySelector(".box button")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = w.retry;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      say(w.retrying);
      if (probe && (await probeService(base)) === false) {
        btn.disabled = false;
        say(w.down, true);
        return;
      }
      onRetry();
    });
    (document.querySelector(".box") || document.body).appendChild(btn);
  }

  // 跳看板。桌面窗口没法探活（CSP 拦跨源 fetch），只能跳——那就多跳几次。
  //
  // 为什么必须重试：WebKit 把「导航到死地址失败」和「导航成功」分不开，页面会一直
  // 停在带路页上不动（magpie 源码的注释原话：leaves the frame on the page's own
  // "connecting…" for good）。而服务没起来是常事：magpie 重启插件宿主、自升级交接，
  // 旧宿主的服务随它退出，新的要几秒才绑上 3491。只跳一次，跳早一次就永远卡住——
  // 2026-11-17 用户报的「又卡到这里不动了」就是导航落在服务死掉的窗口里。
  // 跳失败不会换掉本页（本页还在才能重试），跳成功本页就没了、定时器随文档结束。
  const RETRY_FIRST_MS = 700;
  const RETRY_CAP_MS = 2500;
  const HINT_AFTER = 6; // 从第几次开始提示「服务还没起来」

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
    document.querySelector(".box button")?.remove();
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      setBar(Math.min(94, 76 + attempts * 2));
      if (attempts === 1) {
        say(service ? w.ready : w.readyLocal);
      } else {
        const n = attempts - 1;
        say(n > HINT_AFTER ? `${w.waiting(n)} ${w.waitingHint}` : w.waiting(n), n > HINT_AFTER);
        if (n > HINT_AFTER) addRetry(attempt, false);
      }
      try {
        // assign 而不是 replace：看板页因此能 history.back() 回到这一页，
        // 「跳过去就白屏、回不来」是上一版的事故。
        location.assign(target);
      } catch {
        // 拦了也不用管，下一轮再跳
      }
      setTimeout(attempt, Math.min(RETRY_CAP_MS, RETRY_FIRST_MS + (attempts - 1) * 250));
    };
    attempt();
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
  // 桌面窗口：跨源探测会被 CSP 全拦、与服务真死无法区分，直接跳（gotoBoard 里自带重试）。
  gotoBoard();
})();
