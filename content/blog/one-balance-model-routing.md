---
slug: one-balance-model-routing
category: PRODUCT NOTES
date: 2026-09-28
readTime: 5
accent: green
title: 为什么一个余额，可以连接这么多模型？
title_en: Why one balance can connect to so many models
excerpt: CheapBuddy 把模型选择、路由和计费拆成三个清晰的层，让你可以换模型，而不用换工作流。
excerpt_en: CheapBuddy separates model choice, routing, and billing so you can change models without changing your workflow.
---

<!-- zh -->
## 先把问题拆开

使用多个模型时，真正麻烦的不是发出第一条请求，而是之后的配置同步、Key 管理和费用核对。每个工具都有自己的入口，模型又在持续更新，最后往往是工作流被供应商细节绑住。

CheapBuddy 的做法是把这件事拆成三个层：客户端负责体验，网关负责协议兼容，余额和费率负责结算。每一层都有自己的边界，也可以独立变化。

## 路由层只做一件事

你在 WorkBuddy、Claude Code、OpenCode 或 Codex 中选择模型，客户端把请求发到统一入口。路由层根据模型能力和当前可用性，把请求送到对应的生产通道。

这意味着模型名可以变化，入口和你的本地配置不需要频繁重写。对于图片和视频任务，异步任务状态也沿用同一个 API Key。

## 计费透明，才适合长期使用

共享余额不是订阅额度的替代品，而是一种更直接的用量结算方式。每个模型按实际费率扣除，账户中心展示余额、请求数和 Token 用量。

你可以先用小额余额验证工作流，再决定是否扩展到更多模型。这个顺序把试错成本控制在可见范围内。

<!-- en -->
## Start by separating the problem

The hard part of using multiple models is not sending the first request. It is keeping configs, keys, and cost tracking in sync afterwards. CheapBuddy separates the system into three layers: the client owns the experience, the gateway owns protocol compatibility, and the balance owns settlement.

## The routing layer has one job

You choose a model in WorkBuddy, Claude Code, OpenCode, or Codex, and the client sends the request to one endpoint. The routing layer selects the production channel based on capability and availability.

Model names can change without forcing a rewrite of your local config. Image and video jobs use the same API key and the same account boundary.

## Transparent billing is what makes it sustainable

A shared balance is a direct usage-based settlement model. Each model is charged at its active rate, while the account center shows balance, requests, and token usage.

Start with a small balance to validate a workflow, then expand to more models. The cost of experimentation stays visible.
