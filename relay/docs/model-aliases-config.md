# Relay 模型别名配置

Relay 可以在转发 JSON 请求前重写 `model` 字段。别名可以组成有向链，Relay 会
解析到最终目标；循环别名会保持原始模型 ID，避免请求被错误改写。

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

`relay/config/model-aliases.json` 保留旧模型直通，并将内部路由 ID 转发到新上游模型：

```json
{
  "deepseek-flash": "deepseek-4.1-flash-1017",
  "deepseek-v4.1-flash-1017": "deepseek-flash",
  "deepseek-v4.1-flash-0910": "deepseek-flash",
  "deepseek-v4.1-flash-expires-on-0910": "deepseek-flash",
  "deepseek/deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash"
}
```

历史客户端请求使用：

```text
deepseek/deepseek-v4.1-flash
```

旧模型链路：

```text
旧客户端公开 ID（Relay 保持不变）
deepseek/deepseek-v4.1-flash
        ↓ Sub2API account model_mapping
上游实际 ID
deepseek-v4.1-flash
```

`deepseek-flash` 是内部路由 ID，不是 DeepSeek 官方上游 ID。

`deepseek-4.1-flash-1017` 当前作为独立模型 ID 直通，`deepseek-flash` 内部路由 ID
在 Relay 中改写到它。旧公开 ID 不会进入这条新模型路由。

`ecophase-ai.com` 当前 `/v1/models` 只公布 `deepseek-v4.1-flash` 和
`deepseek/deepseek-v4.1-flash`，不公布 `deepseek-4.1-flash-1017`。因此旧公开模型可走
已公布的旧上游 ID；1017 请求仍需该渠道商在对应上游组中开放模型后才能成功。

## 与 Sub2API 的配合

### 组白名单

同时保留：

- `deepseek/deepseek-v4.1-flash`：公开模型目录和 API Key 权限
- `deepseek-flash`：Relay 重写后的请求
- `deepseek-4.1-flash-1017`：新模型选择和直连请求

### 账户配置

`ecophase-ai.com` 保留以下映射：

```text
deepseek-flash → deepseek-4.1-flash-1017
```

为兼容直连路径，可以额外保留：

```text
deepseek/deepseek-v4.1-flash → deepseek-v4.1-flash
```

账户映射必须按上游实时模型目录配置。当前 `ecophase-ai.com` 的目录不包含 1017，
不要把它描述为已验证可用。

## 行为边界

- 仅处理 `Content-Type: application/json` 且顶层 `model` 为字符串的请求。
- 未命中的模型保持不变。
- Relay 仍保留原始请求模型用于请求上下文和审计；仅命中内部路由别名时才改写 body。
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
- Final Upstream Model：`deepseek-v4.1-flash`
