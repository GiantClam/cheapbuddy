---
slug: deepseek-harness-cheapbuddy
category: BUILD GUIDE
date: 2026-11-04
readTime: 7
accent: green
title: DeepSeek Harness（dsh）接 CheapBuddy：Settings 填 OpenAI-compatible，一个余额跑 DeepSeek + Claude
title_en: Connect DeepSeek Harness (dsh) to CheapBuddy with OpenAI-compatible settings and one balance
excerpt: 在 dsh Settings 添加自定义 OpenAI Chat Completions 提供方，Base URL 填 https://api.cheapbuddy.cc/v1，用配置中心的统一 Key 和同一份 USD 余额调用 deepseek-flash 与已授权的 Claude。CheapBuddy 不是 DeepSeek 官方 Harness。
excerpt_en: Add a custom OpenAI Chat Completions provider in dsh Settings with base URL https://api.cheapbuddy.cc/v1. The config center’s shared key and one USD balance can call deepseek-flash and authorized Claude models. CheapBuddy is not official DeepSeek Harness.
---

<!-- zh -->
## 在 Settings 里填 OpenAI-compatible

DeepSeek Harness（dsh）的 Settings 支持自定义 OpenAI-compatible 提供方。把 Base URL 指到 CheapBuddy，用配置中心给出的一把统一 Key 和同一份 USD 余额，就可以在 dsh 里调用 `deepseek-flash`，以及这把 Key 已授权的 Claude 模型。CheapBuddy 在这里只是 OpenAI-compatible 网关和按用量计费的余额，不是 DeepSeek 官方 Harness，也不是 Super Agent，更不提供一套独立的 Agent 编排运行时。

## 开始之前

准备三件事：

- 一个 CheapBuddy 账号。登录后打开首页的[配置中心](/#generator)（按钮文案是「打开配置中心」），复用或创建名为 CheapBuddy Shared 的统一 Key。这把 Key 绑定复合分组，用来同时访问已授权的 OpenAI 系模型（含 DeepSeek）和 Claude。
- 把 Key 只放在自己的 dsh 里。不要写进仓库，也不要转发。
- DeepSeek Harness 仍是 developer preview。Settings 的字段名、入口和默认行为以 [官方 Providers 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md) 为准；本文只记录 CheapBuddy 这边应当填写的生产地址和模型 ID。

旧的单平台 Key 不会自动扩权。只有 Claude 分组的 Key 调不了 `deepseek-flash`；只有 OpenAI 分组的 Key 调不了 Claude。新配置请用配置中心当前的统一 Key。

## 在 dsh Settings 里添加自定义提供方

打开 **Settings → Models**，选择 **Add model provider**，再切到 **Custom model API**。一个提供方只说一种协议。要在 dsh 里同时跑 DeepSeek 和 Claude 的 Chat Completions，按下面填写同一个提供方：

| 字段 | 填写 |
| --- | --- |
| Provider ID | `cheapbuddy`（小写，创建后不能改名；要换 ID 就新建再删旧的） |
| Display name | `CheapBuddy` |
| Base URL | `https://api.cheapbuddy.cc/v1` |
| API protocol | **OpenAI Chat Completions**（配置里记为 `openai-completions`） |
| API key | 配置中心的统一 Key |

Base URL 就是有的客户端写成 `base_url`、dsh 配置文件写成 `baseURL` 的那一项。OpenAI Chat Completions 适配器会在这个地址后面拼接 `/chat/completions`，所以这里要停在 `/v1`，不要再写成 `https://api.cheapbuddy.cc/v1/chat/completions`，也不要漏掉 `/v1`。生产 API 根地址是 `https://api.cheapbuddy.cc`。

模型至少加一条公开 ID：

- `deepseek-flash`：DeepSeek V4.1 Flash。CheapBuddy 对外使用这个公开 ID，并按当前已授权路由转到上游 `deepseek-v4.1-flash-1017`。新配置不要改填上游型号名。说明见 [DeepSeek V4.1 Flash 模型页](/model/deepseek-v4-1-flash-1017/)。
- Claude 使用 CheapBuddy 公开 ID，例如 `claude-sonnet-5-5`。六个 Claude ID，以及 Anthropic 与 OpenAI-compatible 的差别，见 [Claude 接入指南](/blog/claude-stable-channel-guide)。只有统一 Key 的分组里已经包含对应模型时，这些 ID 才会可用。

dsh 可以用 **Fetch available models** 向当前 Base URL 和 Key 拉目录。拉不到、返回空，或格式对不上时，直接手填上面的公开 ID，保存即可。目录结果只说明这把 Key 现在能发现哪些模型，不代表每一个上游能力都已开通。

保存后在 dsh 的模型选择器里选中该提供方下的模型。Key 在 dsh 里是只写保存的，页面不会再把明文显示出来。

如果还要在 dsh 里走 Anthropic Messages，需要另建一个提供方，协议选 **Anthropic Messages**，Base URL 填根地址 `https://api.cheapbuddy.cc`（适配器自己拼接 `/v1/messages`）。这个提供方只放 Claude 公开 ID。`deepseek-flash` 不要放进 Anthropic 协议。Claude Code 本身仍使用 Anthropic Messages；dsh 的这条路径与它是同一种协议，不是第三套接口。协议对照也可以看 [CLI Base URL 模板](/blog/cli-base-url-templates)。

## 用一条最小请求核对

先在终端确认网关，再回到 dsh 里发一条很短的对话。把统一 Key 放在本地环境变量里：

```bash
export CHEAPBUDDY_API_KEY="粘贴配置中心的统一 Key"
curl https://api.cheapbuddy.cc/v1/chat/completions \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"Reply with OK"}],"stream":false}'
```

返回里能看到助手回复，就说明 Key、分组和 `deepseek-flash` 这条 Chat Completions 路径是通的。Claude 用同一把 Key 时，把 `model` 换成已授权的公开 ID，例如 `claude-sonnet-5-5`。最终扣费由这把 Key 所属分组的倍率、渠道价格和实际 Token 类别决定；官网卡片上的官方价只是参考。小额余额足够做这次核对，余额不够时到 [充值](/#pricing) 补一份 USD 余额。

curl 已成功、dsh 仍拒绝请求时，先核对协议是不是 OpenAI Chat Completions，以及 Base URL 有没有多拼一层 `/v1` 或 `/chat/completions`。请求形状和兼容开关以 dsh 官方文档为准，本文不替 dsh 承诺推理、工具或图像的全部行为。

## 常见问题

**401，或提示缺少凭据。** Key 没贴上、贴错，或这把 Key 的分组没有该模型。回到[配置中心](/#generator) 复制当前统一 Key。旧的 Claude 单平台 Key 调 `deepseek-flash`、旧的 OpenAI 单平台 Key 调 Claude，都会因分组权限失败。配置中心不会自动改绑这些旧 Key。

**模型 ID 对不上，或 dsh 报未知模型。** 请求体和 dsh 模型列表都使用 CheapBuddy 公开 ID：`deepseek-flash`，以及 `claude-sonnet-5-5` 这类 Claude ID。不要把展示名、上游目录里的另一套型号名，或带路径的别名当成新配置的主 ID。已有客户端若仍发送 `deepseek/deepseek-v4.1-flash`，网关仍把它当作兼容别名；新配置请写 `deepseek-flash`。dsh 的 `UNKNOWN_MODEL` 通常表示这个 ID 还没加进当前自定义提供方，补上并保存后再选。

**协议和 Base URL 混用。** OpenAI Chat Completions 的 Base URL 是 `https://api.cheapbuddy.cc/v1`，实际请求落在 `/v1/chat/completions`。Anthropic Messages 的 Base URL 是 `https://api.cheapbuddy.cc`，实际请求落在 `/v1/messages`。不要把 `/chat/completions` 写进 Claude / Anthropic 的 Base URL，也不要用 Anthropic 协议发送 `deepseek-flash`。一个 dsh 提供方只选一种协议。

## 去配置中心，再按需充值

登录 [CheapBuddy](/)，在 [配置生成](/#generator) 打开配置中心，确认统一 Key 和 Base URL，再回到 dsh 保存。安装其他客户端的步骤在 [安装指南](/#guide)。余额在首页 [按量充值](/#pricing) 补充，入账后仍是同一份 USD 余额，按模型和实际用量扣费。一个余额可以接多个已授权模型，这一点见 [为什么一个余额可以连接这么多模型](/blog/one-balance-model-routing)。

## 说明

CheapBuddy 与 DeepSeek 没有官方隶属关系。DeepSeek Harness、dsh 及其 Settings 属于 DeepSeek 的 developer preview，界面和字段以官方文档和你安装的版本为准。CheapBuddy 提供 OpenAI-compatible 网关、统一 Key 和按用量计入同一份余额的转发；它不替代 dsh，也不承诺 dsh 的会话、工具循环或其它 Agent 行为。模型权限、额度、到期、封禁和余额检查仍由服务端执行。

<!-- en -->
## Fill in an OpenAI-compatible provider

DeepSeek Harness (dsh) can add a custom OpenAI-compatible provider in Settings. Point its base URL at CheapBuddy and use the shared key from the config center. That one key and one USD balance can call `deepseek-flash` and any Claude model the key’s group already authorizes. CheapBuddy is the OpenAI-compatible gateway and the usage balance. It is not official DeepSeek Harness, not Super Agent, and not a separate agent orchestration runtime.

## Before you start

- Sign in to CheapBuddy and open the [config center](/#generator) on the homepage (the button label is “Open config center”). Reuse or create the shared key named CheapBuddy Shared. It is bound to a composite group that can include authorized OpenAI-family models, including DeepSeek, and Claude.
- Keep the key inside your own dsh install. Do not commit it or forward it.
- DeepSeek Harness is a developer preview. Field names and defaults follow the [official providers guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md). This note only records the CheapBuddy production base URL and public model IDs.

Older single-platform keys are not widened automatically. A Claude-only key cannot call `deepseek-flash`. An OpenAI-only key cannot call Claude. Use the shared key shown in the config center.

## Add the custom provider in dsh Settings

Open **Settings → Models**, choose **Add model provider**, and switch the card to **Custom model API**. One provider speaks one protocol. To call DeepSeek and Claude through Chat Completions, use a single provider:

| Field | Value |
| --- | --- |
| Provider ID | `cheapbuddy` (lowercase and permanent; create a new provider to change it) |
| Display name | `CheapBuddy` |
| Base URL | `https://api.cheapbuddy.cc/v1` |
| API protocol | **OpenAI Chat Completions** (stored as `openai-completions`) |
| API key | The shared key from the config center |

Base URL is the field some clients label `base_url` and dsh stores as `baseURL`. The Chat Completions adapter appends `/chat/completions`, so stop at `/v1`. Do not paste `https://api.cheapbuddy.cc/v1/chat/completions`, and do not drop `/v1`. The production API root is `https://api.cheapbuddy.cc`.

Add at least these public model IDs:

- `deepseek-flash` for DeepSeek V4.1 Flash. CheapBuddy publishes this ID and forwards it on the current authorized route to upstream `deepseek-v4.1-flash-1017`. Do not put the upstream name in a new client config. See the [DeepSeek V4.1 Flash model page](/model/deepseek-v4-1-flash-1017/).
- Claude public IDs such as `claude-sonnet-5-5`. The six IDs and the native versus compatible split are in the [Claude access guide](/blog/claude-stable-channel-guide). They work only when this key’s group includes them.

**Fetch available models** asks the current base URL and key for a catalog. If that call fails, returns nothing, or uses a shape dsh does not read, type the public IDs by hand and save. A catalog hit only means the key can discover that model now.

Select the model in dsh after saving. dsh stores the key write-only and does not show it again.

Anthropic Messages inside dsh is a second provider. Choose **Anthropic Messages** and set Base URL to the root `https://api.cheapbuddy.cc`, because that adapter appends `/v1/messages`. Put only Claude public IDs on it. Do not send `deepseek-flash` through Anthropic. Claude Code uses the same Messages protocol; it is not a third API. The [CLI base URL templates](/blog/cli-base-url-templates) list the other clients.

## Check with one small request

Confirm the gateway before chatting in dsh:

```bash
export CHEAPBUDDY_API_KEY="paste the shared key"
curl https://api.cheapbuddy.cc/v1/chat/completions \
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"Reply with OK"}],"stream":false}'
```

An assistant reply means the key, group, and `deepseek-flash` Chat Completions path work. For Claude, change `model` to an authorized public ID such as `claude-sonnet-5-5`. Final charges follow that key’s group multiplier, channel price, and actual token categories. Official rates on the site are references. A small balance is enough for this check; add USD balance from [Pricing](/#pricing) if it is empty.

If curl succeeds and dsh still rejects the call, confirm the protocol is OpenAI Chat Completions and that the base URL was not given an extra `/v1` or `/chat/completions`. Request-shape switches belong to the dsh docs. This article does not promise every reasoning, tool, or image behavior inside dsh.

## FAQ

**401 or a missing credential.** The key is absent, wrong, or its group does not include the model. Copy the current shared key from the [config center](/#generator). An old Claude-only key fails on `deepseek-flash`, and an old OpenAI-only key fails on Claude. The config center does not rebind those keys.

**The model ID does not match, or dsh reports an unknown model.** Use CheapBuddy public IDs in both the request and the dsh model list: `deepseek-flash`, and Claude IDs such as `claude-sonnet-5-5`. Do not use a display name or a different upstream catalog name as the new primary ID. Existing `deepseek/deepseek-v4.1-flash` calls remain a compatibility alias; new configs should send `deepseek-flash`. dsh `UNKNOWN_MODEL` usually means the ID is not saved on this custom provider yet.

**Protocol and base URL were mixed.** OpenAI Chat Completions uses `https://api.cheapbuddy.cc/v1` and lands on `/v1/chat/completions`. Anthropic Messages uses `https://api.cheapbuddy.cc` and lands on `/v1/messages`. Do not put `/chat/completions` in an Anthropic base URL, and do not send `deepseek-flash` with the Anthropic protocol. One dsh provider keeps one protocol.

## Open the config center, then top up if you need to

Sign in at [CheapBuddy](/), open the config center from [config generation](/#generator), and confirm the shared key and base URL before saving them in dsh. Other client steps are in the [setup guide](/#guide). Add balance from [usage-based pricing](/#pricing). It remains one USD balance, billed by model and actual usage. See [why one balance can reach many models](/blog/one-balance-model-routing).

## Disclaimer

CheapBuddy is not affiliated with DeepSeek. DeepSeek Harness, dsh, and its Settings are a DeepSeek developer preview; follow the official docs and the build you installed. CheapBuddy is an OpenAI-compatible gateway with one shared key and usage-based charges on one balance. It does not replace dsh and does not promise dsh session, tool-loop, or other agent behavior. Model restrictions, quota, expiry, disabled status, and balance checks stay in force on the server.
