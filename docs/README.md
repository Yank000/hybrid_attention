# 知识库页面维护

直接在浏览器打开 `index.html`。首页的搜索与主题筛选可离线使用。

## 增加知识 HTML

1. 将新页面放入本目录，例如 `new_topic.html`。
2. 在 `index.html` 的 `<script id="knowledge-pages" type="application/json">` 数组末尾增加一条记录（注意前一条记录后添加逗号）：

   ```json
   {
     "title": "新知识页标题",
     "href": "new_topic.html",
     "createdAt": "2026-11-18T14:30:00+08:00",
     "category": "调研",
     "description": "用一两句话说明本页解决的问题。",
     "tags": ["主题一", "模型或引擎"]
   }
   ```

3. 保存并刷新首页。`createdAt` 填写带时区的文件创建时间，`category` 使用“调研”“实验”“工具”或“其他”。首页将本地文档和 Workflow 投稿合并为一个列表，按时间从新到旧排列，以 UTC+8 显示。Workflow 投稿使用 GitHub Issue 的创建时间。
4. 在新页面加入返回入口：`<a href="index.html">← 返回知识库首页</a>`。

JSON 不能含注释或末尾逗号。页面使用相对路径，文件名改变时需要同步更新 `href`。若需支持禁用 JavaScript 的浏览器，同时更新首页的 `<noscript>` 链接列表。顶部建议阅读顺序是人工选择的导读，新页面无需自动加入。

## 内嵌图片

`hybrid_VRAM_management.html` 的前缀匹配 JPEG 已转成 `data:image/jpeg;base64,...`，完整图片随 HTML 保存，不再需要目录中的独立 JPEG。

- 图片内容和画质保持不变；Base64 使图片部分的文本体积增加约三分之一。
- 内嵌图适合单文件离线分享；多个页面重复使用同一图片时，独立资源更便于复用和缓存。
- 更新图片时，需要替换整个 `data:` URL。若将来部署到有 CSP 的网站，需允许 `img-src data:`。

`cache_size_overview.html` 的正文数据与交互图已经内嵌；额外的报告、CSV 和 PNG 下载链接指向工作区其他位置。只分享 `docs` 目录时，仍可查看正文与交互图，但这些附件链接需要同时携带对应资源。
