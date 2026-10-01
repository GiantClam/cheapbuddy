# CheapBuddy Blog 发布

Blog 文章放在 `content/blog/`，Vite 会自动发现目录里的 Markdown 文件。

## 新增文章

复制下面的 Front Matter，然后写 Markdown 正文：

```md
---
slug: my-new-post
category: BUILD GUIDE
date: 2026-09-29
readTime: 5
accent: green
title: 中文标题
title_en: English title
excerpt: 中文摘要
excerpt_en: English excerpt
---

<!-- zh -->
## 中文小标题

中文正文。

<!-- en -->
## English heading

English body.
```

`slug` 会生成 `/blog/{slug}`。`accent` 支持 `green`、`blue`、`orange`，用于文章卡片配色。

正文使用 `react-markdown` 和 `remark-gfm` 渲染，支持标题、列表、表格、链接和代码块。详情页目录自动读取 `##` 标题。

## 发布检查

```powershell
npm run build
npm test
```

新增公开文章后，把对应 URL 加到 `public/sitemap.xml`，方便搜索引擎发现。
