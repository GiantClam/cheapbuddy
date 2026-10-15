# DeepSeek V4.1 Flash 验证指南

## 验收目标

```text
deepseek/deepseek-v4.1-flash
  → deepseek-flash
  → ecophase-ai.com
  → deepseek-v4.1-flash
```

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
- Relay alias 配置能加载公开 ID → 内部路由 ID

## 2. 线上配置验证

`CheapBuddy OpenAI`：

- Active
- `0.72x`
- 白名单包含 `deepseek/deepseek-v4.1-flash`
- 白名单包含 `deepseek-flash`

`ecophase-ai.com`：

- Active
- Schedulable
- Priority 1
- 映射 `deepseek-flash` → `deepseek-v4.1-flash`
- 映射 `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`

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
- 返回 200 但命中 `pptoken-deepseek`：优先账户没有匹配内部路由 ID，或账户暂时
  不可调度、超限、并发已满。
- Requested Model 不是公开 ID：客户端配置仍在泄漏内部/上游 ID。
- Final Upstream Model 不是 `deepseek-v4.1-flash`：账户 Model Mapping 不一致。
