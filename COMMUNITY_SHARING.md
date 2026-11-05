# 用户文档自动分享

首页部署在 GitHub Pages；GitHub Issue 保存投稿，Actions 自动构建发布。无需 Supabase、PAT 或人工审批。投稿需要 GitHub 账号，读者无需登录。

## 使用方法

1. 打开首页“用户分享”，点击“上传分享文档”。
2. 在 GitHub 表单填写标题、简介、分类，可选标签。
3. 将一个 `.html`、`.htm` 或 `.pdf` 文件拖入“文档附件”，等待附件上传完成后提交。
4. 等待 `Publish knowledge base` Workflow 完成。机器人会在 Issue 下回复分享网址。
5. 其他访客打开首页即可看到卡片；已经打开首页的人可点击“刷新分享”。

分享地址为 `share.html?id=<Issue编号>`。编辑 Issue 会重新发布；关闭、删除或转移 Issue 后，下一次成功构建会撤下该条目。重新打开 Issue 会恢复。关闭 Issue 不会删除 GitHub 的原始公开附件。

HTML 必须为 UTF-8、自包含单文件：CSS、JavaScript、图片应内嵌。不支持 ZIP 或本地资源目录。每个文件最大 20 MiB，最多发布 200 条，总分享文件预算 200 MiB，总站点预算 800 MiB。超出总预算会中止构建并保留线上版本，而不是发布缺少条目的列表。

## GitHub 一次性设置

- 仓库公开，并在 `Settings → General → Features` 启用 Issues。
- `Settings → Actions → General` 启用 Actions，允许 GitHub 官方 Actions。
- `Settings → Pages → Source` 选择 **GitHub Actions**。
- `Settings → Environments → github-pages` 不设 Required reviewers 或等待时间，并允许 `main` 分支部署。
- 确认默认分支为 `main`。若更改分支名，同时修改 Workflow 的 push 分支和两处 checkout ref。
- 仓库/组织上层策略不能禁止 Workflow 声明所需的 Pages、Issues 权限。

不需要 Secrets。GitHub 自动提供每个任务的 `GITHUB_TOKEN`。构建任务只能读取代码和 Issues；部署任务仅有 Pages/OIDC 权限；通知任务仅有代码读取和 Issue 回复权限。

将源码提交到 `main` 后会触发首次部署。也可进入 `Actions → Publish knowledge base → Run workflow` 手动重建。Pages 的最终地址以仓库设置显示为准。

## 文件与运行机制

| 文件 | 用途 |
| --- | --- |
| `.github/ISSUE_TEMPLATE/share.yml` | 投稿表单，不依赖人工添加标签 |
| `.github/workflows/publish-pages.yml` | 测试、全量构建、部署、回复发布状态 |
| `scripts/build-shares.mjs` | 读取全部未关闭 Issue，处理附件并生成 `_site` |
| `scripts/notify-share.mjs` | 创建或更新同一条机器人状态回复 |
| `docs/community.js`、`community.css` | 首页社区卡片、搜索、分类和刷新 |
| `docs/share.html`、`share.js`、`share.css` | 独立阅读器、下载与复制链接 |
| `docs/data/shares.json` | 本地开发空清单；部署时自动替换 |

Workflow 只运行默认分支里固定的代码。用户输入不会插入 shell、Action 表达式或文件路径，上传的 JavaScript 不会在构建机器上执行。

每次构建从当前全部未关闭的投稿生成完整清单，不向 main 提交生成文件。站点从 `docs` 复制到临时构建目录，完成后生成 `_site` 并作为 Pages artifact 发布。`.log` 文件不进入部署。不要把未公开文件放入 docs 目录。

只有标题以 `[分享]` 开头、且包含表单字段的 Issue 被识别；普通问题 Issue 不会进入首页。非法格式、类型、已删除附件会列入 `shares.json` 的 rejected，并在对应事件部署后回复原因。网络、API 或容量错误会使整个构建失败，阻止用不完整站点替换线上内容。

多个投稿共享同一发布并发组。每轮读取全部当前投稿，避免新增条目覆盖旧条目；GitHub 可能合并等待中的运行，因此取消/合并的运行不会单独发送成功通知，但最终站点仍按当前全部投稿重建。可手动重跑 Workflow 恢复通知。

HTML 被保存为 JSON 文档数据，通过 `sandbox="allow-scripts"` iframe 阅读。不要添加 `allow-same-origin`。内嵌脚本可以运行，CSP 禁止外部脚本、图片、fetch 等资源请求，不允许弹窗和自动下载。需要导出时使用阅读器外部的“下载文档”。PDF 由浏览器尝试预览，不支持预览的浏览器可下载阅读。

## 本地验证

需要 Node.js 24，无 npm 依赖：

```powershell
node --test tests/build-shares.test.mjs
node --check docs/community.js
node --check docs/share.js
node --check scripts/notify-share.mjs
```

实际构建需要访问 GitHub API。公开仓库本地可不提供 Token，但受未认证 API 限流影响；Actions 会自动提供 Token：

```powershell
$env:GITHUB_REPOSITORY = 'Yank000/hybrid_attention'
node scripts/build-shares.mjs
```

默认输出 `_site`，为防止误覆盖，输出目录已存在时会拒绝构建。再次本地验证可通过 `SHARE_OUTPUT_DIR` 指定一个新的输出目录。生成目录及 `*.staging-*` 不应提交到仓库。

不要直接用 file:// 测试社区列表与分享页：浏览器会限制读取 JSON。使用任意本地静态 HTTP 服务，或查看 Pages 部署；首页内嵌的原知识库导航仍可离线使用。

## 验收与排障

用无仓库写权限的账号提交 HTML 和 PDF。等待 Actions 完成，在未登录的浏览器打开首页与分享链接。再测试编辑、关闭和重新打开投稿。

| 现象 | 检查 |
| --- | --- |
| 没有投稿表单 | 模板是否已进入默认分支，Issues 是否启用 |
| 投稿后没有运行 | 默认分支是否包含 Workflow，Actions 是否启用 |
| 等待人工批准 | github-pages 环境是否配置 reviewers |
| Pages 部署权限错误 | Source 是否为 Actions、部署分支限制、组织权限策略 |
| 普通 Issue 也触发运行 | 正常；构建只收录有效分享，统一重建确保删除/改名可撤下 |
| 机器人没有回复 | 查看 notify 任务；Issues 写权限是否受组织限制，运行是否被合并/取消 |
| 附件下载失败 | 是否为公开 GitHub 附件，是否已完成上传，查看构建日志 |
| 新投稿尚未显示 | 等待 deploy 成功后刷新首页；检查投稿状态回复 |
| HTML 缺图或脚本失效 | 是否依赖外部资源，改为内嵌资源后重新上传 |
| PDF 没有显示 | 使用“下载文档”，浏览器内置 PDF 阅读器可能受 sandbox 限制 |

若附件 CDN 域名将来变化，请先确认其为 GitHub 官方附件域名，再调整 `validateAttachmentRedirect` 的允许列表；不要开放任意 URL 下载。
