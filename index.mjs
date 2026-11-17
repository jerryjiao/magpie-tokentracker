// magpie 窗口里的「TokenTracker」页面。
//
// 两层结构（跟 page-usage-board / page-usage-tree 同一套契约）：
//   1. 本文件被 magpie 的 Bun 宿主当 OpenCode v1 插件加载。模块导入必须零副作用：
//      服务只在 magpie 调 server(input, options) 时启动，且等真正监听后才返回。
//   2. page/index.html + page/boot.js 是 magpie 托管的带路页，把框架导航到本机服务
//      （桌面窗口）或 magpie.web 的 service 转发路径（留在 magpie origin 里）。
//
// 服务自己只绑 127.0.0.1，只读本机 TokenTracker 的回环接口。
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
let starting = null;

const plugin = {
  id: "magpie-tokentracker",
  server: async (_input, options) => {
    if (!starting) {
      starting = import(pathToFileURL(path.join(here, "server.mjs")).href)
        .then((mod) => mod.startServer({
          port: options?.port,
          tokentrackerPort: options?.tokentrackerPort,
          autoStart: options?.autoStart,
          command: options?.command,
          timeZone: options?.timeZone,
        }))
        .then(({ port }) => ({ ok: true, port }))
        .catch((error) => {
          starting = null; // 允许 magpie 下次调用重试
          console.error("[magpie-tokentracker] server not started:", error?.message || error);
          throw error;
        });
    }
    await starting;
    return await starting;
  },
};

export default plugin;

// 手动启动入口：node index.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  plugin.server().then(async (started) => {
    // 手动跑的时候，Ctrl-C / kill 也要顺手带走拉起来的 TokenTracker 子进程
    const { killActiveTokenTracker } = await import("./lib/tokentracker.mjs");
    const stop = () => {
      killActiveTokenTracker();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }).catch((error) => {
    console.error(`[magpie-tokentracker] not started: ${error?.message || error}`);
    process.exit(1);
  });
}
