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
  - `deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`
  - `deepseek-v4.1-flash` → `deepseek-v4.1-flash`

该账户不支持，也不配置以下两个模型 ID 的映射：

- `deepseek-flash`
- `deepseek-v4.1-flash-1017`

`deepseek-flash` 是 Relay/Sub2API 内部路由 ID。Relay 的别名配置与账户映射是两层独立配置；其他确实支持该内部 ID 的账户可以继续作为后备渠道。

## 历史上为什么曾经没有命中 ecophase-ai

Relay 在转发前将公开 ID 重写为 `deepseek-flash`。历史上，
`ecophase-ai.com` 的模型能力与这个内部路由 ID 不一致，所以 Sub2API 的精确模型
匹配没有把它列为候选账户。当前配置保留这一能力边界，调度器会选择实际支持该路由
ID 的 `pptoken-deepseek`。

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

对于 canonical 公开请求，管理后台的 Usage 记录应显示：

- Account：实际支持请求模型 ID 的可调度账户；当前内部路由请求应为
  `pptoken-deepseek`
- Requested Model：`deepseek/deepseek-v4.1-flash`
- Final Upstream Model：`deepseek-v4.1-flash`
- HTTP 请求成功并产生实际 Cost

2026-10-15 17:37:41 的历史线上验证曾命中 `ecophase-ai.com`；当前对
`deepseek-flash` 和 `deepseek-v4.1-flash-1017` 的请求命中后备账户属于预期行为。

## 故障排查

### 404 model_not_found

1. 检查组白名单是否包含公开 ID 和当前需要的内部路由 ID。
2. 检查部署环境是否加载了 `relay/config/model-aliases.json`。
3. 检查目标账户是否确实支持 Relay 重写后的模型 ID；不要向 `ecophase-ai.com` 添加 `deepseek-flash` 或 `deepseek-v4.1-flash-1017` 映射。

### 命中备用账户

1. 检查 `ecophase-ai.com` 是否 Active、Schedulable、Priority 1。
2. 检查 Model Restriction 是否包含上游实际 ID。
3. 检查 `credentials.model_mapping` 是否保留公开 ID和 canonical ID到
   `deepseek-v4.1-flash` 的映射，并确认不包含 `deepseek-flash` 或
   `deepseek-v4.1-flash-1017`。
4. 检查并发、额度、临时不可调度和上游错误状态。

### 401

更换或启用有效的用户 API Key，并确认该 Key 属于 `CheapBuddy OpenAI` 组。
不要把管理员 Key 写入请求脚本或仓库。
