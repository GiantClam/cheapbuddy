# DeepSeek V4.1 Flash 修复总结

> 首次修复：2026-10-15。最近恢复验证：2026-10-19 10:42–10:43（Asia/Shanghai）。

## 2026-10-19 账户映射修正

经生产账户核对，`ecophase-ai.com` 不支持 `deepseek-flash` 和
`deepseek-v4.1-flash-1017`。已从该账户移除 `deepseek-flash` 的账户级映射；
`deepseek-v4.1-flash-1017` 原本也没有该账户映射。该账户当前只保留公开 ID 和
canonical ID 指向 `deepseek-v4.1-flash` 的配置。两个不受支持的 ID 不得再写入
`ecophase-ai.com` 的 `credentials.model_mapping`。

Relay 别名表、模型白名单和账户映射是独立层。其他确实支持内部路由 ID 的账户仍可
作为后备渠道；Relay 能接受某个别名，不代表 `ecophase-ai.com` 支持该别名。

## 2026-10-19 上游 503 与后备恢复

请求 `01a151fd376d7f00a6152975938ee37d` 使用 Key ID 3、group 2，
模型为 `deepseek-flash`。账户 12（`ecophase-ai.com`）的上游返回 503；
其余四个调度候选不支持这个公开名称。第一次请求返回 502，随后重试时
账户 12 处于临时 runtime block，最终返回 503。Key 鉴权已通过。

账户 2（`PPToken · Paid Backup`）本来就声明支持同一个真实模型
`deepseek-v4.1-flash`，直接调用返回 HTTP 200 和 `OK`，但缺少两个公开名称映射。
此次仅为该账户补齐：

```text
deepseek-flash                  → deepseek-v4.1-flash
deepseek/deepseek-v4.1-flash     → deepseek-v4.1-flash
```

通过管理 API 保存完整的既有非敏感 credentials，仅添加上述两项。
保存后核对其余 credentials（包括鉴权字段）、分组、状态、调度开关、优先级、并发和
`openai_responses_mode=force_chat_completions` 均未改变。调度缓存由管理 API 正常刷新。

验收结果：

- 原 Key ID 3 / group 2：两个名称均 HTTP 200，最终正文均为 `OK`。
- 共享 Key ID 189 / group 4：两个名称均 HTTP 200，最终正文均为 `OK`。
- 生产日志确认四次请求均由账户 2 成功处理；其中第一次先遇到账户 12 的 503，
  随后自动切换到账户 2，证明故障切换生效。
- 原 Key 的 `/v1/chat/completions` 和 `/v1/responses` 流式请求均 HTTP 200，
  收到 `OK` 和正常结束事件。

账户 12 的直接上游仍返回 503；当前由真实后备渠道接管。
排障时不要强制解除故障账户，也不要清除独立的模型限流记录。
后续 Usage 验收允许命中健康的账户 2，不能再以必须命中账户 12 作为成功条件。

以下记录保留首次修复的背景和当时证据。

## 结论

DeepSeek V4.1 Flash 现在使用三层、职责明确的模型 ID：

| 层级 | 模型 ID | 用途 |
| --- | --- | --- |
| 客户端与公开目录 | `deepseek/deepseek-v4.1-flash` | 网站、WorkBuddy、Claude Code、OpenCode、Codex 和用户请求 |
| Relay/Sub2API 内部路由 | `deepseek-flash` | Relay 重写后的精确调度 ID |
| 上游实际模型 | `deepseek-v4.1-flash` | EcoPhase 等上游最终收到的 ID |

客户端配置只能输出公开 ID。内部路由 ID 和上游实际 ID 不属于客户端契约。

## 根因

修复前，Relay 会把公开 ID 重写为 `deepseek-flash`，但优先级 1 的
`ecophase-ai.com` 账户只声明了上游实际 ID `deepseek-v4.1-flash`。
Sub2API 使用精确模型匹配筛选候选账户，因此跳过了该账户，继续选择优先级 2 的
`pptoken-deepseek`。

```text
客户端公开 ID
deepseek/deepseek-v4.1-flash
        ↓ Relay alias
内部路由 ID
deepseek-flash
        ↓ Sub2API 账户 mapping
上游实际 ID
deepseek-v4.1-flash
```

## 已实施修复

- `CheapBuddy OpenAI` 组白名单同时包含公开 ID 和内部路由 ID。
- `ecophase-ai.com` 为 Active、可调度、Priority 1。
- 该账户当时保存了公开名称映射；当前生产配置已按实际能力移除不受支持的
  `deepseek-flash` 账户级映射。
- `src/models.js` 不再为 DeepSeek 暴露 `providerModelId`。
- 所有客户端配置生成器和连接测试都使用公开 ID。
- API Key 的模型权限校验使用公开 ID，不再依赖提供商元数据。
- Relay 的别名配置保持显式、可部署：公开 ID → 内部路由 ID。

## 线上证据

2026-10-15 17:37:41（Asia/Shanghai）发送了一个
`max_tokens=1` 的真实请求：

| 字段 | 结果 |
| --- | --- |
| Request ID | `1fa7d9aab0f6c178a687873c7f4cde3c` |
| HTTP | `200` |
| 响应内容 | `OK` |
| Account | `ecophase-ai.com` |
| Requested Model | `deepseek/deepseek-v4.1-flash` |
| Final Upstream Model | `deepseek-v4.1-flash` |
| Inbound / Upstream | `/v1/chat/completions` / `/v1/responses` |
| Tokens | 输入 4,782；输出 2 |
| 用户计费 | `$0.012574` |
| 账户成本 | `$0.001437` |

修复前 2026-10-15 17:18 的同模型请求命中
`pptoken-deepseek`，可作为前后对照。

## 运维约束

- 组白名单必须保留公开 ID，用于公开模型目录和客户端权限。
- 组白名单必须保留内部路由 ID，用于 Relay 重写后的请求。
- 账户的 Model Restriction 和 Model Mapping 必须与该账户实际支持的模型 ID 一致。
  不要为了让优先级账户匹配请求而添加其不支持的内部或版本 ID。
- 不要把 `deepseek-flash` 描述为 DeepSeek 官方模型 ID。
- 修改任一层 ID 后，必须重新执行一次真实请求并核对 Requested Model、Account、
  Final Upstream Model 和 Cost。

## 相关文件

- `src/models.js`
- `src/platform-config.js`
- `src/api.js`
- `relay/config/model-aliases.json`
- `relay/internal/config/config.go`
- `relay/internal/app/app.go`
- `scripts/verify-deepseek-routing.ps1`
- `scripts/setup-deepseek-routing.ps1`
