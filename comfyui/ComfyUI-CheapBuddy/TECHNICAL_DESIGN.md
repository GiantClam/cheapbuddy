# CheapBuddy for ComfyUI — 技术方案

状态：已确认方案，待实施  
OpenSpec：`openspec/changes/add-cheapbuddy-comfyui-nodes/`（Draft）  
插件目录：`ComfyUI/custom_nodes/ComfyUI-CheapBuddy`

## 1. 目标与范围

提供三个通用节点，按任务能力划分，而不是按模型供应商拆分。模型、生成类型及参数由 CheapBuddy 模型元数据驱动；后端上架新模型时，插件通过模型刷新读取，不需要为每个模型新增节点或发布插件版本。

首发节点：

1. `CheapBuddy Text Generate`：文本生成及视觉理解。
2. `CheapBuddy Image Generate`：文生图、图像编辑、图像变体。
3. `CheapBuddy Video Generate`：文生视频、图生视频、参考素材生视频，以及任务续取。

不设置独立的 Config、Upload、Video Status / Result 或 Save Video 节点。每个生成节点自带连接配置；媒体素材直接随 API 创建请求传输。文本和图片节点输出 ComfyUI 数据端口；视频节点负责任务轮询、文件下载、保存和结果注册。

## 2. 已有 API 与 Relay 工作

现有路由契约包括：

| 能力 | 路由 | 用途 |
| --- | --- | --- |
| 模型列表 | `GET /v1/models` | 返回当前用户可见模型及模型能力元数据。 |
| 单模型详情 | `GET /v1/models/{model_id}` | 返回能力与参数 schema；Relay 必须显式放行并鉴权。 |
| 文本 / Vision | `POST /v1/chat/completions` | 文本消息或带图片内容的多模态消息。 |
| 图片生成 | `POST /v1/images/generations` | 文生图。 |
| 图片编辑 | `POST /v1/images/edits` | multipart 图片/可选 mask 编辑。 |
| 图片变体 | `POST /v1/images/variations` | multipart 变体生成（仅对声明支持的模型开放）。 |
| 视频任务 | `POST /v1/videos` | 创建异步任务；JSON URL 和 multipart 媒体输入按模型 schema 使用。 |
| 视频查询 / 下载 | `GET /v1/videos/{id}`、`GET /v1/videos/{id}/content` | 查任务状态及取回成品。 |

CheapBuddy 后端确认 Sub2API 与 NewAPI 均支持模型元数据字段和单模型查询。Relay 是面向 ComfyUI 的统一目录层：文本模型元数据从 Sub2API 获取，媒体模型元数据从 NewAPI 获取，再按 CheapBuddy 用户权限、媒体验证状态和计费配置合并。现有 Relay 代码需要新增模型详情路由、权限校验与元数据聚合；不得将未开放或未计费配置的媒体模型暴露给用户。

建议 OpenAI 兼容模型项追加可选字段，保持现有基础字段不变：

```json
{
  "id": "MiniMax-H3",
  "object": "model",
  "owned_by": "cheapbuddy",
  "type": "video",
  "capabilities": ["text_to_video", "image_to_video", "reference_to_video"],
  "parameter_schema": {
    "seconds": {"type": "integer", "enum": [6, 10], "default": 6},
    "ratio": {"type": "string", "enum": ["16:9", "9:16", "adaptive"]},
    "resolution": {"type": "string", "enum": ["768P", "1080P"]},
    "first_frame": {"type": "image", "required": false}
  }
}
```

元数据约束：

- `type` 建议为 `text`、`image`、`video`；筛选生成方式以 `capabilities` 为准，不从模型名称推断。
- `parameter_schema` 首发采用受限 schema 子集：类型、选项、默认值、最小/最大值、必填标记、说明及媒体类型。暂不执行任意 JSON Schema 条件表达式。
- `/v1/models/{model_id}` 返回同一模型项的完整元数据；Relay 需安全转义模型 ID、检查上游来源并处理不存在/无权限模型。
- Relay 统一合并列表及详情的返回格式，保留客户端可忽略的扩展字段；上游 schema 必须来源于 CheapBuddy 已验证的模型目录。

## 3. 共用节点参数和模型发现

每个节点均提供：

- `base_url`：可编辑，默认 `https://api.cheapbuddy.cc`。
- `api_key`：用户直接填入节点参数。按用户确认，API Key 会保存在工作流 JSON 中。
- `model`：从 Relay 返回且符合节点能力的模型中选择。
- 节点任务专属 prompt、素材和生成参数。

API Key 仅通过 `Authorization: Bearer ...` 发送。不得写入日志、异常、请求 ID、文件名或图像 tensor metadata。工作流及输出媒体可能含有 ComfyUI 工作流元数据；用户将工作流或结果公开分享前应检查并移除其中的 API Key。

模型目录交互：

1. 插件随 ComfyUI 启动加载可用模型；提供前端“刷新模型”操作，无需更新插件或重启 ComfyUI。
2. 模型及 schema 缓存建议 5 分钟；刷新失败时使用最近一次成功缓存，并在节点显示缓存状态。无缓存则报兼容/网络错误，不猜模型类型和参数。
3. 切换模型后，从能力元数据刷新该节点可用生成类型及参数控件。节点保留固定通用端口；常见 schema 参数动态生成整数、数值、布尔、枚举/字符串控件，复杂或未知参数通过高级 JSON 传入。
4. 执行前以当前模型的 schema 校验能力、必填项和取值范围；API 端继续作最终校验，避免依赖客户端校验作为安全边界。
5. 不兼容或没有 schema 的 API 响应显示明确错误。CheapBuddy API 的能力字段和单模型查询是插件的正式依赖，不用模型名启发式回退。

## 4. 三个节点的接口

### 4.1 CheapBuddy Text Generate

**通用输入：**`base_url`、`api_key`、`model`、可选 `system_prompt`、`prompt`、`temperature`、`max_tokens`、schema 参数。  
**视觉输入：**可选 `IMAGE`（支持 batch）。连接后仅允许 `vision` 能力模型，按 OpenAI 多模态消息格式将图片编码后提交；未连接图片时调用普通文本能力。  
**输出：**`TEXT`、`RAW_JSON`（完整 API 响应的安全子集）。首发使用非流式响应，避免 ComfyUI 节点执行时处理 SSE。

### 4.2 CheapBuddy Image Generate

**生成类型：**

- `text_to_image` → `/v1/images/generations`
- `image_edit` → `/v1/images/edits`
- `variation` → `/v1/images/variations`

**通用输入：**`base_url`、`api_key`、`model`、生成类型、`prompt`、可选 `IMAGE` batch、可选 mask、模型 schema 参数。图片/mask 以 API 要求的 multipart 字段发送；仅展示模型声明支持的类型和参数。  
**输出：**ComfyUI `IMAGE` batch；同时可输出安全的结果 URL 信息。base64 图片直接解码；URL 下载只针对 CheapBuddy 返回结果，限制 HTTPS、重定向、体积和图像像素，阻止 loopback/私有/链路本地地址访问。

### 4.3 CheapBuddy Video Generate

**操作：**`generate` 或 `resume`。续取模式要求 `task_id`，只执行状态查询/下载，绝不再创建任务。  
**生成类型：**`text_to_video`、`image_to_video`、`reference_to_video`，由模型 `capabilities` 过滤。

**生成输入：**`prompt`、可选 `IMAGE` 首尾帧、ComfyUI `VIDEO`/`AUDIO` 参考输入，以及 `seconds`、`ratio`、`resolution` 等 schema 参数。图像、视频和音频素材作为本次 `/v1/videos` multipart 请求体直接传送；该流程不依赖远端持久化文件 API，也不把 ComfyUI 本机路径作为 URL 发送。

**任务行为：**POST 创建后保存任务 ID；不自动重试创建 POST。插件有限退避地轮询 GET，成功后通过 `/content` 下载；失败/取消返回可读终态。超出节点等待时限时返回当前 `task_id` 和状态，视频输出暂空，用户可将 ID 接入同一节点的 `resume` 模式。

**输出行为：**视频节点本身为 ComfyUI 标准输出节点。视频保存至当前实例通过 ComfyUI API 配置的输出目录，不硬编码本机目录；向 ComfyUI 提供原生 `VIDEO` 输出和标准视频预览/保存结果信息，并输出 `VIDEO_PATH`、`VIDEO_URL`、`TASK_ID`、`STATUS`。宿主平台负责把本实例任务产物持久化并提供下载链接。

首发依赖 ComfyUI 核心原生 `VIDEO` 类型与 `PreviewVideo`/`SavedResult` 输出协议，不依赖 VideoHelperSuite。实施时需从计划支持的 ComfyUI 与云端运行环境版本中确定并写明最低版本；RunningHub 结果列表需用托管环境做集成验证。

## 5. 插件目录与模块

```text
comfyui/ComfyUI-CheapBuddy/
  TECHNICAL_DESIGN.md
  README.md
  __init__.py                 # 三个节点注册
  nodes/
    text_generate.py
    image_generate.py
    video_generate.py
  cheapbuddy/
    client.py                 # HTTP、鉴权、超时、错误归一化
    models.py                 # 模型列表/schema 缓存及校验
    images.py                 # IMAGE tensor、mask、base64 转换
    video_tasks.py            # 创建、轮询、续取、下载和 ComfyUI 输出注册
    errors.py
  web/
    js/                       # 刷新模型、schema 控件交互
  tests/
```

前端扩展仅负责模型刷新和按 schema 更新控件；密钥随用户确认由各节点参数值保存。后端节点按 `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` 注册。插件不修改 ComfyUI 依赖；HTTP 客户端优先使用标准库，媒体处理复用 ComfyUI/宿主已安装组件，不静默安装大型依赖。

## 6. API 请求与文件安全

- 文本和媒体请求带 `User-Agent: ComfyUI-CheapBuddy/<version>` 及唯一 `X-Request-ID`。媒体创建使用一次性 `Idempotency-Key`，同次执行续取时不创建新 key。
- 401/403 提示检查 API Key；404 提示确认模型/能力；409 提示幂等冲突；429 提示稍后重试；5xx 显示 request ID，不返回内部上游响应。
- 文本和媒体创建 POST 不自动重试；网络结果不明时优先让用户使用已返回的 task ID 续取，避免重复扣费。状态 GET 可有限重试。
- 所有 HTTP 超时、轮询总时长、重定向次数、请求和响应大小有上限；校验 MIME 与图片像素数。禁止把用户输入拼接为本机文件路径。
- 视频保存使用随机安全文件名及原子重命名，避免覆盖。异常中途下载的 `.part` 文件执行清理。
- 日志只记录节点类型、模型 ID、耗时、HTTP 状态、request ID、task ID；不记录 prompt、媒体、API Key 或完整响应体。

## 7. 实施阶段

### Phase 0 — 契约核对与 Relay

1. 用实际 Sub2API/NewAPI 部署版本确认 `/v1/models` 扩展字段及 `GET /v1/models/{id}` 的 JSON 样例。
2. 在 Relay 中放行单模型路由，鉴权并按 Sub2API/NewAPI 归属合并详情与列表元数据。
3. 用一个文本/Vision 模型、一个图像模型和一个视频模型验证能力、参数、可见权限及计费过滤。
4. 确认图片编辑/变体 multipart 字段、图像响应格式、视频状态终态和 content 返回格式。

### Phase 1 — 三节点 MVP

完成直接节点参数、模型刷新/缓存、文本/视觉请求、文生图、视频任务创建/轮询/续取/下载及标准输出注册；支持 schema 基础控件和通用媒体端口。

### Phase 2 — 图片类型和模型参数

实现 image edit、variation、各类图生/参考视频素材输入，以及 schema 控件范围校验、复杂参数 JSON、旧工作流节点迁移。

### Phase 3 — 兼容与发布

在本机 ComfyUI、RunningHub 托管执行环境及 Comfy.icu 节点分发/安装路径验证包结构、最低核心版本、输出文件可见性、API Key 工作流存储行为和节点刷新交互。RunningHub 官方任务输出接口可返回文件 URL；节点需按标准 ComfyUI 输出协议注册产物，并通过实测确认平台任务收集行为。

## 8. 验收标准

- 产品中只有文本、图片、视频三个 CheapBuddy 节点；模型数量增长不要求增加供应商或模型专用节点。
- 模型列表和单模型元数据能按 CheapBuddy 用户权限正确合并；刷新可获取新模型；短暂失败优先使用上次成功缓存。
- 文本节点按所选模型能力切换文本/Vision 请求；图片节点覆盖文生、编辑、变体；视频节点覆盖文生、图生、参考素材和 task resume。
- 每个节点单独配置 `base_url` 与 API Key，工作流保存行为符合已确认选择；运行日志不泄露密钥。
- 视频成功结果能以 ComfyUI 原生 `VIDEO` / 预览产物返回，并在 RunningHub 托管运行的结果列表中可取回；超时不重复提交且可续取。
- 素材请求直传，不要求远端持久 Upload API；失败提示含 request ID，不暴露敏感上游响应。

## 9. 主要风险

1. 本地 Relay 快照与用户确认的 Sub2API/NewAPI 能力可能不同步；Phase 0 必须以实际部署版本契约为准。
2. 直接在工作流节点存 API Key 是用户选择的体验；工作流 JSON 或嵌入工作流元数据的输出文件可能包含密钥，公开分享前需清理。
3. RunningHub 与其他托管执行环境对自定义节点产物的收集可能不同；标准 ComfyUI 输出注册仍需逐平台集成验证。
4. 原生 `VIDEO`/PreviewVideo 支持依赖 ComfyUI 核心版本；需在发布前确定最低版本并检测不兼容宿主。

## 10. 本机 Smoke 验证记录

2026-09-26 在 Windows 本机使用 Comfy Desktop `1.1.3` 验证。先在 Core `0.37.0-39-g79be670e` 测试实例确认节点/API 行为，再发现桌面当前实例实际连接 `127.0.0.1:8188`，Core 为 `0.37.4`；将插件安装至该实例 `ComfyUI/custom_nodes/ComfyUI-CheapBuddy` 并重启后，三个节点均出现在该实例的 `/object_info`，扩展路径 `/extensions/ComfyUI-CheapBuddy/js/cheapbuddy.js` 也已注册。桌面实例报告 Python `3.13.12`、Torch `2.12.1+cu130`、RTX 4090 Laptop CUDA 环境。

在本机测试实例上，本地 mock Relay 分别向文本、图片、视频刷新路由返回模型，并通过单模型详情路由返回各自参数 schema；缺少 API Key 时刷新路由返回 HTTP 400。整个验证没有调用真实 CheapBuddy API，也没有产生付费请求；尚未验证 RunningHub/Comfy.icu 托管产物或最低兼容版本。最低 ComfyUI 版本及托管平台验收仍须单独确认。

2026-09-26 对图片/视频场景使用桌面 ComfyUI 的 Python 3.13/Torch 环境和本地 mock Relay 验证了节点实际请求组装：文生图可按响应数组输出 batch；图像编辑/变体可提交一个或多个 IMAGE 文件并将多个响应合并为 IMAGE batch；文生视频提交无文件请求；首帧、首尾帧分别按模型 schema 的 image 字段发送；`reference_video` 按 video 字段以 MP4 multipart 文件提交。视频任务 mock 返回 completed 后，节点可下载 MP4、创建 ComfyUI 原生 `VIDEO` 对象并返回节点输出。验证发现并修复了 multipart 组包错误，以及只有一个 image schema 字段时首尾帧被错误映射到同一字段的问题；现会明确拒绝不匹配的 schema。首尾帧各只接受一张图。上述结果证明了客户端请求路径和字段组装，不代表真实 Relay/各上游模型已接受这些字段；`n` 多图能力、能力元数据和参数 schema 必须由具体模型提供并经真实接口验证，未发起计费请求。
