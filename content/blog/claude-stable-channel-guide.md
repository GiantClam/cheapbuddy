---
slug: claude-stable-channel-guide
category: BUILD GUIDE
date: 2026-10-13
readTime: 7
accent: blue
title: Claude 分组 Key 接入：原生与兼容协议任选其一
title_en: Use a Claude-group key: choose native or compatible access
excerpt: 保留现有 CheapBuddy 入口和 API Key，在已授权分组内接入六个 Claude 模型；含 Claude Code 配置、原生接口和分组计费说明。
excerpt_en: Keep your CheapBuddy endpoint and API key for six Claude models in an authorized group, with Claude Code setup, native endpoints, and group-based billing notes.
---

<!-- zh -->
## 保留入口，使用匹配的分组 Key

继续使用 `https://api.cheapbuddy.cc` 和同一个 USD 钱包，但普通 CheapBuddy API Key 只绑定一个 Sub2API 分组。Claude 必须使用已授权的 Claude 分组 Key；配置中心会优先复用已有匹配 Key，没有时创建一把 Claude 分组 Key。OpenAI/媒体继续使用对应分组 Key。Anthropic 与 OpenAI-compatible 是同一 Claude 分组的两种协议，不需要为协议各建一把 Key；模型权限与最终扣费由请求所属分组决定。

统一接入不会解除显式模型限制、额度、到期、封禁或余额检查。如果 OpenAI 分组 Key 看不到 Claude，应在配置中心生成/选择 Claude 分组 Key，而不是反复重试同一把 Key。以下为接入合同和配置示例，不作为生产部署或所有客户端已完成验收的证明。

## 选一种协议，不要把同一请求发两遍

| 协议 | 接口与客户端 |
| --- | --- |
| Anthropic 原生 | Messages；Claude Code、官方 Python / TypeScript SDK，或 OpenCode 原生配置 |
| OpenAI-compatible | 既有 Chat Completions 或 Responses；WorkBuddy / Chat、OpenCode / Chat、Codex / Responses |

两种协议任选其一。Chat Completions 与 Responses 是兼容类别中的接口，不是第三种协议，也不要求同时使用。同一模型的权限和请求所属分组计费不随选择的协议改变。

Relay 只做 HTTP 透传；Sub2API 负责业务语义、必要转换、鉴权、模型路由、故障转移和文本计费。原生响应、上游错误与 SSE 事件由 Sub2API 决定，Relay 不再解析或重建它们。现有根地址或 `/v1` Base URL 都可保留，无需 strip-v1 或更换 URL。SDK 有的追加 `/v1/messages`，有的（如 OpenCode 的 Anthropic SDK）追加 `/messages`；Relay 兼容安全 SDK 路径别名与重复 `/v1` 形式（如 `/v1/v1/messages`）。下文是规范 HTTP / 根地址配置示例，不是迁移要求；Claude Code 配置生成器保留用户提供的 URL。

## Claude Code 使用根 Base URL 和 Claude 分组 Key

在本地设置 `CHEAPBUDDY_API_KEY` 为 Claude 分组 Key。已安装 Claude Code 时，PowerShell 配置示例为：

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.cheapbuddy.cc"
$env:ANTHROPIC_AUTH_TOKEN = $env:CHEAPBUDDY_API_KEY
$env:ANTHROPIC_MODEL = "claude-sonnet-5-5"
claude
```

macOS / Linux 使用相同入口和凭据：

```bash
export ANTHROPIC_BASE_URL="https://api.cheapbuddy.cc"
export ANTHROPIC_AUTH_TOKEN="$CHEAPBUDDY_API_KEY"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
claude
```

WorkBuddy 继续使用 Chat Completions，OpenCode 可选择原生或兼容配置，Codex 继续使用 `wire_api = "responses"` 的 HTTP 接口。选择 Claude 时使用 Claude 分组 Key；如果还要访问 OpenAI/媒体模型，保留对应分组的另一把 Key。备份并合并已有配置，不覆盖其他 Provider 或权限设置，不把带 Key 的文件公开分享。

## 原生 API 的四个接口

| 接口 | 用途 |
| --- | --- |
| `POST /v1/messages` | 同步 JSON 或 SSE 消息生成 |
| `POST /v1/messages/count_tokens` | 输入 Token 计数 |
| `GET /v1/models` | 当前 Key 获准访问的原生模型列表 |
| `GET /v1/models/{model_id}` | 原生模型详情 |

原生请求使用 Claude 分组 Key 的 `x-api-key` 或 Bearer 认证，任选一种，不混用冲突凭据。最小 Messages 示例：

```bash
curl https://api.cheapbuddy.cc/v1/messages \
  -H "x-api-key: $CHEAPBUDDY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

需要 SSE 时使用 `curl -N`，并在请求体增加 `"stream": true`。计数接口提交 `model`、`messages` 及需要计数的原生输入字段；输入计数不等于最终生成请求的账单。原生模型列表 / 详情直接沿用 Sub2API，不混入媒体记录或补造能力；既有兼容聚合目录保持原合同。

## 六个模型与官方参考价

单位为 **USD / MTok（每百万 Token）**。下表是 Anthropic 官方参考价，不是所有 CheapBuddy 分组的最终客户价格。最终扣费沿用请求所属 Sub2API 分组的倍率、渠道价格、账号统计规则和用户配置，Relay 不再叠加固定 Claude 倍率。

| 模型 ID | 输入 | 输出 | 缓存读取 |
| --- | ---: | ---: | ---: |
| `claude-fable-5` | 10 | 50 | 1 |
| `claude-fable-5-1` | 10 | 50 | 0.25 |
| `claude-opus-5` | 5 | 25 | 0.5 |
| `claude-opus-5-5` | 4 | 20 | 0.2 |
| `claude-sonnet-5` | 2 | 10 | 0.2 |
| `claude-sonnet-5-5` | 2 | 10 | 0.1 |

价格来源：[Claude 官方定价](https://platform.claude.com/docs/en/about-claude/pricing)，核对日期为 **2026-10-13**。缓存读取与缓存写入是不同用量类别，不能都套用普通输入价；最终账单按实际 Token 分类、请求所属分组与用量结算。

## 支持边界与媒体工作流

Messages 的多轮 / system、工具、图片输入、Thinking 和缓存按 Sub2API 实际支持透传，不由 Relay 独立实现或修复。官方 SDK 能连接 Messages，不等于所有平台功能都被支持：首版排除 **Batch、Files、Admin**，HTTP Responses 兼容也不代表原生 Responses WebSocket 可用。官方价格来源只用于价格核对，不是 CheapBuddy 全功能兼容或可用性证明。

有序回退和粘性会话由 Sub2API 负责，不是 100% 可用性或无失败 SLA。请求超时、取消或已经返回部分流式输出时，不要无限重试；保留不含凭据的错误和请求标识，核对账户用量后再排查。

图片、视频与 ComfyUI 仍使用具备媒体权限的现有 Key，素材字段、任务轮询和结果下载流程不变。继续参照 [API 文档](/api-docs/) 与 [ComfyUI 指南](/comfyui/)，不要把媒体任务发送到 Claude Messages。

<!-- en -->
## Keep the endpoint and use a matching group key

Keep using `https://api.cheapbuddy.cc` and the same USD wallet, but each ordinary CheapBuddy API key is bound to one Sub2API group. Claude requests require an authorized Claude-group key. The config center reuses one when available or creates it when needed; OpenAI and media requests keep their corresponding group key. Native Anthropic and OpenAI-compatible are two protocols for the same Claude group, so they do not require separate protocol-specific keys. Explicit model restrictions, quota, expiry, disabled status, and balance checks remain effective.

This article documents the access contract and examples; it is not evidence of production deployment or completed acceptance for every client.

## Choose one protocol

| Protocol | Interfaces and clients |
| --- | --- |
| Native Anthropic | Messages; Claude Code, official Python / TypeScript SDKs, or native OpenCode configuration |
| OpenAI-compatible | Existing Chat Completions or Responses; WorkBuddy / Chat, OpenCode / Chat, Codex / Responses |

Choose either protocol for an inference. Chat Completions and Responses belong to the compatible category, not a third protocol or a requirement to call both. Permissions and the selected Sub2API group's billing configuration do not change with that choice.

The Relay forwards HTTP only. Sub2API owns semantics, conversion, authentication, model routing, failover, and text billing. Native responses, errors, and SSE events are not reconstructed by the Relay. Keep your existing root or `/v1` Base URL; there is no requirement to strip `/v1` or change the URL. SDKs append either `/v1/messages` or `/messages` (for example, OpenCode’s Anthropic SDK). The Relay supports safe SDK aliases and repeated `/v1` forms such as `/v1/v1/messages`. Canonical HTTP examples do not require client migration; the Claude Code generator preserves your provided URL.

## Configure Claude Code with a Claude-group key

With Claude Code installed and a Claude-group key stored locally as `CHEAPBUDDY_API_KEY`:

```bash
export ANTHROPIC_BASE_URL="https://api.cheapbuddy.cc"
export ANTHROPIC_AUTH_TOKEN="$CHEAPBUDDY_API_KEY"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
claude
```

This native example uses the root Base URL; existing root or `/v1` values remain supported and need not be changed. Do not put a model endpoint in the Base URL. WorkBuddy keeps Chat Completions, OpenCode can choose native or compatible access, and Codex keeps HTTP Responses with `wire_api = "responses"`. Use a separate matching group key when also configuring OpenAI or media models. Back up and merge existing configurations, preserve unrelated providers and permissions, and never share files containing your key.

## Four native endpoints

- `POST /v1/messages`: synchronous JSON or SSE with `stream: true`.
- `POST /v1/messages/count_tokens`: input token counting, not the final bill.
- `GET /v1/models`: native models authorized for the current key.
- `GET /v1/models/{model_id}`: native model details.

Use either `x-api-key` or Bearer authentication with the Claude-group key, plus `anthropic-version: 2023-06-01` for native requests. Do not send conflicting credentials. Native discovery preserves Sub2API’s response without media records or invented capabilities; the existing compatible aggregate catalog retains its contract.

## Six models and official reference rates

**USD / MTok (one million tokens)**. These are Anthropic reference rates, not a universal CheapBuddy customer rate. Final charges follow the request's Sub2API group, channel, account-statistics, and user pricing configuration; the Relay does not add a fixed Claude multiplier.

| Model ID | Input | Output | Cache read |
| --- | ---: | ---: | ---: |
| `claude-fable-5` | 10 | 50 | 1 |
| `claude-fable-5-1` | 10 | 50 | 0.25 |
| `claude-opus-5` | 5 | 25 | 0.5 |
| `claude-opus-5-5` | 4 | 20 | 0.2 |
| `claude-sonnet-5` | 2 | 10 | 0.2 |
| `claude-sonnet-5-5` | 2 | 10 | 0.1 |

Source: [official Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked **October 13, 2026**. Cache reads and writes are different usage categories; final charges follow actual token categories and usage.

## Boundaries, not blanket compatibility

Multi-turn / system input, tools, image input, Thinking, and caching pass through according to Sub2API’s actual support. The Relay does not implement or repair those semantics. SDK connectivity does not promise every platform feature: **Batch, Files, and Admin are excluded**. HTTP Responses compatibility does not imply native Responses WebSocket. The pricing source establishes rates, not CheapBuddy feature parity or uptime.

Sub2API manages fallback and sticky sessions, without a 100% availability or zero-failure SLA. Avoid blind retries after partial streaming output, cancellation, or timeouts. Keep sanitized errors and request identifiers, then check account usage.

Existing image, video, and ComfyUI workflows keep their media-authorized key, input fields, polling, and downloads. Follow the [API reference](/api-docs/) and [ComfyUI guide](/comfyui/); do not submit media jobs to Claude Messages.
