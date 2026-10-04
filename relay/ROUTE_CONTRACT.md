# Public Route Contract and Node-to-Go Migration

NewAPI is independently deployable and is the primary Qingyan integration
surface. CheapBuddy Relay is optional and only adds unified identity/wallet
policy in front of NewAPI.

## Public routes

| Class | Routes | Upstream | Notes |
| --- | --- | --- | --- |
| Text | `/v1/chat/completions`, `/v1/messages` | Sub2API | Text routing remains unchanged. |
| Responses | `POST /v1/responses`, `GET /v1/responses/{response_id}` | NewAPI for verified media models | Supports `stream`, `sync`, and `background`; NewAPI owns polling and SSE framing. |
| Task artifacts | `GET|HEAD /v1/tasks/{task_id}/artifacts/{key}/content` | NewAPI | Capability URL emitted by Responses; Relay validates task ownership before forwarding it with the shadow token. |
| Models | `GET /v1/models` | Sub2API + Relay media additions | Only verified, reserved, and priced media models are added. |
| Pricing | `GET /v1/pricing?model={model}` | NewAPI account rate card + Relay billing metadata | Bearer-authenticated, read-only model rate lookup; preserves the account's NewAPI rate record and includes the default group ratio, CheapBuddy multiplier, and quota conversion. |
| Image | `/v1/images/generations`, `/v1/images/edits`, `/v1/images/variations`, `/v1/images/tasks/*` | NewAPI | Native request/response format and polling preserved. |
| Video | `/v1/videos`, `/v1/videos/{id}`, `/v1/videos/{id}/content` | NewAPI Task Plugin | Qingyan `MiniMax-H3`; request conversion and result artifacts are owned by NewAPI. |
| Audio/TTS | `POST /v1/audio/speech` | NewAPI | OpenAI-compatible speech synthesis; model selects the configured TTS channel. |
| Audio/STT | `POST /v1/audio/transcriptions`, `POST /v1/audio/translations` | NewAPI | Multipart audio is relayed without persistent file storage; `model` must precede file parts. |
| Music | `/suno/submit/music`, `/suno/submit/lyrics`, `/suno/fetch`, `/suno/fetch/{id}` | NewAPI | Native task contract preserved. |
| Media usage | `GET /v1/usage/dashboard/media` | Relay PostgreSQL | API-key scoped aggregation for the account's recent image/video requests. |
| Temporary media input | `POST /v1/media`, `GET|HEAD /v1/media/{token}` | Relay bounded memory store | Upload requires a CheapBuddy Bearer key; the returned 30-minute URL is readable without a key by NewAPI/provider fetchers. |

All other paths, especially `/admin/*`, `/api/user/*`, `/api/token/*`, login, registration, configuration, and provider-channel paths, are rejected at the public Relay.

`GET /v1/pricing` requires a verified media `model` query and the caller's
CheapBuddy API key. It returns only that model's current NewAPI rate-card row,
the default-group ratio, and Relay billing metadata; the response does not
estimate future task duration or authorize a paid generation. Final media
settlement continues to use successful-task usage.

When Responses is routed through Relay, configure NewAPI `TaskPublicAddress`
to the Relay public origin (for example `https://api.example.com`). NewAPI then
emits capability URLs that remain on the public Relay boundary. In standalone
NewAPI mode, `TaskPublicAddress` may instead be the standalone NewAPI origin.
The capability query is forwarded unchanged and is never logged by Relay.

The current NewAPI Task Plugin API has no persistent user-file CRUD endpoint.
Video inputs use JSON URLs/Data URLs, the Relay's short-lived `/v1/media`
bridge, or multipart fields on the video submission itself; NewAPI converts
multipart fields to request-scoped file placeholders. Relay does not expose a
persistent `/v1/files` API.

## Error and correlation contract

- Relay accepts a safe client `X-Request-ID`; otherwise it generates one and returns it in the response header.
- `X-Request-ID` is trace-only. A media `Idempotency-Key` is optional but is the only create retry key.
- Same key plus the same canonical request reuses the original task/response; same key plus a different request returns `409 idempotency_conflict`.
- Relay never relies on NewAPI to deduplicate a public create. A repeated
  accepted key returns the persisted public identity without submitting again;
  a stream retry receives the current JSON identity because historical SSE is
  not replayed.
- Relay errors use `{ "error": { "type": "...", "message": "..." } }` and never expose internal URLs, tokens, upstream bodies, or provider credentials.
- Text SSE has no Relay response-buffer timeout. Request cancellation is forwarded through Go request contexts.
- Media submission has bounded upstream timeouts. An ambiguous timeout becomes `accepted_unknown`; Relay does not submit it again.

## Migration from Node Relay

| Concern | Node baseline | Go Relay target |
| --- | --- | --- |
| Runtime | Node HTTP server | Go + Chi + `httputil.ReverseProxy` |
| SSE | Response body buffered | Incremental streaming, covered by test |
| Cache/locks/rate limits | No Redis client | Redis cache-aside, locks, rate limits |
| Pricing | NewAPI final quota plus CheapBuddy media multiplier | Qingyan successful-task usage is priced by NewAPI; Relay applies the configured multiplier exactly once |
| Model discovery | Sub2API-only passthrough | Text list + verified media models |
| Idempotency | Request ID correlation only | Canonical request hash plus optional media idempotency key |
| Production service | Node Railway command | Go binary Railway command |

Node source remains in the repository as migration evidence. It must not be the production request path after the Go release gate has passed.
