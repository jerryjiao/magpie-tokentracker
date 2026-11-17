# magpie-tokentracker 设计规范（v1）

两个界面共用这份规范：**本机看板**（page/）与**云端站点**（cloud/site/）。照此实现，不要另起配色。
界面语言：中文为主，zh/en 双语（看板已有双语机制，站点先只做中文）。

## 1. 原则

- 深色优先（magpie 页面默认深色），同时支持浅色（`data-theme="light"`）。
- 信息密度适中：一屏看清「花了多少、花在哪、还剩多少」。
- 数字用等宽字体 + `font-variant-numeric: tabular-nums`，对齐不跳动。
- 动效克制：150ms ease 过渡即可，不做大动画。
- 对比度达 WCAG AA；可聚焦元素有 `:focus-visible` 描边。

## 2. CSS 变量（直接拷进 style.css / 站点 css）

```css
:root, [data-theme="dark"] {
  --bg: #0b0f14;          /* 页面底 */
  --surface: #121821;     /* 卡片 */
  --surface-2: #1a2330;   /* 卡片内嵌套块 */
  --border: #233041;
  --text: #e6edf3;
  --text-dim: #8b98a9;
  --text-faint: #5c6a7d;
  --brand: #2dd4a7;       /* 主色（青绿） */
  --brand-deep: #1f9d78;
  --brand-soft: rgba(45, 212, 167, 0.12);
  --accent: #58a6ff;      /* 次强调 / 链接 */
  --warn: #d29922;
  --danger: #f85149;
  --grid: #1d2735;        /* 图表网格线 */
  --heat-0: #161b22;      /* 热力图 5 档 */
  --heat-1: #0e4429;
  --heat-2: #006d32;
  --heat-3: #26a641;
  --heat-4: #39d353;
  --radius: 12px;
  --radius-sm: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
[data-theme="light"] {
  --bg: #f6f8fa;
  --surface: #ffffff;
  --surface-2: #f0f3f7;
  --border: #d0d7de;
  --text: #1f2328;
  --text-dim: #59636e;
  --text-faint: #8c959f;
  --brand: #1a9e77;
  --brand-deep: #147a5c;
  --brand-soft: rgba(26, 158, 119, 0.10);
  --accent: #0969da;
  --warn: #9a6700;
  --danger: #cf222e;
  --grid: #e4e9ee;
  --heat-0: #eaeef2;
  --heat-1: #9be9a8;
  --heat-2: #40c463;
  --heat-3: #30a14e;
  --heat-4: #216e39;
}
```

## 3. 版式与组件

- 页面容器：`max-width: 1080px; margin: 0 auto; padding: 20px 24px 32px;`
- **头部**：左 = 状态点（8px 圆点：ok=--brand、warn=--warn、bad=--danger，带 6px 光晕）+ 标题 + 副标题；右 = 周期切换 + 次级按钮。周期切换用分段控件（圆角胶囊、选中态 --surface-2 + --text，未选中 --text-dim）。
- **按钮**：主按钮 = --brand 底 + 深色字（#08130e）；次级/幽灵按钮 = 透明底 1px --border + --text-dim，hover 变 --text。radius-sm。
- **指标卡**：4 列网格（<720px 折 2 列）。label 12px --text-dim；value 26px mono；meta 12px --text-faint。卡片 = --surface、1px --border、radius、hover translateY(-1px)。
- **趋势柱图**：CSS grid 柱列；柱体 `linear-gradient(180deg, var(--brand), var(--brand-deep))`、顶部圆角 3px、零值柱 2px 高 --grid 色。hover：亮 20% + 自绘 tooltip（fixed 定位小黑卡：--surface-2 底、1px --border、mono 数字；用 title 属性兜底也行）。x 轴刻度 10px --text-faint。
- **条形排行**（按工具/按模型）：行头 name + 右对齐数值（mono）；轨道 = --surface-2 全宽圆角，填充 = 同柱图渐变，最小可见 1.5%。
- **热力图**：GitHub 风格周列 × 7 行，格子 11px 圆角 3px 间距 3px；颜色档按当日 tokens 分位（0 / >0 / >25% / >50% / >75% 峰值）映射 --heat-0..4；月份标签 10px --text-faint；格子 hover 有 title（日期 + tokens）。
- **配额面板**：每行 = provider 名 + 右侧百分比（mono）+ 进度条（6px 高全宽圆角）。颜色按 used_percent：<70 --brand、70–85 --warn、>85 --danger。窗口说明（如 5h / weekly）放行尾 faint。
- **成就徽章**：横向滚动条带；每枚 = 徽章名（12px）+ tier 徽标（bronze/silver/gold/diamond 四档，用文字+边框色区分：#b08d57 / #c0c8d0 / #e0b34d / #7ee0ff）+ 进度（mono，x/y）。
- **空态/离线态**：--surface 卡片居中，图标可省，标题 + 说明 + 命令代码块（--surface-2 + mono）+ 重试按钮。
- **表单/输入**（站点用）：输入框 = --surface-2 底 1px --border，focus 时 border 变 --brand；错误提示 12px --danger。
- **表格**（站点按模型）：表头 12px --text-dim 底部 1px --border；行 hover --surface-2。

## 4. 文案口径

- 中文界面措辞平实，不用营销腔：「上传」「重新连接」「这个周期没有用量」。
- 数字格式沿用看板现有函数（万/亿缩写、$ 花费、百分比 1 位小数）。
