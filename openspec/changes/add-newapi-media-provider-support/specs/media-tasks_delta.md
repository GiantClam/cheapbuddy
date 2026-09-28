# Delta: Qingyan EcoPhase MiniMax-H3 NewAPI Tasks

**Change ID:** `add-newapi-media-provider-support`
**Affects:** NewAPI Task Plugin, OpenAI Video, OpenAI Responses

## ADDED

### Requirement: Origin-agnostic portable plugin

NewAPI MUST provide an independently installable `ecophase_minimax_h3` Task Plugin in `newapi-plugin/ecophase_minimax_h3/` using Task Plugin API v1. In a NewAPI checkout, the source MUST be installed at `plugins/tasks/ecophase_minimax_h3/plugin.js` so the existing embed registry includes it. It MUST NOT modify NewAPI core, native task tables, database schema, or existing provider/Hailuo plugins.

The plugin MUST receive only the ordinary NewAPI Task Plugin API context. It MUST NOT detect, branch on, accept, read, or require a direct-versus-Relay marker, CheapBuddy header, CheapBuddy user identity, Relay database record, wallet state, billing mode, or CheapBuddy runtime configuration.

#### Scenario: Relay-originated request

- GIVEN Relay forwards an authenticated request with the user's NewAPI shadow token
- WHEN NewAPI invokes the plugin
- THEN the plugin receives the same host task contract as for direct NewAPI ingress
- AND it performs no source-specific branching

### Requirement: Qingyan provider contract

The plugin MUST use NewAPI channel configuration for `https://ecotoken.ecophase-ai.com`, provider model `MiniMax-H3`, `POST /v2/video_generation`, `GET /v2/query/video_generation/{task_id}`, and the documented provider lifecycle. Request-scoped multipart files MUST use NewAPI Task Plugin file placeholders. The current NewAPI Task Plugin API does not expose a persistent user-file registry or a plugin file-upload route, so the first release MUST NOT claim a public `/v1/files` or raw `mm_file://` capability. The Qingyan API key MUST be a server-side NewAPI channel secret.

The plugin MUST not expose raw Qingyan request JSON, provider endpoint selection, provider headers, or credentials to clients.

### Requirement: Standard native protocols

The plugin MUST claim `openai_video` for native task create, retrieve, and artifact/content access. It MUST claim `openai_responses` with `stream`, `sync`, `background`, and retrieve for `MiniMax-H3` video tasks only.

MiniMax-H3 Responses support MUST NOT imply support for text chat, tool calls, function calls, reasoning parameters, or general non-video Responses behavior.

#### Scenario: Background response

- GIVEN a valid MiniMax-H3 Response request specifies `background: true`
- WHEN NewAPI accepts the task
- THEN NewAPI returns a pending response immediately
- AND later retrieve returns the latest persisted task state

### Requirement: Complete validated input matrix

The plugin MUST support text prompt, first frame, last frame, first-plus-last frame, reference image, reference video, and reference audio inputs. It MUST accept only safe HTTPS URLs, valid Data URLs inside documented JSON limits, and NewAPI host-authorized request-scoped file placeholders produced from multipart input.

Before provider submission, the plugin MUST validate field combinations, URL/Data URL structure, MIME type, per-file size, total request size, and authorized file ownership. It MUST reject HTTP, file, localhost, private-network, cloud-metadata, arbitrary-scheme, unregistered-file, unsafe MIME, invalid, and oversized input without calling Qingyan.

#### Scenario: First and last frame

- GIVEN a valid request contains first-frame and last-frame inputs
- WHEN the plugin builds the Qingyan request
- THEN both inputs appear in their documented provider positions
- AND neither input is dropped

#### Scenario: Authorized multipart placeholder

- GIVEN an authenticated NewAPI user submits a supported multipart input
- WHEN the host converts that input to an authorized file placeholder
- THEN the plugin passes the reference through the documented provider mapping
- AND it does not read, copy, or permanently store the file itself

Raw client-supplied `mm_file://{file_id}` values MUST be rejected until a future NewAPI host capability provides an ownership-checked file registry.

### Requirement: Polling, host streaming, and callbacks

The plugin MUST submit using a stable Qingyan `Idempotency-Key` and retain native/provider correlation. It MUST map `queued`, `running`, `succeeded`, `failed`, `cancelled`, and unknown provider states to NewAPI lifecycle state with sanitized errors.

NewAPI, not the plugin, MUST manage polling scheduling, task persistence, SSE framing, heartbeat, and retrieve behavior. Streaming events MUST represent observed transitions and MUST NOT invent percentage progress. Client disconnect MUST NOT cancel provider work, and retrieve MUST return the latest persisted state without promising historical SSE replay.

The plugin MUST omit/reject client `callback_url` and MUST NOT require or implement a provider callback receiver, provider SSE client, provider WebSocket client, plugin worker, queue, or independent stream server.

#### Scenario: Stream disconnect

- GIVEN a client disconnects from a streaming MiniMax-H3 Response
- WHEN Qingyan continues the task
- THEN NewAPI retains and polls the task
- AND later retrieve returns the latest state

### Requirement: Ambiguous create recovery

The plugin MUST NOT recover an ambiguous provider create with a new idempotency key. NewAPI MAY issue the identical provider operation with the same key only after fixtures and a real-channel test demonstrate that Qingyan returns the original task without duplicate work. Otherwise the task MUST remain `accepted_unknown` for reconciliation.

### Requirement: Artifact, file, and cancellation boundary

Request-scoped multipart file references, task retrieval, artifact access, and video content MUST enforce NewAPI user ownership. A cross-user access attempt MUST return a non-enumerating not-found response. Persistent file metadata/content/delete is outside the current NewAPI Task Plugin API and is not exposed by this change.

Successful results MUST use NewAPI artifact capability/content URLs. Raw Qingyan result URLs, unneeded provider identifiers, and provider credentials MUST NOT be emitted in public task, response, file, artifact, or error payloads.

Qingyan delete/cancel semantics MAY be available only through a tested, NewAPI-native, ownership-safe internal route. Standard video and Responses APIs MUST NOT promise public cancellation in the first release.

## MODIFIED

### Requirement: Model publication

NewAPI MUST publish an exact `MiniMax-H3` alias only after the pinned host, configured channel, full input matrix, task lifecycle, native protocols, usage/bill hook, and security tests pass in a standalone NewAPI environment.

## REMOVED

- A Relay-owned provider adapter, task poller, custom event generator, callback endpoint, or provider WebSocket bridge.
- Raw Qingyan JSON as a public client protocol.
- Permanent CheapBuddy media storage or client-visible Qingyan result URLs.
