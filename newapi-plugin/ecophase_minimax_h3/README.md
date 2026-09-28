# EcoPhase MiniMax-H3 NewAPI plugin

The executable plugin source is embedded by the checked-in NewAPI tree at:

`newapi-upstream/plugins/tasks/ecophase_minimax_h3/plugin.js`

That location is the portable install unit for NewAPI Task Plugin API v1. Copy
the directory into another compatible NewAPI checkout under
`plugins/tasks/ecophase_minimax_h3/`, then rebuild NewAPI. No CheapBuddy,
Relay, Sub2API, callback service, worker, or queue is required.

Configure a NewAPI Task Plugin channel with:

- model: `MiniMax-H3`
- base URL: `https://ecotoken.ecophase-ai.com`
- provider API key: stored server-side in the NewAPI channel
- plugin key: `ecophase_minimax_h3`

The plugin claims NewAPI's native `/v1/videos` and `/v1/responses` protocol
bindings. Responses supports `stream`, synchronous, and background creation;
the host owns polling, persistence, SSE framing, heartbeats, retrieval, and
artifact capability URLs. The plugin never exposes the provider's short-lived
download URL to a client.

Provider `callback_url`, webhook, provider SSE, and provider WebSocket are not
used. Multipart inputs are converted by the host to bounded Data URLs; callers
may also provide safe HTTPS or Data URLs. Raw `mm_file://<file_id>` values are
rejected because this Task Plugin API does not expose a persistent user-file
registry to plugins, so accepting them would bypass ownership checks.

Successful tasks return a short-lived Qingyan OSS URL. The plugin exposes it
only through NewAPI's artifact capability and marks the downstream request as
credentialless because the signed URL itself is the credential; the Qingyan
API key is never forwarded to the OSS host.

For a mixed image-plus-reference-video request, mark the image as
`reference_image` (for Responses, set the `input_image` part's `role` to
`reference_image`). Qingyan rejects mixing a frame role such as
`first_frame` with a reference-video role; a plain image-only request may keep
the default first-frame behavior.

## Live provider test in this checkout

Keep provider credentials in the ignored `newapi-upstream/.env.local` file:

```text
MINIMAX_H3_BASE_URL=https://ecotoken.ecophase-ai.com
MINIMAX_H3_API_KEY=<server-side-key>
MINIMAX_H3_REAL_PROVIDER=1
```

Load that file into the test process and run the opt-in integration test:

```powershell
Get-Content .env.local | Where-Object { $_ -match '^[A-Z0-9_]+=.*$' } | ForEach-Object {
  $pair = $_ -split '=', 2
  Set-Item -Path ("Env:" + $pair[0]) -Value $pair[1]
}
go test ./plugins -run '^TestMiniMaxH3RealProvider$' -count=1 -v
```

The test exercises the plugin request and response hooks against Qingyan,
polls to a terminal state, validates provider usage and the HTTPS artifact URL,
and replays the same provider idempotency key. It is opt-in because it creates
a billable real video task.

The media matrix test additionally requires `MINIMAX_H3_IMAGE_URL`,
`MINIMAX_H3_REFERENCE_VIDEO_URL`, and `MINIMAX_H3_AUDIO_URL`, then runs frame,
reference-image, reference-video, reference-audio, and their tested legal
combinations against the real provider:

```powershell
$env:MINIMAX_H3_REAL_PROVIDER_MEDIA = '1'
go test ./plugins -run '^TestMiniMaxH3RealProviderMediaMatrix$' -count=1 -v
```
