# DeepSeek V4.1 Flash 白名单与账户映射

## 正确配置

```text
公开/客户端 ID： deepseek/deepseek-v4.1-flash
内部路由 ID：    deepseek-flash
上游实际 ID：    deepseek-v4.1-flash
```

### CheapBuddy OpenAI 组

模型白名单需要同时勾选：

- `deepseek/deepseek-v4.1-flash`
- `deepseek-flash`

公开 ID 用于模型目录和 API Key 权限；内部 ID 用于 Relay 重写后的请求。
`deepseek-v4.1-flash` 是上游实际 ID，不应作为客户端配置生成器的输出。

### ecophase-ai.com 账户

- Status：Active
- Schedulable：启用
- Priority：1
- Model Restriction：`deepseek-v4.1-flash`
- Model Mapping：
  - `deepseek-flash` → `deepseek-v4.1-flash`
  - `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`

第二条映射保留直连和兼容路径；经过 Relay 时，第一条映射是调度命中的关键。

## 为什么曾经没有命中 ecophase-ai

Relay 在转发前将公开 ID 重写为 `deepseek-flash`。修复前，
`ecophase-ai.com` 只声明了 `deepseek-v4.1-flash`，所以 Sub2API 的精确模型
匹配没有把它列为候选账户。调度器随后选择了支持该路由 ID 的
`pptoken-deepseek`。

这不是优先级算法失效。优先级只在“已匹配模型且可调度”的候选账户之间生效。

## 验证请求

```bash
curl https://api.cheapbuddy.cc/v1/chat/completions \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-v4.1-flash",
    "messages": [{"role": "user", "content": "Reply with OK"}],
    "max_tokens": 1,
    "stream": false
  }'
```

管理后台的 Usage 记录应显示：

- Account：`ecophase-ai.com`
- Requested Model：`deepseek/deepseek-v4.1-flash`
- Final Upstream Model：`deepseek-v4.1-flash`
- HTTP 请求成功并产生实际 Cost

2026-10-15 17:37:41 的线上验证已满足这些条件。

## 故障排查

### 404 model_not_found

1. 检查组白名单是否同时包含公开 ID 和内部路由 ID。
2. 检查部署环境是否加载了 `relay/config/model-aliases.json`。
3. 检查 Usage/Relay 日志中请求是否被重写为 `deepseek-flash`。

### 命中备用账户

1. 检查 `ecophase-ai.com` 是否 Active、Schedulable、Priority 1。
2. 检查 Model Restriction 是否包含上游实际 ID。
3. 检查 `credentials.model_mapping` 是否包含
   `deepseek-flash` → `deepseek-v4.1-flash`。
4. 检查并发、额度、临时不可调度和上游错误状态。

### 401

更换或启用有效的用户 API Key，并确认该 Key 属于 `CheapBuddy OpenAI` 组。
不要把管理员 Key 写入请求脚本或仓库。
