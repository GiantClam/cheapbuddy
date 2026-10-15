# CheapBuddy Media MCP 开发计划

日期：2026-10-10
状态：需求澄清完成，待实施

## 1. 决策摘要

### 产品目标

提供一个本地 stdio MCP，让 Claude Code、Codex 和 OpenCode 通过一个 CheapBuddy API Key 调用图片和视频能力：

```text
Claude Code / Codex / OpenCode
        -> @cheapbuddy/media-mcp (stdio)
        -> CheapBuddy Relay HTTP API
        -> NewAPI image routes / H3 Task Plugin
        -> image provider / MiniMax-H3
```

### 明确不做

- 不在 NewAPI 中新增 MCP Server。
- 不让 Relay 放行通用 `/mcp`、`tools/list` 或 `tools/call` 路由。
- 不把 NewAPI 的 Claude/Responses MCP 字段转换能力包装成通用 MCP 平台。
- 不直连 Qingyan、MiniMax 或 NewAPI 管理接口。
- 不实现日预算、月预算或单任务预算。
- 不实现强制 `quote -> confirm -> generate` 流程。
- 不提供 MCP 批量工具。
- 不提供视频阻塞式等待工具。
- 不提供账户总媒体用量工具。
- 不在本地持久化 API Key、任务映射或任务数据库。
- 不接受任意 provider-specific `options` 透传。

### 复用边界

MCP 复用现有 CheapBuddy 公共 API：

```text
GET  /v1/models
GET  /v1/pricing?model=...
POST /v1/images/generations
POST /v1/images/edits
POST /v1/images/variations
GET  /v1/images/tasks/{id}
POST /v1/videos
GET  /v1/videos/{id}
GET  /v1/videos/{id}/content
POST /v1/media
```

NewAPI 继续负责 H3 provider adapter、任务轮询、artifact 和上游密钥隔离；Relay 继续负责用户身份、媒体预扣、幂等、限流、失败释放和最终结算。

## 2. 运行时与发布

### 包位置

```text
media-mcp/
  package.json
  README.md
  src/
  test/
```

### 技术选择

- Node.js 20+。
- ESM JavaScript，与主仓库现有 Node/Vite 代码保持一致。
- 官方 `@modelcontextprotocol/sdk`。
- stdio transport。
- 通过 `npx @cheapbuddy/media-mcp` 启动。
- 不首发独立二进制。
- 不新增 monorepo workspace。

### 认证

唯一密钥来源：

```text
CHEAPBUDDY_API_KEY=...
CHEAPBUDDY_BASE_URL=https://api.cheapbuddy.cc
```

规则：

- `CHEAPBUDDY_API_KEY` 必填。
- `CHEAPBUDDY_BASE_URL` 可选，默认生产地址。
- 支持 Claude Code、Codex、OpenCode 在 MCP 配置中的 `env` 注入。
- 不支持命令行传 Key。
- 不支持 v1 login 命令。
- 不写入本地配置文件。
- 不写入日志、错误、任务 ID 或 MCP 返回内容。
- 启动时缺少 Key 要返回清晰的本地配置错误，不发起网络请求。

## 3. MCP 工具契约

正式工具共 6 个：

```text
cheapbuddy_list_media_models
cheapbuddy_quote_image
cheapbuddy_generate_image
cheapbuddy_quote_video
cheapbuddy_submit_video
cheapbuddy_get_media_job
```

### 3.1 `cheapbuddy_list_media_models`

只读工具。

调用 `GET /v1/models`，只返回当前 API Key 实际可见的图片和视频模型。建议输出：

```json
{
  "models": [
    {
      "id": "gpt-image-2.5",
      "media_type": "image",
      "operations": ["generate", "edit", "variation"],
      "input_types": ["text", "image"],
      "output_types": ["image"],
      "parameter_schema": {}
    },
    {
      "id": "MiniMax-H3",
      "media_type": "video",
      "operations": ["text_to_video", "image_to_video", "reference_to_video"],
      "input_types": ["text", "image", "video", "audio"],
      "output_types": ["video"],
      "parameter_schema": {}
    }
  ],
  "cached": false,
  "cache_ttl_seconds": 60
}
```

缓存策略：

- 进程内缓存 60 秒。
- 不写磁盘。
- API Key 变化时清空。
- 发现 `model_not_found`、权限变化或鉴权刷新时主动刷新。
- 不把静态 `src/models.js` 当作权限来源。

### 3.2 `cheapbuddy_quote_image`

只读工具，不锁定额度，不是生成前置。

输入：

- `model`：必填。
- `operation`：`generate | edit | variation`。
- `size`、`quality`、`n` 等仅在动态模型 schema 声明后允许。
- `images` 和 `mask` 只用于构造估算上下文，不上传大文件，除非后端报价确实需要。

输出必须区分：

```json
{
  "pricing_type": "estimate | rate_card",
  "model": "gpt-image-2.5",
  "estimated_amount": null,
  "exact": false,
  "currency": "USD",
  "basis": "Current account rate card",
  "rate_card": {},
  "final_charge_may_differ": true
}
```

不能从现有费率卡计算单次任务金额时，返回 `rate_card`，不得硬编码价格或伪造精确报价。

### 3.3 `cheapbuddy_generate_image`

这是图片的唯一写工具，通过 `operation` 区分三类操作：

```text
generate | edit | variation
```

所有写操作必须显式传 `model`，模型必须来自当前动态目录。

基础输入：

```json
{
  "model": "gpt-image-2.5",
  "operation": "generate",
  "prompt": "A clean product photo on a studio background",
  "images": [],
  "mask": null,
  "size": "1024x1024",
  "quality": "auto",
  "n": 1
}
```

规则：

- `generate`：需要 prompt，不接受 mask；是否允许 images 由模型能力决定。
- `edit`：需要至少一张 `images`，允许可选 `mask`。
- `variation`：需要至少一张 `images`，是否允许多图由动态模型 schema 决定。
- 不接受未在模型 schema 中声明的字段。
- 支持多张图片；数量按动态 schema 校验，未声明时使用保守默认上限。
- `mask` 只允许 `edit`，推荐 PNG。
- 本地文件直接 multipart 上传。
- HTTPS 素材走 JSON URL。
- 图片任务默认在 MCP 内部轮询最多 300 秒。
- 300 秒内完成则直接返回 `completed`；超时返回 `processing` 和不透明 `job_id`。

### 3.4 `cheapbuddy_quote_video`

只读工具，不锁定额度，不是生成前置。

输入至少包括：

- `model`：必填，v1 主要为 `MiniMax-H3`。
- 可选 `seconds`、`resolution`、素材类型摘要。

H3 估算：

- `seconds` 省略时按 6 秒估算。
- 显式值必须为 4-15 的整数。
- `resolution` 省略时按 `768P`。
- 估算结果必须标记 `exact: false`。
- 最终扣费以上游成功任务用量和 CheapBuddy 结算为准。

### 3.5 `cheapbuddy_submit_video`

计费写工具，提交后立即返回，不内部等待。

输入：

```json
{
  "model": "MiniMax-H3",
  "prompt": "A smooth product reveal with soft studio lighting",
  "seconds": 6,
  "ratio": "16:9",
  "resolution": "768P",
  "first_frame": { "path": "C:/work/start.png" },
  "last_frame": null,
  "reference_image": null,
  "reference_video": null,
  "reference_audio": null,
  "idempotency_key": "optional-client-key"
}
```

H3 规则：

- `seconds` 可省略，默认 6 秒；显式值 4-15 秒整数。
- 纯文生视频时 `ratio` 必填。
- 有参考素材时 `ratio` 可省略，默认 `adaptive`。
- 固定比例：`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。
- `adaptive` 只在有参考素材时允许。
- `resolution` 可省略，默认 `768P`；当前只接受 `768P`。
- 完整支持首帧、尾帧、参考图片、参考视频、参考音频。
- 本地素材直接 multipart 上传。
- HTTPS 素材作为 JSON URL 传递。
- 不提供同步等待选项。

返回：

```json
{
  "status": "submitted",
  "job_id": "vid_task_<base64url-id>",
  "media_type": "video",
  "model": "MiniMax-H3",
  "requested": {
    "seconds": 6,
    "ratio": "16:9",
    "resolution": "768P"
  },
  "poll_after_ms": 2000,
  "request_id": "...",
  "billing": {
    "charged": true,
    "currency": "USD",
    "amount": null,
    "final_amount_pending": true
  }
}
```

### 3.6 `cheapbuddy_get_media_job`

只接收 MCP 生成的不透明 `job_id`：

```text
img_task_<base64url(relay-task-id)>
vid_task_<base64url(relay-task-id)>
```

MCP 重启后仍可查询，不使用本地数据库。Relay 继续验证任务所有权。

统一返回：

```json
{
  "job_id": "vid_task_...",
  "media_type": "video",
  "model": "MiniMax-H3",
  "status": "queued | in_progress | completed | failed | unknown",
  "poll_after_ms": 3000,
  "requested": {},
  "media": [],
  "usage": null,
  "cost": null,
  "billing": null,
  "error": null
}
```

## 4. 统一数据结构

### `MediaInput`

```ts
type MediaInput =
  | { path: string }
  | { url: string }
```

路径策略：

- 允许用户显式提供任意绝对路径。
- 只接受普通文件。
- 拒绝目录、符号链接、设备文件和其他特殊文件。
- 校验真实 MIME、扩展名、单文件大小和总请求大小。
- 不读取路径之外的文件。
- 错误消息不泄露其他文件存在性。

URL 策略：

- 只接受 `https://`。
- 允许签名查询参数。
- 拒绝 `http://`、`file://`、localhost、环回、私网、云元数据和嵌入凭据。
- MCP 不主动下载远程素材。
- Relay/NewAPI 保留最终 URL 校验与供应商抓取责任。

### `MediaJob`

统一图片异步降级任务和视频任务的状态：

```text
queued
in_progress
completed
failed
unknown
```

终态输出必须包含：

- `media`：短期 HTTPS URL、MIME、`expires_at`。
- `usage`：上游返回的可用事实。
- `cost`：如果可确认则返回，否则为 `null`。
- `billing`：是否已扣费、是否最终结算。
- `error`：已清洗、可恢复的错误。

### 结果媒体

图片结果处理：

1. 上游返回 HTTPS URL：直接使用。
2. 上游返回 `b64_json`：MCP 解码并校验大小/MIME。
3. 通过 `POST /v1/media` 上传，获取短期 HTTPS URL。
4. 统一返回结构化 `media`，客户端支持时附加 MCP `image` 内容。

视频结果处理：

- 只返回短期 HTTPS artifact URL。
- 不返回 base64。
- 不承诺永久存储。
- 明确返回 `expires_at`。

## 5. HTTP 客户端与可靠性

### 后端抽象

MCP 内部保留：

```text
MediaBackend
  - listModels
  - quote
  - generateImage
  - submitVideo
  - getImageJob
  - getVideoJob
  - uploadResultMedia
```

v1 只实现：

```text
CheapBuddyRelayBackend
```

它调用现有 HTTP API；不实现 NewAPI-hosted MCP backend。

### 重试与错误

- `400/401/403`：不重试。
- `429`：返回 `rate_limited` 和 `Retry-After`。
- 查询类请求：有限次重试。
- 图片/视频提交未知结果：不更换幂等键重试。
- 任务已接受后查询失败：返回 `unknown`，不重新提交。
- 所有 Relay 错误都转换成 MCP 结构化错误，不暴露内部 URL、Token、供应商密钥或原始错误体。

### 轮询

统一退避：

```text
2s -> 3s -> 5s -> 8s
最大间隔：10s
```

服务端返回 `poll_after_ms` 时优先使用，但限制在合理上下限内。

图片：

- `generate_image` 内部最多轮询 300 秒。
- 超时返回 `processing` 和 `job_id`。

视频：

- `submit_video` 不等待。
- `get_media_job` 是单次查询，不提供阻塞等待参数。

### 并发

- MCP 不人为限制媒体任务提交并发。
- Relay 负责账户级限流和媒体并发控制。
- MCP 只保护本地文件读取/上传资源，建议同时处理最多 4 个本地文件。
- 收到 429 时遵循 `Retry-After`。

## 6. 模块拆分建议

```text
media-mcp/
  package.json
  README.md
  src/
    index.mjs                 # 进程入口、stdio transport
    server.mjs                # MCP Server 初始化和工具注册
    backend.mjs               # MediaBackend 接口与 Relay 实现
    cheapbuddy-client.mjs     # HTTP、认证、请求 ID、错误映射
    model-catalog.mjs         # /v1/models 解析与 60 秒缓存
    media-input.mjs           # path/url 校验、MIME、multipart
    image-tools.mjs           # quote/generate/edit/variation
    video-tools.mjs           # quote/submit/H3 规范化
    job-tools.mjs             # job id 编解码、查询和统一状态
    result-normalizer.mjs     # url/b64_json/artifact -> media
    retry.mjs                 # 429、查询重试、退避策略
    schemas.mjs               # MCP 输入/输出 JSON Schema
    errors.mjs                # 安全错误类型与脱敏
  test/
    server-protocol.test.mjs
    model-catalog.test.mjs
    media-input.test.mjs
    image-tools.test.mjs
    video-tools.test.mjs
    jobs.test.mjs
    retry.test.mjs
    relay-contract.test.mjs
    fixtures/
```

实现建议：优先写纯函数和可注入 HTTP client，避免测试必须启动真实 MCP 或访问生产 API。

## 7. 分阶段开发任务

### Phase 0：契约冻结

1. 将本计划中的工具名、字段、状态、错误和 `MediaInput` 写成内部 schema。
2. 明确动态 `/v1/models` 能力字段到 MCP 能力字段的映射。
3. 明确图片三种 operation 的字段条件。
4. 明确 H3 规范化规则和 MediaJob 映射。
5. 固定 npm 包名、Node 版本、环境变量和日志策略。

产出：`media-mcp/src/schemas.mjs`、契约 fixtures、README 草稿。

### Phase 1：MCP 包骨架

1. 创建顶层 `media-mcp/` 包。
2. 接入官方 `@modelcontextprotocol/sdk`。
3. 实现 stdio 启动、初始化、`tools/list`。
4. 实现环境变量读取和启动校验。
5. 默认所有日志写 stderr，stdout 只输出 MCP 协议帧。
6. 增加 npm `bin` 入口，支持 `npx` 启动。

退出条件：MCP Inspector 能成功初始化并列出 6 个工具。

### Phase 2：HTTP Backend 与基础安全

1. 实现 `CheapBuddyRelayBackend`。
2. 支持 Bearer API Key、`CHEAPBUDDY_BASE_URL`、`X-Request-ID`。
3. 实现 60 秒模型目录缓存。
4. 实现 `MediaInput` 本地路径校验和 HTTPS URL 校验。
5. 实现本地文件最多 4 个并行读取/上传的资源保护。
6. 实现 URL/b64 图片结果转换到 `/v1/media`。
7. 实现安全错误映射和 Key 脱敏。

退出条件：mock Relay contract 测试覆盖正常响应、鉴权、429、5xx、超时和敏感信息脱敏。

### Phase 3：图片工具

1. 实现 `list_media_models` 的图片过滤和能力解析。
2. 实现 `quote_image` 的 estimate/rate_card 结果。
3. 实现 `generate_image` 三种 operation。
4. 实现本地 multipart 和 HTTPS JSON 两种输入路径。
5. 实现 mask 仅限 edit。
6. 实现多图数量按动态 schema 校验。
7. 实现最多 300 秒内部轮询和图片结果归一化。
8. 输出 `billing`、`usage`、`cost` 和规范化参数。

退出条件：generate/edit/variation、mask、多图、url/b64_json、同步完成和 processing 降级全部通过测试。

### Phase 4：H3 视频工具

1. 实现视频模型能力解析。
2. 实现 `quote_video` 的 6 秒默认、4-15 秒校验和非精确估算。
3. 实现 `submit_video` 的完整素材矩阵。
4. 实现 H3 ratio、resolution、seconds 规范化。
5. 实现 multipart 本地素材和 JSON HTTPS URL。
6. 实现 `vid_task_` 无状态 job ID。
7. 实现 `get_media_job` 的视频查询、artifact URL 和 billing 映射。
8. 确保未知提交结果不自动换 key 重提。

退出条件：文生、首帧、首尾帧、参考图、参考视频、参考音频、幂等和重启恢复测试通过。

### Phase 5：跨客户端与文档

1. 编写 Claude Code 配置片段。
2. 编写 Codex 配置片段。
3. 编写 OpenCode 配置片段。
4. 写环境变量、安全和本地路径说明。
5. 写图片和视频工具示例。
6. 写批量工作流示例：Agent 循环提交多个视频并按 `poll_after_ms` 查询。
7. 明确不会自动确认、不会实现预算制、不会提供取消工具。
8. 增加 MCP Inspector 调试说明。

### Phase 6：真实验收与发布

1. MCP Inspector 协议测试。
2. Relay mock contract 测试。
3. Claude Code smoke test。
4. Codex smoke test。
5. OpenCode smoke test。
6. 真实图片任务，验证计费和结果 URL。
7. 真实 H3 任务，验证预扣、完成结算和 artifact URL。
8. 失败/超时/429/客户端断开场景验证。
9. npm 包发布前运行 secret scan、测试、lint 和 package dry-run。
10. 发布 `@cheapbuddy/media-mcp`，记录版本和变更日志。

## 8. 测试矩阵

### 协议

- initialize。
- tools/list。
- 每个工具的必填字段、枚举、条件字段和未知字段拒绝。
- stdout 只输出 MCP JSON-RPC，日志只写 stderr。
- MCP 错误不包含 API Key、路径之外的文件信息或内部 URL。

### 图片

- generate、edit、variation。
- 单图、多图。
- edit + mask。
- generate/variation + mask 必须失败。
- path、HTTPS URL、非法 URL、目录、符号链接、超大文件、错误 MIME。
- 上游 URL 结果。
- 上游 b64_json 结果并转换为 `/v1/media`。
- 120 秒以上任务，验证 300 秒超时降级。
- 429 和查询重试。

### 视频

- 文生视频，ratio 必填。
- 参考素材省略 ratio，默认 adaptive。
- 6 秒默认。
- 4-15 秒边界和非法小数。
- 768P 默认和显式值。
- 首帧、尾帧、首尾帧、参考图、参考视频、参考音频。
- 非法素材组合。
- multipart 字段顺序和文件大小限制。
- 提交未知结果不换 idempotency key。
- `vid_task_` 重启后查询。
- completed artifact、failed、unknown。

### 客户端

- Claude Code 本地 stdio。
- Codex 本地 stdio。
- OpenCode 本地 stdio。
- 三者均能发现工具、传入文件路径、看到结构化结果。

## 9. 发布门槛

必须全部满足后才能发布 v1：

- `tools/list` 和全部工具 schema 通过 MCP Inspector。
- 自动化测试覆盖契约、输入安全、图片、视频、重试和任务恢复。
- Claude Code、Codex、OpenCode 各完成真实 smoke test。
- 至少一次真实图片任务成功并完成计费核对。
- 至少一次真实 H3 任务成功并完成预扣/结算核对。
- 没有重复扣费或重复创建任务。
- secret scan 通过。
- npm package dry-run 内容只包含必要源码和文档。
- README 能让新用户在 10 分钟内完成配置和首次调用。

## 10. 风险与后续

### v1 风险

- 图片不同 provider 的 `parameter_schema` 可能不完整，动态能力缺失时要采用保守默认值。
- 图片最终费用可能只能在任务完成后确认，报价必须保持非精确语义。
- H3 参考视频/音频的客户端路径和 MIME 处理比图片复杂。
- 本地 stdio 不能直接用于 Anthropic Messages API MCP connector；远程 MCP 是后续独立项目。
- 不提供预算制意味着账户余额是唯一总消费边界。

### v2 候选

- 远程 Streamable HTTP MCP + OAuth/短期 token。
- `cheapbuddy_get_media_usage`。
- MCP 专属子预算。
- 显式 `download_media` 工具。
- 多任务批次工具。
- 独立二进制发布。
- NewAPI-hosted MCP backend，前提是 NewAPI 正式提供稳定 MCP Server 和用户/计费桥接能力。

## 11. 需求确认记录

本计划基于 2026-10-10 的 grilling 会话，已确认的关键选择：

- 本地 stdio；正式支持 Claude Code、Codex、OpenCode。
- 顶层独立 `media-mcp/` npm 包；Node 20+；官方 MCP SDK。
- 图片支持 generate/edit/variation、mask、多图。
- 视频完整复用 H3 输入矩阵。
- `MediaInput` 支持绝对路径和 HTTPS URL。
- 本地素材直传 multipart；远程 URL 原样传递。
- 图片内部轮询最多 300 秒；视频提交/查询分离。
- 60 秒进程内模型目录缓存。
- 无预算制、无强制确认、无批量工具、无账户用量工具。
- 可选 quote 工具采用 estimate/rate_card 双语义。
- 统一 `MediaJob`、无状态 job ID、严格重试策略。
- 不修改 NewAPI 增加 MCP Server；只做独立 CheapBuddy Media MCP。