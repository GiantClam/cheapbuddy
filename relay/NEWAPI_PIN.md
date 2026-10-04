# NewAPI staging pin

Use the official NewAPI release below for the first integration environment:

| Item | Value |
| --- | --- |
| Release | `v1.0.0-rc.30` |
| Git commit | `27ff6a8767e728f879d52770c273d4f73214a430` |
| Image | `calciumion/new-api:v1.0.0-rc.30` |
| OCI multi-arch digest | `sha256:94e853de615144b7dd809583ef96434b5539f52072b6e96c6e53354fa422a871` |
| Release date | `2026-08-31` |

The tag and image digest were resolved from the official GitHub repository and
Docker registry on 2026-09-02. Keep the digest in the Railway NewAPI service
image configuration. A floating `latest` tag is not acceptable for the
integration environment.

Railway staging deployed this exact image successfully on 2026-09-02. The
staging deployment reported the same OCI digest and NewAPI startup version.
The staging admin API also confirmed the native user-login and token-creation
contracts used by Relay (`data.access_token` and string `model_limits`).
Provider success evidence is intentionally still pending: the staging NewAPI
instance currently has zero configured channels.

## Provider verification matrix

Before publishing any model through Relay, configure the exact NewAPI channel
and record the native model ID, route, channel type, input matrix, and one
successful submit/query/result probe. For Qingyan video, the probe must also
verify successful-only usage extraction, actual duration and resolution,
Context IR usage, and zero usage on failure/cancellation.

| Family | Requested models | Required evidence |
| --- | --- | --- |
| Image | `gpt-image-2`, `seedream`, `grok`, `qwen-image`, `nanobanana 2` | native image submit, task/result query, bill/log if paid |
| Qingyan video | `MiniMax-H3` | standalone NewAPI direct access, all prompt/frame/reference input modes, request-scoped multipart files, `openai_video`, Responses stream/retrieve, host-supported cancel semantics, artifact authorization, successful-only usage/pricing |
| Other video | `seedance`, `qwen video`, `kling`, `vidu` | native video submit, task query, bill/log if enabled |
| Audio | `minimax`, `suno` | native audio/Suno submit, task/result query, bill/log if paid |

Relay must remain configured with only rows that pass this matrix. The final
provider response and result URL are returned unchanged; CheapBuddy does not
store the media result.
