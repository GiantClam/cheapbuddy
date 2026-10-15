# DeepSeek V4.1 Flash 修复总结

> 状态：已于 2026-10-15 完成线上配置修复和真实请求验证。

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
- 该账户保存两条映射：
  - `deepseek-flash` → `deepseek-v4.1-flash`
  - `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`
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
- 账户的 Model Restriction 可以声明上游实际 ID；Model Mapping 必须能把内部路由
  ID 转为上游实际 ID。
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
