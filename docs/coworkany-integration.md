# Coworkany 接入 CheapBuddy：既有接口核验与交付

日期：2026-10-04。本文对应用户提供的《cheapbuddy.cc 整改方案：复用现有接口接入 Coworkany》版本 2。

本次沿用既有公共接口：账号、会话、Key、会员及商品由 Sub2API 提供；Relay 承载模型目录、文本和媒体请求。Coworkany 适配、默认 Key 分组和充值目录修复已经发布到生产。本文把已验证的线上行为与尚未满足的验收项分开记录；测试凭据、JWT、API Key 和 Railway secrets 不进入仓库。

## 1. 固定配置与验证状态

| 配置 | 候选值 | 状态 |
| --- | --- | --- |
| Provider ID / 名称 | `cheapbuddy` / `CheapBuddy` | 方案约定，由 Coworkany 内置 |
| 模型 Base URL | `https://api.cheapbuddy.cc/v1` | 生产已有绑定 OpenAI 分组的用户 Key 读取目录成功 |
| 账号 Base URL | `https://cheapbuddy.cc/api/v1` | 普通用户登录、账号、Key、会员及商品读取均已返回 200 |
| 官网购买入口 | `https://cheapbuddy.cc/#account` | 方案候选；购买导航、付款及到账尚未验收 |
| 推荐文本模型 | `gpt-6-sol` | 方案候选；必须存在于该用户实际 `/v1/models` 目录才可选用 |

账号 JWT 与模型 API Key 是两类凭据。Coworkany Host 使用 JWT 调账号接口，使用同一用户模型 Key 调 Relay。系统浏览器打开购买页面后按官网正常登录；URL 中不得携带 JWT、refresh token 或 API Key。

生产脱敏证据位于 `output/coworkany-existing-api-20261004/phase-one.json`、`gap-check.json`、`existing-key-phase-one.json`。公开设置、登录、`/auth/me`、Key 列表、有效会员、checkout-info、plans 均返回 200；名称为 `Coworkany/relay-check-20261004` 的 Key 创建成功但 `group_id=null`，其直连 Sub2API 模型目录返回 403，Relay 返回 502。改用当前账号已获准的 OpenAI 分组 Key 后，Relay 目录返回 200：9 个文本、1 个图片、1 个视频模型，没有未分类项。

账号可绑定分组中，ID 2 为 `CheapBuddy OpenAI`（`openai`），ID 1 为 `default`（`anthropic`）。不能把名称为 default 的组当作正确 GPT 分组。目录读取成功只证明目录联通，不证明收费模型执行、视频下载或最终账单已验收。

## 2. 账号接口及响应契约

下表路径均相对于账号 Base URL。除公开设置、登录、2FA、刷新和退出外，用户读取和 Key 管理需要 `Authorization: Bearer <access_token>`。

| 既有接口 | 请求 / 返回 | 源码确认 |
| --- | --- | --- |
| `GET /settings/public` | 读取部署启用的验证码、2FA 等公开设置 | 生产 200；具体验证分支按真实账号要求处理 |
| `POST /auth/login` | `email`、`password`，以及实际验证码参数 | 成功返回 token pair 与普通用户 DTO，或 `requires_2fa` 分支 |
| `POST /auth/login/2fa` | `temp_token`、6 位 `totp_code` | 成功返回同一认证响应 |
| `POST /auth/refresh` | `refresh_token` | 返回新的 access token 和 refresh token；旧 refresh token 轮转失效 |
| `POST /auth/logout` | 可选 `refresh_token`，允许空请求体 | 提供 refresh token 时撤销该 token；返回退出成功消息 |
| `GET /auth/me` | 无请求体 | 返回用户、余额、身份兼容字段及 `run_mode` |
| `GET /keys` | 分页、名称搜索和状态等筛选 | 返回分页对象及完整 Key |
| `GET /keys/{id}` | Key ID | 校验当前用户所有权；返回完整 Key DTO |
| `POST /keys` | 必填 `name`；可选分组和限制 | 支持既有 `Idempotency-Key`，返回完整 Key DTO |
| `GET /subscriptions/active` | 无请求体 | 返回当前用户有效会员数组；不是可售目录 |
| `GET /payment/checkout-info` | 无请求体 | 返回会员计划、支付方式、充值范围和配置 |
| `GET /payment/plans` | 无请求体 | 返回 `for_sale=true` 的会员计划数组 |

### 通用响应

账号接口成功为 HTTP 200，包裹格式固定为：

```json
{"code":0,"message":"success","data":{}}
```

`data` 根据接口为对象或数组。失败使用 HTTP 状态码，主体为 `code`、`message`，可选 `reason` 和 `metadata`；没有成功 `data`：

```json
{"code":403,"message":"user is not allowed to bind this group","reason":"GROUP_NOT_ALLOWED"}
```

Relay 的模型接口使用 OpenAI 兼容响应，不使用此账号包裹格式。解析器不能把两种响应混用。

### 登录、2FA 和刷新

以下均为脱敏结构示例，不包含真实账号或凭据。

```json
{"code":0,"message":"success","data":{"access_token":"<redacted>","refresh_token":"<redacted>","expires_in":3600,"token_type":"Bearer","user":{"id":1,"email":"user@example.invalid","role":"user","balance":0,"status":"active"}}}
```

此示例的 `user` 省略了其他 `dto.User` 字段。若服务端 token pair 生成失败，现有兼容分支可能仅返回 access token，省略 `refresh_token` 和 `expires_in`；桌面必须处理这种会话，不能假定一定能刷新。

启用并需要 2FA 时，首次登录 `data` 为：

```json
{"requires_2fa":true,"temp_token":"<redacted>","user_email_masked":"<masked>"}
```

此时尚未取得用户会话，不能执行 `/auth/me` 或 Key 创建。完成 `/auth/login/2fa` 后再继续。登录验证码字段为 `turnstile_token`，或腾讯验证码的 `tencent_captcha_ticket` 与 `tencent_captcha_randstr`；不得绕过实际启用的验证。

刷新成功 `data` 为 `access_token`、`refresh_token`、`expires_in`、`token_type`，不附用户对象。错误原因包括 `REFRESH_TOKEN_INVALID`、`REFRESH_TOKEN_EXPIRED`、`TOKEN_REVOKED`；会话绑定启用时 IP/UA 改变也可能使会话失效。Host 应保存轮转结果，串行刷新，并在需要时重新登录。退出只撤销传入的 refresh token；已发 access token 不因此自动即时失效，桌面仍须删除本地会话。

### 当前用户 DTO

`GET /auth/me` 的 `data` 包含用户 ID、邮箱、名称、角色、`balance`、`frozen_balance`、并发、状态、`allowed_groups`、限流、时间及余额提醒字段；附 `run_mode`、身份绑定兼容字段，可能附头像和资料来源。关联 `api_keys` / `subscriptions` 是否加载由接口决定。普通用户 DTO 不包含管理员 `notes`。完整字段见 `dto/types.go` 和 `userProfileResponse`，桌面余额单位以部署账本为准。

## 3. Key 恢复、默认分组及幂等

### 已有分页和完整 Key

`GET /keys?page=1&page_size=100&search=Coworkany%2F` 的返回结构如下。`search` 是筛选条件，Host 仍应对名称精确匹配，不能将第一条搜索结果直接认作本设备 Key。

```json
{
  "code":0,
  "message":"success",
  "data":{
    "items":[{
      "id":1,"user_id":1,"key":"<redacted>","name":"Coworkany/<device_id>",
      "group_id":null,"status":"active","quota":0,"quota_used":0,"expires_at":null
    }],
    "total":1,"page":1,"page_size":100,"pages":1
  }
}
```

示例 Key 项省略其他既有字段：`ip_whitelist`、`ip_blacklist`、`last_used_at`、`last_used_ip`、`created_at`、`updated_at`、`current_concurrency`、`rate_limit_5h`、`rate_limit_1d`、`rate_limit_7d`、`usage_5h`、`usage_1d`、`usage_7d`、各 `window_*_start`、可选 `reset*at`、`user` 和 `group`。列表默认每页 20，支持 `page_size` 或 `limit`，最大 1000；不能只看第一页就断言设备 Key 不存在。

列表、详情和创建响应均将服务层 `key` 原值映射到 DTO，没有掩码。桌面应在安全存储中保存本设备 Key，并核对状态、过期时间、额度及绑定权限。名称没有唯一性保证。创建超时后优先按本设备名称查询或用同一个幂等键重试，不能循环创建。

### 创建请求和当前缺口

现有最小请求是 `{"name":"Coworkany/<device_id>"}`。可选 `group_id`、`custom_key`、`ip_whitelist`、`ip_blacklist`、`quota`、`expires_in_days`、`rate_limit_5h`、`rate_limit_1d`、`rate_limit_7d`。数值限制必须有限且非负，过期天数提供时必须大于零。

生产已复现 C2 缺口：只传设备名称可创建未绑定分组的 Key，但该 Key 模型目录直连返回 403。现有官网前端显式传 `VITE_CHEAPBUDDY_GROUP_ID`，缺省 1，不能替代后端默认规则。

本地修复仅对名称以 `Coworkany/` 开头且省略 `group_id` 的创建请求启用默认绑定：读取 `COWORKANY_DEFAULT_GROUP_ID`（配置路径 `coworkany.default_group_id`），缺省 0，不自动猜测分组。配置必须指向活跃组，并通过当前用户原有权限校验：标准公开组、获授权专属组或当前有效订阅组。显式指定分组与其他既有客户端保持原行为。

| 已发布的创建分支 | HTTP / 原因 |
| --- | --- |
| 未配置默认分组（0） | 503 `DEFAULT_GROUP_NOT_CONFIGURED` |
| 分组不存在、不可读取或不活跃 | 503 `DEFAULT_GROUP_UNAVAILABLE` |
| 当前用户无权绑定 | 403 `GROUP_NOT_ALLOWED` |
| 活跃且有权 | 返回带明确 `group_id` 的完整 Key DTO |

发布时应显式配置已确认可用的统一 OpenAI 组，本次测试账号验证的是 ID 2。既有 `group_id=null` Key 不会被修复自动迁移；复测应使用新的设备名称/创建幂等键或既有授权 Key，不能把旧失败 Key 的重放当作修复失效。

### 幂等契约

`POST /keys` 已接入用户写入幂等协调器，作用域 `user.api_keys.create`，并按用户、HTTP 方法、路由及请求主体构造指纹。

- Header 为 `Idempotency-Key`，去掉两端空白后最多 128 字节，只允许 ASCII 可见字符（码点 33–126），不可含空格、控制字符或中文。建议随机 UUID，并为同一次创建持久保存。
- 默认记录 TTL 为 24 小时，部署可以调整；默认 `ObserveOnly=true`，未提供 header 时兼容执行。启用强制模式后缺少 header 返回 400 `IDEMPOTENCY_KEY_REQUIRED`。
- 同一用户、同一幂等键、同一主体可重放，响应附 `X-Idempotency-Replayed: true`；不同主体复用返回 409 `IDEMPOTENCY_KEY_CONFLICT`。
- 正在处理或重试退避返回 409，可能附 `Retry-After`；存储不可用返回 503，不能认为没有发生创建。

Host 原生网络调用不依赖浏览器 CORS。若未来改为 WebView 直接请求，必须另行核对 CORS 是否允许 `Idempotency-Key`；当前 Cloudflare 网站代理的允许头列表没有该 header。

## 4. 商品目录、会员及购买

`/subscriptions/active` 的 `data` 是数组，无会员为 `[]`。每项包含 `id`、`user_id`、`group_id`、`starts_at`、`expires_at`、`status`、每日/每周/每月窗口和用量、创建更新时间、可选 `revoked_at` 及 `group`/`user`。它描述已购权益，不包含可售价格。

`/payment/checkout-info` 的 `data` 字段为：

```text
methods: { <payment_type>: {
  payment_type, display_name?, currency, fee_rate, daily_limit, single_min, single_max
} }
global_min, global_max, plans[], recharge_tiers[]（生产已启用）
balance_disabled, balance_recharge_multiplier, subscription_usd_to_cny_rate
recharge_fee_rate, help_text, help_image_url, stripe_publishable_key
alipay_force_qrcode, alipay_mobile_precreate_deep_link
```

`plans[]` 每项包含 `id`、`group_id`、`group_platform`、`group_name`、倍率及高峰配置、`daily_limit_usd`、`weekly_limit_usd`、`monthly_limit_usd`、`supported_model_scopes`、`name`、`description`、`price`、可选 `original_price`、可选 `currency`、`validity_days`、`validity_unit`、`features`（数组）、`product_name`。

`/payment/plans` 同样仅返回可售会员计划，额外有 `for_sale`、`sort_order`；它的 `features` 是原始字符串，不是 checkout-info 的数组。空币种可能被省略，不能默认将会员价格认作某个币种。真实支付币种还须与支付方式配置核对。

生产已证实 C3 缺口：checkout-info 没有官网的命名充值档位，本次账号会员 plans 为 `[]`。生产可见支付方式为支付宝 CNY、Stripe USD；独立 `src/pricing.js` 档位不能视为后端商品源。

本地修复在既有 checkout-info 增加 `recharge_tiers`，商品配置存于 Sub2API 设置键 `PAYMENT_RECHARGE_TIERS`，无配置时返回 `[]`，不内置或编造生产商品。通过既有支付配置更新 DTO 的可选 `recharge_tiers` 修改；省略保留现值，显式 `[]` 清空。配置每项为 `id`、`name`、`description`、`order_type:"balance"`、`prices`（币种→金额）、可选 `featured`。

桌面/官网登录后的普通用户响应每项为：

```json
{
  "id":"trial","name":"<服务端商品名称>","description":"<服务端说明>",
  "order_type":"balance","featured":false,
  "payment_options":[{
    "payment_type":"alipay","currency":"CNY", "amount":3,
    "pay_amount":3,"credited_balance":3
  }]
}
```

此示例仅说明字段；实际 `pay_amount`、`credited_balance` 依据真实手续费及充值倍率计算，不保证等于 `amount`。服务端仅报价已配置币种和可见支付方式，并过滤不满足全局或支付方式金额限制的选项。登录后官网展示服务端 `pay_amount`，下单前刷新报价并使用服务端 `amount`；目录为空时不回退到静态售价。未登录宣传档位仅作展示，不能作为已登录购买依据。

本地 checkout-info 同时改为传播会员计划读取错误，避免数据库失败伪装成空会员目录。余额充值与 `plans[]` 会员分开展示，不从分组或已购会员推算售价；现有接口没有自动续费承诺字段。

## 5. Relay 模型及媒体契约

以下路径相对于模型 Base URL 去掉末尾 `/v1` 后的 origin；调用使用 `Authorization: Bearer <api_key>`。

| 既有接口 | 用途 |
| --- | --- |
| `GET /v1/models` | 当前 Key 的混合模型目录，OpenAI `object=list`、`data=[]` 格式 |
| `GET /v1/models/{id}` | 已配置模型详情；隐藏的已验证媒体模型可能仅详情可见 |
| `POST /v1/chat/completions`、`POST /v1/responses` | 既有文本接口；部分已配置媒体模型也可走兼容路径 |
| `POST /v1/images/generations`、`POST /v1/images/edits` | 已配置图片模型及参数协议 |
| `POST /v1/videos` | 创建视频；`/v1/video/generations` 为既有兼容路径 |
| `GET /v1/videos/{id}` | 读取任务状态 |
| `GET /v1/videos/{id}/content` | 受保护的任务结果下载 |
| `GET /v1/tasks/{task_id}/artifacts/{key}/content` | 使用 Responses 媒体任务时的既有受保护 artifact 下载 |

目录保留上游及配置的 `type`、`capabilities`、`parameter_schema`、`supported_endpoint_types` 等元数据。Coworkany 应按 `text_generation`、`text_to_image`、`image_edit`、`text_to_video` 等明确能力选择操作；文本模型接受图片输入不能据此推定它支持图片生成。媒体是否可用还受 Relay 已验证模型、可见目录和显式计费配置控制，不能把 NewAPI 的所有模型直接展示为当前用户可用模型。

Relay 查询视频任务和 content 时，先用用户 Key 解析 CheapBuddy 身份，再查 Relay 持久化任务归属；不存在或不属于当前用户返回 404 `Task is not available`。隔离按 CheapBuddy 用户 ID 判定，不是必须使用创建时那一把 Key；同一用户另一个有效 Key 仍须满足身份校验。随后 Relay 使用该用户加密保存的 NewAPI shadow token 转发，客户端不取得 NewAPI 凭据。

生产失败曾将用户模型目录的 403 包成 Relay 502。已发布修复保留 Sub2API 对用户目录鉴权/权限/限流的 401、403、429；NewAPI 服务端 shadow token 鉴权失败仍返回脱敏上游错误 502，避免被误认作用户 Key 错误。

原生任务 ID 与 provider ID 分开保存。Relay 保留 NewAPI 原有响应和任务状态，不提供 Coworkany 专用任务协议。artifact 地址应由 NewAPI `TaskPublicAddress` 指向 Relay 公共 origin；部署值和真实结果地址仍须联调。Coworkany Host 发带 Key 的下载请求，结果 URL 本身不加 Key，不把授权头转发到不可信下载 origin。

`POST /v1/media` 及其临时资源 URL 是另一套已有输入上传能力：上传有鉴权，随机 token 资源可供 provider 无 Key 抓取，默认短期、进程内存存储。它不等同于上述受保护视频结果下载，不能作为永久成果存储。

媒体创建也支持 `Idempotency-Key`；同一次请求相同主体返回原任务，不同主体返回 409。`X-Request-ID` 仅用于追踪，不能替代幂等键。原始任务已接受但 ID 未确定时可能返回 `accepted_unknown`，不得自动再创建收费任务。multipart 视频请求应将 `model` 字段置于文件之前。媒体预留、结算及任务费用仍由现有 Relay / Sub2API 流程负责。

## 6. 第一阶段联调工具

脚本：`relay/test/integration/coworkany.mjs`，使用 Node.js 内置模块。它核验既有账号及目录读取，不执行付费文本、图片、视频请求或付款。

```powershell
node .\relay\test\integration\coworkany.mjs --credentials C:\private\coworkany-test.json --output C:\private\coworkany-evidence.json
```

凭据文件使用以下字段（只展示占位符，不应提交真实文件）：

```json
{
  "access_token":"<ordinary-user-session>",
  "api_key":"<optional-existing-model-key>",
  "device_id":"<stable-device-id>",
  "allow_key_creation":false
}
```

也可以用 `email` / `password` 登录替代 access token，并按实际启用分支提供 `turnstile_token`、`tencent_captcha_ticket`、`tencent_captcha_randstr`、`totp_code`。不得使用管理员账号。`allow_key_creation` 默认关闭；若确需核验创建，显式设为 `true`，脚本仅创建当前测试用户的应用 Key，沿用既有创建接口及幂等能力。

脚本覆盖公开配置 → 普通用户登录/已有会话 → `/auth/me` → 本设备已有 Key/允许时创建 → Relay `/v1/models` → `/subscriptions/active` → checkout-info/plans。证据经过脱敏；`--output` 使用新文件路径，避免覆盖已有证据。本轮已取得普通测试账号并跑完该链路，失败设备 Key 和已有授权 Key 的结果分别记录。创建新 Key 时默认生成一次性的操作 UUID；只有调用方显式提供 `creation_idempotency_key` 才跨进程复用该值，未知超时只查询一次，不重复提交。2FA 的未触发分支、刷新和退出仍须独立验证。

`relay/` 在官网父仓库中被忽略；脚本属于 Relay 的实际部署目录。交付时必须将该文件纳入对应部署 checkout / 制品；不能只提交官网 `docs/` 就声称 Relay 交付完成。

## 7. 证据边界与后续验收

| 项目 | 当前结论 |
| --- | --- |
| 本地测试 | auth/me 兼容字段、验证码参数绑定、OAuth 退出、撤销会话、用户幂等并发/重放、认证 Redis 故障限流测试通过；官网 npm 测试 48/48、build 通过；新增生产 runner 测试 21/21 |
| 本地 service 单测 | `-tags=unit` 的 Key 数值校验、幂等键/指纹与冲突、会员计划校验、支付币种校验测试通过 |
| 生产认证联调 | 账号、刷新轮转、旧 refresh 拒绝、Key 幂等/冲突/清理、模型目录和详情均通过；普通用户目录包含 12 个文本、1 个图片、1 个视频模型 |
| 生产文本收费 | 12 个文本模型各执行一次；11 个在客户端 200/stop/非空，Astra 后台 200 但耗时 204601ms，客户端 60 秒超时；账本与余额差额一致 |
| 生产图片与上传 | ComfyUI 文本节点、图片节点、Relay 临时 PNG 上传/下载通过；图片供应商 ticks 为 $0.04，而当前 native quota 仅扣 $0.000076，采购成本与用户扣费尚未对齐 |
| 生产任务隔离 | owner status 200；其他普通用户 status/content 404；匿名 status/content 401。历史任务 content 下载返回上游 `artifact_upstream_auth_failed` 502，未通过 |
| 充值目录与 UI | CNY 3/15/30/90/150 与 USD 2.31/4.62/13.85/23.08 线上展示；未付款订单创建、权威金额核对、取消通过；真实付款到账未测 |
| 发布 | 官网 commit `4635693` 已部署；Sub2API commit `21bb0027a485f5c9db19c07a661e425e994efba7` 已部署；Relay、Sub2API、官网 Railway deployment 均为 `SUCCESS` |

本地已通过的账号测试覆盖 handler、认证路由及 `-tags=unit` 的 service 校验；不使用 `unit` tag 时，部分 service 测试不会运行。官网本地浏览器截图证据为 `output/coworkany-existing-api-20261004/coworkany-local-ui.png`，使用本地 mock，不含真实账号或真实支付。新增默认组、充值报价及 Relay 状态码行为还须纳入发布验证，单测不代替生产调用与付款验收。

生产已配置 `COWORKANY_DEFAULT_GROUP_ID=2` 并写入 `PAYMENT_RECHARGE_TIERS`。当前官网基准为下表；金额由服务端报价返回，不是固定汇率自动换算承诺。

| 档位 ID | CNY amount | USD amount |
| --- | --- | --- |
| `trial` | 3 | 0.46 |
| `standard` | 15 | 2.31 |
| `regular` | 30 | 4.62 |
| `heavy` | 90 | 13.85 |
| `team` | 150 | 23.08 |

部署后复测名称创建自动分组、同 Key 目录、真实充值报价与官网登录后的购买展示。C4 系统浏览器独立登录、官网付款到账，以及 C5 同 Key 文本/图片/视频执行、跨用户任务隔离和 content 下载仍待验收；付费调用需约定预算。刷新、退出及未触发的 2FA 分支也未完成生产验证。按上传方案不新增 Relay 账号路由；若改变该边界需另行确定契约。

## 8. 源码定位

- `sub2api-bridge/backend/internal/server/routes/auth.go`、`user.go`、`payment.go`：既有账号路由与鉴权、限流。
- `sub2api-bridge/backend/internal/handler/auth_handler.go`、`user_handler.go`：登录、2FA、刷新、退出和当前用户结构。
- `sub2api-bridge/backend/internal/handler/api_key_handler.go`、`dto/types.go`、`dto/mappers.go`：Key 分页和原值映射。
- `sub2api-bridge/backend/internal/service/api_key_service.go`、`config/config.go`：Coworkany 默认分组及原有权限。
- `sub2api-bridge/backend/internal/handler/idempotency_helper.go`、`service/idempotency.go`：Key 创建幂等与 header 校验。
- `sub2api-bridge/backend/internal/handler/payment_handler.go`、`subscription_handler.go`、`service/payment_recharge_tiers.go`：商品、充值报价及已购会员 DTO。
- `src/pricing.js`、`src/payment.js`、`src/main.jsx`：未登录宣传档位及登录后服务端报价/下单。
- `relay/internal/app/app.go`、`relay/README.md`：模型目录、原生媒体路由、task 归属与 shadow token 转发。
