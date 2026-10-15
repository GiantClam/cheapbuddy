# Claude 模型与 H3 MCP 需求研究

日期：2026-10-10

## 执行摘要

CheapBuddy 应当上架 Claude 模型，并把现有 MiniMax-H3 视频能力包装成 MCP 工具，但两者必须被定义为两个互补层：

- Claude Opus 5.5 / Sonnet 5.5 是规划、编码、脚本、分镜和工作流编排模型。
- MiniMax-H3 是异步视频生成执行器。
- CheapBuddy 的产品卖点不是“Claude 会生成视频”，而是“用一个账户、一个余额和一套工具，让 Claude 规划并调用 H3 完成视频”。

最近的 Opus 5.5 视频趋势提供了明确的分发机会，但需要准确理解。`awesome-opus5-5-videos` 在 2026-10-08 已收录 513 个案例，公开页面显示约 3.4k stars；其 README 明确说明，这些视频主要是 Opus 5.5 编写 HTML、Canvas、SVG、Three.js 等动画代码后再渲染或录制，并不是 Claude 直接输出视频文件。这个信号证明用户愿意把 Claude 当作“创意工程师和动画导演”，也暴露了生成式镜头、人物、产品演示和参考素材视频仍缺少统一工具入口的空白。

建议采用以下产品定义：

> CheapBuddy Video Studio for Agents：Claude 负责脚本、分镜、提示词和迭代决策，CheapBuddy H3 MCP 负责生成、查询和交付视频资产。

优先级建议：

1. 首发 Claude Opus 5.5 与 Claude Sonnet 5.5，Haiku 5.5 作为后续低成本路由模型。
2. 先发布本地 stdio MCP，面向 Claude Code、Codex、OpenCode 和其他桌面 MCP 客户端。
3. MCP v1 只复用现有 CheapBuddy API，不直连 Qingyan/MiniMax，不新增第二套计费或任务系统。
4. v1 提供报价、提交、查询和结果获取；在后端公开取消语义完成前，不提供“取消生成”工具。
5. 通过真实 Claude Code + H3 的端到端样例销售，不以单独的模型折扣作为主要定位。

## 1. 市场与用户信号

### 1.1 观察到的趋势

公开案例库 `awesome-opus5-5-videos` 提供了一个有价值但非总体市场规模的方向性信号：

- 513 个收录案例与提示词。
- 最新一批在 2026-10-08 增加 38 个案例，主要是 motion graphics 和 explainers。
- 高亮内容包含 58 个 motion graphics、16 个 explainers、14 个 3D scenes、12 个 games & interactive。
- 工作流核心是让 Opus 5.5 生成可运行的动画代码，再渲染或录制。

来源：[Awesome Opus 5.5 Videos](https://github.com/yihui-dev/awesome-opus5-5-videos)

这说明需求并非泛化的“文生视频”，而是至少包含四类不同任务：

| 任务 | 当前常见实现 | H3 的补充价值 |
| --- | --- | --- |
| 动态信息图与解释视频 | HTML / SVG / Canvas / GSAP | 生成转场、背景、镜头素材和产品氛围片段 |
| 3D 场景与互动演示 | Three.js / WebGL / GLSL | 生成写实或风格化 B-roll、参考镜头和首尾帧动画 |
| 社媒短视频 | 代码动画后录屏 | 直接生成可发布 MP4 片段，降低录屏与后期门槛 |
| 产品与电商展示 | UI 动画、图片素材拼接 | 图生视频、参考图一致性和产品镜头扩展 |

### 1.2 不能从现有证据推出的结论

- 513 个案例不能等同于 513 个付费用户。
- GitHub stars 不能直接换算为 Claude API 或 H3 的购买意愿。
- 当前趋势偏创意编码圈，不代表普通视频创作者的整体需求。
- 不能把这些案例宣传成“Claude 原生视频生成”。

因此，MVP 的验证目标不是估算大市场，而是确认已有 CheapBuddy 用户是否愿意为“Claude 编排 + H3 生成”增加充值和调用频率。

## 2. 官方模型事实

Anthropic 当前模型目录列出 Claude Opus 5.5、Sonnet 5.5 和 Haiku 5.5。所有当前模型支持文本和图片输入、文本输出、视觉理解和工具调用；模型本身不输出视频。官方目录给出的共同上限为 1M context 和 128K max output。

来源：[Claude models overview](https://platform.claude.com/docs/en/models/overview)

| 模型 | 官方 API ID | 定位 | 输入 / 输出价格 | 推荐角色 |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | `claude-opus-5-5` | 长时间 Agent 编码与知识工作 | $4 / $20 每 MTok | 高质量导演、复杂分镜、代码动画生成 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 速度与智能的平衡 | $2 / $10 每 MTok | 默认生产模型、提示词迭代、日常 Agent 工作流 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 高吞吐、低延迟 | ≤100K prompt 为 $0.10 / $0.50；>100K 为 $0.50 / $2.50 | 分类、路由、状态摘要和低价助手 |

Prompt caching 不能只用输入/输出两个字段表达：

- Opus 5.5：5 分钟写入 $5/MTok，1 小时写入 $8/MTok，命中 $0.20/MTok。
- Sonnet 5.5：5 分钟写入 $2.50/MTok，1 小时写入 $4/MTok，命中 $0.10/MTok。
- Haiku 5.5：短上下文写入 $0.125/$0.20、命中 $0.01；长上下文有另一档价格。
- Batch API 的输入和输出为标准价格的 50%。
- `inference_geo: "us"` 对 Claude 4.6 及之后模型施加 1.1 倍价格。
- Opus 5.5 Fast mode 为 $8/$40 每 MTok。

来源：[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### 产品结论

首发不应只上 Opus。Opus 是获客招牌，Sonnet 更适合作为默认模型和稳定毛利入口。Haiku 适合后续做自动路由、任务分类和低成本状态处理，不应在尚未正确实现 100K 阶梯计费时匆忙上线。

## 3. CheapBuddy 当前能力

### 3.1 已经具备的基础

- Relay 已把 `/v1/messages` 作为文本路径转发到 Sub2API：[`relay/ROUTE_CONTRACT.md`](../relay/ROUTE_CONTRACT.md)、[`relay/internal/config/config.go`](../relay/internal/config/config.go)。
- 官网已经可以生成 Claude Code 网关配置，包括 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、默认模型和 Haiku fallback：[`src/platform-config.js`](../src/platform-config.js)。
- H3 已经具有公开 `/v1/videos`、查询、内容下载、幂等、预扣、失败释放和成功结算：[`relay/internal/app/app.go`](../relay/internal/app/app.go)、[`relay/internal/app/h3_reservation.go`](../relay/internal/app/h3_reservation.go)、[`relay/internal/app/h3_refund.go`](../relay/internal/app/h3_refund.go)。
- NewAPI H3 插件已经承担供应商协议转换、轮询、SSE、任务持久化和安全产物 URL：[`newapi-plugin/ecophase_minimax_h3/plugin.js`](../newapi-plugin/ecophase_minimax_h3/plugin.js)。
- H3 已进入官网模型目录、ComfyUI 和 Hypit 适配。

### 3.2 仍未被证明的能力

- 仓库中没有 Claude 官方供应商 Channel、生产 API Key 或供应商合同证据。
- `src/models.js` 没有 Claude 模型卡。
- 没有 Claude `/v1/messages` 的真实端到端测试。
- 未验证流式、tool use、thinking、prompt caching、长上下文和错误格式。
- CheapBuddy 还没有实际 MCP Server、npm 包或 `/mcp` 路由。

因此，Claude Code 配置入口不能被宣传为“已上架 Claude 模型”；正式上架必须以生产 Channel 和真实 E2E 为准。

## 4. 目标用户与核心任务

### 用户 A：创意开发者

需求：用 Opus/Sonnet 写 Canvas、SVG、Three.js、Remotion 动画，并在同一对话中生成补充视频素材。

成功标准：不离开 Claude Code 或 Codex，能够提交 H3、获取任务状态、下载 MP4，并继续把结果用于页面或剪辑工程。

### 用户 B：短视频与营销创作者

需求：从产品描述生成脚本、分镜、镜头提示词和多个 H3 片段。

成功标准：模型能先给出成本提示，再按镜头逐个生成；失败任务不重复扣款；结果 URL 和过期时间清楚。

### 用户 C：AI 工作流构建者

需求：把 Claude 作为编排模型，把 H3 作为工具接入自动化流水线。

成功标准：工具输入输出稳定、可机器解析、有幂等键、状态枚举和错误分类；不依赖人工解析自然语言。

### 用户 D：CheapBuddy 现有多模型用户

需求：一个 Key、一个余额同时使用 Claude、OpenAI 类模型和媒体模型。

成功标准：模型发现、配置生成、用量、价格和余额扣减一致，不需要自行维护 Anthropic 或 MiniMax 密钥。

## 5. 产品范围

### 5.1 Claude 模型 MVP

首发模型：

1. `claude-opus-5-5`：营销主模型和高质量工作流。
2. `claude-sonnet-5-5`：默认推荐模型。

延后模型：

- `claude-haiku-5-5`：等待长上下文阶梯计费、缓存计费和路由策略正确实现后上线。

必须支持：

- Anthropic Messages 非流式和流式响应。
- system blocks、文本和图片输入。
- tool use / tool result 多轮循环。
- adaptive thinking 与 effort 透传。
- prompt caching 使用量记录。
- API 错误和余额不足错误保持 Anthropic 客户端可识别格式。
- Claude Code 的真实安装、模型发现和长连接验证。

不在 MVP：Anthropic Batch API 代理、Fast mode、US-only inference 选项、Anthropic 服务端 web search/code execution 的二次转售。

### 5.2 H3 MCP MVP

推荐包名：`@cheapbuddy/media-mcp`。

推荐第一阶段使用本地 stdio：

```text
Claude Code / Codex / OpenCode
        -> local stdio MCP
        -> api.cheapbuddy.cc
        -> Relay -> NewAPI -> H3
```

原因：用户的 CheapBuddy API Key 保留在本机环境变量或系统凭据库；部署面小；可以复用现有公开 API。

Anthropic 官方 Messages API MCP connector 只支持公开 HTTPS 的 Streamable HTTP 或 SSE Server，不能直接连接本地 stdio。若 CheapBuddy 以后希望让服务端 Messages API 直接调用 H3 MCP，必须另行提供远程 HTTPS MCP，并处理 OAuth、用户授权和多租户密钥映射。

来源：[Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)

## 6. MCP 工具契约

### `cheapbuddy_quote_video`

只读报价，不创建任务。

输入：`model`（v1 固定为 `MiniMax-H3`）、`seconds`（4-15 的整数）、`resolution`，以及可选素材类型摘要。

输出：`currency`、`estimated_cost` 或 `reservation_amount`、`pricing_basis`、`balance_sufficient`、`quote_expires_at`。

### `cheapbuddy_submit_video`

计费写操作，立即返回异步任务身份，不等待成片。

输入：`prompt`、`seconds`、`ratio`、`resolution`、合法的首尾帧/参考图/参考视频/参考音频组合、可复用的 `idempotency_key`、可选的 `max_cost`。

输出：`job_id`、`status`、`submitted_at`、`poll_after_ms`、`reservation_amount`、`request_id`。

### `cheapbuddy_get_video_job`

输入：`job_id`。

输出：`status`（`queued | in_progress | completed | failed | unknown`）、完成后的 `media[]`、`usage`、`final_cost`、清洗后的 `error` 和 `poll_after_ms`。

### `cheapbuddy_get_model_capabilities`

返回当前 Key 实际可见的媒体模型、输入组合和参数 schema，避免把 H3 参数硬编码在 Agent 提示词中。

### 暂不提供的工具

`cheapbuddy_cancel_video_job` 不进入 v1。当前公共 API 没有可靠的用户级取消契约；“停止轮询”不等于取消供应商任务，也不能承诺退款。

## 7. 功能需求

### Claude 上架

- FR-C1：生产 `/v1/models` 对目标分组返回准确 Claude ID 和能力。
- FR-C2：`/v1/messages` 支持 JSON 和 SSE，不缓冲流。
- FR-C3：usage 能区分 input、output、cache creation、cache read。
- FR-C4：模型卡展示官方价格与 CheapBuddy 最终计费的区别。
- FR-C5：配置中心将 Sonnet 设为推荐默认，允许用户显式选择 Opus。
- FR-C6：Claude Code 配置必须使用 Relay 根地址，不附加 `/v1` 或 `/chat/completions`。

### H3 MCP

- FR-M1：从 `CHEAPBUDDY_API_KEY` 读取凭据，日志中永不输出完整 Key。
- FR-M2：只调用 CheapBuddy 公共 API，不持有 Qingyan/NewAPI 管理凭据。
- FR-M3：提交前验证媒体类型、大小、URL scheme、时长和组合。
- FR-M4：所有提交使用稳定幂等键；网络超时不得生成新的 key 自动重试。
- FR-M5：视频任务保持异步，工具不以长阻塞等待作为正确性前提。
- FR-M6：返回结构化内容；MP4 使用资源链接，不内嵌大体积 base64。
- FR-M7：下载 URL 必须带过期提示；MCP 不承担永久媒体存储。
- FR-M8：余额不足时返回充值链接和缺口，不把上游错误原样透出。
- FR-M9：工具描述明确“会产生费用”，支持客户端在调用前请求用户确认。
- FR-M10：提供 Claude Code、Codex、OpenCode 的安装配置示例。

## 8. 非功能需求

- 安全：Key 仅从环境变量/凭据库读取；输入 URL 防 SSRF；不允许 `file://`、localhost、私网和云元数据地址。
- 可靠性：submit/get 的超时、重试和幂等语义与 Relay 保持一致。
- 可观测性：记录 request ID、job ID、模型、状态、耗时和计费结果，不记录完整提示词和敏感 URL query。
- 兼容性：Windows、macOS、Linux；Node LTS；JSON-RPC/MCP 协议错误结构稳定。
- 性能：`tools/list` 和能力查询不应触发昂贵上游请求；状态查询遵循 `poll_after_ms`。
- 发布：npm 包锁定版本并提供 SHA/provenance；不新增未审计依赖。

## 9. 计费与单位经济

Claude 模型必须建立四类 token rate，而不是只配置 input/output：标准输入、标准输出、cache write（至少区分 5 分钟与 1 小时）和 cache read。

首发前必须用真实供应商账单验证采购折扣、渠道倍率、约 30% tokenizer 增长、tool schema/MCP 工具定义产生的输入 token，以及 Opus + H3 一次完整工作流的总毛利。

建议销售页提供两个示例，不承诺固定价格：

- “用 Sonnet 5.5 写脚本和镜头，再生成一个 8 秒 H3 视频”的参考区间。
- “用 Opus 5.5 生成 Three.js 动画代码”的 token 成本与“不调用 H3”的区别。

H3 模型卡当前引用官方 768P $0.08/秒、2K $0.13/秒，但最终 CheapBuddy 扣费仍由生产倍率和实际用量决定。MCP 报价必须读取实时 `/v1/pricing` 或专用报价接口，不能复制官网静态文案。

## 10. 销售与包装

### 主叙事

避免：

> Claude Opus 5.5 能生成视频，CheapBuddy 也卖 H3。

推荐：

> Claude 写脚本、分镜和动画，H3 生成镜头。CheapBuddy 用一个 Key 把两者接进同一个 Agent 工作流。

### 可销售的场景包

1. Motion Graphics Pack：Opus/Sonnet + 代码动画模板，不强制调用 H3。
2. Product Video Pack：Sonnet 生成脚本，H3 生成首帧/参考图驱动镜头。
3. Explainer Pack：Opus 生成交互解释动画，H3 生成背景或故事化片段。
4. Agent Video API Pack：Claude Code/Codex + MCP，用于开发者和工作流团队。

### 获客资产

- 一个真实端到端演示：一句需求 -> Claude 分镜 -> H3 submit -> 自动轮询 -> MP4 链接。
- 三个可复制 prompt/skill：产品展示、解释动画、社媒短片。
- 一个成本对比页面：仅代码动画、代码动画 + H3、纯 H3 三种路线。
- 一个公开 MCP 工具文档页和安装命令。

## 11. 分期路线

### Phase 0：商业与生产验证

确认 Anthropic 官方或合规上游渠道、额度、地区和转售条款；在 Sub2API 建立 Opus 5.5 / Sonnet 5.5 channel 与 CheapBuddy 分组；验证供应商账单、缓存计价、工具调用计价和毛利。

退出标准：真实 `/v1/messages` 调用成功且账单可对账。

### Phase 1：Claude 模型上架

更新动态和静态模型目录；补 `/v1/messages` E2E、SSE、tool use、thinking、缓存和错误测试；更新官网模型卡、Claude Code 配置和价格说明。

退出标准：Claude Code 在干净环境完成安装、对话、工具调用和流式输出。

### Phase 2：本地 H3 MCP

实现 stdio 包与四个 v1 工具；补 mock Relay、幂等、断线、余额不足和 URL 安全测试；发布 npm 包、安装说明和真实演示。

退出标准：Claude Code 和 Codex 均可提交、查询并拿到 H3 视频。

### Phase 3：远程 MCP

提供 Streamable HTTP HTTPS endpoint、OAuth 2.1 / PKCE、用户授权、token rotation、审计、限流、tenant mapping 和工具 allowlist。

退出标准：Anthropic Messages API MCP connector 能使用用户授权调用工具；任何 API 请求都不携带用户长期 CheapBuddy Key。

### Phase 4：工作流产品化

增加视频导演 Skill/Prompt、多镜头批量任务、预算控制、结果持久化或外部存储集成，以及可选 WorkBuddy 原生 ImageGen/VideoGen 薄适配。

## 12. MVP 验收标准

### Claude

- Opus 5.5 和 Sonnet 5.5 在授权用户的 `/v1/models` 中可见。
- Messages 非流式、流式、图片输入、tool use 多轮通过真实 E2E。
- cache write/read usage 与供应商账单可核对。
- 余额不足返回 Claude Code 可读错误和充值 URL。
- 官网、配置中心、实际模型权限和计价无矛盾。

### MCP

- `tools/list` 稳定返回工具 schema。
- 8 秒 H3 任务提交后 2 秒内返回 job ID。
- 同一 idempotency key 的网络重试不创建第二个视频。
- completed 结果返回可下载 MP4、过期时间和最终成本。
- failed 任务不会被 MCP 自动重提，预扣最终释放或正确结算。
- 日志、错误和 MCP 响应中不存在 CheapBuddy Key、NewAPI token 或 Qingyan Key。
- Windows、macOS、Linux 各完成一次安装和调用验证。

## 13. 指标与决策门槛

上线后 30 天建议观察 Claude 激活率、Claude 到媒体转化率、MCP 安装成功率、首次任务成功率、H3 完成时间、重复任务率、每活跃用户充值金额、组合工作流毛利、7 日重复调用率和支持工单分布。

建议继续投入的最低信号：

- 至少 20 个真实用户完成 MCP 首次生成。
- 首次生成成功率 ≥ 85%。
- 7 日内至少 25% 的成功用户再次生成。
- 组合工作流保持正毛利，且重复任务/重复扣费为 0。

## 14. 主要风险

| 风险 | 缓解 |
| --- | --- |
| 把代码动画趋势误判成生成式视频需求 | 分别衡量代码动画与 H3 调用，不强迫每个工作流使用 H3 |
| Claude 模型已配置但协议不完整 | 真实 Claude Code E2E 是发布门禁 |
| 缓存、长上下文和工具 token 导致亏损 | 四类 rate、账单对账和每路由毛利告警 |
| MCP 重试生成重复付费任务 | 稳定幂等键，ambiguous create 不自动换 key 重提 |
| 本地 MCP Key 泄漏 | 环境变量/凭据库、日志脱敏、发布包 secret scan |
| 远程 MCP 直接接收长期 API Key | 远程版必须使用 OAuth 和短期 token |
| 视频 URL 过期造成用户认为结果丢失 | 输出 `expires_at`，提示及时下载；持久化放在后续版本 |
| 宣传“Claude 生成视频”引发预期错位 | 营销明确区分 Claude 编排、代码动画与 H3 生成 |

## 15. 最终建议

这是值得做的需求，且与 CheapBuddy 当前架构高度匹配。H3 后端链路已经是重资产部分，MCP 主要是产品化和分发层；Claude Code 配置入口也已存在。真正的工作量集中在 Claude 生产供应商验证、Anthropic 协议 E2E、正确计费，以及 MCP 的跨客户端体验。

建议立项为一个组合产品，而不是两个零散功能：

> `Claude 5.5 models + CheapBuddy Media MCP`

首发应以 Opus 5.5 获客、Sonnet 5.5 默认、H3 MCP 转化为媒体收入。先本地 stdio，后远程 OAuth MCP；先单镜头异步任务，后多镜头导演工作流。