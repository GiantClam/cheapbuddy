# Implementation Tasks: Qingyan MiniMax-H3 NewAPI Plugin and CheapBuddy Integration

**Change ID:** `add-newapi-media-provider-support`
**Status:** Release-candidate validation complete for the scoped single-Relay rollout; production enablement remains a deliberate operator action.

## Phase 0: Freeze Contracts and Existing Behavior

- [x] Pin the NewAPI image, commit, digest, and Task Plugin API v1 capability set. ✓ 2026-09-18 (`relay/NEWAPI_PIN.md`)
- [x] Verify host hooks for `openai_video`, `openai_responses`, task submit/query, artifact/content, and usage facts from the checked-in Task Plugin API v1 contract. Persistent user files and plugin cancellation hooks are not available in this host contract.
- [ ] Capture redacted Qingyan fixtures for create, query, all terminal states, errors, and `Idempotency-Key` replay. Provider delete/file-upload fixtures are not applicable to the current NewAPI host contract.
- [ ] Verify `MiniMax-H3` limits: `768P`, duration, aspect ratios, content combinations, MIME types, URL/Data URL rules, and request-scoped multipart retention.
- [ ] Record current behavior/tests for text Responses, existing media routes, Hailuo, and text billing.

**Quality Gate:** The pinned host/provider contract is testable and the existing compatibility baseline is recorded.

## Phase 1: Build the Portable NewAPI Plugin

- [x] Create `newapi-plugin/ecophase_minimax_h3/` with metadata, provider mapping, tests, and installation documentation.
- [x] Use only the normal NewAPI Task Plugin API context; do not add direct-versus-Relay flags, CheapBuddy headers, CheapBuddy imports, or billing lookups.
- [x] Claim only exact configured `MiniMax-H3` model matching; do not modify NewAPI core or Hailuo.
- [x] Map create and query to Qingyan; provider delete/cancel remains blocked because Task Plugin API v1 exposes no delete hook.
- [x] Normalize standard NewAPI/OpenAI video and Responses inputs for prompt, first frame, last frame, first-plus-last frame, reference image, reference video, and reference audio.
- [x] Validate safe HTTPS, Data URL, and NewAPI host file placeholders; reject raw `mm_file://`, unsafe schemes, private targets, invalid MIME, incompatible fields, and oversized requests before provider contact.
- [x] Omit/reject `callback_url`; do not add a provider callback, provider SSE/WebSocket client, worker, queue, or independent stream server.
- [x] Send a stable provider `Idempotency-Key`; no new-key recovery path is implemented. The live provider test now proves identical-key replay returns the original task without a second create. ✓ 2026-09-18
- [x] Map `queued`, `running`, `succeeded`, `failed`, `cancelled`, unknown states, and sanitized errors to NewAPI task state.
- [x] Report only documented provider usage facts; do not invent price, quota, duration, resolution, or Context IR usage.
- [x] Return NewAPI artifact capability references, never raw Qingyan result URLs.

**Quality Gate:** Plugin unit tests cover request conversion, every input family, validation, lifecycle, errors, idempotency, file references, artifacts, and origin-agnostic behavior.

## Phase 2: Wire Native NewAPI Protocols and Standalone Deployment

- [x] Implement `openai_video` create/retrieve/content through native NewAPI task/artifact contracts.
- [x] Implement `openai_responses` for `MiniMax-H3` only with `stream`, `sync`, `background`, and retrieve.
- [x] Keep MiniMax-H3 out of chat/text/tool/function/reasoning semantics. ✓ 2026-09-18 (plugin claims only video and Responses task protocols)
- [x] Verify NewAPI polling produces first SSE event and heartbeat without fabricated progress; verify retrieve returns the latest state. ✓ 2026-09-18 (real MiniMax-H3 stream; `response.created`, status events, `: PING`, artifact output, and completion observed)
- [x] Verify background responses return pending immediately and use the same task/billing lifecycle. ✓ 2026-09-18 (real MiniMax-H3 background create returned `queued`; retrieve reached `completed`)
- [x] Defer cancellation: Task Plugin API v1 exposes no ownership-safe delete hook, so CheapBuddy standard APIs do not promise cancellation in this release.
- [x] Verify successful tasks produce a queryable NewAPI bill/log with stable `request_id`; block CheapBuddy enablement if not. ✓ 2026-09-18 (5 real MiniMax-H3 log rows, all with `request_id`, successful-only task settlement)
- [x] Deploy a clean standalone NewAPI instance with its own persistent services, protected admin, user API, Qingyan secret, and local quota policy. ✓ 2026-09-18 (local Docker NewAPI/PostgreSQL/Redis stack; channel #1 configured)
- [ ] Install the same plugin in a second clean NewAPI instance with a different provider credential (portable packaging is verified; second-live-provider deployment is deferred to the next deployment rehearsal).

**Quality Gate:** Both standalone instances complete the provider matrix directly without CheapBuddy services.

## Phase 3: Extend CheapBuddy Relay Without Changing Existing Paths

- [x] Add exact `MiniMax-H3` to the verified model and route policy; production publication remains gated on standalone verification.
- [x] Route `POST /v1/responses` by model: text models remain on Sub2API; MiniMax-H3 goes to NewAPI.
- [x] Persist `response_id`/video ownership mappings after JSON or observed SSE acceptance and use them for response retrieval; unknown IDs return non-enumerating 404.
- [x] Allow `/v1/videos` and video retrieve/content; use NewAPI request-scoped multipart files rather than exposing an unavailable `/v1/files` API.
- [x] Preserve native request bodies, required headers, status, envelopes, `Cache-Control`, and incremental SSE bytes without provider-specific rewriting.
- [x] Stream multipart bodies through Relay when possible; use only a bounded request-scoped temporary spool when an idempotency hash is required.
- [x] Reuse the encrypted per-user NewAPI shadow identity/token mapping; never expose the token. ✓ 2026-09-18 (real single-Relay submission)
- [x] Preserve NewAPI native task/file/artifact authorization and add Relay user ownership checks. ✓ 2026-09-18 (Responses task and capability artifact route)
- [x] Preserve NewAPI error status/type fields while redacting secrets and internal details; keep existing CheapBuddy errors for Relay-generated failures. ✓ 2026-09-18 (callback/invalid-input and artifact probes)
- [x] Keep admin, login, channel, plugin-internal, unverified, and wildcard routes blocked. ✓ 2026-09-18 (route tests and unknown-task probe)

**Quality Gate:** Relay tests cover text Responses regression, MiniMax-H3 Responses routing, video mappings, file streaming, first SSE bytes, disconnect, retrieve, ownership, and path rejection.

## Phase 4: Add CheapBuddy Video Billing and Recovery

- [x] Add a fixed maximum reservation, explicit billing mode, and media multiplier for MiniMax-H3.
- [x] Reserve before a non-idempotent create; reject before NewAPI when balance or reservation configuration is unavailable.
- [x] Preserve client `Idempotency-Key`; same user/key/request uses the persisted correlation path, while a different request returns 409; `X-Request-ID` is trace-only.
- [x] Persist canonical request hash, response/video ID, NewAPI request ID, provider task ID, bill ID, reservation ID, settlement ID, and separate provider/billing lifecycles.
- [x] Release exactly once on clear rejection; retain reservation on ambiguous submission, timeout, 5xx, or missing response.
- [x] Query bills only by persisted NewAPI `request_id`; missing bill enters `pending_reconciliation` without guessing or duplicate capture.
- [x] Capture `NewAPI final quota × CheapBuddy media multiplier` exactly once on successful final bill; release unused reservation.
- [x] Settle failed, cancelled, rejected, and confirmed no-result tasks at zero and release exactly once.
- [x] Keep reservations through SSE disconnect and `background: true`; never infer task result from HTTP connection state.
- [x] Preserve existing text billing behavior in the scoped single-Relay rollout. ✓ 2026-09-18 (Go Relay full test suite)
- [ ] Make reconciliation safe across two Relay instances. Deferred by current release scope; dual-Relay rollout is explicitly not being enabled or accepted in this gate.

**Quality Gate:** Failure-injection tests prove no duplicate provider task, no duplicate wallet operation, correct one-time multiplier, zero failed-task charge, and unchanged text billing.

## Phase 5: Security, Compatibility, and Release

- [x] Run SSRF/input validation, request-size, file ownership, task ownership, artifact authorization, secret-redaction, and provider-URL non-leakage tests. ✓ 2026-09-18 (plugin unit tests plus real Relay probes)
- [x] Run the real provider media subset for last-frame, first-plus-last-frame, reference-image, reference-video, reference-audio, and tested image/video/audio combinations, including idempotency, polling, usage, and HTTPS artifact checks. ✓ 2026-09-18
- [ ] Run the full real-channel provider matrix for all enabled inputs and terminal outcomes.
- [x] Run direct NewAPI and CheapBuddy integration tests for stream/sync/background/retrieve. ✓ 2026-09-18 (real provider through one local Relay)
- [ ] Run disconnect recovery. Deferred follow-up; no automatic provider cancellation or duplicate create is permitted.
- [ ] Verify result download expiry behavior and no permanent CheapBuddy media storage.
- [x] Review the final diff: no NewAPI core/Hailuo changes; no existing text/image/audio behavior changes; only scoped Relay and media billing additions. ✓ 2026-09-18
- [x] Publish standalone plugin installation and CheapBuddy operator runbooks with pinned compatibility, configuration, rollback, and model enablement evidence. ✓ 2026-09-18

## Completion Checklist

- [x] The origin-agnostic plugin works through direct NewAPI and through one local Relay. ✓ 2026-09-18
- [x] NewAPI can be installed independently in another project (portable plugin directory and pinned host contract verified). ✓ 2026-09-18
- [x] CheapBuddy supports `/v1/videos` and model-routed `/v1/responses` with native streaming. ✓ 2026-09-18
- [x] NewAPI bill lookup by `request_id` is proven. ✓ 2026-09-18
- [x] Successful video usage settles once; clear rejection releases; existing text billing is unchanged in the scoped tests. ✓ 2026-09-18
- [x] Ready for scoped single-Relay `/openspec-apply add-newapi-media-provider-support`; dual-Relay and second-live-instance rehearsals remain deferred.

## Open blockers

- Go 1.27.0 is available locally; the frontend build was generated for verification, and the NewAPI root build passes. The full NewAPI suite still reports two unrelated baseline `service` channel-affinity cache assertions (`actual int64(3/4)` versus isolated expected `int(2/1)`); the plugin and Relay packages are clean. This change does not modify that service code.
- A second clean NewAPI live-provider rehearsal, provider-forced terminal-failure fixtures, disconnect recovery, and expiry-after-provider-retention validation remain follow-up evidence; they are not enabled in the current single-Relay rollout.
- The current NewAPI host has no persistent `/v1/files` plugin surface. Multipart request-scoped files are implemented; raw `mm_file://` and public file CRUD remain intentionally disabled until the host contract adds ownership-checked file storage.
