# 更新日志

本项目的所有重要变更都会记录在这个文件里。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-17

### 新增

- 看板 UI 按 `docs/design-spec.md`（v1）全面改版：浅色为默认主题、`?theme=dark` 跟随 magpie 深色模式、指标卡与渐变趋势柱图、条形排行、自绘组件样式。
- 订阅配额面板：`/api/limits` 透传 TokenTracker 的 `tokentracker-usage-limits`，按 provider 展示用量窗口百分比、重置时间与倒计时（<70% 绿 / 70–85% 橙 / >85% 红），60 秒缓存。
- 近一年活动热力图：`/api/heatmap` 透传 `tokentracker-usage-heatmap`，GitHub 风格周列 × 7 行格子，带月份标签与活跃/连续天数，5 分钟缓存。
- 成就徽章面板：`/api/achievements` 透传 `tokentracker-achievements`，展示各成就 tier 与进度，5 分钟缓存。
- 官方账号状态与云入口：`/api/cloud` 读 `~/.tokentracker/tracker/config.json` 判定官方账号登录态（ID 掩码显示）；云面板给出官方看板登录、`tokentracker device-login`、tokentracker.cc 与 Cloud 介绍入口。本地功能不受登录影响，本机数据不上传。
- 三个新面板失败时各自显示「暂不可用」，不阻塞主用量区；整站离线仍走原离线面板（命令 + 原因 + 重试）。

### 变更

- 服务探活逻辑统一：四个接口共用一份探活与 60 秒失败冷却，避免重复 spawn；`BUILD` 3 → 4。
- 默认周期恢复为「今天」，`?period=` URL 参数优先于本地记忆。

## [未发布]

### 修复

- 卡片「输入 / 输出 / 缓存读取 / 会话」全是 0：看板读的是 `cacheReadTokens`/`sessions` 这类驼峰名，而 `/api/usage` 是透传 TokenTracker 的 `input`/`cacheRead`/`cacheHitRate`/`conversations`。现在两套名字都认，并按真实值显示（实测：输入 703.7 万、缓存读取 9,877 万、命中率 92.7%、会话 930）。
- 看板页新增「← 返回插件页」按钮：带路页改用 `location.assign` 跳转，看板页因此可用 `history.back()` 退回带路页重试。以前用 `location.replace`，跳过去之后 frame 里没有上一页，服务一挂就只剩白屏、回不来。
- 「打开本机看板 / 了解 Cloud」不再把看板整页跳走。沙盒里 `location.href` 换成 `127.0.0.1:7680`（服务没起来就是连接拒绝）会变成白屏，而且没有返回。现在优先新窗口打开；弹窗被拦时留在看板里，给出可复制的地址。
- 「云」改名为「云同步」，点开的说明面板（官方账号登录、云同步、排行榜）从页面最底部移到头部下方：一打开就在视口里，不用滚动。以前面板在最底下展开，视口不动，看起来像按钮没反应。
- 看板在 magpie 沙盒 frame（opaque origin）里打开后全是「—」：`page/app.js` 裸访问 `localStorage` 抛 SecurityError 炸掉整个脚本（0.2.0「记住周期」引入），现在包一层安全存储，沙盒里降级为不记忆周期。
- 带路页（`page/boot.js`）探活只在 magpie.web 的 service 同源转发模式下做（结果可信），失败显示红色提示与「重试」按钮，服务恢复后点重试即可进入看板；桌面窗口的带路页 CSP 会把跨源 fetch 和 `<script>` 全拦（0.1.4345 实测），双失败与服务真死无法区分，故桌面版保持直接跳转——跳转本身就是最快的验证，不再把活服务误判成死服务。`/api/healthz?probe=` 回合法 JS（nosniff 的 MIME 检查可过）；`server.mjs` 的 BUILD 4 → 5（healthz 新增 probe 语义，指纹区分新旧服务）。

### 规划中

- 发布到 npm：支持 `magpie plugin add magpie-tokentracker` 从 npm 直接安装。

## [0.1.0] - 2026-11-16

### 新增

- magpie 插件：窗口侧栏 Plugins 组出现「TokenTracker」页，经 magpie 托管的带路页（bridge）跳转到本机看板服务。
- 本机服务：零依赖 `node:http` 服务，只绑 `127.0.0.1`，通过回环接口读本机 TokenTracker 的数据。
- 用量看板：today / 7d / 30d 三个周期的 token 数、花费、缓存命中、会话数。
- 按编程工具（source）与按模型的用量拆分。
- TokenTracker 探活失败时自动拉起（`autoStart`，默认开）：独立进程组启动，服务退出时整组回收；拉起失败后有 60 秒冷却。
- 端口复用：同款服务连续两次探活成功即复用，否则每秒重试绑定、最多等 20 秒。
- 看板为全内联单页：服务端把 css/js 内联进 HTML 并注入服务地址，适配 magpie 页面 opaque origin frame 的 CSP 限制。

[未发布]: https://github.com/jerryjiao/magpie-tokentracker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jerryjiao/magpie-tokentracker/releases/tag/v0.1.0
