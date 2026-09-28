# WorkBuddy 类桌面 Agent 的图片与视频接入研究

日期：2026-09-21

## 结论

`models.json` 的 Custom Provider 配置只能让 Agent 把某个模型当作对话模型使用；它不等同于向 Agent 注册图片或视频生成工具。把 `gpt-image-2.5` 的 URL 填为 `/v1/images/generations`，或把 `MiniMax-H3` 的 URL 填为 `/v1/videos`，不能使 WorkBuddy 自动选择、提交、轮询并交付媒体任务。

本机 WorkBuddy 包内的工作模式提示把图片和视频分别路由到独立的 `ImageGen` 与 `VideoGen` 工具。这说明媒体生成在产品架构中是工具能力，不是普通模型配置。`supportsImages` 也应理解为模型可接收图像输入的能力标记，不能当作“可生成图片”的开关。

推荐把 CheapBuddy 媒体能力做成独立的 **CheapBuddy Media MCP Server**。Skill 可作为可选的工作流层，指导模型选择模型、生成提示词和处理异步状态，但 Skill 本身不替代可调用的 API 工具。

## 推荐架构

```text
WorkBuddy / Claude Code / Codex / 其他 MCP 客户端
                 |
                 | MCP tools
                 v
          CheapBuddy Media MCP
                 |
                 | 使用用户自己的 CheapBuddy API Key
                 v
 CheapBuddy OpenAI-compatible media endpoints
  - POST /v1/images/generations
  - POST /v1/videos
  - GET  /v1/videos/{video_id}
  - GET  /v1/videos/{video_id}/content
```

推荐优先提供本地 stdio MCP（例如 `npx @cheapbuddy/media-mcp`）并从环境变量或系统凭据库读取 `CHEAPBUDDY_API_KEY`。这样 API Key 不必交给第三方 MCP 服务。以后可增加 Streamable HTTP MCP 与 OAuth，服务企业集中管理场景。

## MCP 工具契约（v1）

| 工具 | 目的 | 关键输入 | 关键输出 |
| --- | --- | --- | --- |
| `cheapbuddy_generate_image` | 文生图、图生图或编辑 | `model`、`prompt`、`size`、`quality`、`input_images` | `status`、`media`、`revised_prompt`、成本/用量 |
| `cheapbuddy_submit_video` | 提交异步文生视频或图生视频 | `model`、`prompt`、`duration`、`resolution`、`ratio`、`input_image` | `job_id`、`status`、`poll_after_ms` |
| `cheapbuddy_get_media_job` | 查询图片或视频任务 | `job_id` | `status`、`progress`、`media`、`error` |
| `cheapbuddy_cancel_media_job` | 取消仍在运行的任务 | `job_id` | `status` |

所有工具都应定义 JSON Schema 输入和输出。完成的图片可返回 MCP `image` 内容；较大的媒体（特别是 MP4）应返回签名 HTTPS URL 或资源链接，并同时提供结构化的 `media` 数组。这样即便客户端不渲染资源链接，Agent 也能读到可用下载地址。

视频任务不要让一次 MCP 调用阻塞到成片完成：提交工具立即返回任务 ID；客户端或 Agent 调用查询工具轮询。若 MCP 客户端支持进度通知，服务端可在单次长请求中发送进度；但不能把它作为正确性前提。

## Skill、MCP 与原生插件的边界

| 方式 | 能否真正调用媒体 API | 可移植性 | 适合度 |
| --- | --- | --- | --- |
| 仅 Custom Provider / `models.json` | 否 | 低 | 不采用 |
| 仅 Skill（说明或 shell/curl） | 勉强可行，但依赖终端、密钥处理和提示词遵从 | 低 | 仅临时验证 |
| MCP 工具 + 可选 Skill | 是 | 高 | 推荐 |
| WorkBuddy 原生 ImageGen/VideoGen Provider 插件 | 是 | 仅 WorkBuddy | MCP 之后再做，改善 UI |

因此，最快的稳妥路径是先交付 MCP；随后用一个很薄的 WorkBuddy 专用适配器，把其硬编码的 `ImageGen`/`VideoGen` UI 映射到同一套 CheapBuddy 媒体服务。两个入口共用请求校验、异步任务状态和媒体下载逻辑，避免重复维护供应商适配。

## 安全与产品要求

1. 不在 Skill、仓库、`models.json` 示例或日志中写入真实 API Key；本地 MCP 使用环境变量或操作系统凭据库。
2. 图片/视频生成属于计费操作。首次调用和超过预设预算时要求用户确认；服务端按用户 Key 做额度、速率和审计。
3. 返回短期签名下载 URL，不泄漏上游供应商 URL 或密钥。
4. 输入图像使用受控上传或短期预签名 URL；验证 MIME、大小和来源。
5. 失败输出应是可恢复的结构化状态，而非把上游错误原样暴露给模型或用户。

## 证据与参考

- 本机 WorkBuddy 提取包的 `resources/plugins/workbuddy-builtin/welcomemode/*/prompt.tpl` 明确将图片路由到 `ImageGen`、视频路由到 `VideoGen`，而不是模型配置。
- [MCP Tools 规范](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)：工具由模型发现和调用，使用 JSON Schema 描述输入/输出；结果可包含文本、图片、音频、资源链接与嵌入资源。
- [MCP Progress 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress)：长任务可通过 `notifications/progress` 发送进度，但接收方可选择不使用该能力。
- [OpenAI Responses API 工具参考](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)：将 MCP 与自定义函数并列为模型可调用工具，佐证“模型端点”与“可调用能力”是两个不同层次。
