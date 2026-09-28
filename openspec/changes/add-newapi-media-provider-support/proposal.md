# Proposal: Qingyan MiniMax-H3 NewAPI Plugin with CheapBuddy Integration

**Change ID:** `add-newapi-media-provider-support`
**Status:** Implementation in progress; standalone and real-channel gates remain open
**Scope:** A portable NewAPI provider plugin plus the CheapBuddy Relay and media-settlement integration required to expose it

## Problem Statement

Qingyan EcoPhase exposes `MiniMax-H3` through an asynchronous video-generation API. NewAPI needs a provider adapter that converts a standard video task into Qingyan requests, polls task state, handles temporary media references, and exposes results through NewAPI's native video and Responses protocols.

The same plugin must be portable to another standalone NewAPI deployment. CheapBuddy must also expose the model through its existing single-key API, which requires Relay route changes, native streaming passthrough, user/task correlation, and media billing reconciliation. These are separate responsibilities around one NewAPI plugin; they are not two plugin modes.

## Final Decisions

| Concern | Decision |
| --- | --- |
| Plugin | Portable `newapi-plugin/ecophase_minimax_h3/` package, embedded for this checkout at `newapi-upstream/plugins/tasks/ecophase_minimax_h3/`, using NewAPI Task Plugin API v1 |
| Plugin awareness | Origin-agnostic; it cannot know whether NewAPI was called directly or through Relay |
| NewAPI core/Hailuo | No core, schema, native task-table, or Hailuo plugin changes |
| Provider | Qingyan base URL `https://ecotoken.ecophase-ai.com`, provider model `MiniMax-H3` |
| Provider lifecycle | Create/query; NewAPI polls; request-scoped multipart file placeholders; no callback/Webhook/provider SSE/WebSocket dependency |
| Public NewAPI API | Standard `openai_video` and `openai_responses` with `stream`, `sync`, and `background` |
| CheapBuddy API | `/v1/videos` and model-routed `/v1/responses`; text Responses remain on Sub2API |
| Streaming | NewAPI generates SSE from its persisted task observations; Relay only flushes bytes through |
| Files | NewAPI request-scoped multipart files; the current host has no persistent `/v1/files` registry, so raw `mm_file://` is rejected |
| Billing | NewAPI produces the technical final quota/bill; CheapBuddy applies its configured media multiplier once |
| Existing behavior | Existing text, image, audio, other model, and Hailuo behavior remains unchanged |
| Storage | No permanent CheapBuddy media store; results use NewAPI artifacts and Qingyan retention semantics |

## Architecture and Responsibility Boundary

```text
Direct NewAPI ingress:
Client -> NewAPI -> ecophase_minimax_h3 plugin -> Qingyan

CheapBuddy ingress:
Client -> CheapBuddy Relay -> NewAPI -> ecophase_minimax_h3 plugin -> Qingyan
            |                  |
            |                  +-- native task state, polling, artifacts, request/bill
            +-- identity, route policy, reservation, settlement
```

The plugin is invoked inside NewAPI. It receives only the normal NewAPI Task Plugin API context after NewAPI authentication and request normalization. It MUST NOT read or receive a Relay marker, CheapBuddy header, source URL, CheapBuddy user ID, Relay database record, wallet state, or billing mode. Direct NewAPI ingress and CheapBuddy ingress therefore execute the same plugin logic.

NewAPI owns provider adaptation, task persistence, polling, response snapshots, request-scoped multipart files, artifacts, and native usage/bill records. Relay owns public CheapBuddy identity, model/path policy, NewAPI shadow-token use, customer-wallet reservation/settlement, and integration correlation. Relay does not translate Qingyan JSON, poll Qingyan, generate SSE events, or store media bytes.

## NewAPI Plugin Contract

The independently installable package `newapi-plugin/ecophase_minimax_h3/` contains the executable plugin source and installation/configuration documentation. This checkout mirrors the source into `newapi-upstream/plugins/tasks/ecophase_minimax_h3/`, which is the upstream embed location; the upstream test suite lives beside the embedded plugin. It claims:

- `openai_video` for create, retrieve, and artifact/content access;
- `openai_responses` for `stream`, `sync`, `background`, and retrieve.

The provider mapping is:

| Operation | Qingyan API |
| --- | --- |
| Create | `POST /v2/video_generation` |
| Query | `GET /v2/query/video_generation/{task_id}` |
| Delete/cancel | `DELETE /v2/video_generation/{task_id}` |
| Request-scoped file input | NewAPI Task Plugin multipart file placeholders |

The provider key is a server-side NewAPI channel secret. The plugin accepts standard NewAPI/OpenAI request shapes and controlled, documented extensions only. Clients MUST NOT submit raw Qingyan request JSON or arbitrary provider endpoints/headers.

The first release supports prompt, first frame, last frame, first-plus-last frame, reference image, reference video, and reference audio inputs. Accepted references are safe HTTPS URLs, valid Data URLs within the provider JSON limit, and NewAPI host-authorized request-scoped multipart placeholders. Raw `mm_file://{file_id}` values are rejected because the current host does not expose an ownership-checked persistent file registry. The plugin validates content combinations, MIME type, size, and URL syntax before provider submission.

Qingyan states `queued`, `running`, `succeeded`, `failed`, and `cancelled` map to the NewAPI task lifecycle. The plugin maps provider errors to sanitized NewAPI errors and reports only documented provider usage facts. It does not invent duration, resolution, Context IR usage, price, or quota.

The plugin omits and rejects client `callback_url`. Qingyan callback delivery is not a dependency. The plugin does not provide a callback receiver, provider SSE client, provider WebSocket client, worker, queue, or independent streaming server.

For one NewAPI task, the plugin uses a stable Qingyan `Idempotency-Key`. It MUST never recover an ambiguous submission by creating with a new key. The NewAPI host may retry the identical operation with the same key only after fixtures and a real-channel test prove that Qingyan returns the original task without duplicate work. Otherwise the task remains `accepted_unknown` for reconciliation.

## NewAPI Public Protocols and Streaming

`POST /v1/videos` is the standard asynchronous video task surface. `POST /v1/responses` is a video-task Responses surface for the `MiniMax-H3` model only. It supports `stream`, `sync`, and `background`; it is not a promise that MiniMax-H3 is a text chat, tool-calling, function-calling, or general reasoning model.

NewAPI, not the plugin, owns polling scheduling, task persistence, host SSE framing, heartbeat, and retrieve behavior:

- `stream: true` emits NewAPI SSE based on observed state transitions;
- NewAPI sends a prompt first event and host-configured heartbeats, but never fabricates percentage progress;
- `sync` waits within bounded host limits;
- `background: true` returns a pending response immediately and uses retrieve as the completion path;
- client disconnect does not cancel provider work;
- reconnect retrieves the latest persisted state and does not promise historical SSE replay.

NewAPI's native artifact/content surface hides raw Qingyan result URLs. Result URLs are temporary and are not converted into permanent CheapBuddy assets.

## CheapBuddy Relay Integration

Relay keeps one user-facing CheapBuddy API key. It resolves the existing Sub2API identity, creates or reuses one encrypted NewAPI shadow token per user, and forwards requests with that token. NewAPI remains responsible for native task, file, and artifact ownership.

Relay adds explicit MiniMax-H3 route policy:

- `POST /v1/videos`, `GET /v1/videos/{id}`, and `GET|HEAD /v1/videos/{id}/content`;
- `POST /v1/responses` and `GET /v1/responses/{response_id}`;
- multipart file fields on the tested video submission route; no persistent file CRUD routes.

`POST /v1/responses` is model-routed: ordinary text models continue to Sub2API, while exact `MiniMax-H3` requests go to NewAPI. Relay persists `response_id -> upstream -> NewAPI request/task -> user -> model` after acceptance. It uses that mapping for response retrieval; an unknown response ID returns a non-enumerating 404 instead of being guessed or broadcast to an upstream.

Video creation similarly persists `video_id -> NewAPI request/task -> user -> model` and uses the mapping for retrieve/content authorization. NewAPI performs a second native ownership check.

Relay preserves native request body bytes, required headers, status codes, response envelopes, `Cache-Control`, and SSE frames. It does not parse or rewrite NewAPI event bodies. Multipart video uploads stream through Relay when no request hash is required; an idempotent create may use a bounded request-scoped disk spool to compute an exact hash, which is removed after the request. Relay does not transcode or persist media.

Relay preserves NewAPI error status/type fields while filtering internal URLs, tokens, raw provider debug bodies, and sensitive request data. Relay-generated errors such as insufficient balance, disabled model, missing mapping, and reconciliation pending use the existing CheapBuddy error contract.

## Billing, Reservation, and Recovery

NewAPI native billing is a hard prerequisite for CheapBuddy enablement. A successful plugin task must produce a queryable NewAPI bill/log with a stable `request_id`. Relay uses that `request_id` as the only bill lookup correlation. Missing bills enter `pending_reconciliation`; Relay never guesses from model, task ID, prompt, time window, or provider response.

For CheapBuddy media requests:

1. Relay checks the exact `MiniMax-H3` model and configured media billing mode.
2. Relay reserves a configured fixed maximum in the existing Sub2API wallet before a non-idempotent create.
3. A clear NewAPI rejection releases the reservation exactly once.
4. An accepted task keeps the reservation even if the SSE client disconnects or the request uses `background: true`.
5. A successful final NewAPI bill is multiplied once by the configured CheapBuddy media multiplier and captured exactly once.
6. Failed, cancelled, rejected, and confirmed no-result tasks settle at zero and release the reservation exactly once.
7. A provider timeout, 5xx, missing response, or other ambiguous outcome becomes `accepted_unknown`; Relay does not create again. Only the tested NewAPI identical-key recovery described above is permitted.

The Relay integration record stores user identity, canonical request hash, client idempotency key, provider idempotency key, public response/video ID, NewAPI request ID, NewAPI bill ID, Qingyan task ID, reservation ID, settlement ID, provider lifecycle, billing lifecycle, and sanitized error. Provider and billing state are separate and transitions are idempotent across Relay instances.

The media multiplier is applied in Relay/Sub2API settlement only. It is not applied in NewAPI and is not applied twice by Relay. Existing text billing and historical accounting behavior are unchanged.

## Security and Data Ownership

- Only safe HTTPS URLs, valid Data URLs, and NewAPI host-authorized request-scoped file placeholders are accepted; raw `mm_file://` references are rejected.
- HTTP, file, localhost, private-network, cloud-metadata, arbitrary-scheme, unregistered-file, arbitrary-endpoint, and arbitrary-provider-header inputs are rejected.
- NewAPI owns task, file, artifact, and provider credential secrets.
- Relay owns only its integration mappings, reservations, and settlement records.
- Cross-user task/file/artifact access returns a non-enumerating 404.
- NewAPI and Sub2API are private upstreams in CheapBuddy production; only Relay is the user API boundary.
- A standalone NewAPI deployment may expose its native user API, but administration/channel configuration remains separately protected.

## Compatibility and Release Gates

Existing text, image, audio, other video, Hailuo, and text-Responses behavior MUST remain unchanged. Only exact, verified `MiniMax-H3` model matching enters this new path. Missing MiniMax-H3 configuration or verification MUST reject that model without preventing other models from starting.

Release requires:

1. a pinned NewAPI build proving all required Task Plugin API v1 hooks;
2. a standalone NewAPI smoke test covering every input family, request-scoped multipart handling, create/query/result, stream/sync/background/retrieve, errors, timeout, and host-supported cancellation behavior;
3. a second clean NewAPI installation proving plugin portability;
4. Relay tests covering model-level Responses routing, response/video mappings, streamed uploads, first SSE bytes, disconnect recovery, ownership, and rejected administrative paths;
5. billing tests covering reservation, final NewAPI bill lookup by `request_id`, one-time multiplier application, failure release, accepted-unknown, duplicate reconciliation, and two Relay instances;
6. a source review proving no NewAPI core/Hailuo/text-billing behavior changed.
