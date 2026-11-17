# 更新日志

本项目的所有重要变更都会记录在这个文件里。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.3] - 2026-11-17

### 修复

- 带路页永远停在「正在打开本机看板…」不动（用户报的「又卡到这里」）。根因是端口复用的一个漏洞：magpie 重启插件宿主时，旧宿主的服务还在应答，新宿主把它当成「长期存在」直接复用；旧宿主随 magpie 退出，端口立刻空掉，而新宿主已经不再重绑，带路页跳过去就是死地址。WebKit 又把失败的那次导航和成功分不开（magpie 源码注释：leaves the frame on the page's own "connecting…" for good），页面就永远停住。实机时间线对得上：16:33:04 绑定 3491 → 16:33:49 宿主重启 → 16:33:51 `same service already on 3491; reusing it` → 16:33:51 宿主退出，3491 再没人接。
- 复用之后现在会守望端口（每 750ms 探活）：对方一停应答就自己绑，日志打 `took over from a service that quit`。真被另一个活着的实例占着时不抢，等它退。
- 插件加载不再可能被端口等待拖过 magpie 的 20 秒加载上限：首次绑定预算 8 秒，超了先返回（`deferred`/`pending`）交给守望循环接手；拖过上限 magpie 会判这次加载失败且不再重试，服务就再也起不来（同一类「页面卡住」的另一种成因）。
- 带路页在桌面窗口不再只跳一次：跳失败不会换掉本页，改成每 0.7–2.5 秒再跳一次，服务回来就进看板；第 7 次起给出「服务还没起来」的说明和重试按钮。WKWebView 实测（本机 quicklook 之外单独搭的 harness）：连续 22 次导航失败后本页仍在、定时器照跑，服务起来后第 3 次跳成功。

### 变更

- `BUILD` 6 → 7（复用后的守望、加载预算都变了）。

### 文档

- README 去掉全部截图：npm 页面渲染的是包内 README，相对路径的 `docs/screenshots/*.png` 在 npm 上是破图，所以界面图不再进 README，`docs/screenshots/` 连同 4 张图一并删除。
- README 结构一节测试数 29 → 31（本版新增两个端口接手的测试）；发布手册里关于截图占位的两条说明同步改成「README 不放截图」。

## [0.2.2] - 2026-11-17

### 文档

- README 对齐 0.2.1 的实际功能：安装改为 npm 已发布；新增「看板内容」一节；接口表补齐配额、热力图、成就、官方云与静态路由；选项表补环境变量列；补充找不到页面 / 白屏的排查顺序。
- 截图按 0.2.1 界面重拍：浅色全页、深色全页、云同步面板，替换掉旧界面截图（缓存全 0、按模型空白、无纵轴）。
- 代码无变更，`BUILD` 仍为 6。

## [0.2.1] - 2026-11-17

### 新增

- 发布到 npm：`magpie plugin add magpie-tokentracker` 可以直接装，不用再从本地目录装。

### 修复

- 卡片「输入 / 输出 / 缓存读取 / 会话」全是 0：看板读的是 `cacheReadTokens`/`sessions` 这类驼峰名，而 `/api/usage` 是透传 TokenTracker 的 `input`/`cacheRead`/`cacheHitRate`/`conversations`。现在两套名字都认，并按真实值显示（实测：输入 703.7 万、缓存读取 9,877 万、命中率 92.7%、会话 930）。
- 删掉「← 返回插件页」按钮。它做的只是 `history.back()` 回带路页再自动跳回来，等于一次重载，和 magpie 页面右上角的 ⟳ 重复，看着像没反应；带路页仍用 `location.assign` 跳转（保留回退能力），只是页面里不再露出这个按钮。
- 「打开本机看板 / 了解 Cloud」不再把看板整页跳走。沙盒里 `location.href` 换成 `127.0.0.1:7680`（服务没起来就是连接拒绝）会变成白屏，而且没有返回。现在优先新窗口打开；弹窗被拦时留在看板里，给出可复制的地址。
- 「云」改名为「云同步」，点开的说明面板（官方账号登录、云同步、排行榜）从页面最底部移到头部下方：一打开就在视口里，不用滚动。以前面板在最底下展开，视口不动，看起来像按钮没反应。
- 看板在 magpie 沙盒 frame（opaque origin）里打开后全是「—」：`page/app.js` 裸访问 `localStorage` 抛 SecurityError 炸掉整个脚本（0.2.0「记住周期」引入），现在包一层安全存储，沙盒里降级为不记忆周期。
- 带路页（`page/boot.js`）探活只在 magpie.web 的 service 同源转发模式下做（结果可信），失败显示红色提示与「重试」按钮，服务恢复后点重试即可进入看板；桌面窗口的带路页 CSP 会把跨源 fetch 和 `<script>` 全拦（0.1.4345 实测），双失败与服务真死无法区分，故桌面版保持直接跳转——跳转本身就是最快的验证，不再把活服务误判成死服务。`/api/healthz?probe=` 回合法 JS（nosniff 的 MIME 检查可过）；`server.mjs` 的 BUILD 4 → 5（healthz 新增 probe 语义，指纹区分新旧服务）；本版再 5 → 6（看板页面与图表结构变了，旧进程不复用）。

### 界面调整（按 Jerry 2026-11-17 反馈）

- 标题和那排按钮同一行：`.top` 不再换行，品牌区可压缩、标题过长省略；窗口 ≤720px 时先隐藏副标题，保证按钮不被挤到第二行。
- 趋势图补上纵轴：刻度 0 / 一半 / 最高（带横线），柱子高度只按 150px 绘图区算。以前标签和柱子挤在同一个 150px 盒子里，百分比高度把标签高度也算进去，柱高不成比例，也没有任何刻度可读。
- 横轴刻度自适应，最多 10 个：每小时图每 3 小时一个、只写小时数（0 3 6 9 12 15 18 21）；30 天图每 3 天一个（10-19、10-22…）。柱子标题仍带完整时间与用量。
- 「按模型」恢复显示：接口给的是模型 id（`smart-split`、`glm-5.3-flash`），没有 `name` 字段，原来取 `r.name` 取到空值只剩空条，现在标签兜底到 id（实测 9,527 万 / 2,489 万）。

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

## [0.1.0] - 2026-11-16

### 新增

- magpie 插件：窗口侧栏 Plugins 组出现「TokenTracker」页，经 magpie 托管的带路页（bridge）跳转到本机看板服务。
- 本机服务：零依赖 `node:http` 服务，只绑 `127.0.0.1`，通过回环接口读本机 TokenTracker 的数据。
- 用量看板：today / 7d / 30d 三个周期的 token 数、花费、缓存命中、会话数。
- 按编程工具（source）与按模型的用量拆分。
- TokenTracker 探活失败时自动拉起（`autoStart`，默认开）：独立进程组启动，服务退出时整组回收；拉起失败后有 60 秒冷却。
- 端口复用：同款服务连续两次探活成功即复用，否则每秒重试绑定、最多等 20 秒。
- 看板为全内联单页：服务端把 css/js 内联进 HTML 并注入服务地址，适配 magpie 页面 opaque origin frame 的 CSP 限制。

[0.2.3]: https://github.com/jerryjiao/magpie-tokentracker/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/jerryjiao/magpie-tokentracker/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/jerryjiao/magpie-tokentracker/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jerryjiao/magpie-tokentracker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jerryjiao/magpie-tokentracker/releases/tag/v0.1.0
