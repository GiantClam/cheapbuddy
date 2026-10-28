# DeepSeek V4.1 Flash 验证指南

## 2026-10-28 DeepSeek 路由现状

账户 12（`ecophase-ai.com`）为 Priority 1、Active、Schedulable。其实时 `/v1/models`
目录只返回 `deepseek-v4.1-flash` 和 `deepseek/deepseek-v4.1-flash`，不包含
`deepseek-4.1-flash-1017`。账户 8（`pptoken-deepseek`）的目录包含带 `v` 的
`deepseek-v4.1-flash-1017`，两者不能混为同一个已验证上游 ID。

旧模型验收应核对请求的公开 ID、最终上游型号 `deepseek-v4.1-flash`、非空最终正文、
正常结束事件与实际计费；输出预算必须足以产生最终正文，不能仅凭状态 200 或
`max_tokens=1` 的空正文通过。两条名称和 Chat Completions、Responses 流式协议
均已于 2026-10-19 复测成功。详见 `docs/deepseek-fix-summary.md`。

## 验收目标

```text
deepseek/deepseek-v4.1-flash
  → Relay 保持旧 ID 不变
  → ecophase-ai.com（Priority 1）
  → deepseek-v4.1-flash
```

新模型路径 `deepseek-flash` → `deepseek-4.1-flash-1017` 已在本地配置，但 EcoPhase
尚未在其实时模型目录中公布该 ID；在渠道商更新上游组权限前，该路径会被上游拒绝。

## 1. 本地静态验证

```powershell
npm test
npm run test:coverage
npm run build

Push-Location relay
go test ./...
go vet ./...
go build ./cmd/relay
Pop-Location
```

重点测试：

- DeepSeek catalog 不再包含 `providerModelId`
- 所有平台生成器输出公开 ID
- API Key 权限检查忽略旧 provider 元数据
- 旧公开 ID 不会被 Relay 改写成未开放的 1017 ID

## 2. 线上配置验证

`CheapBuddy OpenAI`：

- Active
- `0.72x`
- 白名单包含 `deepseek/deepseek-v4.1-flash`
- 白名单包含 `deepseek-flash`
- 白名单包含 `deepseek-4.1-flash-1017`（本地白名单不代表上游已授权）

`ecophase-ai.com`：

- Active
- Schedulable
- Priority 1
- 映射 `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- 映射 `deepseek-flash` → `deepseek-4.1-flash-1017`

可以使用只读脚本检查账户 API 返回：

```powershell
.\scripts\setup-deepseek-routing.ps1
```

## 3. 真实请求

```powershell
$env:CHEAPBUDDY_API_KEY = "<valid-user-key>"
.\scripts\verify-deepseek-routing.ps1
```

脚本只请求公开 ID，且使用 `max_tokens=1`。不要用管理员 Key 代替用户 Key。

## 4. Usage 对账

| 字段 | 期望值 |
| --- | --- |
| Account | `ecophase-ai.com` |
| Requested Model | `deepseek/deepseek-v4.1-flash` |
| Final Upstream Model | `deepseek-v4.1-flash` |
| Inbound | `/v1/chat/completions` |
| HTTP | 成功 |
| Cost | 用户计费和账户成本均存在 |

2026-10-15 的已知成功样本：

- Request ID：`1fa7d9aab0f6c178a687873c7f4cde3c`
- 时间：17:37:41（Asia/Shanghai）
- Account：`ecophase-ai.com`
- Tokens：4,782 输入 / 2 输出
- 用户计费：`$0.012574`
- 账户成本：`$0.001437`

## 失败判定

- `401`：用户 Key 无效、过期或不属于正确组。
- `404 model_not_found`：公开 ID 或内部路由 ID 未进入组白名单，或 Relay alias
  没有部署。
- `400 Model is not available` 且日志显示 Account `ecophase-ai.com`：上游账号模型目录或组权限未开放请求的上游 ID。
- 返回 200 但命中 `pptoken-deepseek`：优先账户没有匹配当前请求的实际 ID，或账户暂时
  不可调度、超限、并发已满。
- Requested Model 不是公开 ID：客户端配置仍在泄漏内部/上游 ID。
- 旧模型 Final Upstream Model 不是 `deepseek-v4.1-flash`：检查 Relay 别名和账户 Model Mapping。
