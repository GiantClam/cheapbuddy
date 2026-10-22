# CheapBuddy

**CheapBuddy 是一个面向开发者、创作者和 AI 工作流用户的多模型 AI Gateway。**

通过 [cheapbuddy.cc](https://cheapbuddy.cc/) 注册并管理账户，使用统一 CheapBuddy Base URL 和 USD 钱包。WorkBuddy、OpenCode 与 Codex 配置可同时选择 OpenAI 与 Claude 文本模型；Claude Code 使用 Anthropic Messages 协议，只支持 Claude 模型。配置中心复用或创建绑定 Sub2API `composite` 分组的 `CheapBuddy Shared` Key，并在复制或下载前验证当前平台支持的已选模型。每把 Key 仍只绑定一个分组；跨平台访问由 composite 分组的授权、账号和模型路由提供，最终计费沿用服务端分组配置。

## 快速访问

- [CheapBuddy 官网](https://cheapbuddy.cc/)
- [注册 / 登录](https://cheapbuddy.cc/#account)
- [文本 / 图片 / 视频 API 文档](https://cheapbuddy.cc/api-docs/)
- [Claude 稳定通道接入指南](./docs/claude-stable-channel.md)
- [ComfyUI 节点介绍](https://cheapbuddy.cc/comfyui/)
- [下载 ComfyUI 节点 ZIP](https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.1.zip)
- [CheapBuddy GitHub](https://github.com/GiantClam/cheapbuddy)

## CheapBuddy 能做什么

- **统一入口与共享凭据**：OpenAI 与 Claude 文本模型可在同一份配置中共用一把 `CheapBuddy Shared` Key。共享 Key 绑定 composite 分组；旧单平台 Key 保持原授权，不会自动迁移或扩大权限。
- **模型按协议发现**：使用匹配分组的 Key 从 `GET /v1/models` 获取授权模型；Anthropic 原生列表 / 详情沿用 Sub2API 响应，不混入媒体目录或补造能力字段。既有 OpenAI-compatible 聚合目录仍按原合同提供文本、图片和视频模型。
- **多客户端接入**：可用于 WorkBuddy、Claude Code、OpenCode、Codex、ComfyUI 和自定义程序；按客户端能力选一种协议，不要求同一次推理同时调用两种协议。
- **按实际用量计费**：文本按 Token 计费，图片和视频按媒体任务用量计费；最终价格以官网账户和 API 返回为准。
- **无需自行维护上游密钥**：用户只需要管理自己的 CheapBuddy API Key。

## ComfyUI 节点

CheapBuddy ComfyUI 插件包含三个通用节点：

| 节点 | 支持能力 |
| --- | --- |
| `CheapBuddy Text Generate` | 文本生成；连接图片后可调用支持 Vision 的模型 |
| `CheapBuddy Image Generate` | 文生图、图生图、文生多图、图生多图、图片编辑和图片变体 |
| `CheapBuddy Video Generate` | 文生视频、图生视频、参数视频生视频、首帧生视频、首尾帧生视频、参考视频/音频生视频 |

节点会根据当前 API Key 动态加载模型和参数 schema。每个节点独立填写 `base_url`、API Key、模型和生成参数，不需要额外的 Config 或远端 Upload 节点。图片和视频素材由节点随任务请求发送。

### 安装方式 A：下载 ZIP

1. 安装 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 并确认可以正常启动。
2. 下载 [ComfyUI-CheapBuddy ZIP](https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.1.zip)。
3. 解压后，将 `ComfyUI-CheapBuddy` 目录放入：

   ```text
   ComfyUI/custom_nodes/ComfyUI-CheapBuddy
   ```

4. 重启 ComfyUI。
5. 在节点搜索框中搜索 `CheapBuddy`，即可看到三个节点。

### 安装方式 B：从源码安装

```bash
git clone https://github.com/GiantClam/cheapbuddy.git
cp -R cheapbuddy/comfyui/ComfyUI-CheapBuddy ComfyUI/custom_nodes/
```

Windows 可以将 `comfyui/ComfyUI-CheapBuddy` 目录复制到 `ComfyUI/custom_nodes/`。

### 第一个工作流

1. 打开 [CheapBuddy 官网](https://cheapbuddy.cc/)，注册或登录账户。
2. 在账户中心创建或复制具备媒体权限的 OpenAI 通道 CheapBuddy API Key。
3. 打开 ComfyUI，添加三个 CheapBuddy 节点。
4. 在每个节点中填写：

   ```text
   base_url: https://api.cheapbuddy.cc
   api_key: 你的 CheapBuddy API Key
   ```

5. 点击模型下拉框。节点会按当前 API Key 自动请求模型目录，并显示该节点支持的模型。
6. 选择模型和生成类型，填写提示词及高级参数 JSON。
7. 点击 Queue Prompt 运行工作流。

也可以直接导入 `comfyui/ComfyUI-CheapBuddy/workflows/CheapBuddy-Test-Workflow.json`。该工作流覆盖文本生成、文生图、图生视频，以及图像编辑、图片变体、首尾帧和参考视频等分支。导入后只启用要运行的分支，并在对应节点中填入自己的 API Key。

### API Key 安全

按照 ComfyUI 的工作流使用方式，API Key 会保存在节点参数和工作流 JSON 中。不要把填入 API Key 的工作流上传到 GitHub、RunningHub、Comfy.icu、论坛或聊天记录。分享工作流前请清空或轮换 API Key。

## API 快速示例

OpenAI-compatible 文本接口（使用对应模型分组的 CheapBuddy Key；Claude 也可通过此接口调用）：

```bash
curl https://api.cheapbuddy.cc/v1/chat/completions \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-sol","messages":[{"role":"user","content":"Write a short product idea."}]}'
```

图片和视频请求、参数说明、任务轮询及素材字段请查看 [图片 / 视频 API 文档](https://cheapbuddy.cc/api-docs/)。

## Claude 稳定通道

Claude 使用统一 CheapBuddy Base URL。配置中心使用具有 Claude 与 OpenAI 权限的 `CheapBuddy Shared` Key；已有单平台 Claude Key 仍可按原授权使用。支持 Claude 的分组可访问 `claude-fable-5`、`claude-fable-5-1`、`claude-opus-5`、`claude-opus-5-5`、`claude-sonnet-5`、`claude-sonnet-5-5`；实际可用模型以该 Key 的 Sub2API 授权和 `GET /v1/models` 返回为准。Claude Code 原生发送 Anthropic Messages 请求，因此只能配置支持该协议的 Claude 模型；GLM 等 OpenAI-compatible 模型请在 WorkBuddy 或 OpenCode 的兼容协议中使用。最终价格由请求所属分组的倍率、渠道模型价格、账号统计规则和用户配置共同决定，官网展示的 Anthropic 价格仅作官方参考价。

两种协议任选其一：Anthropic 原生使用 `POST /v1/messages`（同步 / SSE）、`POST /v1/messages/count_tokens`、`GET /v1/models` 和 `GET /v1/models/{model_id}`；OpenAI-compatible 使用既有 Chat Completions 或 Responses。具备两类模型权限的共享 Key 可同时用于这些接口。Claude Code 示例用根地址 `ANTHROPIC_BASE_URL=https://api.cheapbuddy.cc` 和共享 Key 的 `ANTHROPIC_AUTH_TOKEN`。现有根地址或 `/v1` Base URL 都可保留，无需 strip-v1 或更换 URL。不同 SDK 追加 `/v1/messages` 或 `/messages`；Relay 兼容规范路径与 SDK 引起的重复 `/v1` 形式。`/v1/messages` 是规范 HTTP 示例，不是要求用户修改入口。Claude Code 配置生成器保留用户提供的 Base URL。Relay 只做 HTTP 透传；Sub2API 负责业务语义、协议转换、鉴权、模型路由和文本计费。Batch / Files / Admin 不在首版范围，HTTP Responses 兼容不代表原生 Responses WebSocket 或所有平台特性，也不是 100% 可用性 SLA。

六个模型的价格、原生模型发现 / 计数、官方 Python / TypeScript SDK 示例及客户端协议对照见 [Claude 稳定通道接入指南](./docs/claude-stable-channel.md)；旧分组接入方式见 [历史 Claude 单平台 Key 接入说明](https://cheapbuddy.cc/blog/claude-stable-channel-guide)。

## Run

```bash
npm install
npm run dev
```

首页支持中文和 English 两种界面语言。语言切换位于顶部导航，选择会保存在当前浏览器，下次访问自动恢复；未保存语言偏好时会根据浏览器语言初始化。

## Sub2API local deployment

本地开发可使用 Sub2API 官方 Compose；以下 `http://127.0.0.1:8080` 仅为本地 API 服务示例，不是公共模型入口。Sub2API 负责用户、API Key、余额、渠道、模型路由、计费和 OpenAI 兼容接口；WorkBuddy 应直接请求 Sub2API 的 `/v1/chat/completions`。

```powershell
docker compose -f docker-compose.local.yml up -d
```

当前本地实例只监听 `http://127.0.0.1:8080`，没有额外自建网关。CheapBuddy 不再提供或要求运行本地脚本。登录后，首页或配置中心可以复制一段包含当前用户 Key 和所选模型的 WorkBuddy 提示词；将提示词直接粘贴到 WorkBuddy 对话框，要求它备份旧文件、按模型 ID 合并 `models.json` 并重启。JSON 下载仍作为手动备用方式。

提示词配置只应粘贴到用户自己的 WorkBuddy。它包含个人 API Key，不要转发给他人或粘贴到公开对话中。

## Multi-platform config generation

配置中心支持选择目标平台并生成对应的用户级配置：

| 平台 | 生成文件 | 默认目标路径 | 协议 |
| --- | --- | --- | --- |
| WorkBuddy | `models.json` | `~/.workbuddy/models.json` | Chat Completions；Claude 转换由 Sub2API 处理 |
| Claude Code | `settings.json` | `~/.claude/settings.json` | 原生 Anthropic Messages，使用共享 Key，并保留用户提供的 Base URL |
| OpenCode | `opencode.json` | `~/.config/opencode/opencode.json` | 原生混选时分为 Anthropic 与 OpenAI-compatible 两个适配器，共用 Key 和 Base URL |
| Codex | `config.toml` | `~/.codex/config.toml` | `wire_api = "responses"`；Claude 请求由服务端转换，不是原生 Anthropic Responses |

登录后选择平台、协议和模型，可同时勾选当前客户端支持的 OpenAI 与 Claude 文本模型。页面先从 `GET /api/v1/keys` 复用有效 composite 分组 Key；没有时从 `GET /api/v1/groups/available` 选择用户有权绑定的活跃 composite 分组，创建 `CheapBuddy Shared` Key。可通过 `VITE_CHEAPBUDDY_SHARED_GROUP_ID` 指定共享分组，不使用写死的默认分组 ID，也不回退到单平台 Key。复制或下载前，同一把 Key 必须通过 `GET /v1/models` 验证全部选中模型的实际 ID（`wireId`）；缺少模型或验证失败时阻止导出，不能切换另一把 Key 绕过。

预览显示完整文件内容和已包含模型。可以复制自动配置提示词，让目标 Agent 备份并合并现有配置；也可以复制或下载原生配置文件后手动合并。各平台可多选或一键全选当前平台和协议支持的模型；WorkBuddy、OpenCode 会将已选模型写入原生模型目录，Claude Code 将已选模型加入模型选择白名单，Codex 使用首个模型作为默认值并在配置注释中列出其余模型 ID。OpenCode 原生模式混选时生成两个适配器，分别使用 Anthropic 与 OpenAI SDK，两个适配器共享同一把 CheapBuddy Key 和 Base URL。OpenCode 使用当前配置格式的单数 `provider`、`npm` 和 `options` 字段，不使用旧的 `providers` / `package` / `settings` 格式。Codex 的 provider 配置应写入用户级 `~/.codex/config.toml`，不要只放在项目级配置中。

共享访问需要服务端已配置 composite 分组、可调度的 OpenAI 与 Anthropic 账号、模型路由、价格及用户绑定权限。缺少这些条件时配置中心会报告错误；前端不会迁移旧 Key 或修改权限。管理员准备示例与验收步骤见 [Claude 稳定通道接入指南](./docs/claude-stable-channel.md#11-生产共享分组准备管理员)。本文描述代码支持的流程，不代表生产环境已经完成配置或验收。

生成文件包含个人 API Key。只能保存在用户自己的设备上，不应提交到 Git、公开工单或聊天记录。合并配置前应先备份旧文件，并保留已有 Provider、权限和其他无关设置。

### Media MCP 一键配置

配置中心的“媒体 MCP 一键配置”会分别生成 Claude Desktop、Claude Code、OpenCode 和 Codex 的无密钥安装提示词。提示词会要求目标 Agent 备份用户级配置、合并 `cheapbuddy-media`、重启客户端，并用 `tools/list` 验证 6 个工具；真实 `CHEAPBUDDY_API_KEY` 不会被复制到剪贴板。Claude Desktop 可直接下载官网提供的 [CheapBuddy Media 扩展](./public/downloads/cheapbuddy-media.mcpb)，在安装界面填写敏感 API Key；其他平台复制对应提示词即可。可直接查看 [`media-mcp/INSTALL-PROMPTS.md`](./media-mcp/INSTALL-PROMPTS.md) 或使用 `media-mcp` 目录中的四份示例。

Claude Desktop 普通 JSON 配置不应假定会展开 `${CHEAPBUDDY_API_KEY}`；Windows 用户需在本机替换示例中的占位符。支持 Desktop Extensions 的版本可使用 `media-mcp/manifest.json` 打包的 `.mcpb`，在 **Settings → Extensions → Advanced settings → Install Extension…** 中一键安装，API Key 由扩展的敏感配置字段收集。打包命令为 `cd media-mcp; npm install; npm run pack:mcpb`。

安装器可能先调用 MCP 可执行文件的帮助命令；已发布的 `@cheapbuddy/media-mcp` 支持 `--help` / `--version`，正常 stdio 启动时 stdout 仍只输出 MCP JSON-RPC。OpenCode、Claude Code 和 Codex 的提示词会从当前包元数据读取版本。

## Model catalog

官网模型的唯一配置源是 [`src/models.js`](./src/models.js)。首页模型货架、首屏模型卡片、价格示例、账户用量标记、配置中心选择器，以及 WorkBuddy / Claude Code / OpenCode / Codex 配置生成，都会从这份目录读取模型。

官网目录是模型展示与配置候选源，不会绕过某把 Key 的显式限制或替换其 Sub2API 分组。配置导出前使用同一把共享 Key 检查 `GET /v1/models` 是否包含所有选中模型；旧 OpenAI 单平台 Key 不会自动获得 Claude 权限。原生协议的模型列表仍以 Sub2API 对该协议的返回为准。

新增、删除或修改模型时，只需编辑 `src/models.js` 中对应对象：

- `id`、`short`、`vendor`、`description`：模型 ID、短名称、厂商和中英文展示文案
- `input`、`output`：首页展示的每百万 Token 参考价格
- `modality`、`endpointPath`、`billingUnit`：文本/图片/视频能力、原生接口路径和计费单位
- `maxInputTokens`、`maxOutputTokens`、`temperature`：生成配置使用的上下文和输出参数
- `supportsToolCall`、`supportsImages`、`supportsReasoning`、`onlyReasoning`、`reasoning`：平台配置能力字段
- `featured`：是否优先出现在首屏和配置中心前列
- `showInUsageExample`：是否优先出现在首页价格示例
- `accent`、`mark`：模型卡片视觉标记

模型文案使用 `vendor.zh/en` 和 `description.zh/en` 内联定义，不需要再修改 `src/i18n.js`。模型数量文案会根据目录长度自动计算。生成 WorkBuddy `models.json` 时会将本地化厂商对象转换为 WorkBuddy 5.5.x 要求的普通字符串；仅文本模型会写入 WorkBuddy 的 `models` 和 `availableModels`，图片/视频模型通过独立媒体 API 使用。修改后运行 `npm test` 和 `npm run build`，再部署官网即可。

Windows：打开文件资源管理器，输入 `%USERPROFILE%`，进入或创建 `.workbuddy`，将 JSON 中的 `models` 数组合并到现有 `models.json`。如果文件不存在，直接创建。

macOS：终端执行 `open ~/.workbuddy`；如果目录不存在，先执行 `mkdir -p ~/.workbuddy`。将 JSON 中的 `models` 数组合并到现有 `models.json`，如果文件不存在则创建。

Linux：打开或创建 `~/.workbuddy`，按相同方式合并 `models.json`。

完成后完全退出并重新打开 WorkBuddy。不要覆盖现有 JSON 中与 `models` 无关的设置；配置文件包含用户 API Key，只应保存在自己的电脑上。

下载或复制的文本配置使用同一把已验证的 composite 分组 Key 和全部选中模型。旧单平台 Key 仍按原授权使用；媒体模型继续要求对应媒体授权，不会因为文本模型混选而自动开放。

配置文件包含当前用户的 API Key，只应在自己的电脑上使用，不要转发给他人。OpenAI 通道文本模型使用 `https://api.cheapbuddy.cc/v1/chat/completions`；Claude 稳定通道可用原生 `/v1/messages` 或经服务端转换的 `/v1/chat/completions`、`/v1/responses`；图片模型 `gpt-image-2.5` 使用 `/v1/images/generations`，视频模型 `MiniMax-H3` 使用 `/v1/videos`，视频任务完成后通过 `/v1/videos/{video_id}/content` 下载。生产环境由 Railway API 服务承载，Cloudflare Worker 不是业务链路必需组件；部署到其他环境时通过 `VITE_WORKBUDDY_BASE_URL` 覆盖。

## Media API quick reference

官网的“图片 / 视频接入”文档与配置中心共用 `src/models.js` 的媒体模型目录。媒体请求继续使用具备媒体权限的现有 CheapBuddy 用户 API Key；Claude 统一接入不新增媒体权限，也不改变下面的媒体请求路径，不要发送到 `/chat/completions`：

```bash
curl https://api.cheapbuddy.cc/v1/images/generations \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2.5","prompt":"a cinematic city at night","size":"1024x1024","n":1}'

curl -X POST https://api.cheapbuddy.cc/v1/videos \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -F "model=MiniMax-H3" \
  -F "prompt=A slow camera move through a misty forest" \
  -F "seconds=8" \
  -F "ratio=16:9" \
  -F "resolution=768P"

# image-to-video: JSON accepts public HTTPS image URLs
curl -X POST https://api.cheapbuddy.cc/v1/videos \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-H3","prompt":"Create a smooth transition between these frames.","first_frame":"https://example.com/start.png","last_frame":"https://example.com/end.png","seconds":8,"ratio":"adaptive","resolution":"768P"}'

# reference-to-video: multipart accepts reference files
curl -X POST https://api.cheapbuddy.cc/v1/videos \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -F "model=MiniMax-H3" \
  -F "prompt=Use the reference motion to create a cinematic dawn scene" \
  -F "seconds=8" \
  -F "ratio=adaptive" \
  -F "resolution=768P" \
  -F "reference_video=@reference.mp4"
```

H3 支持三种生成方式：无素材时为 text-to-video；使用 `first_frame`、`last_frame` 或 `images` 为 image-to-video；使用 `reference_image`、`reference_video` 或 `reference_audio` 为 reference-to-video。视频接口是异步任务：保存返回的 `id`，轮询 `GET /v1/videos/{id}`，完成后请求 `GET /v1/videos/{id}/content`。请求体支持 JSON 和 multipart；JSON 参考素材使用公开 HTTPS URL，multipart 参考素材使用对应文件字段，并把 `model` 字段放在文件字段之前。图片和视频任务的实际计费由媒体上游返回的用量和 CheapBuddy 媒体倍率结算。Claude Code、OpenCode、Codex 等文本 Agent 是否能直接展示媒体按钮取决于客户端；不支持时使用上述 API。

发布新的媒体模型时，Relay 的 `RELAY_VERIFIED_MODELS`、`RELAY_RESERVATION_QUOTA_BY_MODEL`、`RELAY_MEDIA_MULTIPLIER_BY_MODEL` 和 `RELAY_MEDIA_BILLING_MODE_BY_MODEL` 必须同时包含完全一致的模型 ID；否则模型不会出现在 `/v1/models`，也不会被路由。

## Backend integration

首页已经直接复用 Sub2API 的用户面接口，不自建协议网关：

- 登录：`POST /api/v1/auth/login`
- 发送注册邮箱验证码：`POST /api/v1/auth/send-verify-code`；需要有效的 `turnstile_token`
- 注册：`POST /api/v1/auth/register`；邮箱验证开启时需要 `verify_code`，注册和登录都必须完成有效的人机验证流程
- 余额：`GET /api/v1/user/profile`
- API Key：`GET/POST /api/v1/keys`
- 充值：`GET /api/v1/payment/checkout-info`，然后 `POST /api/v1/payment/orders`
- 官网公告：登录后的 CheapBuddy 官网通过同源 `GET /api/v1/announcements` 加载公告，并在导航栏铃铛入口展示；Sub2API 的公告页面仅供管理员发布和维护，不作为用户展示入口。
- WorkBuddy 配置：生成的 `models.json` 使用 WorkBuddy 的 `url` 字段，指向公共 `https://api.cheapbuddy.cc/v1/chat/completions`；Relay 将 HTTP 请求透传至 Sub2API 的既有 OpenAI-compatible 接口

本地开发服务器只将 `/api/`（带结尾斜杠）代理到 `http://127.0.0.1:8080`；不能改成 `/api`，否则 `/api-docs` 会被误转发为后端请求。`/api-docs/` 和 `/comfyui/` 是 Vite 多入口页面，必须通过 HTTP 开发服务器或构建后的静态服务访问，不能直接打开 `file://` 源文件。生产官网的用户中心 API 使用同域 `https://cheapbuddy.cc/api/v1`；WorkBuddy 文本 API 使用 `https://api.cheapbuddy.cc/v1`，媒体 API 也通过同一 Railway Relay 域名提供。如果官网和 Sub2API 不在同一域名，设置：

完整的前端运行限制和导航验收范围见 [`docs/project-limitations.md`](./docs/project-limitations.md)。

```powershell
$env:VITE_API_BASE_URL = "https://console.cheapbuddy.cc/api/v1"
$env:VITE_WORKBUDDY_BASE_URL = "https://api.cheapbuddy.cc/v1"
$env:VITE_CHEAPBUDDY_SHARED_GROUP_ID = "99" # 示例 ID；替换为用户有权绑定的实际 composite 分组 ID
$env:VITE_SUB2API_STRIPE_PAYMENT_URL = "https://console.cheapbuddy.cc"
```

管理功能与用户接入分开授权；实际管理域名、内部地址及凭据不写入公开客户端配置。管理员文档中的 API 路径与示意 ID 不属于用户配置。`VITE_API_BASE_URL` 必须是浏览器可访问的 HTTPS 用户 API 地址，不能使用服务间私有地址。

### Cloudflare Turnstile

注册和登录均启用 Cloudflare Turnstile。前端优先从 Sub2API 的 `GET /api/v1/settings/public` 读取站点密钥，也可以通过环境变量覆盖：

```powershell
$env:VITE_TURNSTILE_SITE_KEY = "0x4AAAAAAA..."
$env:VITE_TURNSTILE_REQUIRED = "true"
```

服务端校验由 Sub2API 执行，`turnstile.required: true` 已写入本地部署配置；请在 Sub2API 管理后台的 Turnstile 设置中填写 Site Key 和 Secret Key，并在 Cloudflare Turnstile 中把官网域名加入允许的 Hostname。Secret Key 只保存在后端，不能写入前端环境变量或代码。

充值支持多通道：中文界面优先选择 `easypay`（用于 z-pay.cn 通道），再回退到 `alipay` / `alipay_direct`；英文界面只选择已启用的 `stripe`，并按 Stripe provider 的 `currency`（推荐 `USD`）创建订单。支付供应商必须先在 Sub2API 后台配置并启用；未配置时页面会明确提示，不会创建假订单。Stripe 创建订单后由前端打开 Sub2API 原生 `/payment/stripe` 页面，支付回调、验签和幂等入账全部由 Sub2API 负责。完整配置见 [`docs/stripe-payment-setup.md`](./docs/stripe-payment-setup.md)。

前端不会保存上游模型密钥；下载配置时只使用当前 Sub2API 用户 API Key。

## Billing and recharge tiers

CheapBuddy uses pay-as-you-go balance rather than a monthly subscription. New registrations receive a one-time ¥1 trial balance through Sub2API's `default.user_balance` setting. The customer-facing tiers are defined in `src/pricing.js` and the selected `amount` is sent to Sub2API when an order is created:

| Tier | Payment | CheapBuddy balance added |
| --- | ---: | ---: | ---: |
| Trial | ¥3 | ¥3 |
| Standard | ¥15 | ¥15 |
| Regular | ¥30 | ¥30 |
| Heavy | ¥90 | ¥90 |
| Team | ¥150 | ¥150 |

CheapBuddy displays recharge amounts as RMB balance shared across supported models and clients. The final debit is controlled by each production backend route and model rate; no single official-price discount is advertised until those production values are verified. Check the live balance and per-model price details before making cost comparisons.

公共入口分工：`cheapbuddy.cc` 官网、`console.cheapbuddy.cc` 用户中心、`api.cheapbuddy.cc` 文本与媒体 API。管理入口不挂载到官网或公开 API 路由，也不公开其地址或凭据。
