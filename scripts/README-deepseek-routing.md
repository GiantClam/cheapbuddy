# DeepSeek 路由脚本

本目录提供两个脚本：

| 脚本 | 行为 |
| --- | --- |
| `setup-deepseek-routing.ps1` | 只读审计 Sub2API 账户状态、优先级和 Model Mapping |
| `verify-deepseek-routing.ps1` | 使用公开模型 ID 发送一次最小真实请求 |

## 固定 ID

```text
公开 ID：     deepseek/deepseek-v4.1-flash
内部路由 ID： deepseek-flash
上游实际 ID： deepseek-v4.1-flash
```

不要把内部路由 ID 写入 WorkBuddy、Claude Code、OpenCode 或 Codex 的生成配置。

## 1. 审计账户配置

```powershell
$env:SUB2API_BASE_URL = "https://admin.cheapbuddy.cc"
$env:SUB2API_ADMIN_API_KEY = "<admin-api-key>"
.\scripts\setup-deepseek-routing.ps1
```

脚本不会修改线上账户。检测到差异时，在管理后台完成以下设置：

- `ecophase-ai.com`：Priority 1、Active、Schedulable
- `deepseek-flash` → `deepseek-v4.1-flash`
- `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`

并确认 `CheapBuddy OpenAI` 组白名单勾选公开 ID 和内部路由 ID。

## 2. 发送最小验收请求

```powershell
$env:CHEAPBUDDY_API_KEY = "<user-api-key>"
.\scripts\verify-deepseek-routing.ps1
```

默认请求：

- Base URL：`https://api.cheapbuddy.cc`
- Model：`deepseek/deepseek-v4.1-flash`
- `max_tokens=1`
- 非流式

请求会产生少量真实费用。脚本不会显示 API Key，也不会尝试内部或上游 ID。

## 3. 检查 Usage

成功响应只证明入口和上游可用。最终验收还要确认：

- Account 为 `ecophase-ai.com`
- Requested Model 为公开 ID
- Final Upstream Model 为 `deepseek-v4.1-flash`
- 有实际 Cost

详细步骤见 `scripts/VERIFICATION-GUIDE.md`。
