# Proposal: Relay 原生 Anthropic 协议支持

**Change ID:** `add-relay-anthropic-protocol`
**Created:** 2026-10-13
**Status:** Implementation Complete
**Completed:** 2026-10-14

## Why

用户明确提出：Relay 支持 Anthropic 协议是独立新需求，必须先完成需求整理，而不是将其简化为模型名称放行或增加一个认证请求头。需要明确目标客户端、协议范围、错误与流式语义及可验证的兼容承诺。

## 已确认的背景

- 用户要求先使用 grill-me 逐项访谈，再以 OpenSpec 整理变更。
- 公共网关为 api.cheapbuddy.cc；文本由 Sub2API 处理，媒体由 NewAPI 处理。
- 线上已有 Claude 稳定通道，三层账号优先级和各组价格配置由 Sub2API 管理；当前 Claude Stable 分组的倍率只是该分组的配置示例，不是全局 Claude 售价规则。
- Sub2API 的生产版本包含 Anthropic Messages，以及 Chat Completions、Responses 到 Anthropic 的服务端转换。转换接口的存在不等于 Relay 完整满足 Anthropic 客户端契约。
- 上轮的本地 Relay 认证、计数路由与元数据初步修改及测试尚未发布；必须依据本提案复核，不视为已批准方案。
- 官网模型信息、配置生成、docs、blogs 的同步更新仍是关联工作，但不能先承诺尚未验证的协议兼容性。

## What Changes

### 已确认需求

Relay 对外提供 Anthropic 协议支持，并遵守现有 API Key 授权、余额和路由隔离边界。

用户已确认：继续使用现有 CheapBuddy Base URL 和现有 CheapBuddy API Key；不要求为 Claude 替换入口、轮换 Key 或另建专用 Key。此约束针对 CheapBuddy 入口与凭据，不是让 Anthropic 官方域名及官方凭据自动改走 CheapBuddy。现有合法入口形式的 SDK 路径拼接差异，由网关兼容合同处理。统一凭据不能绕过用户或 Key 的显式模型权限、额度、到期与封禁规则。

### 已确认的接入范围

在现有 CheapBuddy Base URL / API Key 不变的前提下，原生协议验收已确认覆盖 Claude Code 与 Anthropic 官方 Python / TypeScript SDK。Claude 模型提供两种可任选的接入协议：Anthropic 原生和 OpenAI-compatible。客户端按自身支持的协议选择一种即可，不要求切换到原生 Anthropic，不要求同时调用两种协议，也不要求分别调用 Chat Completions 和 Responses。WorkBuddy、OpenCode、Codex 的相应 Claude 接入继续复用 Sub2API 既有能力。具体客户端版本在实施时核实并记录，不作为需要用户回答的协议事实。

首版接口范围已获用户确认：POST /v1/messages（非流式与 SSE）、POST /v1/messages/count_tokens、GET /v1/models、GET /v1/models/{model_id}。Batch、Files、Admin 等平台 API 不纳入首版。Messages 的多轮 / system、工具调用、图片输入、Thinking 和缓存能力已确认纳入透传验收；行为以 Sub2API 实际支持为准，不由 Relay 二次实现。

## 已确认职责边界

- **Sub2API 是 Anthropic 协议契约的权威。** 请求校验、内容块、Tools、Vision、Thinking、缓存、原生响应 / 错误、账户调度、故障转移和文本计费均归 Sub2API。
- **Relay 只是 HTTP 透传层。** 只做必要的公共路径准入、认证头接入、合法入口路径兼容、安全头处理和流式连接转发；不解析或重新序列化 Anthropic 业务请求，不修复上游不支持的功能，不改写上游业务响应、错误或 SSE。
- **原生模型发现也对齐 Sub2API。** 原生请求不得进入现有 OpenAI / NewAPI 聚合目录的混合、能力补全或格式重建流程；旧聚合目录仍保留自身既有合同。两种入口的 HTTP 识别方式通过现有客户端和源码确定，而不是让用户决定技术细节。
- **统一 Key 在 Sub2API 侧落实授权 / 路由 / 定价策略。** Relay 不代客户换成另一个业务 Key，不注入私有供应商凭据，也不按 Claude 内容块另做扣费。Claude 是否可用、可用哪些模型以及最终价格，均以请求所使用的 Sub2API 分组、渠道、账号和用户价格配置为准；Relay 不把 Claude 自动加入默认 OpenAI 分组，也不覆盖现有分组授权。显式受限 Key、额度、有效期、封禁和余额检查仍按既有策略执行；此策略由 Sub2API 落实，不由 Relay 绕过。
- **验收重点是透传不失真。** 对比直接访问 Sub2API 与经过 Relay 的请求内容、响应状态 / 业务内容和 SSE 事件；覆盖未知字段、工具往返、图片、Thinking 签名、缓存、上游错误、取消和连接中断。HTTP 分块 / Hop-by-hop 头等传输层必要处理不视为业务协议改写。


### 已确认的模型访问范围

支持 Claude 的 Sub2API 分组中的现有有效 Key，无需轮换或另建协议专用 Key，即可按该分组授权发现并调用以下 Claude 模型：

- `claude-fable-5`
- `claude-fable-5-1`
- `claude-opus-5`
- `claude-opus-5-5`
- `claude-sonnet-5`
- `claude-sonnet-5-5`

Relay 不扩大分组授权：未配置 Claude 的分组不会因为使用 Anthropic 协议或 OpenAI-compatible 协议而自动获得 Claude。受限、过期、禁用、余额不足或额度耗尽的凭据仍受相应控制。最终扣费沿用请求所属 Sub2API 分组的倍率、渠道模型价格、账号统计规则和用户覆盖；当前 Claude Stable 分组的 1.1 倍仅表示该分组的现行配置，不能推广为所有分组的固定价格。底层账号优先级和成本统计仍归 Sub2API 管理。

## 已确认的两种可任选接入协议

**准确表述：同一现有 CheapBuddy Base URL / API Key，客户端可按自身支持的协议，选择 Anthropic 或 OpenAI-compatible 来使用 Claude 模型；Relay 将请求直接转发给 Sub2API。**

| 协议类别 | 使用方式 | 责任边界 |
|---|---|---|
| Anthropic 原生 | 使用 Messages；首版含计数、模型列表 / 详情及非流式 / SSE | Relay HTTP 透传，Sub2API 提供对应原生契约 |
| OpenAI-compatible | 使用 Sub2API 已有的兼容 API，例如 Chat Completions 或 Responses；按客户端支持选择接口 | Relay 转发，Sub2API 提供已有兼容能力及其内部必要适配 |

Chat Completions 与 Responses 是 OpenAI-compatible 类别中的接口，不是额外的第三种协议，也不是客户端必须同时使用的接口。两种协议是可选接入方式，不要求同一调用走两遍、不要求客户端生成两套凭据。选择协议不会绕过请求所属分组的权限或改变该分组的计费配置；两种协议都由同版本 Sub2API 负责业务处理和计费。协议能力与同版本 Sub2API 对齐，Relay 不二次实现、补全或转换业务协议。先前已确认的客户端验收及既有功能回归用于验证接入方式，不构成用户必须同时使用所有客户端或接口的条件。

## Scope

### 确定纳入

- 需求访谈、已确认决策与未决问题记录。
- 同一 CheapBuddy Base URL、同一现有 API Key 的多协议接入约束。
- Messages 非流式与 SSE、Token 计数、模型列表 / 详情这四个首版接口。
- 六个 Claude 模型可选择 Anthropic 或 OpenAI-compatible 接入；OpenAI-compatible 接口复用 Sub2API 既有能力，不在 Relay 新增转换器。
- Anthropic 原生协议与现有 OpenAI 兼容接口的边界定义。
- 客户端可执行验收标准及受控上线、回退要求。

### 实施前待核实的技术事实

- 不再逐项设计 Messages 业务语义；以 Sub2API 同版本接口为验收基线，仅核对透传是否保留全部内容及未知字段。
- 原生入口与既有聚合目录的 HTTP 分流事实及客户端 / SDK 具体版本核实；客户端范围、普通 Key 的 Claude 访问范围均已确认。模型发现和计数的业务响应直接沿用 Sub2API。
- API Key 认证、版本 / Beta 请求头、HTTP 错误和 SSE 错误。
- 超时、取消、流式中断、重试及三层故障转移的安全边界。
- 客户端版本、覆盖模型、并发与性能目标。

### 不自动扩展

Batch、Files、Admin 已明确排除在首版之外。任意上游地址代理、WebSocket、新钱包或新计费公式也不由本需求自动授权；如需纳入，应在访谈中单独决定。

## Impact

| 组件 | 可能影响 | 当前结论 |
|---|---|---|
| Relay | 入口认证头、路径兼容、原生直通与流式传输 | 不新增业务协议解析器，不改写上游错误或 SSE |
| Sub2API | 原生协议、统一 Key 授权 / 模型路由与计费 | 协议权威；优先复用现有分组和配置能力 |
| NewAPI | 媒体路由与计费隔离 | 不将 Claude 加入媒体白名单 |
| 官网 / 配置生成 | 端点、认证、统一 Key 与兼容说明 | 不再要求为 Claude 另建分组 Key，依据最终协议合同同步 |
| docs / blogs | 示例、支持范围与限制 | 不发布未验证的兼容承诺 |
| 数据库 / 余额 | 可能的测试与关联字段 | 不预设 schema 变更，不调整客户余额 |

## Success Criteria

- [x] 用户确认现有 CheapBuddy Base URL 和 API Key 均保持不变。
- [x] 用户确认四个首版推理 / 发现接口与 Batch / Files / Admin 的排除边界。
- [x] 用户确认 Claude 的 Anthropic / OpenAI-compatible 两种可任选接入方式；客户端验收不等于强制使用多种协议 / 接口。
- [x] 用户确认 Relay 仅透传，Anthropic 业务能力与 Sub2API 对齐。
- [x] 用户确认 Claude 访问和计费沿用请求所属 Sub2API 分组；Relay 不自动扩展默认 OpenAI 分组的模型授权或覆盖分组价格。
- [x] Relay 原生端点及 Claude 的 Chat Completions / Responses 转发边界通过本地合同测试；业务语义继续由同版本 Sub2API 提供。
- [x] 配置生成器覆盖 Claude Code、官方 Anthropic 接入形态、OpenCode、WorkBuddy 和 Codex 的协议矩阵；未使用客户资金做在线 SDK 调用。
- [x] OpenAI 与媒体通道行为不回归，Relay 不承担 Claude 业务计费或权限扩展。
- [x] 官网配置、文档和博客与分组授权、双协议接入矩阵一致。
- [x] 访谈达到共同理解并获用户确认后进入实现 / 发布。

## Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| 仅认证成功却被误称原生透传正常 | 比较同版本 Sub2API 的实际业务请求 / 响应及流式事件 |
| 原生响应进入旧目录聚合或钱包错误改写流程 | 原生直通保持 Sub2API 合同；旧聚合 / 改写仅限旧入口 |
| 流式输出后重试导致重复内容或重复计费 | 明确输出前 / 输出后故障转移与取消规则 |
| 将 Claude 放入媒体白名单 | 保持文本与媒体调度和结算隔离 |
| 既有本地尝试被直接上线 | 全部视为未批准的初步改动，规格确定后复核 |

## Decision Log

| 编号 | 决策 | 状态 |
|---|---|---|
| D1 | 现有 CheapBuddy Base URL 与 API Key 均不变，不为 Claude 更换入口、轮换或另建 Key | 已确认（2026-10-13） |
| D1a | 客户端：Claude Code、官方 Python / TypeScript SDK、WorkBuddy、OpenCode、Codex | 范围已确认；具体可用版本在实施时核实并记录 |
| D2 | 首版接口：Messages（非流式 / SSE）、Token 计数、模型列表 / 详情；排除 Batch / Files / Admin | 已确认（2026-10-13） |
| D2a | Messages 常用能力：多轮 / system、工具、图片、Thinking、缓存；以 Sub2API 实际支持为准 | 已确认（2026-10-13）；Relay 不独立实现或修复这些能力 |
| D3 | 原生请求、发现、上游错误及 SSE 内容沿用 Sub2API；入口 HTTP 识别和连接失败处理单独核对 | 已由 Relay 合同测试与线上无效凭据检查核实 |
| D4 | 账户切层与文本计费归 Sub2API，Relay 不做业务请求重放或 SSE 重建 | 已由透传、SSE 取消和分组计费边界测试核实 |
| D5 | 同版本 Sub2API 为基线，流式透传不缓冲完成响应，生产 Relay / 官网 / 配置生成 / docs / blogs 按原任务更新 | 已完成本地验证、Railway 发布和线上页面检查 |
| D6 | Relay 只是 HTTP 透传层，不理解 / 重写 Anthropic 业务协议内容 | 已确认（2026-10-13） |
| D7 | Claude 只在 Sub2API 已授权的分组内提供两种协议访问；最终计费沿用请求所属分组配置，Relay 不自动扩展默认 OpenAI 分组或设置全局 Claude 倍率 | 已确认并修正（2026-10-14） |
| D8 | 只有两种可任选接入协议：Anthropic 和 OpenAI-compatible，均可使用 Claude；不要求客户端同时使用两种协议或多个接口 | 已确认并修正措辞（2026-10-13）；Chat / Responses 是兼容类别中的既有接口 |
