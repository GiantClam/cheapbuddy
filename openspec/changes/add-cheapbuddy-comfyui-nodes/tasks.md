# Implementation Tasks: CheapBuddy ComfyUI Nodes and Dynamic Model Discovery

**Change ID:** `add-cheapbuddy-comfyui-nodes`

## Phase 0: Confirm Upstream Contracts

- [ ] 0.1 Capture `/v1/models` and `/v1/models/{model_id}` examples from the deployed Sub2API and NewAPI versions.
- [ ] 0.2 Confirm capability names and the supported `parameter_schema` subset for text, Vision, image generation/edit/variation, and video modes.
- [ ] 0.3 Confirm image response forms, image edit/variation multipart fields, video terminal states, and video content response format.
- [ ] 0.4 Confirm minimum supported ComfyUI version and RunningHub's result collection behavior for native video saved results.

**Quality gate:** upstream samples are captured and one published model from each media class is verified end to end at the API contract level.

## Phase 1: Relay Model Directory

- [x] 1.1 Add authenticated `GET /v1/models/{model_id}` routing and path validation.
- [x] 1.2 Merge text model metadata from Sub2API and media metadata from NewAPI using the correct user-scoped upstream identity.
- [x] 1.3 Preserve capability and parameter metadata while retaining OpenAI-compatible base model fields.
- [x] 1.4 Enforce CheapBuddy-visible models, verified media publication, and billing configuration on list and detail responses.
- [ ] 1.5 Add unit/contract tests for merge precedence, missing models, unauthorized models, upstream errors, and schema preservation.

**Quality gate:** a CheapBuddy API Key sees only its callable models through list and detail routes.

## Phase 2: ComfyUI Package Foundation

- [x] 2.1 Create `comfyui/ComfyUI-CheapBuddy/` package and register exactly three nodes.
- [x] 2.2 Implement shared HTTP client with editable base URL, per-node API Key, request IDs, bounded timeouts, redacted errors, and no implicit POST retry.
- [x] 2.3 Implement model discovery, capability filtering, refresh UI, five-minute cache, stale-cache fallback, and no-cache errors.
- [x] 2.4 Implement bounded schema parser, common dynamic controls, advanced JSON parameters, and preflight validation.
- [x] 2.5 Document API Key persistence in workflow JSON and key removal/rotation before sharing.

**Quality gate:** node registration and model refresh work on the pinned minimum ComfyUI version without adding unrelated runtime dependencies.

## Phase 3: Text and Image Nodes

- [x] 3.1 Implement Text Generate against `/v1/chat/completions`.
- [x] 3.2 Add optional IMAGE batch input and multimodal Vision request mapping for models advertising Vision capability.
- [x] 3.3 Implement Image Generate routing for text-to-image, edit, and variation capabilities.
- [x] 3.4 Convert base64/URL image results into ComfyUI IMAGE batches with size, MIME, pixel, redirect, and destination-address checks.
- [ ] 3.5 Add focused unit/contract tests for request mapping, tensor conversion, schema validation, and sanitized failures.

**Quality gate:** text/Vision and all enabled image operation types match upstream contract fixtures and return expected ComfyUI outputs.

## Phase 4: Video Node and Task Lifecycle

- [x] 4.1 Implement video `generate` and `resume` operations and capability-gated text/image/reference input modes.
- [x] 4.2 Serialize input images and reference image/video/audio media as request-scoped multipart parts.
- [x] 4.3 Add create-once behavior, unique idempotency key, bounded polling/backoff, terminal-state mapping, and timeout output with resumable task ID.
- [x] 4.4 Download successful results safely to the active ComfyUI output directory and emit native VIDEO plus saved-result preview metadata.
- [ ] 4.5 Add tests for submit timeout, no duplicate create, resume, failure/cancel, bounded download, and output registration.

**Quality gate:** an accepted task can complete or be resumed without duplicate billing and is visible through ComfyUI's native output protocol.

## Phase 5: Host Validation and Release

- [ ] 5.1 Validate installation and workflows on local ComfyUI at the minimum supported version.
- [ ] 5.2 Validate RunningHub hosted task output URLs and artifact visibility; document any host-specific limits.
- [ ] 5.3 Validate Comfy.icu package/discovery metadata and install path.
- [x] 5.4 Document installation, node usage, model/schema behavior, and the key-sharing warning.
- [ ] 5.5 Review `git diff`, run focused tests/lint/type checks, and record the tested ComfyUI/host versions.

**Quality gate:** local and hosted acceptance criteria pass; no unsupported host or model is claimed as verified.

## Completion Checklist

- [ ] All Relay, node, and documentation tasks complete.
- [ ] Contract and focused tests pass; local ComfyUI and RunningHub validation evidence is recorded.
- [ ] Only the three agreed CheapBuddy nodes are published.
- [ ] Ready for `/openspec-archive add-cheapbuddy-comfyui-nodes`.

Implementation checkboxes describe code/document changes only. Phase 0 contract evidence, focused tests, minimum-version confirmation, and hosted ComfyUI validation remain open; do not archive until those are recorded.
