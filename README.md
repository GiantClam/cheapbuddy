# CheapBuddy

cheapbuddy.cc 的品牌化前端，后端能力直接使用 Sub2API。

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

登录后选择平台和模型，页面会使用当前用户 API Key 生成配置预览。预览会显示完整文件内容和已包含模型，复制或下载动作使用完整文件内容。可以复制自动配置提示词，让目标 Agent 备份并合并现有配置；也可以复制或下载原生配置文件后手动合并。WorkBuddy 和 OpenCode 会把全部已选模型写入原生模型目录；OpenCode 使用当前 v2 的 `providers`、`package`、`settings`、`modelID` 和 `capabilities` 字段，支持推理的模型同时声明 `reasoning_content` 兼容字段；Claude Code 最多选择两个模型，分别作为主模型和小型快速模型，其余模型由网关模型发现；Codex 原生配置只支持一个默认模型，因此页面会限制为单选。Codex 的 provider 配置应写入用户级 `~/.codex/config.toml`，不要只放在项目级配置中。

生成文件包含个人 API Key。只能保存在用户自己的设备上，不应提交到 Git、公开工单或聊天记录。合并配置前应先备份旧文件，并保留已有 Provider、权限和其他无关设置。

## Model catalog

官网模型的唯一配置源是 [`src/models.js`](./src/models.js)。首页模型货架、首屏模型卡片、价格示例、账户用量标记、配置中心选择器，以及 WorkBuddy / Claude Code / OpenCode / Codex 配置生成，都会从这份目录读取模型。

新增、删除或修改模型时，只需编辑 `src/models.js` 中对应对象：

- `id`、`short`、`vendor`、`description`：模型 ID、短名称、厂商和中英文展示文案
- `input`、`output`：首页展示的每百万 Token 参考价格
- `maxInputTokens`、`maxOutputTokens`、`temperature`：生成配置使用的上下文和输出参数
- `supportsToolCall`、`supportsImages`、`supportsReasoning`、`onlyReasoning`、`reasoning`：平台配置能力字段
- `featured`：是否优先出现在首屏和配置中心前列
- `showInUsageExample`：是否优先出现在首页价格示例
- `accent`、`mark`：模型卡片视觉标记

模型文案使用 `vendor.zh/en` 和 `description.zh/en` 内联定义，不需要再修改 `src/i18n.js`。模型数量文案会根据目录长度自动计算。生成 WorkBuddy `models.json` 时会将本地化厂商对象转换为 WorkBuddy 5.5.x 要求的普通字符串，并写入 `availableModels` 以确保模型出现在选择器中。修改后运行 `npm test` 和 `npm run build`，再部署官网即可。

Windows：打开文件资源管理器，输入 `%USERPROFILE%`，进入或创建 `.workbuddy`，将 JSON 中的 `models` 数组合并到现有 `models.json`。如果文件不存在，直接创建。

macOS：终端执行 `open ~/.workbuddy`；如果目录不存在，先执行 `mkdir -p ~/.workbuddy`。将 JSON 中的 `models` 数组合并到现有 `models.json`，如果文件不存在则创建。

Linux：打开或创建 `~/.workbuddy`，按相同方式合并 `models.json`。

完成后完全退出并重新打开 WorkBuddy。不要覆盖现有 JSON 中与 `models` 无关的设置；配置文件包含用户 API Key，只应保存在自己的电脑上。

注册成功后，网站会自动检查当前 CheapBuddy 分组的用户 Key：已有有效 Key 则直接复用，没有则自动创建；创建完成后自动打开配置中心，可直接下载或复制包含本人 Key 和已选模型的 `models.json`。

配置文件包含当前用户的 API Key，只应在自己的电脑上使用，不要转发给他人。WorkBuddy 的 API 地址应使用 CheapBuddy 的 `https://api.cheapbuddy.cc/v1/chat/completions` 接口。生产环境由 Railway API 服务承载，Cloudflare Worker 不是业务链路必需组件；部署到其他环境时通过 `VITE_WORKBUDDY_BASE_URL` 覆盖。

## Backend integration

首页已经直接复用 Sub2API 的用户面接口，不自建协议网关：

- 登录：`POST /api/v1/auth/login`
- 注册：`POST /api/v1/auth/register`；注册和登录都必须携带有效的 `turnstile_token`
- 余额：`GET /api/v1/user/profile`
- API Key：`GET/POST /api/v1/keys`
- 充值：`GET /api/v1/payment/checkout-info`，然后 `POST /api/v1/payment/orders`
- 官网公告：登录后的 CheapBuddy 官网通过同源 `GET /api/v1/announcements` 加载公告，并在导航栏铃铛入口展示；Sub2API 的公告页面仅供管理员发布和维护，不作为用户展示入口。
- WorkBuddy 配置：生成的 `models.json` 使用 WorkBuddy 的 `url` 字段，直接指向 Sub2API 的 `/v1/chat/completions` OpenAI 兼容接口

本地开发服务器已将 `/api` 代理到 `http://127.0.0.1:8080`。生产官网的用户中心 API 使用同域 `https://cheapbuddy.cc/api/v1`；WorkBuddy 文本 API 使用 `https://api.cheapbuddy.cc/v1`，媒体 API 也通过同一 Railway Relay 域名提供。如果官网和 Sub2API 不在同一域名，设置：

```powershell
$env:VITE_API_BASE_URL = "https://console.cheapbuddy.cc/api/v1"
$env:VITE_CHEAPBUDDY_GROUP_ID = "2"
$env:VITE_WORKBUDDY_BASE_URL = "https://api.cheapbuddy.cc/v1"
$env:VITE_ADMIN_PORTAL_HOST = "admin.cheapbuddy.cc"
$env:VITE_ADMIN_SUB2API_URL = "https://sub2api-admin.cheapbuddy.cc"
$env:VITE_ADMIN_NEWAPI_URL = "https://newapi-admin.cheapbuddy.cc"
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

充值按钮优先选择 `easypay`（用于 z-pay.cn 通道），再回退到 `alipay` / `alipay_direct`。支付供应商必须先在 Sub2API 后台配置并启用；未配置时页面会明确提示，不会创建假订单。支付回调、验签和幂等入账全部由 Sub2API 负责。

前端不会保存上游模型密钥；下载配置时只使用当前 Sub2API 用户 API Key。

## Billing and recharge tiers

CheapBuddy uses pay-as-you-go balance rather than a monthly subscription. New registrations receive a one-time ¥1 trial balance through Sub2API's `default.user_balance` setting. The customer-facing tiers are defined in `src/pricing.js` and the selected `amount` is sent to Sub2API when an order is created:

| Tier | Payment | WorkBuddy points |
| --- | ---: | ---: | ---: |
| Trial | ¥3 | 1,000 points |
| Standard | ¥15 | 5,000 points |
| Regular | ¥30 | 10,000 points |
| Heavy | ¥90 | 30,000 points |
| Team | ¥150 | 50,000 points |

Internally, CheapBuddy applies the Sub2API group rate `1.2 ×` to the configured channel price. Customer-facing pricing is compared with official model pricing: with the current `0.6 ×` channel benchmark, the effective rate is `0.72 ×` official pricing, or about `7.2 折` (28% below official). This internal rate is intentionally not presented as a customer-facing price multiplier. Balances are shared across models and devices and do not reset monthly.

推荐生产域名分工：`cheapbuddy.cc` 官网、`console.cheapbuddy.cc` 用户中心、`api.cheapbuddy.cc` WorkBuddy/媒体 API、`admin.cheapbuddy.cc` 私有管理入口。官网不展示管理域名，管理入口不挂载到官网或公开 API 路由。
