# 项目限制与运行边界

本文档记录容易造成误判的开发、预览和部署限制。修改 Vite、静态路由或多入口页面时，需要同步检查这里的规则。

## 前端开发代理匹配范围

Vite 开发服务器只把 `/api/`（带结尾斜杠）代理到本地 Sub2API：

```text
/api/* -> http://127.0.0.1:8080
```

不要把代理键改成 `/api`。Vite 的前缀匹配会把 `/api-docs` 误认为后端请求；当本地 8080 未启动时，文档页会收到 `502 Bad Gateway`。`/api-docs` 是前端多入口页面，不属于后端 API。

## 页面预览方式

`index.html`、`api-docs/index.html` 和 `comfyui/index.html` 是 Vite 源入口，不能通过 `file://` 直接预览。必须启动开发服务器后访问：

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/api-docs/
http://127.0.0.1:5173/comfyui/
```

生产预览使用 `npm run build` 后的静态服务；构建产物包含 `dist/api-docs/index.html`、`dist/comfyui/index.html` 和 ComfyUI ZIP 下载文件。

## API 服务依赖

官网页面本身可以在没有本地 Sub2API 的情况下打开，但登录、余额、公告、API Key 和配置测试会请求 `/api/v1/*`。本地后端未启动时，这些功能会失败；这不应阻止首页、API 文档页或 ComfyUI 文档页渲染。

## 导航验收范围

首页顶部导航必须保持以下入口可访问：

- `模型货架` -> `#models`
- `使用方法` -> `#how`
- `价格与消耗` -> `#pricing`
- `安装指南` -> `#guide`
- `图片 / 视频接入` 菜单 -> `/api-docs/` 和 `/comfyui/`

API 文档页和 ComfyUI 文档页的顶部返回、互链和语言切换也属于导航验收范围。
