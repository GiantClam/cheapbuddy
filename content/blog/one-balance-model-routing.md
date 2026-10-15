---
slug: one-balance-model-routing
category: PRODUCT NOTES
date: 2026-09-28
readTime: 5
accent: green
title: 为什么一个余额，可以连接这么多模型？
title_en: Why one balance can connect to so many models
excerpt: 一个入口、分组 API Key 与 USD 钱包：Claude 任选原生或兼容协议，权限和计费边界不变。
excerpt_en: One endpoint, matching group keys, and a USD wallet: choose native or compatible Claude access without changing permission or billing boundaries.
---

<!-- zh -->
更新：2026-10-14。入口与 USD 钱包不变，但普通 API Key 只绑定一个 Sub2API 分组；支持 Claude 的分组 Key 可以用 Anthropic 或 OpenAI-compatible 访问六个 Claude 模型，权限与计费继续由请求所属分组决定。配置中心会复用已有匹配 Key，或为目标分组创建新 Key。

## 先把问题拆开

使用多个模型时，真正麻烦的不是发出第一条请求，而是之后的配置同步、Key 管理和费用核对。每个工具都有自己的入口，模型又在持续更新，最后往往是工作流被供应商细节绑住。

CheapBuddy 把这件事拆成三个层：客户端选择体验与协议，Relay 只负责 HTTP 透传，Sub2API 负责文本语义、协议转换、授权、模型路由和计费。媒体的原有任务与结算边界不变。

## 路由层只做一件事

你在 WorkBuddy、Claude Code、OpenCode 或 Codex 中选择模型，客户端继续请求 `https://api.cheapbuddy.cc`。Claude 使用已授权 Claude 分组的 Key，OpenAI/媒体使用对应分组 Key；配置中心会按目标模型分组复用或创建 Key。Claude 提供 Anthropic 原生与 OpenAI-compatible 两种任选协议，协议选择不改变分组；模型发现仍遵守当前 Key 的权限。

Claude Code 使用原生 `/v1/messages`；WorkBuddy 使用 `/v1/chat/completions`，OpenCode 可选原生 Anthropic 或兼容 Chat，Codex 使用 `/v1/responses`。Chat 与 Responses 的已有转换由 Sub2API 处理，不由 Relay 另做适配。它们属于 OpenAI-compatible 类别，不是第三种协议，也不要求同一次推理同时调用。HTTP 文本兼容不表示原生 Responses WebSocket 或所有 SDK 平台特性受支持；Batch、Files、Admin 不在首版范围。

可以保留入口，按客户端能力选择协议与已授权模型。现有根地址或 `/v1` Base URL 无需修改；Relay 兼容不同 SDK 的安全路径别名及重复 `/v1` 形式，Claude Code 配置生成器保留用户提供的 URL。原生模型列表 / 详情直接沿用 Sub2API，不混入媒体记录；既有兼容聚合目录保留原合同。图片和视频任务继续使用具备媒体权限的对应分组 Key，不因新增 Claude 接入而改变素材、轮询和下载流程。

## 共享余额与 Key，保留权限边界

已有 Claude 分组 Key 可以直接访问六个 Claude 模型；没有该分组 Key 时，配置中心会创建一把匹配的 Key。无需为两种协议各建 Key，但 OpenAI/媒体分组 Key 不会自动获得 Claude 权限。显式模型限制、额度、到期、封禁和余额检查仍有效，统一入口不会扩大分组权限。最终扣费沿用请求所属分组的倍率、渠道价格、账号统计规则和用户配置；官网展示的官方 Token 价格只作参考，其他模型既有定价不变。

Claude 稳定通道的有序回退、粘性会话和文本计费由 Sub2API 负责；Relay 不重建 SSE 或重放业务请求。这是降低中断的机制，不是 100% 可用性或无失败保证。具体配置和六个模型的价格见 [Claude 稳定通道指南](/blog/claude-stable-channel-guide)。

## 计费透明，才适合长期使用

共享余额不是订阅额度的替代品，而是一种更直接的用量结算方式。每个模型按实际费率扣除，账户中心展示余额、请求数和 Token 用量。

你可以先用小额余额验证工作流，再决定是否扩展到更多模型。这个顺序把试错成本控制在可见范围内。

<!-- en -->
Updated October 14, 2026. Keep the endpoint and USD wallet, but remember that each ordinary API key belongs to one Sub2API group. A Claude-authorized group key can access six Claude models through either Anthropic or OpenAI-compatible requests; the config center reuses or creates the matching key, while permissions and billing remain group-defined.

## Start by separating the problem

The hard part of using multiple models is not sending the first request. It is keeping configs, keys, and cost tracking in sync afterwards. The client chooses its experience and protocol, the Relay forwards HTTP, and Sub2API owns text semantics, conversion, authorization, routing, and billing. Existing media task and settlement boundaries remain unchanged.

## The routing layer has one job

Choose a model in WorkBuddy, Claude Code, OpenCode, or Codex and keep using `https://api.cheapbuddy.cc`. Use a Claude-group key for Claude and the corresponding group key for OpenAI/media; the config center reuses or creates the key for the selected group. Anthropic and OpenAI-compatible are alternative protocols for Claude, and discovery remains subject to the key’s permissions.

Claude Code uses native `/v1/messages`; WorkBuddy uses `/v1/chat/completions`; OpenCode can choose native Anthropic or compatible Chat; Codex uses `/v1/responses`. Sub2API owns the existing conversion, not a new Relay adapter. Chat and Responses belong to the compatible category, not a third protocol or a requirement to call both. HTTP text compatibility does not imply native Responses WebSocket or every SDK platform feature. Batch, Files, and Admin are outside the first release.

Keep the endpoint, then choose a protocol and authorized model supported by your client. Keep your existing root or `/v1` Base URL without stripping `/v1`. The Relay handles safe SDK aliases and repeated `/v1` forms, and the Claude Code generator preserves the URL you provide. Native discovery preserves Sub2API’s list and detail responses without media records; the existing compatible aggregate catalog retains its contract. Image and video jobs keep using the corresponding media-authorized group key, with unchanged inputs, polling, and downloads.

## One balance and key, preserved permission boundaries

An existing key in a group that admits Claude can access six Claude models without a protocol-specific key. If the account has no Claude-group key, the config center creates one; an OpenAI/media key is not silently widened. Explicit model restrictions, quota, expiry, disabled status, and wallet checks remain effective. Final charges follow the request's Sub2API group, channel, account-statistics, and user pricing configuration. Official token rates shown on the site are references; existing prices for other models do not change.

Sub2API owns Claude account fallback, sticky sessions, and text billing. The Relay does not reconstruct SSE or replay business requests. This reduces interruptions; it is not a 100% availability or zero-failure guarantee. See the [Claude stable channel guide](/blog/claude-stable-channel-guide) for setup and pricing for all six models.

## Transparent billing is what makes it sustainable

A shared balance is a direct usage-based settlement model. Each model is charged at its active rate, while the account center shows balance, requests, and token usage.

Start with a small balance to validate a workflow, then expand to more models. The cost of experimentation stays visible.
