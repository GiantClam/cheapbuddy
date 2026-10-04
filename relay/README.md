# CheapBuddy Go Relay

Railway-only, API-first optional Relay for CheapBuddy. It is implemented in Go with Chi and `httputil.ReverseProxy`; it fronts Sub2API text APIs and an independently deployable NewAPI media API.

The Relay does not provide a creative UI, media storage, provider adapter, custom task protocol, webhook, WebSocket, queue, or automatic media-submit retry. Provider adaptation belongs to the NewAPI Task Plugin. The Relay preserves the approved upstream contracts and streams Responses SSE without buffering. Video multipart inputs use NewAPI request-scoped file placeholders; no persistent file API is added.

The pinned NewAPI release is in [NEWAPI_PIN.md](NEWAPI_PIN.md). Do not use a floating `latest` tag in staging or production.

## Runtime configuration

All values below are Railway secrets/configuration, never frontend variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Relay-owned PostgreSQL schema connection. |
| `REDIS_URL` | Relay Redis ACL/prefix connection. |
| `SUB2API_INTERNAL_URL` | Railway-private Sub2API base URL. |
| `NEWAPI_INTERNAL_URL` | Railway-private NewAPI base URL. |
| `SUB2API_RELAY_SERVICE_TOKEN` | Sub2API private identity/wallet bridge credential. |
| `NEWAPI_ADMIN_TOKEN` | Server-only NewAPI admin credential. |
| `RELAY_TOKEN_ENCRYPTION_KEY` | Encrypts stored NewAPI shadow tokens. |
| `RELAY_INTERNAL_ADMIN_TOKEN` | Restricts internal targeted cache purge. |
| `RELAY_PUBLIC_URL` | Optional public origin used for short-lived media URLs; when omitted, Relay derives the origin from the request and trusted proxy headers. |
| `RELAY_VERIFIED_MODELS` | Comma-separated media models allowed by Relay. |
| `RELAY_VISIBLE_MEDIA_MODELS` | Optional subset of verified media models shown by `/v1/models`; omitted means all verified models are shown. Hidden verified models remain callable by ID. |
| `RELAY_MEDIA_CAPABILITIES_BY_MODEL` | Optional JSON capability overrides for verified models whose upstream API endpoint metadata does not describe media actions (for example, a video task exposed through an OpenAI Responses endpoint). |
| `RELAY_RESERVATION_QUOTA_BY_MODEL` | JSON bounded reservation per media model. |
| `RELAY_MEDIA_MULTIPLIER_BY_MODEL` | JSON customer multiplier applied once to the final NewAPI quota. |
| `RELAY_MEDIA_BILLING_MODE_BY_MODEL` | Explicit `disabled`/`free`/`paid` mode per media model. Qingyan uses NewAPI final usage when enabled. |

For the first Hypit trial, add the exact NewAPI model IDs
`gpt-image-2`, `doubao-seedance-2-0-mini-260615`, `MiniMax-H3`,
`mimo-v2.5-tts-voicedesign`, `fishaudio/voice-design-1`,
`fishaudio/voice-clone`, and `victor-upmeet/whisperx` to the verified model,
reservation, multiplier, and billing maps. The corresponding public media
routes are `/v1/images/*`, `/v1/videos`, `/v1/audio/speech`, and
`/v1/audio/transcriptions`.

`RELAY_VERIFIED_MODELS` and billing mode must agree. `MiniMax-H3` requires an
explicit billing mode before it is routed; legacy verified media models retain
the paid default for compatibility. A model missing verification is neither
routed nor returned by `/v1/models`. `RELAY_VISIBLE_MEDIA_MODELS` can hide a
verified legacy model from discovery without removing its request route or
authenticated `/v1/models/{id}` detail lookup. Optional settings include route allowlists,
CORS, rate limits (including `RELAY_AUTH_RATE_LIMIT`), and cache TTLs. Identity
cache defaults to `180s`; mapping cache defaults to `30m`.

`RELAY_MEDIA_CAPABILITIES_BY_MODEL` maps verified model IDs to explicit media
capabilities, for example
`{"MiniMax-H3":["text_to_video","image_to_video","reference_to_video"]}`.
Capabilities from text, media, model-detail, and override metadata are merged
so a model exposed through more than one API surface remains available in each
compatible ComfyUI node.

## Public behavior

```text
api.cheapbuddy.cc
  -> Go Relay
       -> Sub2API: identity, text, wallet reservation/capture/release
       -> NewAPI: Qingyan MiniMax-H3 Task Plugin, polling, Responses SSE, result artifact
```

- Text uses the customer API Key with Sub2API.
- Media uses a lazy, encrypted NewAPI shadow token that never reaches clients.
- `GET /v1/usage/dashboard/media` uses the customer API Key to return recent media usage grouped by model; it never exposes NewAPI identities or credentials.
- Routing is path-first and model-assisted for compatible completion routes.
- Only explicit user paths are accepted; admin, login, configuration, and unknown paths are rejected.
- A media `Idempotency-Key` is the retry key. `X-Request-ID` is trace-only. Without an idempotency key, each media write is independent.
- Same key plus the same canonical request returns the original task/response; same key plus a different request returns 409.
- Replays are served from the Relay correlation record; Relay never asks
  NewAPI to create a second task for an already accepted idempotency key.
- A clear NewAPI rejection releases the reservation. Ambiguous timeouts enter `accepted_unknown` and are never resubmitted by Relay.
- Qingyan MiniMax-H3 uses NewAPI's polled task observation. Provider callback, provider SSE, and provider WebSocket are not required.
- `POST /v1/media` accepts an authenticated image, video, or audio body up to the
  Relay body limit and returns a 30-minute public URL. `GET /v1/media/{token}`
  serves the temporary bytes without an API key so NewAPI's provider can fetch
  them. The store is process-local, bounded, and not a permanent asset store;
  clients must upload again after expiry or a Relay restart.

For multipart `/v1/videos` requests, put the `model` form field before file
parts. Requests without an idempotency key can be inspected up to that field
and then replayed byte-for-byte to NewAPI. Requests with an idempotency key use
an ephemeral bounded disk spool so Relay can compute the exact request hash
before reserving wallet quota; the spool is deleted when the request closes.
Once an idempotent multipart body is fully spooled, media submission runs on a
detached context so a client or edge disconnect after upload does not cancel
NewAPI task acceptance. Use a unique `Idempotency-Key` for large multipart
uploads; the public API remains the existing upload-then-poll task contract.

NewAPI owns asynchronous tasks and provider result URLs. Clients poll native task paths through this public domain and download results before provider URL expiry. CheapBuddy stores only request-scoped input media in the bounded 30-minute Relay memory store described above; it does not retain a permanent asset copy. Raw `mm_file://` provider references are rejected because the current host has no ownership-checked persistent file registry.

Responses artifact URLs use NewAPI's host capability path
(`/v1/tasks/{task_id}/artifacts/{key}/content`). In Relay mode, set NewAPI
`TaskPublicAddress` to the Relay public origin so emitted URLs stay on the
public boundary; Relay checks task ownership before forwarding the capability
request with the encrypted shadow token. In standalone NewAPI mode, point
`TaskPublicAddress` at the standalone NewAPI origin.

## Billing, state, and capacity

Sub2API is the only customer wallet and recharge ledger for Relay users. Qingyan
MiniMax-H3 successful-task usage is priced by NewAPI from actual duration,
resolution, and Context IR facts. Customer settlement is `NewAPI final quota ×
RELAY_MEDIA_MULTIPLIER_BY_MODEL` exactly once. Failed and cancelled tasks
settle at zero; the multiplier is not applied in NewAPI or twice in Relay.

For every media submission, the integration record persists the NewAPI request
ID separately from the provider task ID. Unknown submissions retain their
reservation until they are resolved; the reconciler never guesses from a
time-window or silently retries a non-idempotent create.

PostgreSQL persists mappings, reservations, tasks, bills, and settlements. Redis is non-authoritative: it caches identity for 180 seconds and mappings for 30 minutes, and coordinates rate limits and short locks. Each cache operation has a 250ms deadline with no client retry, so Redis loss falls back to Sub2API/PostgreSQL instead of consuming the upstream request timeout; unavailable fact sources still fail closed.

The current release gate validates one Relay instance. A multi-instance Relay
deployment and cross-instance reconciliation failover are explicitly deferred;
do not enable a second Relay until the separate HA rehearsal proves leader-lock,
duplicate-capture, and disconnect recovery behavior.

## Local verification

```powershell
cd relay
go test ./...
go vet ./...
go build ./cmd/relay
```

For a Docker-only contract check with local PostgreSQL, Redis, and disposable
mock upstreams (no real provider credentials), run this from the repository
root:

```powershell
docker compose -f docker-compose.local.yml up --build -d
```

The Relay is available at `http://127.0.0.1:18080`; the mock is exposed only
for assertion at `http://127.0.0.1:18081`. Tear the stack down with
`docker compose -f docker-compose.local.yml down -v` after verification.

Run the repeatable local concurrency checks from `relay/` while that stack is
up. The local Compose file raises only its test rate limits; it never changes
production limits. The load client explicitly disables environment proxy use
and targets only `127.0.0.1`, so these checks do not traverse a VPN or proxy.

```powershell
go run ./test/integration/load -base http://127.0.0.1:18080 -mode text -requests 300 -concurrency 100
go run ./test/integration/load -base http://127.0.0.1:18080 -mode media -requests 100 -concurrency 50 -run-id local-run-001
```

The text workload verifies SSE first-event and `[DONE]` delivery without
cookies. The media workload uses unique idempotency keys and expects the local
mock's clear native rejection, which lets it verify exactly one reservation
and release per request without a provider call.

Railway builds `bin/relay` from `./cmd/relay` and starts it directly. The Relay applies its own PostgreSQL migrations at startup using only its service role.

## Boundaries

Only Relay is public for user API traffic. Sub2API and NewAPI user APIs use Railway private networking. Native admin UIs remain separate protected operator domains; `admin.cheapbuddy.cc` checks native Sub2API admin permission and links to them without forwarding sessions or implementing SSO.

Read [ROUTE_CONTRACT.md](ROUTE_CONTRACT.md), [STAGING.md](STAGING.md), and [RUNBOOK.md](RUNBOOK.md) before enabling a model or changing the public domain.
