// 和本机 TokenTracker 打交道：探测、必要时拉起、读它的回环接口。
//
// TokenTracker（github.com/xiufengsun/TokenTracker，npm 包 tokentracker-cli）在
// `tokentracker serve` 时于 127.0.0.1:7680 提供一套本机接口：
//   GET /api/local-auth                       → { token, serverVersion? }
//   GET /functions/tokentracker-usage-summary?from&to&tz
//   GET /functions/tokentracker-usage-model-breakdown?from&to&tz
//   GET /functions/tokentracker-usage-daily?from&to&tz
//   GET /functions/tokentracker-usage-hourly?from&to&tz
// 读接口对回环地址开放（不校验 token），写接口才要 token；我们只读，所以不拿 token。
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";

export const DEFAULT_PORT = 7680;

// 最近一次由 ensureRunning 拉起的 TokenTracker 子进程；手动跑服务时退出要带走它
let activeChild = null;

export function killActiveTokenTracker() {
  const child = activeChild;
  activeChild = null;
  try {
    child?.kill();
  } catch {
    // 已经退了
  }
}
const PROBE_TIMEOUT_MS = 1500;

export function resolvePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

export function baseUrl(port) {
  return `http://127.0.0.1:${resolvePort(port)}`;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

// 探测：能拿到 /api/local-auth 的 JSON 就算 TokenTracker 在跑。
export async function probe(base, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${base}/api/local-auth`, {
      headers: { Accept: "application/json" },
      signal: timeout.signal,
    });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    return {
      reachable: true,
      version: typeof data?.serverVersion === "string" ? data.serverVersion : "",
    };
  } catch (error) {
    const code = error?.cause?.code || error?.code || "";
    return {
      reachable: false,
      error: code || (error?.name === "AbortError" ? "timeout" : String(error?.message || error)),
    };
  } finally {
    timeout.done();
  }
}

function onPath(bin) {
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      accessSync(path.join(dir, bin), constants.X_OK);
      return path.join(dir, bin);
    } catch {
      // 继续找
    }
  }
  return "";
}

// 拉起命令：优先用户配置（command），其次 PATH 里的 tokentracker，最后 npx。
export function resolveCommand(command, port) {
  const args = ["serve", "--no-open", "--port", String(resolvePort(port))];
  const custom = String(command || "").trim();
  if (custom) {
    const parts = custom.split(/\s+/);
    return { bin: parts[0], args: [...parts.slice(1), ...args] };
  }
  const local = onPath("tokentracker");
  if (local) return { bin: local, args };
  const npx = onPath("npx");
  if (npx) return { bin: npx, args: ["-y", "tokentracker-cli", ...args] };
  return { bin: "", args: [] };
}

// 确保有一个可用的 TokenTracker：先探测；不行且允许自动拉起时，起一个子进程等它就绪。
export async function ensureRunning({
  port,
  autoStart = true,
  command = "",
  log = () => {},
  waitMs = 25000,
  probeFn = probe,
  spawnFn = spawn,
} = {}) {
  const base = baseUrl(port);
  const first = await probeFn(base);
  if (first.reachable) return { reachable: true, base, started: false, version: first.version || "" };

  if (!autoStart) return { reachable: false, base, started: false, error: first.error || "unreachable" };

  const cmd = resolveCommand(command, port);
  if (!cmd.bin) {
    return { reachable: false, base, started: false, error: "tokentracker command not found" };
  }
  log(`starting TokenTracker: ${cmd.bin} ${cmd.args.join(" ")}`);
  let child;
  activeChild = null;
  try {
    // detached: true 让 tokentracker 自己成组：它还会再 fork 一个真正监听端口的
    // node 子进程，只有整组杀才能带走，不然留下孤儿服务占着端口。
    child = spawnFn(cmd.bin, cmd.args, { stdio: "ignore", detached: true });
  } catch (error) {
    return { reachable: false, base, started: false, error: `spawn failed: ${error?.message || error}` };
  }
  child.on?.("error", (error) => log(`TokenTracker start failed: ${error?.message || error}`));
  // 退出时顺手带走整组子进程，别在 magpie 关掉后留一个孤儿服务。
  activeChild = child;
  const killChild = () => {
    if (activeChild === child) activeChild = null;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill();
    } catch {
      // 已经退了
    }
  };
  child.once?.("exit", killChild);
  process.once("exit", killChild);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const now = await probeFn(base);
    if (now.reachable) {
      return { reachable: true, base, started: true, version: now.version || "" };
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      return { reachable: false, base, started: false, error: `TokenTracker exited (${child.exitCode})` };
    }
  }
  return { reachable: false, base, started: false, error: "TokenTracker did not answer in time" };
}

export async function apiGet(base, slug, params = {}, { timeoutMs = 8000 } = {}) {
  const url = new URL(`/functions/${slug}`, base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: timeout.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${slug} answered HTTP ${res.status}`);
    return JSON.parse(text);
  } finally {
    timeout.done();
  }
}
