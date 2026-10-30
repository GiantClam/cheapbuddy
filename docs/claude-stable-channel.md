# Claude 稳定通道接入指南

配置说明更新日期：2026-10-15；价格核对日期：2026-10-13。本文说明接入合同与配置示例，不作为已完成生产部署或客户端全功能验收的证明。

**WorkBuddy、OpenCode 与 Codex 配置可同时选择 OpenAI 与 Claude 文本模型，并让这些模型共用同一把 `CheapBuddy Shared` Key。Claude Code 使用 Anthropic Messages 协议，只支持 Claude 模型。** 每把 Key 仍只绑定一个 Sub2API 分组；共享 Key 绑定 `platform=composite` 的分组，由该分组的账号、路由、价格与授权提供跨平台访问。CheapBuddy Base URL 和 USD 余额保持不变。旧 `CheapBuddy Claude Stable` 或 OpenAI 单平台 Key 继续遵守原权限，配置中心不会自动迁移它们、改绑分组或扩大授权。历史单平台分组的倍率不代表新共享分组的价格；最终扣费以共享 Key 的服务端配置为准。

## 1. 沿用现有入口与 Key，选择模型

在 [CheapBuddy 官网](https://cheapbuddy.cc/) 登录，进入配置中心，选择目标客户端、协议和模型。WorkBuddy、OpenCode 与 Codex 的选择器允许同时选择 OpenAI 与 Claude 模型；Claude Code 的选择器只显示支持 Anthropic Messages 的 Claude 模型。GLM 等 OpenAI-compatible 模型请使用 WorkBuddy 或 OpenCode 的兼容协议。实际模型访问应通过同一把共享 Key 的连接测试核验。

配置中心先从 `GET /api/v1/keys` 复用有效的 composite 分组 Key；没有时，从 `GET /api/v1/groups/available` 取得当前用户有权绑定的活跃 composite 分组，再通过 `POST /api/v1/keys` 创建名为 `CheapBuddy Shared` 的 Key。部署时可用 `VITE_CHEAPBUDDY_SHARED_GROUP_ID` 指定共享分组；不会猜测写死的默认分组 ID，也不会改用普通单平台 Key。

复制配置、复制自动配置提示词或下载文件前，页面会用将写入配置的同一把 Key 请求 `GET /v1/models`，逐一验证全部选中模型的实际 ID（`wireId`）。目录缺少任一模型、鉴权失败或网络错误都会阻止导出，并提示检查服务端配置；不会换一把 Key 绕过失败。目录检查证明该 Key 当前可发现所选模型，实际生成、额度与计费仍需按下面步骤验收。

Claude 稳定通道提供以下六个模型 ID。调用时按原样填写，不把展示名称或带小数点的简称当作 API 模型 ID。

| 模型 | API 模型 ID |
| --- | --- |
| Claude Fable 5 | `claude-fable-5` |
| Claude Fable 5.1 | `claude-fable-5-1` |
| Claude Opus 5 | `claude-opus-5` |
| Claude Opus 5.5 | `claude-opus-5-5` |
| Claude Sonnet 5 | `claude-sonnet-5` |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` |

对比通道另提供 `claude-opus-5-5-MAX`。它保持 Claude Opus 5.5 的上游模型语义，
仅通过 PPToken 的 Claude 账号池提供服务，用于与活动期间的 `claude-opus-5-5`
（Aiberm 路由）进行对比。活动期内该模型沿用 Claude Opus 5.5 的 3 折价格；
请求会在 usage 中保留公开模型名，并记录实际的 PPToken 账号和上游
`claude-opus-5-5`。

公开 API 根地址为 `https://api.cheapbuddy.cc`。将具备 OpenAI 与 Claude 权限的 **CheapBuddy Shared Key** 保存在本地环境变量 `CHEAPBUDDY_API_KEY`，再按所选协议读取该 Key 可访问的模型。下面使用原生 Anthropic 认证与版本头：

```bash
curl https://api.cheapbuddy.cc/v1/models \
  -H "x-api-key: $CHEAPBUDDY_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

原生 `GET /v1/models` 和详情响应直接沿用 Sub2API，不混入 NewAPI 媒体记录，也不补造能力字段；既有 OpenAI-compatible 聚合目录保留原合同。两者都遵守当前 Key 的权限。模型出现在官网货架上，不代表受限、过期或禁用 Key 可以绕过访问控制。

**现有根地址或 `/v1` Base URL 都可保留，无需 strip-v1 或修改已有 URL。** 下文展示规范 HTTP 路径 `/v1/messages`。不同 SDK 有的追加 `/v1/messages`，有的（如 OpenCode 的 Anthropic SDK）追加 `/messages`；Relay 的安全 SDK 路径别名兼容这些拼接方式，以及 SDK 引起的重复 `/v1` 形式（如 `/v1/v1/messages`）。它们不是另一个服务入口。下文根地址 / `/v1` 示例是规范写法，不是迁移要求。

### 1.1 生产共享分组准备（管理员）

以下仅为仓库内 Sub2API 管理接口的配置示例，不会由前端执行，也不表示生产已经部署。需要支持 composite 的常规运行模式；`simple` 模式拒绝创建或绑定 composite 分组。管理员应先准备可用的 OpenAI、Anthropic 账号，并核对上游模型映射和调度状态。

例如，`101`、`102` 分别代表已核验的 OpenAI 与 Anthropic 来源分组 ID。管理员使用自己的受保护管理入口向 `POST /api/v1/admin/groups` 提交以下请求体，并保存返回的共享分组 ID；所有 ID 均为示意，不能直接套用到生产：

```json
{
  "name": "CheapBuddy Shared",
  "platform": "composite",
  "rate_multiplier": 1,
  "is_exclusive": true,
  "subscription_type": "standard",
  "copy_accounts_from_group_ids": [101, 102],
  "model_allowlist": {
    "enabled": true,
    "models": ["gpt-6-sol", "claude-sonnet-5-5"]
  }
}
```

`copy_accounts_from_group_ids` 复制账号绑定，仍须确认复制后两类账号均处于 active、可调度且模型映射有效的状态。它不复制来源分组的价格或用户授权。上例倍率 `1` 只是配置结构示例，实际客户价格须在开放用户绑定前确认。

为避免模型归属或别名不明确，可向 `POST /api/v1/admin/groups/{shared_group_id}/composite-routes` 分别提交以下两个请求体；每次只提交一个对象：

```json
{
  "public_model": "gpt-6-sol",
  "match_type": "exact",
  "target_platform": "openai",
  "upstream_model": "gpt-6-sol",
  "endpoint": "any",
  "priority": 100,
  "enabled": true
}
```

```json
{
  "public_model": "claude-sonnet-5-5",
  "match_type": "exact",
  "target_platform": "anthropic",
  "upstream_model": "claude-sonnet-5-5",
  "endpoint": "any",
  "priority": 100,
  "enabled": true
}
```

`endpoint: "any"` 仅表示这条路由的端点匹配范围，不会额外实现上游不支持的协议或能力。扩展模型列表时，应同步更新白名单、路由、上游模型映射和价格。

开放共享分组前，还需完成以下配置与验证：

| 项目 | 配置与验证方式 |
| --- | --- |
| 分组状态与价格 | `GET/PUT /api/v1/admin/groups/{shared_group_id}`；保持 `status: "active"`，核对分组倍率及按 `platform`、`models` 区分的 `model_pricing`。输入、输出、缓存读取、5 分钟与 1 小时缓存写入应分别配置，不能沿用旧分组倍率推断共享价格。 |
| 用户绑定权限 | 专属分组需通过 `GET/PUT /api/v1/admin/users/{user_id}` 将共享 ID 加入用户 `allowed_groups`。更新字段会替换整个列表，先读取并保留原有授权；订阅分组还须具有有效订阅。 |
| 路由预览 | `POST /api/v1/admin/groups/{shared_group_id}/composite-routes/preview`，分别提交 `{"model":"gpt-6-sol","endpoint":"responses"}`、`{"model":"claude-sonnet-5-5","endpoint":"messages"}`，确认目标平台与上游模型。预览成功不代表已有可调度账号。 |
| 前端指定分组 | 将 `VITE_CHEAPBUDDY_SHARED_GROUP_ID` 设置为真实共享 ID 后重新构建；登录用户的 `GET /api/v1/groups/available` 必须能返回该活跃 composite 分组。环境变量不能授予用户权限。 |
| 同一 Key 验收 | 使用同一把共享 Key 获取 `GET /v1/models`，确认全部所选 ID；随后分别实际调用一个 OpenAI 模型及一个 Claude 模型，检查响应、用量记录和扣费归属。只展示模型目录不等于完成生成与计费验收。 |

前端只在用户已有权限内复用或创建共享 Key。服务端没有可用 composite 分组、模型不全或用户无绑定权限时，应先修复服务端配置；旧单平台 Key 与媒体授权保持原合同。Relay 继续透传请求，由 Sub2API 负责模型路由、授权和文本计费。

## 2. 两种任选协议与客户端边界

六个模型提供 **Anthropic 原生**与 **OpenAI-compatible** 两种任选接入方式。按客户端能力选择一种，不要求同一次推理走两遍；Chat Completions 和 Responses 是兼容类别中的接口，不是第三种协议，也不要求同时调用。

| 客户端 | 请求路径 | Claude 请求的处理方式 |
| --- | --- | --- |
| WorkBuddy | `POST /v1/chat/completions` | Sub2API 提供已有 Chat Completions 转换能力 |
| Claude Code | `POST /v1/messages` | 原生 Anthropic Messages；环境变量 Base URL 使用根地址 |
| OpenCode | `POST /v1/messages` 或 `POST /v1/chat/completions` | 原生模式混选时生成 Anthropic 与 OpenAI 两个适配器，共用同一 Key 和 Base URL；兼容模式使用 Chat 配置 |
| Codex | `POST /v1/responses`，`wire_api = "responses"` | Sub2API 提供已有 Responses 转换能力；不是原生 Anthropic Responses |

Relay 只做 HTTP 透传，不解析、重写或重新序列化 Anthropic 业务内容；Sub2API 负责原生语义、协议转换、鉴权、模型路由、故障转移和文本计费。Messages 的多轮 / system、工具、图片输入、Thinking 与缓存按 Sub2API 实际支持透传，不由 Relay 独立实现或修复。

协议接入不等于官方 SDK 的所有平台特性都可用。首版不包含 **Batch、Files、Admin**；HTTP Responses 兼容也不表示原生 Responses WebSocket 或全部 OpenAI 特性可用。未知字段、上游错误和 SSE 事件不由 Relay 改写；具体能力及响应以 Sub2API 的对应协议合同为准。

OpenCode 使用单数 `provider`，以及 `npm`、`options` 字段。不要使用旧的 `providers` / `package` / `settings` 配置格式。使用配置中心生成的对应协议配置，合并前备份原文件，保留已有 Provider、权限和其他无关设置。

## 3. Claude Code 原生配置

Claude Code 原生配置示例使用根地址 `ANTHROPIC_BASE_URL=https://api.cheapbuddy.cc`，由客户端拼接请求路径；`ANTHROPIC_AUTH_TOKEN` 填写具备 Claude 权限的 CheapBuddy Shared Key。已有根地址或 `/v1` 入口形式由网关兼容，不需要为 Claude 修改现有 Base URL；Claude Code 配置生成器会保留用户提供的 URL。

Windows PowerShell：

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.cheapbuddy.cc"
$env:ANTHROPIC_AUTH_TOKEN = $env:CHEAPBUDDY_API_KEY
$env:ANTHROPIC_MODEL = "claude-sonnet-5-5"
claude
```

macOS / Linux：

```bash
export ANTHROPIC_BASE_URL="https://api.cheapbuddy.cc"
export ANTHROPIC_AUTH_TOKEN="$CHEAPBUDDY_API_KEY"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
claude
```

以上命令在已设置 `CHEAPBUDDY_API_KEY` 且已安装 Claude Code 的前提下使用。也可从配置中心生成 `~/.claude/settings.json` 后合并到现有用户配置。不要同时保留指向其他服务的冲突配置，不要把包含 Key 的文件提交到 Git 或公开工单。

## 4. 官方 Python / TypeScript SDK

以下示例使用已安装的官方 SDK，并从本地环境读取具备 Claude 权限的 CheapBuddy Shared Key。这里只演示 Messages，不代表 SDK 的 Batch / Files / Admin 等平台功能也获支持。

Python（`anthropic`）：

```python
import os
import anthropic

client = anthropic.Anthropic(
    api_key=os.environ["CHEAPBUDDY_API_KEY"],
    base_url="https://api.cheapbuddy.cc",
)
message = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello"}],
)
print(message.content)
```

TypeScript（`@anthropic-ai/sdk`）：

```typescript
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.CHEAPBUDDY_API_KEY;
if (!apiKey) throw new Error('Set CHEAPBUDDY_API_KEY locally first');
const client = new Anthropic({
  apiKey,
  baseURL: 'https://api.cheapbuddy.cc',
});
const message = await client.messages.create({
  model: 'claude-sonnet-5-5',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(message.content);
```

OpenAI-compatible 客户端同样保留 Base URL（根地址或 `/v1` 形式），并使用同一把 CheapBuddy Shared Key 调用已授权 OpenAI 或 Claude 模型的 Chat Completions 或 Responses。原生与兼容协议不要求准备两套凭据。媒体模型仍需服务端单独授予媒体权限；文本模型混选不会自动开放媒体访问。

## 5. 原生 API、鉴权与 Token 计数

Claude 原生请求可以使用 `x-api-key: <CheapBuddy Shared API Key>` 或 `Authorization: Bearer <CheapBuddy Shared API Key>`。任选一种认证方式，避免同时发送冲突凭据；原生请求还应携带 `anthropic-version: 2023-06-01`。SDK 所需的版本 / Beta 头由 HTTP 层转发，Sub2API 决定其实际语义与支持范围。

| 接口 | 用途 |
| --- | --- |
| `GET /v1/models` | 原生授权模型列表；保留 Sub2API 响应 |
| `GET /v1/models/{model_id}` | 原生单模型详情；保留 Sub2API 响应 |
| `POST /v1/messages` | 原生消息生成，支持同步 JSON 与 SSE |
| `POST /v1/messages/count_tokens` | 原生输入 Token 计数；不是最终账单 |

最小消息请求（Bash）：

```bash
curl https://api.cheapbuddy.cc/v1/messages \
  -H "x-api-key: $CHEAPBUDDY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":256,"messages":[{"role":"user","content":"Explain sticky sessions in one sentence."}]}'
```

需要流式文本时，使用 `curl -N` 并在 Messages 请求体中增加 `"stream": true`。Relay 不缓冲完整响应后再输出，也不重建 SSE 事件；不要在已经收到部分输出后盲目重放请求。

Token 计数与模型详情使用同一把共享 Key：

```bash
curl https://api.cheapbuddy.cc/v1/messages/count_tokens \
  -H "x-api-key: $CHEAPBUDDY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-5-5","messages":[{"role":"user","content":"Hello"}]}'

curl https://api.cheapbuddy.cc/v1/models/claude-sonnet-5-5 \
  -H "x-api-key: $CHEAPBUDDY_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

输入 Token 数不能代替最终生成请求的输出、缓存用量与账单。

## 6. Claude 官方参考价与分组计费

单位为 **USD / MTok（每百万 Token）**。下表是 Anthropic 官方 Token 参考价，用于识别输入、输出和缓存类别；它不是所有 CheapBuddy 分组的最终客户价格。最终扣费沿用请求所属 Sub2API 分组的倍率、渠道模型价格、账号统计规则和用户覆盖，不由 Relay 或客户端再叠加固定 Claude 倍率。

| 模型 ID | 输入 | 输出 | 缓存读取 | 5 分钟缓存写入 | 1 小时缓存写入 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `claude-fable-5` | 10 | 50 | 1 | 12.5 | 20 |
| `claude-fable-5-1` | 10 | 50 | 0.25 | 12.5 | 20 |
| `claude-opus-5` | 5 | 25 | 0.5 | 6.25 | 10 |
| `claude-opus-5-5` | 4 | 20 | 0.2 | 5 | 8 |
| `claude-sonnet-5` | 2 | 10 | 0.2 | 2.5 | 4 |
| `claude-sonnet-5-5` | 2 | 10 | 0.1 | 2.5 | 4 |

价格来源：[Anthropic 官方 Claude 定价](https://platform.claude.com/docs/en/about-claude/pricing)，核对日期为 **2026-10-13**。Sonnet 5.5 的官方缓存读取参考价为 **$0.10 / MTok**；实际扣费请以当前 Key 所属分组账单为准。

输入、输出、缓存读取、5 分钟缓存写入、1 小时缓存写入是五种独立用量类别，不能直接套用普通输入价；是否产生缓存用量以实际请求为准。最终账单按实际 Token 分类、请求所属分组和用量结算，本文不承诺额外 OpenAI 功能或其他计费模式的完整兼容。

## 7. 有序回退、粘性会话与排查

稳定通道的账户调度、有序回退、粘性会话和文本计费由 Sub2API 负责；Relay 不做业务请求重放或独立账户切层。这有助于降低中断，但**不是 100% 可用性、无失败或延迟 SLA 保证**。

- **共享 Key 或所选模型验证失败**：确认 Key 及所属 composite 分组均有效，用户具有绑定权限，组内有可调度的 OpenAI 与 Anthropic 账号；再检查所选模型的白名单、路由、模型映射、额度、到期、封禁和余额。缺少任一所选模型时配置中心会阻止导出，不会另换 Key。旧 OpenAI 单平台 Key 不会自动获得 Claude 权限；请服务端按第 1.1 节配置共享分组。
- **Claude Code 路径错误**：以根地址示例核对客户端实际拼接的路径，并检查旧配置是否覆盖环境变量；不要将模型路径写进 Base URL，也不要默认更换 Key。
- **协议或功能不兼容**：对照上面的客户端表；Codex 的 Claude 请求走 HTTP Responses 转换，不走原生 Responses WebSocket。
- **请求超时或失败**：保留不含凭据的错误信息并检查账户用量；不要无限重试，尤其在已经返回部分输出时。
- **准备分享工作流或配置**：移除 API Key。现有图片与视频的素材、任务轮询和下载流程不变，参见 [媒体 API 文档](https://cheapbuddy.cc/api-docs/) 与 [ComfyUI 指南](https://cheapbuddy.cc/comfyui/)。
