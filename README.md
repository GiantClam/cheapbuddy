# CheapBuddy

**CheapBuddy 是一个面向开发者、创作者和 AI 工作流用户的多模型 AI Gateway。**

通过 [cheapbuddy.cc](https://cheapbuddy.cc/) 注册并管理账户，使用一个 CheapBuddy API Key 访问文本、图片和视频模型。CheapBuddy 提供统一的 OpenAI 兼容文本接口、图片/视频 API，以及可直接接入 ComfyUI 的三个通用节点。

## 快速访问

- [CheapBuddy 官网](https://cheapbuddy.cc/)
- [注册 / 登录](https://cheapbuddy.cc/#account)
- [图片 / 视频 API 文档](https://cheapbuddy.cc/api-docs/)
- [ComfyUI 节点介绍](https://cheapbuddy.cc/comfyui/)
- [下载 ComfyUI 节点 ZIP](https://cheapbuddy.cc/downloads/ComfyUI-CheapBuddy-0.1.1.zip)
- [CheapBuddy GitHub](https://github.com/GiantClam/cheapbuddy)

## CheapBuddy 能做什么

- **统一模型入口**：文本、视觉、图片生成、图片编辑和视频生成使用统一的 CheapBuddy API Key。
- **模型按能力发现**：客户端从 `/v1/models` 获取当前账户可用模型，按文本、图片和视频能力过滤。
- **多客户端接入**：可用于 WorkBuddy、Claude Code、OpenCode、Codex、ComfyUI 和自定义程序。
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
2. 在账户中心创建或复制自己的 CheapBuddy API Key。
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

文本接口：

```bash
curl https://api.cheapbuddy.cc/v1/chat/completions \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-sol","messages":[{"role":"user","content":"Write a short product idea."}]}'
```

图片和视频请求、参数说明、任务轮询及素材字段请查看 [图片 / 视频 API 文档](https://cheapbuddy.cc/api-docs/)。

## Run

```bash
npm install
npm run dev
```

首页支持中文和 English 两种界面语言。语言切换位于顶部导航，选择会保存在当前浏览器，下次访问自动恢复；未保存语言偏好时会根据浏览器语言初始化。

## Sub2API local deployment

本机 Sub2API 官方 Compose 部署位于 `C:\Users\liula\Documents\sub2api-deploy`，管理后台默认地址为 `http://127.0.0.1:8080`。Sub2API 负责用户、API Key、余额、渠道、模型路由、计费和 OpenAI 兼容接口；WorkBuddy 应直接请求 Sub2API 的 `/v1/chat/completions`。

```powershell
docker compose -f docker-compose.local.yml up -d
```

当前本地实例只监听 `http://127.0.0.1:8080`，没有额外自建网关。CheapBuddy 不再提供或要求运行本地脚本。登录后，首页或配置中心可以复制一段包含当前用户 Key 和所选模型的 WorkBuddy 提示词；将提示词直接粘贴到 WorkBuddy 对话框，要求它备份旧文件、按模型 ID 合并 `models.json` 并重启。JSON 下载仍作为手动备用方式。

提示词配置只应粘贴到用户自己的 WorkBuddy。它包含个人 API Key，不要转发给他人或粘贴到公开对话中。

## Multi-platform config generation

配置中心支持选择目标平台并生成对应的用户级配置：

| 平台 | 生成文件 | 默认目标路径 | 协议 |
| --- | --- | --- | --- |
| WorkBuddy | `models.json` | `~/.workbuddy/models.json` | Chat Completions |
| Claude Code | `settings.json` | `~/.claude/settings.json` | Anthropic Messages |
| OpenCode | `opencode.json` | `~/.config/opencode/opencode.json` | OpenAI-compatible |
| Codex | `config.toml` | `~/.codex/config.toml` | Responses API |

登录后选择平台和模型，页面会使用当前用户 API Key 生成配置预览。预览会显示完整文件内容和已包含模型，复制或下载动作使用完整文件内容。可以复制自动配置提示词，让目标 Agent 备份并合并现有配置；也可以复制或下载原生配置文件后手动合并。所有平台均可多选或一键全选模型；WorkBuddy、OpenCode 会将已选模型写入原生模型目录，Claude Code 将已选模型加入模型选择白名单，Codex 使用首个模型作为默认值并在配置注释中列出其余模型 ID。OpenCode 使用当前 v2 的 `providers`、`package`、`settings`、`modelID` 和 `capabilities` 字段，支持推理的模型同时声明 `reasoning_content` 兼容字段。Codex 的 provider 配置应写入用户级 `~/.codex/config.toml`，不要只放在项目级配置中。

生成文件包含个人 API Key。只能保存在用户自己的设备上，不应提交到 Git、公开工单或聊天记录。合并配置前应先备份旧文件，并保留已有 Provider、权限和其他无关设置。

## Model catalog

官网模型的唯一配置源是 [`src/models.js`](./src/models.js)。首页模型货架、首屏模型卡片、价格示例、账户用量标记、配置中心选择器，以及 WorkBuddy / Claude Code / OpenCode / Codex 配置生成，都会从这份目录读取模型。

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

注册成功后，网站会自动检查当前 CheapBuddy 分组的用户 Key：已有有效 Key 则直接复用，没有则自动创建；创建完成后自动打开配置中心，可直接下载或复制包含本人 Key 和已选模型的 `models.json`。

配置文件包含当前用户的 API Key，只应在自己的电脑上使用，不要转发给他人。文本模型使用 `https://api.cheapbuddy.cc/v1/chat/completions`；图片模型 `gpt-image-2.5` 使用 `/v1/images/generations`，视频模型 `MiniMax-H3` 使用 `/v1/videos`，视频任务完成后通过 `/v1/videos/{video_id}/content` 下载。生产环境由 Railway API 服务承载，Cloudflare Worker 不是业务链路必需组件；部署到其他环境时通过 `VITE_WORKBUDDY_BASE_URL` 覆盖。

## Media API quick reference

官网的“图片 / 视频接入”文档与配置中心共用 `src/models.js` 的媒体模型目录。媒体请求仍使用登录后生成的 CheapBuddy 用户 API Key，但不要发送到 `/chat/completions`：

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
- 注册：`POST /api/v1/auth/register`；注册和登录都必须携带有效的 `turnstile_token`
- 余额：`GET /api/v1/user/profile`
- API Key：`GET/POST /api/v1/keys`
- 充值：`GET /api/v1/payment/checkout-info`，然后 `POST /api/v1/payment/orders`
- 官网公告：登录后的 CheapBuddy 官网通过同源 `GET /api/v1/announcements` 加载公告，并在导航栏铃铛入口展示；Sub2API 的公告页面仅供管理员发布和维护，不作为用户展示入口。
- WorkBuddy 配置：生成的 `models.json` 使用 WorkBuddy 的 `url` 字段，直接指向 Sub2API 的 `/v1/chat/completions` OpenAI 兼容接口

本地开发服务器只将 `/api/`（带结尾斜杠）代理到 `http://127.0.0.1:8080`；不能改成 `/api`，否则 `/api-docs` 会被误转发为后端请求。`/api-docs/` 和 `/comfyui/` 是 Vite 多入口页面，必须通过 HTTP 开发服务器或构建后的静态服务访问，不能直接打开 `file://` 源文件。生产官网的用户中心 API 使用同域 `https://cheapbuddy.cc/api/v1`；WorkBuddy 文本 API 使用 `https://api.cheapbuddy.cc/v1`，媒体 API 也通过同一 Railway Relay 域名提供。如果官网和 Sub2API 不在同一域名，设置：

完整的前端运行限制和导航验收范围见 [`docs/project-limitations.md`](./docs/project-limitations.md)。

```powershell
$env:VITE_API_BASE_URL = "https://console.cheapbuddy.cc/api/v1"
$env:VITE_CHEAPBUDDY_GROUP_ID = "2"
$env:VITE_WORKBUDDY_BASE_URL = "https://api.cheapbuddy.cc/v1"
$env:VITE_ADMIN_PORTAL_HOST = "admin.cheapbuddy.cc"
$env:VITE_ADMIN_SUB2API_URL = "https://sub2api-admin.cheapbuddy.cc"
$env:VITE_ADMIN_NEWAPI_URL = "https://newapi-admin.cheapbuddy.cc"
$env:VITE_SUB2API_STRIPE_PAYMENT_URL = "https://console.cheapbuddy.cc"
```

当用户从 `admin.cheapbuddy.cc` 登录时，前端会先使用当前 CheapBuddy/Sub2API Token 请求 Sub2API 原生的管理员接口 `/api/v1/admin/users` 做权限探针；只有原生接口确认该账号具备管理员权限后，才显示管理系统选择框。普通用户会话会被清除并拒绝进入。通过校验后分别打开 Sub2API 或 NewAPI 的后台入口，两个后台的登录会话仍由各自系统维护；CheapBuddy 不把 Sub2API Token 冒充成 NewAPI 会话。`VITE_ADMIN_SUB2API_URL` 和 `VITE_ADMIN_NEWAPI_URL` 未配置或不是 `http(s)` 地址时，对应入口会保持禁用。

由于权限探针由管理员浏览器直接请求 Sub2API，`VITE_API_BASE_URL` 必须是浏览器可访问的 HTTPS API 地址，并且 Sub2API 的 CORS 允许来源中必须包含 `https://admin.cheapbuddy.cc`。Railway private URL 只供服务间调用，不能作为这个前端变量。

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

推荐生产域名分工：`cheapbuddy.cc` 官网、`console.cheapbuddy.cc` 用户中心、`api.cheapbuddy.cc` WorkBuddy/媒体 API、`admin.cheapbuddy.cc` 私有管理入口。官网不展示管理域名，管理入口不挂载到官网或公开 API 路由。
