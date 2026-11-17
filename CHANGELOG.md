# 更新日志

本项目的所有重要变更都会记录在这个文件里。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 规划中

- 看板 UI 改版：按 `docs/design-spec.md`（v1）对齐深色/浅色主题、指标卡与趋势柱图版式。
- 配额面板：展示各 provider 的用量窗口百分比与重置时间。
- 活动热力图：GitHub 风格的按日 tokens 热力图。
- 成就徽章面板。
- 看板显示 TokenTracker 官方账号登录状态与官方云同步 / 全球排行榜入口（登录不影响本地功能）。
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
