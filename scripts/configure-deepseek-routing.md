# DeepSeek V4.1 Flash 线上路由配置

## 模型 ID 契约

| 位置 | 值 |
| --- | --- |
| 客户端、网站和公开模型目录 | `deepseek/deepseek-v4.1-flash` |
| Relay/Sub2API 内部调度 | `deepseek-flash` |
| EcoPhase 上游实际模型 | `deepseek-4.1-flash-1017` |

客户端生成配置不得输出后两种 ID。

## Relay

部署 `relay/config/model-aliases.json`，并设置：

```bash
RELAY_MODEL_ALIASES_FILE=/etc/cheapbuddy/config/model-aliases.json
```

关键映射：

```json
{
  "deepseek/deepseek-v4.1-flash": "deepseek-flash",
  "deepseek-4.1-flash-1017": "deepseek-flash"
}
```

环境变量 `RELAY_MODEL_ALIASES` 非空时会覆盖文件配置；不要只放入一条临时映射
而意外删除其他别名。

## CheapBuddy OpenAI 组

- Status：Active
- Rate Multiplier：`0.72`
- Model Allowlist：启用
- 必须勾选：
  - `deepseek/deepseek-v4.1-flash`
  - `deepseek-flash`

## ecophase-ai.com

- Status：Active
- Schedulable：启用
- Priority：1
- Model Restriction：`deepseek-v4.1-flash`、`deepseek-4.1-flash-1017`
- Model Mapping：

```text
deepseek/deepseek-v4.1-flash → deepseek-v4.1-flash
deepseek-flash → deepseek-4.1-flash-1017
```

该账户应勾选以下模型白名单：

```text
deepseek-flash
deepseek-4.1-flash-1017
```

Relay 的内部别名配置与 Sub2API 账户映射分开维护。其他支持内部路由 ID 的账户可以继续作为后备渠道。

`pptoken-deepseek` 当前为 Priority 2，只应在 Priority 1 账户不可用、超限或模型不匹配
时接管请求。请求 `deepseek-flash` 或 `deepseek-4.1-flash-1017` 时，优先命中
`ecophase-ai.com` 的 `deepseek-4.1-flash-1017`。

## 安全审计脚本

`setup-deepseek-routing.ps1` 只读取账户详情并验证优先级、状态和
`credentials.model_mapping`。它不会用部分 PUT payload 更新账户，因为这种更新
可能覆盖 API Key、完整 credentials 或其他账户字段。

```powershell
$env:SUB2API_BASE_URL = "https://admin.cheapbuddy.cc"
$env:SUB2API_ADMIN_API_KEY = "<admin-api-key>"
.\scripts\setup-deepseek-routing.ps1
```

如果脚本无法读取完整 credentials，或检测到差异，请在管理后台编辑账户并保存完整
配置。

## 真实请求验证

```powershell
$env:CHEAPBUDDY_API_KEY = "<user-api-key>"
.\scripts\verify-deepseek-routing.ps1
```

然后检查 Usage：

- Account：优先为 `ecophase-ai.com`
- Requested Model：`deepseek/deepseek-v4.1-flash`
- Final Upstream Model：`deepseek-4.1-flash-1017`
- Cost：存在实际用户计费和账户成本

2026-10-27 生产配置已更新：`ecophase-ai.com` 为 Priority 1，
`deepseek-flash` 映射到 `deepseek-4.1-flash-1017`；`pptoken-deepseek`
保留为 Priority 2 后备。

2026-10-15 17:37:41 的请求
`1fa7d9aab0f6c178a687873c7f4cde3c` 已完成上述验证。
