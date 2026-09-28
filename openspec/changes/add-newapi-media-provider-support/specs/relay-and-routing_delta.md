# Delta: CheapBuddy Relay Routing for Qingyan MiniMax-H3

**Change ID:** `add-newapi-media-provider-support`
**Affects:** CheapBuddy public API, model routing, native NewAPI passthrough

## ADDED

### Requirement: Exact model and path allowlist

Relay MUST publish only the exact verified model name `MiniMax-H3`. It MUST explicitly allow only the tested NewAPI user paths for:

- `POST /v1/videos`, `GET /v1/videos/{id}`, and `GET|HEAD /v1/videos/{id}/content`;
- `POST /v1/responses` and `GET /v1/responses/{response_id}`;
- `GET|HEAD /v1/tasks/{task_id}/artifacts/{artifact_key}/content` for NewAPI host capability URLs emitted by Responses;
- multipart file fields on the tested video submission route; no persistent `/v1/files` route is exposed because the current NewAPI host does not implement that user API.

Relay MUST reject administrative, login, channel-management, plugin-internal, unverified, and wildcard NewAPI paths.

When Responses is exposed through Relay, NewAPI `TaskPublicAddress` MUST be
configured to the Relay public origin. Relay MUST validate the underlying task
ID against the CheapBuddy user's durable mapping before forwarding the
capability request with the encrypted NewAPI shadow token. The capability
query MUST be forwarded unchanged and MUST NOT be logged. A standalone NewAPI
deployment MAY point `TaskPublicAddress` to its own public origin.

### Requirement: Model-routed Responses

Relay MUST route `POST /v1/responses` by the requested model. Existing text models MUST retain their Sub2API path. Exact verified `MiniMax-H3` requests MUST use NewAPI. Relay MUST NOT route an unverified model to NewAPI merely because the path is `/v1/responses`.

#### Scenario: Text Response after video enablement

- GIVEN MiniMax-H3 is enabled
- WHEN a caller submits an existing text model to `POST /v1/responses`
- THEN Relay preserves the existing Sub2API route and behavior
- AND no NewAPI video reservation or task is created

### Requirement: Durable response and video ownership mappings

After a MiniMax-H3 create is accepted, Relay MUST persist response/video ID, upstream, NewAPI request ID, native task ID, CheapBuddy user, and model. `GET /v1/responses/{response_id}`, video retrieve, and video content requests MUST use this mapping before upstream forwarding.

An unknown or foreign response/video ID MUST return a non-enumerating not-found response. Relay MUST NOT guess upstream ownership from an identifier's format, task time, model string, or client input. NewAPI native ownership checks remain required after Relay validation.

### Requirement: Transparent stream and upload proxying

Relay MUST preserve native request bytes, required headers, HTTP status, response envelopes, `Cache-Control`, and NewAPI SSE bytes. It MUST flush SSE incrementally without event parsing, buffering, replay, or provider-specific rewriting. Client disconnect MUST NOT cause Relay to cancel the NewAPI/Qingyan task or issue a second create.

Multipart video submissions MUST preserve the original body and stream through Relay when no idempotency body hash is required. When a client supplies `Idempotency-Key`, Relay may use a bounded, request-scoped temporary disk spool to compute the exact request hash before reservation; the spool MUST be deleted after the request and MUST NOT become media storage. Relay MUST NOT transcode or inspect media contents.

#### Scenario: First streaming bytes

- GIVEN NewAPI accepts a streaming MiniMax-H3 Response before it reaches terminal state
- WHEN Relay proxies it
- THEN the client receives initial SSE bytes before terminal completion
- AND the payload remains NewAPI-owned

### Requirement: Unified identity and safe errors

Relay MUST validate the existing CheapBuddy key through Sub2API and use one encrypted server-side NewAPI shadow token per user. That token MUST NOT reach the client. Relay MUST use the shadow identity for task, file, artifact, and content calls so NewAPI can enforce native ownership.

Relay MUST preserve NewAPI error status/type fields for upstream errors while redacting tokens, private URLs, raw provider debug payloads, and sensitive request content. Relay-generated errors use the existing CheapBuddy error envelope.

### Requirement: Request idempotency and recovery boundary

Relay MUST preserve client `Idempotency-Key` for media creates and treat `X-Request-ID` as trace-only. It MUST persist durable correlation before reconciliation. It MUST NOT replay a provider-facing create on a timeout or missing response; only the tested NewAPI identical-key recovery is permitted.

## MODIFIED

### Requirement: Media model discovery

Relay MUST include MiniMax-H3 in model discovery only after standalone NewAPI verification, exact route policy, multipart input tests, reservation configuration, native bill lookup, streaming/retrieve tests, and ownership tests pass. Existing model discovery remains unchanged.

## REMOVED

- Implicit upstream guessing for Response or video retrieval.
- Relay-owned Qingyan request conversion, polling, callback handling, task persistence, result storage, or event generation.
