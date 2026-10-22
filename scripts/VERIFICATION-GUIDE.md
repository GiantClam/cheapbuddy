# DeepSeek V4.1 Flash 验证指南

## 2026-10-19 后备恢复后的验收规则

账户 12（`ecophase-ai.com`）只保留其实际支持的 canonical/public 映射；它不支持
`deepseek-flash` 和 `deepseek-v4.1-flash-1017`，这两个 ID 不得写入该账户的
`credentials.model_mapping`。账户 2 等确实支持内部 ID 的渠道可以作为后备。

验收应核对请求的公开 ID、最终上游型号 `deepseek-v4.1-flash`、非空最终正文、
正常结束事件与实际计费；输出预算必须足以产生最终正文，不能仅凭状态 200 或
`max_tokens=1` 的空正文通过。两条名称和 Chat Completions、Responses 流式协议
均已于 2026-10-19 复测成功。详见 `docs/deepseek-fix-summary.md`。

## 验收目标

```text
deepseek/deepseek-v4.1-flash
  → deepseek-flash
  → 支持 deepseek-flash 的可调度账户
  → deepseek-v4.1-flash
```

当前生产验证中，`deepseek-flash` 和 `deepseek-v4.1-flash-1017` 由
`pptoken-deepseek` 承接；`ecophase-ai.com` 不配置这两个 ID 的映射。

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
- 映射 `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- 映射 `deepseek-v4.1-flash` → `deepseek-v4.1-flash`
- 不得映射 `deepseek-flash`
- 不得映射 `deepseek-v4.1-flash-1017`

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
| Account | 支持实际请求模型 ID 的可调度账户；当前内部路由请求预期为 `pptoken-deepseek` |
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
- 返回 200 但命中 `pptoken-deepseek`：优先账户没有匹配当前请求的实际 ID，或账户暂时
  不可调度、超限、并发已满。对于 `deepseek-flash` 和 `deepseek-v4.1-flash-1017`，
  命中后备账户是预期行为，因为 `ecophase-ai.com` 不支持这两个 ID。
- Requested Model 不是公开 ID：客户端配置仍在泄漏内部/上游 ID。
- Final Upstream Model 不是 `deepseek-v4.1-flash`：账户 Model Mapping 不一致。
