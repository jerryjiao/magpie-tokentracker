// TokenTracker 官方云（tokentracker.cc）登录态的纯函数：读本机配置 + userId 掩码。
//
// 官方登录信息写在本机 ~/.tokentracker/tracker/config.json（1.5.22 未登录时只有
// installedAt / baseUrl / machineId 三个字段；machineId 是装机就有的设备标识，不算登录）。
// 路径由调用方传入，测试用临时文件喂「已登录 / 未登录」两种状态。
import { readFile } from "node:fs/promises";

// 登录后可能写入 config.json 的用户标识字段（按常见命名逐一试）。
const USER_ID_KEYS = ["userId", "user_id", "uid", "accountId", "account_id", "email", "username"];

// 掩码：前 6 位 + … + 后 4 位；太短（≤10）掩不住就直接原样返回；空给空串。
export function maskUserId(id) {
  const text = String(id ?? "").trim();
  if (!text) return "";
  if (text.length <= 10) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

// 从配置对象里挑出用户标识；挑不出给空串。
export function pickUserId(config) {
  if (!config || typeof config !== "object") return "";
  for (const key of USER_ID_KEYS) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Number.isFinite(value) && value > 0) return String(value);
  }
  return "";
}

// 读官方配置 → 登录态。读不到 / 解析失败都算未登录：
// 配置文件损坏不该拖垮看板，云面板降级成「未登录」即可。
export async function readOfficialStatus(filePath) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { loggedIn: false, userId: "" };
  }
  let config = null;
  try {
    config = JSON.parse(text);
  } catch {
    return { loggedIn: false, userId: "" };
  }
  const id = pickUserId(config);
  return { loggedIn: Boolean(id), userId: maskUserId(id) };
}
