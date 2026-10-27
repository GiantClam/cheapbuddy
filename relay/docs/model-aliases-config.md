# Relay 模型别名配置

Relay 可以在转发 JSON 请求前重写 `model` 字段。别名目标是下游路由器用于精确
调度的 ID；它不一定是提供商官方模型 ID。

## 配置来源与优先级

1. 非空的 `RELAY_MODEL_ALIASES`：JSON 对象，优先级最高。
2. 非空的 `RELAY_MODEL_ALIASES_FILE`：读取 JSON 文件。
3. 两者都为空：不执行任何模型别名重写。

`RELAY_MODEL_ALIASES={}` 会显式禁用全部别名。配置不是合法 JSON、不是对象，或
包含空 key/value 时，Relay 启动失败。

生产镜像包含：

```text
/etc/cheapbuddy/config/model-aliases.json
```

对应环境变量：

```bash
RELAY_MODEL_ALIASES_FILE=/etc/cheapbuddy/config/model-aliases.json
```

## DeepSeek V4.1 Flash

`relay/config/model-aliases.json` 将受支持的公开/兼容别名统一到内部路由 ID：

```json
{
  "deepseek/deepseek-v4.1-flash": "deepseek-flash",
  "deepseek-flash": "deepseek-4.1-flash-1017",
  "deepseek-4.1-flash-1017": "deepseek-flash",
  "deepseek-v4.1-flash": "deepseek-flash",
  "deepseek-v4.1-flash-1017": "deepseek-flash",
  "deepseek-v4.1-flash-0910": "deepseek-flash",
  "deepseek-v4.1-flash-expires-on-0910": "deepseek-flash",
  "deepseek/deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash"
}
```

标准客户端请求始终使用：

```text
deepseek/deepseek-v4.1-flash
```

完整链路：

```text
客户端公开 ID
deepseek/deepseek-v4.1-flash
        ↓ Relay alias
Sub2API 内部路由 ID
deepseek-flash
        ↓ account credentials.model_mapping / Relay direct alias
上游实际 ID
deepseek-4.1-flash-1017
```

`deepseek-flash` 是内部路由 ID，不是 DeepSeek 官方上游 ID。

`deepseek-4.1-flash-1017` 当前作为可选模型 ID 放行，并映射到同一个
`deepseek-flash` 内部路由 ID。`deepseek-flash` 请求在 Relay 中直接改写为
`deepseek-4.1-flash-1017`；生产优先账户 `ecophase-ai.com` 同时保留该精确模型能力。

当前生产账户 `ecophase-ai.com` 为 Priority 1、Active、Schedulable，并优先承接
`deepseek-flash` 和 `deepseek-4.1-flash-1017`。

## 与 Sub2API 的配合

### 组白名单

同时保留：

- `deepseek/deepseek-v4.1-flash`：公开模型目录和 API Key 权限
- `deepseek-flash`：Relay 重写后的请求
- `deepseek-4.1-flash-1017`：新模型选择和直连请求

### 账户配置

优先账户需要能匹配内部路由 ID，并将其转换为上游实际 ID：

```text
deepseek-flash → deepseek-4.1-flash-1017
```

为兼容直连路径，可以额外保留：

```text
deepseek/deepseek-v4.1-flash → deepseek-v4.1-flash
```

账户映射必须按上游实际能力配置。`ecophase-ai.com` 当前使用
`deepseek-flash → deepseek-4.1-flash-1017`；其他账户仍按自身实际能力配置。

## 行为边界

- 仅处理 `Content-Type: application/json` 且顶层 `model` 为字符串的请求。
- 未命中的模型保持不变。
- Relay 仍保留原始请求模型用于请求上下文和审计；转发 body 使用映射后的值。
- 环境变量配置会完整覆盖文件配置，不会与文件合并。

## 验证

```powershell
cd relay
go test ./...
go vet ./...
go build ./cmd/relay
```

线上使用公开 ID 发送一个 `max_tokens=1` 请求，然后在 Usage 中核对：

- Requested Model：`deepseek/deepseek-v4.1-flash`
- Account：`ecophase-ai.com`
- Final Upstream Model：`deepseek-4.1-flash-1017`
