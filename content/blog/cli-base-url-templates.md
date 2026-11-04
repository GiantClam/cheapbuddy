---
slug: cli-base-url-templates
category: BUILD GUIDE
date: 2026-11-03
readTime: 4
accent: blue
title: Claude Code、Codex、OpenCode、WorkBuddy 的 Base URL 对照
title_en: Base URL templates for Claude Code, Codex, OpenCode, and WorkBuddy
excerpt: 配置中心默认写出 https://api.cheapbuddy.cc/v1。对照 Chat Completions、Responses 和 Anthropic Messages 各自该停在哪一层，并链到 dsh 的填法。
excerpt_en: The config center writes https://api.cheapbuddy.cc/v1 by default. See where Chat Completions, Responses, and Anthropic Messages should stop, then jump to the dsh setup.
---

<!-- zh -->
## 先记生产地址

CheapBuddy 的生产 API 根地址是 `https://api.cheapbuddy.cc`。首页配置中心当前默认把 OpenAI-compatible 客户端的 Base URL 写成 `https://api.cheapbuddy.cc/v1`。登录后在 [配置中心](/#generator) 复制统一 Key，不要把 Key 放进公开文件。DeepSeek Harness 的填法单独写在 [dsh 接入说明](/blog/deepseek-harness-cheapbuddy)。

## 四个客户端各停在哪一层

| 客户端 | 字段 | 配置中心写出的值 |
| --- | --- | --- |
| WorkBuddy | 每个模型的 `url` | `https://api.cheapbuddy.cc/v1/chat/completions` |
| OpenCode | `options.baseURL` | `https://api.cheapbuddy.cc/v1` |
| Codex | `base_url` | `https://api.cheapbuddy.cc/v1`，并保留 `wire_api = "responses"` |
| Claude Code | `ANTHROPIC_BASE_URL` | 同一默认值 `https://api.cheapbuddy.cc/v1`；根地址 `https://api.cheapbuddy.cc` 也可继续使用 |

WorkBuddy 直接请求 Chat Completions。OpenCode 的兼容协议使用 `/v1`，由客户端再拼接 `/chat/completions`。Codex 也使用 `/v1`，但走 Responses，不要改成 Chat Completions 路径。Claude Code 走 Anthropic Messages，不要在 `ANTHROPIC_BASE_URL` 后面再加 `/chat/completions` 或 `/v1/messages`。根地址和以 `/v1` 结尾的地址都可以保留；Relay 接受 SDK 拼接出来的安全路径别名。

OpenAI 系模型（含 `deepseek-flash`）和 Claude 在 WorkBuddy、OpenCode、Codex 里可以共用这一把统一 Key 和这一份 USD 余额，前提是 Key 的复合分组已经包含对应模型。Claude Code 的选择器只放 Claude 模型。六个 Claude 公开 ID 见 [Claude 接入指南](/blog/claude-stable-channel-guide)。

## dsh 不要照搬 Claude Code 的根地址

dsh 的 Custom model API 在协议为 OpenAI Chat Completions 时，Base URL 填 `https://api.cheapbuddy.cc/v1`，和 OpenCode 同层，而不是 WorkBuddy 那条已经带 `/chat/completions` 的完整 URL。步骤、模型 ID 和 401 对照见 [DeepSeek Harness（dsh）接 CheapBuddy](/blog/deepseek-harness-cheapbuddy)。

<!-- en -->
## Start from the production host

The CheapBuddy API root is `https://api.cheapbuddy.cc`. The homepage config center currently writes `https://api.cheapbuddy.cc/v1` for OpenAI-compatible clients. Copy the shared key from the [config center](/#generator) and keep it out of public files. DeepSeek Harness has its own note: [connect dsh to CheapBuddy](/blog/deepseek-harness-cheapbuddy).

## Where each client should stop

| Client | Field | Value the config center writes |
| --- | --- | --- |
| WorkBuddy | each model `url` | `https://api.cheapbuddy.cc/v1/chat/completions` |
| OpenCode | `options.baseURL` | `https://api.cheapbuddy.cc/v1` |
| Codex | `base_url` | `https://api.cheapbuddy.cc/v1`, with `wire_api = "responses"` |
| Claude Code | `ANTHROPIC_BASE_URL` | the same default, `https://api.cheapbuddy.cc/v1`; the root `https://api.cheapbuddy.cc` can stay in existing setups |

WorkBuddy calls Chat Completions directly. OpenCode’s compatible provider uses `/v1` and appends `/chat/completions`. Codex also uses `/v1`, but through Responses; do not switch it to the Chat Completions path. Claude Code uses Anthropic Messages. Do not append `/chat/completions` or `/v1/messages` to `ANTHROPIC_BASE_URL`. Both the root and a `/v1` base remain valid; the Relay accepts the safe path aliases SDKs append.

OpenAI-family models, including `deepseek-flash`, and Claude can share this key and USD balance in WorkBuddy, OpenCode, and Codex when the composite group includes those models. The Claude Code picker lists Claude models only. The six public IDs are in the [Claude access guide](/blog/claude-stable-channel-guide).

## Do not copy the Claude Code root into dsh Chat Completions

For a dsh custom provider on OpenAI Chat Completions, set Base URL to `https://api.cheapbuddy.cc/v1`, the same layer as OpenCode, not WorkBuddy’s full `/chat/completions` URL. Steps, model IDs, and the 401 checks are in [Connect DeepSeek Harness (dsh) to CheapBuddy](/blog/deepseek-harness-cheapbuddy).
