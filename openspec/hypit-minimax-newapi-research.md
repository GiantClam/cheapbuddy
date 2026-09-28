# Hypit、MiniMax 与 NewAPI 的最快接入研究

研究范围：当前仓库的 CheapBuddy Go Relay、Hypit Custom Provider、固定的 NewAPI 源码，以及 Hypit 和 MiniMax 官方文档。目标是以最少改动尽快跑通第一个 Hypit Build。

## 结论

最快可行路径是：

```text
Hypit image/video -> CheapBuddy Custom Provider -> CheapBuddy Relay -> NewAPI
Hypit basic TTS   -> CheapBuddy Custom Provider -> CheapBuddy Relay -> NewAPI MiniMax channel
Hypit alignment   -> current victor-upmeet/whisperx route, or HypiHub for the first smoke test
```

MiniMax Voice Design、Voice Clone 和官方 ASR 可以接入，但它们不是当前 NewAPI MiniMax channel 的配置项；它们需要 Provider 或 NewAPI channel adapter 处理不同的请求路径、文件生命周期和响应结构。

## 一手资料事实

### Hypit

Hypit 的 Model、Provider、Endpoint 和 Runtime Profile 分工明确：Model 定义能力和请求含义，Provider 负责服务 API 的 HTTP 映射，Endpoint 持有地址和凭据，Runtime Profile 用 bindings 把 capability 绑定到 Endpoint。不同 API 需要安装或编写不同 Provider，不能只把一个 API key 填入另一个 Provider。[Hypit Models and Providers](https://hypit.ai/guide/providers/)

Hypit 官方 Runtime 文档使用 `endpoints` 和 `bindings` 选择 Provider，并示例了把 `@hypit/whisperx@1#whisperx-alignment` 绑定到本地 WhisperX Endpoint。[Hypit Runtime](https://hypit.ai/guide/runtime/)

Hypit 的时间线语义依赖语音对齐：每个 SemanticTake 需要把音频和 authored Script Segment 对齐，输出每个词的本地时间范围。[Hypit Timing and Assembly](https://hypit.ai/quickstart/timing/)

### MiniMax

当前 MiniMax 官方 API 文档包含以下独立接口：

- `POST /v1/voice_design`：传 `prompt` 和 `preview_text`，返回可用于 TTS 的 `voice_id`。
- `POST /v1/voice_clone`：传已上传音频的 `file_id`、`voice_id` 和可选的 prompt audio/text。
- `POST /v1/speech_to_text`：模型 `asr-1.0`，支持 `verbose_json`、分段时间戳、说话人和 `timestamp_level=word`。
- TTS：HTTP/WebSocket/异步接口，当前文档示例使用 `speech-2.8-turbo` 或 `speech-2.8-hd`。

MiniMax Voice Design 文档说明请求会生成并返回 `voice_id`，后续可以把该 ID 用于语音合成。[MiniMax Voice Design](https://platform.minimax.io/docs/api-reference/voice-design-design)

MiniMax Voice Clone 需要先通过文件上传接口获得 `file_id`；官方文档还说明，克隆声音如果 7 天未使用会被删除。[MiniMax Voice Clone](https://platform.minimax.io/docs/api-reference/voice-cloning-clone)

MiniMax ASR 的请求路径、模型和字段如下：

```text
POST https://api.minimax.io/v1/speech_to_text
model=asr-1.0
response_format=verbose_json
timestamp_level=word
stream=false
```

官方文档限制单个音频最长 500 秒、最大 50 MB；英文 `timestamp_level=word` 返回词级时间戳，中文返回字符级时间戳。[MiniMax Speech-to-Text](https://platform.minimax.io/docs/api-reference/speech-to-text)

### 当前仓库中的 NewAPI

本仓库固定的 NewAPI 版本见 [relay/NEWAPI_PIN.md](../relay/NEWAPI_PIN.md)，当前为 `v1.0.0-rc.30`。

截至本次研究，NewAPI 官方 release 页面已列出 `v1.0.0-rc.38`；但 CheapBuddy 当前固定的是 `rc.30`，而官方仓库中与 MiniMax Voice Clone 相关的实现仍以独立 PR 形式出现。不能因为上游已有 PR 就假定 `rc.30` 或当前生产镜像已经包含该能力；升级 NewAPI 应另开兼容性验证，不放入首次 Hypit 上线链路。[NewAPI Releases](https://github.com/QuantumNous/new-api/releases) · [MiniMax voice-clone PR](https://github.com/QuantumNous/new-api/pull/5201)

对最新官方 `v1.0.0-rc.38` / `main` 源码再次核验：`relay/channel/minimax/adaptor.go` 的 `ConvertAudioRequest` 仍只接受 `RelayModeAudioSpeech`，`GetRequestURL` 的音频分支仍指向 `/v1/t2a_v2`；`relay/constant/relay_mode.go` 仍只有 TTS、Whisper transcription 和 translation 三类音频模式，没有 Voice Design 或 Voice Clone 模式。`constants.go` 的 MiniMax 模型列表仍未列出 `speech-2.8-turbo`。因此最新官方代码确认支持 MiniMax TTS，不确认支持 MiniMax ASR、Voice Design 或 Voice Clone；OpenAI 风格的 `/v1/audio/transcriptions` 路由存在，但不能据此推断 MiniMax channel 已转换到 `/v1/speech_to_text`。[Latest MiniMax adaptor](https://raw.githubusercontent.com/QuantumNous/new-api/main/relay/channel/minimax/adaptor.go) · [Latest relay modes](https://raw.githubusercontent.com/QuantumNous/new-api/main/relay/constant/relay_mode.go) · [Latest MiniMax model list](https://raw.githubusercontent.com/QuantumNous/new-api/main/relay/channel/minimax/constants.go)

该版本的 MiniMax channel 代码位于 `newapi-upstream/relay/channel/minimax/`：

- `GetRequestURL` 对 `RelayModeAudioSpeech` 使用 `/v1/t2a_v2`；
- `ConvertAudioRequest` 只接受 `RelayModeAudioSpeech`，也就是 TTS；
- 该 adaptor 没有把 MiniMax `/v1/speech_to_text`、`/v1/voice_design` 或 `/v1/voice_clone` 接到原生 channel；
- `ModelList` 仍包含 `speech-02-*` 和 `speech-2.5-*` 等旧模型名，当前 MiniMax 官方文档的 `speech-2.8-*` 可以作为手工配置模型，但上线前必须用真实请求验证。

NewAPI 的标准 Relay 路由有 `/v1/audio/speech`、`/v1/audio/transcriptions` 和 `/v1/audio/translations`。CheapBuddy 已经把这些路径转发到 NewAPI，但转发层不会把 `/v1/audio/transcriptions` 自动改成 MiniMax 的 `/v1/speech_to_text`，也不会执行 Voice Design/Clone 的两步文件流程。

NewAPI Advanced Custom 的当前源码适合 OpenAI、Claude、Gemini、图片和 Embeddings 路由；其 endpoint type 判定没有把 `/v1/audio/transcriptions` 作为一个完整的原生 Advanced Custom endpoint 类型。因此不能把 MiniMax ASR 当成已经支持的“填 URL 即用”能力来发布，除非先用真实 NewAPI 版本验证，或增加专门 adaptor。

## 当前 CheapBuddy/Hypit Provider 的限制

### TTS

`hypit-provider/src/provider.mjs` 的 `audioEndpoint` 固定向 CheapBuddy 发送：

```text
POST /v1/audio/speech
{ model, response_format: "mp3", ...compiled.input }
```

`hypit-provider/src/mapping.mjs` 当前把 Mimo capability 映射到：

```text
model: mimo-v2.5-tts-voicedesign
input: text -> input
input: voiceDescription -> voice_description
```

NewAPI MiniMax TTS adaptor识别的是 OpenAI 的 `input`、`voice`、`speed` 以及 MiniMax 扩展 metadata；它不会把 `voice_description` 自动变成 MiniMax 的 Voice Design 请求。因此：

- 普通 TTS 可以通过 MiniMax channel 接入，但应把 Provider 映射到实际 MiniMax TTS 模型并提供 `voice`；
- Hypit 的 `voice-design-1` 需要先调用 `/v1/voice_design` 再使用返回的 `voice_id`，必须增加代码；
- `voice-clone` 需要文件上传、`file_id` 和 `voice_id` 生命周期，也必须增加代码。

### WhisperX

`hypit-provider/src/provider.mjs` 当前固定使用 `victor-upmeet/whisperx`，发送 OpenAI Whisper 风格的：

```text
POST /v1/audio/transcriptions
model=victor-upmeet/whisperx
response_format=verbose_json
timestamp_granularities=segment
timestamp_granularities=word
file=input.wav
```

它随后由 `hypit-provider/src/whisperx.mjs` 读取 `segments[].words[]` 或 `words[]`。MiniMax ASR 使用不同的路径和字段，并且当前官方文档把中文的 `word` 粒度定义为字符级，所以需要一个格式和粒度适配层才能证明它满足 Hypit 的 authored word alignment。

## 最快上线方案

### 阶段 0：只跑通 Hypit 主链路

先只绑定图像、视频和现有 WhisperX；TTS 只在目标 Skill 确实请求语音时启用。Hypit 官方推荐 HypiHub 作为托管的 WhisperX 和生成服务，使用它可以先排除本地 Provider、Relay 和 NewAPI 的联合故障。[Hypit Service Partners](https://hypit.ai/guide/service-partners/)

### 阶段 1：接入 NewAPI 原生 MiniMax TTS

在 NewAPI 管理端创建 MiniMax channel：

```text
Channel type: MiniMax
Base URL:     https://api.minimax.io
API key:      MiniMax Open Platform API key
Model:        speech-2.8-turbo  # 若账户/版本不支持，使用实际可用模型
Route:        native /v1/audio/speech
```

CheapBuddy Relay 增加并配置实际模型 ID，例如：

```text
RELAY_VERIFIED_MODELS=...,speech-2.8-turbo,...
RELAY_RESERVATION_QUOTA_BY_MODEL={"speech-2.8-turbo":100000,...}
RELAY_MEDIA_MULTIPLIER_BY_MODEL={"speech-2.8-turbo":1.0,...}
RELAY_MEDIA_BILLING_MODE_BY_MODEL={"speech-2.8-turbo":"paid",...}
```

然后把 CheapBuddy Provider 的 Mimo TTS service model 改成 `speech-2.8-turbo`，并将请求字段映射为固定的 MiniMax system voice：

```json
{
  "model": "speech-2.8-turbo",
  "input": "...",
  "voice": "<已验证的 MiniMax voice_id>",
  "response_format": "mp3"
}
```

这一阶段不提供 Voice Design/Clone 语义，只验证 Hypit 能生成并消费音频。

### 阶段 2：增加 MiniMax Voice Provider

在 CheapBuddy Provider 内直接调用 MiniMax 原生接口，或者新增独立的 `@cheapbuddy/provider-minimax`：

```text
voice-design -> /v1/voice_design -> voice_id
voice-clone  -> file upload -> /v1/voice_clone -> voice_id
speech       -> TTS with voice_id
```

建议把 `voice_id` 按项目/运行时缓存，并在过期后重新创建。不要把 Voice Design/Clone 伪装成普通 `/v1/audio/speech` 模型，因为它们需要额外的创建动作和输入文件。

### 阶段 3：实验性接入 MiniMax ASR

优先在 Provider 中加一个可切换的 `minimax-asr` backend，直接调用：

```text
POST https://api.minimax.io/v1/speech_to_text
model=asr-1.0
response_format=verbose_json
timestamp_level=word
```

将返回的 `segments` 适配为 Hypit 的 `AlignedTranscriptEvidence`，然后用英文和中文各一条已知音频回归：

- 英文是否有每个 authored word 的 start/end；
- 中文字符时间戳如何合并到 Hypit 的 authored token；
- 分段边界、静音、说话人和采样帧是否仍满足 Hypit 的时间线校验。

回归通过后再把 `victor-upmeet/whisperx` 从默认后端切换到 MiniMax ASR。若目标是最快稳定上线，继续使用当前 WhisperX 路由或 HypiHub，MiniMax ASR 放在 feature flag 后面。

## 不应采用的配置

1. 只在 NewAPI MiniMax channel 中添加 `asr-1.0`，然后调用 `/v1/audio/transcriptions`。当前 NewAPI MiniMax adaptor 的原生音频分支只处理 TTS，MiniMax ASR 的路径也不是 OpenAI 路径。
2. 把 `mimo-v2.5-tts-voicedesign` 直接改名为 `speech-2.8-turbo`，但保留 `voice_description` 字段。MiniMax TTS 需要 `voice_id`；声音描述必须先调用 Voice Design。
3. 让 Relay 直接公开 MiniMax API key 或 MiniMax 的 `/v1/voice_design`、`/v1/voice_clone` 管理接口。CheapBuddy 的公网边界应继续只接受用户 CheapBuddy key，第三方 key 保留在后端配置或 NewAPI channel 中。
4. 没有 `segments[].words[]` 或等价时间证据就宣称 MiniMax ASR 已经替代 WhisperX。Hypit 的时间线需要对齐后的 authored word timing。

## 验证顺序

1. 直接对 MiniMax 做一次 TTS 请求，确认账号、模型、voice_id 和音频格式。
2. 通过 standalone NewAPI 做一次 `/v1/audio/speech`，确认 NewAPI MiniMax channel 返回音频且计费日志存在。
3. 通过 CheapBuddy Relay 做同一请求，确认 `/v1/models` 可看到模型、Relay 保留余额预留/结算并且不泄露 NewAPI token。
4. 用 CheapBuddy Provider 做一个只有文本、图片、视频和 TTS 的 Hypit Build。
5. 单独运行 WhisperX 回归，再测试 MiniMax ASR adapter；不要把两个变量放进同一次首次 Build。

## 研究依据

- Hypit Provider/Runtime 官方文档：见上文链接。
- MiniMax API 官方文档：见上文 Voice Design、Voice Clone、Speech-to-Text 链接。
- 当前仓库源码：`newapi-upstream/relay/channel/minimax/`、`newapi-upstream/relay/channel/openai/`、`newapi-upstream/relay/channel/advancedcustom/`、`relay/`、`hypit-provider/`。
- NewAPI 官方仓库中关于 MiniMax 当前 TTS 已有、Voice Clone 需要额外适配的讨论：[Issue #2399](https://github.com/QuantumNous/new-api/issues/2399)。
