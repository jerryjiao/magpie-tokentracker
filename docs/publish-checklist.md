# magpie-tokentracker 发布手册

本文是发布操作手册，只记录步骤，**不代表已执行**。执行前确认：截图已补进 `docs/screenshots/`、CHANGELOG 已更新到待发版本、`package.json` 的 `private: true` 已移除（见下文问题清单）。

## 一、GitHub（public repo：jerryjiao/magpie-tokentracker）

### 前置检查

```sh
gh auth status             # gh 已登录 jerryjiao 账号
git status --short         # 无多余/敏感文件；node_modules/、*.log、.DS_Store、dist/、.env 均被 .gitignore 挡住
git log --oneline          # 提交历史干净
npm test                   # 全绿
```

### 创建 repo 并推送

```sh
# 在项目根目录执行；--source . 取当前仓库，--push 推当前分支（main）
gh repo create jerryjiao/magpie-tokentracker --public --source . --push
```

### 建议的 repo description

```text
Token usage dashboard for magpie — today / 7d / 30d tokens & cost, split by coding tool and model, read from the local TokenTracker loopback API. Zero dependencies.
```

### topics 建议

`magpie` `tokentracker` `tokens` `usage` `dashboard` `ai`

```sh
gh repo edit jerryjiao/magpie-tokentracker \
  --description "Token usage dashboard for magpie — today / 7d / 30d tokens & cost, split by coding tool and model, read from the local TokenTracker loopback API. Zero dependencies." \
  --add-topic magpie --add-topic tokentracker --add-topic tokens \
  --add-topic usage --add-topic dashboard --add-topic ai
```

### 首个 release

```sh
git tag -a v0.1.0 -m "v0.1.0 首个公开版本"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes "首个公开版本，变更见 CHANGELOG.md。"
```

### 收尾

- About 栏的 description 与 topics 上面的命令已覆盖；可再到网页端核对。
- （可选）Settings → Branches 给 `main` 加分支保护；Issues 默认开启。

## 二、npm（包名：magpie-tokentracker）

### 发布前检查

1. **移除 `package.json` 里的 `"private": true`** —— npm 拒绝发布 private 包。该字段不在本次发布准备的可改动范围内，需仓库 owner 手动移除。
2. `npm whoami` —— 确认登录目标账号（2026-11-17 实测：本机已登录 `jerryjiao`）。
3. `npm pack --dry-run` —— 核对打包清单。`files` 白名单 = `index.mjs` / `server.mjs` / `lib` / `page` / `README.md`，npm 在此之外自动带上 `package.json`、`README.md`、`LICENSE`。预期打包清单（2026-11-17 实测 13 个文件，25.2 kB / 解压 72.6 kB）：

   | 打进包的文件 | 来源 |
   |---|---|
   | `package.json` | npm 自动 |
   | `README.md` | files 白名单 + npm 自动 |
   | `LICENSE` | npm 自动（根目录存在即带） |
   | `index.mjs` | files |
   | `server.mjs` | files |
   | `lib/usage.mjs`、`lib/tokentracker.mjs` | files: `lib` |
   | `page/index.html`、`page/boot.js`、`page/board.html`、`page/app.js`、`page/style.css`、`page/icon.svg` | files: `page` |

   **不应出现**（实测确认没有）：`docs/`、`test/`、`.git/`、`node_modules/`、`.env`、`.gitignore`。
4. `CHANGELOG.md` 目前**不在**包内（npm 的自动包含清单只有 package.json / README / LICENSE / main 入口，不含 CHANGELOG）。要么接受（GitHub 上有全文即可），要么由 owner 把 `"CHANGELOG.md"` 加进 `files` 白名单后重跑 dry-run。
5. `npm test` 再跑一遍全绿；确认 CHANGELOG 顶部没有该随本次发布收编的「未发布」条目。

### 发布

```sh
npm publish --access public
```

> 本包非 scoped，默认就是 public；显式 `--access public` 无害，防止误配。

### 发版后验证

```sh
npm view magpie-tokentracker             # 版本、engines、repository/bugs/homepage 链接是否正确
npm view magpie-tokentracker dist-tags
npm pack magpie-tokentracker --dry-run   # 从 registry 拉远端包核对清单与本地一致
magpie plugin add magpie-tokentracker    # 真机冒烟：侧栏出现「TokenTracker」页、数据正常
```

## 三、magpie 插件市场口径

- 发布 npm 后，magpie 用户不再需要本地路径或软链，直接：

  ```sh
  magpie plugin add magpie-tokentracker
  ```

  magpie 从 npm 拉包，装进 `~/.config/magpie/plugins/node_modules/`，page 文件随包一起下发——这正是 README「本地安装」一节里本地路径安装白屏坑的解法。
- **TODO：确认 magpie 插件收录流程。** 若 magpie 有官方插件目录 / 收录机制（目录页、审核、上架表单），npm 发布后走一遍收录，让用户能在目录里搜到本插件；收录所需的图标、截图、分类等字段以 magpie 官方文档为准。

## 附：本次发布准备发现的问题清单（2026-11-17）

1. `package.json` 带 `"private": true`，npm publish 前必须移除（字段不在发布准备的可改范围内，需 owner 操作）。
2. `CHANGELOG.md` 不在 npm 包内，见上文第二节第 4 条，二选一。
3. `funding` 指向 `https://github.com/sponsors/jerryjiao`；若未开通 GitHub Sponsors，发布前删除该字段或改成真实链接（不删也不影响安装）。
4. GitHub repo 与 npm 包都尚未创建，README badges、CHANGELOG 底部的 compare/tag 链接、`repository/bugs/homepage` 在创建前均为死链——属预期，创建后自动生效。
5. README「结构」一节的测试数量（15 个）会随并行开发漂移，发布前以 `npm test` 实际输出为准。
6. README 截图占位（`docs/screenshots/board.png`）待补，发布前建议补齐并取消注释。
