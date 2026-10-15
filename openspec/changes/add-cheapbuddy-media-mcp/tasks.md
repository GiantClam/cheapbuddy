# Implementation Tasks: CheapBuddy Media MCP

**Change ID:** `add-cheapbuddy-media-mcp`
**Source plan:** `docs/media-mcp-development-plan-2026-10-10.md`
**Design:** `design.md`

## 1. Contract and Package Setup

- [x] 1.1 Create `media-mcp/` as a standalone Node.js 20+ package. ✓ 2026-10-11
- [x] 1.2 Add official `@modelcontextprotocol/sdk`, package `bin`, test, lint, and npm dry-run scripts. ✓ 2026-10-11
- [x] 1.3 Define stable schemas for all six tools, `MediaInput`, `MediaJob`, assets, pricing, billing, and safe errors. ✓ 2026-10-11
- [x] 1.4 Define dynamic model capability mapping, H3 normalization rules, and stateless job ID encoding. ✓ 2026-10-11
- [x] 1.5 Implement stdio startup with stdout protocol isolation and stderr-only diagnostics. ✓ 2026-10-11
- [x] 1.6 Validate environment-only authentication and fail locally when `CHEAPBUDDY_API_KEY` is missing. ✓ 2026-10-11

**Quality Gate:** PASSED — `npm run lint`, `npm test`, and stdio startup tests.

## 2. Relay HTTP Backend and Input Security

- [x] 2.1 Implement injectable `CheapBuddyRelayBackend` for existing Relay routes. ✓ 2026-10-11
- [x] 2.2 Add Bearer authentication, safe request IDs, bounded response bodies, and structured HTTP errors. ✓ 2026-10-11
- [x] 2.3 Implement the 60-second in-memory `/v1/models` cache and refresh rules. ✓ 2026-10-11
- [x] 2.4 Implement absolute local path validation for regular files, rejecting symlinks, directories, devices, and special files. ✓ 2026-10-11
- [x] 2.5 Implement HTTPS URL validation while preserving signed query parameters. ✓ 2026-10-11
- [x] 2.6 Implement MIME, extension, per-file, aggregate-size, and media-type validation. ✓ 2026-10-11
- [x] 2.7 Implement multipart builders for local image/video/audio inputs and JSON builders for remote URLs. ✓ 2026-10-11
- [x] 2.8 Implement image `b64_json` validation and `/v1/media` result upload. ✓ 2026-10-11
- [x] 2.9 Implement secret redaction and sensitive-error tests. ✓ 2026-10-11

**Quality Gate:** PASSED — Relay mock contract tests, local/remote input tests, secret scan, and bounded HTTP response handling.

## 3. Image Tools

- [x] 3.1 Implement `cheapbuddy_list_media_models` image filtering and operation capabilities. ✓ 2026-10-11
- [x] 3.2 Implement `cheapbuddy_quote_image` with estimate versus rate-card semantics. ✓ 2026-10-11
- [x] 3.3 Implement `cheapbuddy_generate_image` for `generate`, `edit`, and `variation`. ✓ 2026-10-11
- [x] 3.4 Enforce prompt, image, mask-only-for-edit, and dynamic multi-image conditions. ✓ 2026-10-11
- [x] 3.5 Normalize image URL and `b64_json` responses into structured media assets. ✓ 2026-10-11
- [x] 3.6 Implement image task fallback and internal polling for up to 300 seconds. ✓ 2026-10-11
- [x] 3.7 Return optional MCP image content plus structured media URL, usage, cost, and billing metadata. ✓ 2026-10-11

**Quality Gate:** PASSED — image operation, mask, multi-image, base64, and bounded polling tests.

## 4. H3 Video Tools

- [x] 4.1 Implement dynamic H3 capability discovery. ✓ 2026-10-11
- [x] 4.2 Implement `cheapbuddy_quote_video` with non-exact estimate/rate-card semantics. ✓ 2026-10-11
- [x] 4.3 Normalize H3 seconds, ratio, resolution, and reference roles. ✓ 2026-10-11
- [x] 4.4 Implement `cheapbuddy_submit_video` for JSON HTTPS and multipart local inputs. ✓ 2026-10-11
- [x] 4.5 Support first frame, last frame, reference image, reference video, and reference audio. ✓ 2026-10-11
- [x] 4.6 Generate stable idempotency keys when absent and preserve caller keys. ✓ 2026-10-11
- [x] 4.7 Implement `cheapbuddy_get_media_job` for H3 task query and artifact URLs. ✓ 2026-10-11
- [x] 4.8 Normalize H3 states to `queued`, `in_progress`, `completed`, `failed`, and `unknown`. ✓ 2026-10-11
- [x] 4.9 Return normalized request fields, usage, cost, billing, and expiration metadata. ✓ 2026-10-11

**Quality Gate:** PASSED — H3 JSON/multipart, all reference roles, defaults, non-blocking submission, and stateless lookup tests.

## 5. Reliability and Stateless Jobs

- [x] 5.1 Implement no-retry rules for 400/401/403 and bounded query retries. ✓ 2026-10-11
- [x] 5.2 Honor `Retry-After` for 429 responses. ✓ 2026-10-11
- [x] 5.3 Prevent ambiguous creates from retrying with a new idempotency key. ✓ 2026-10-11
- [x] 5.4 Implement polling backoff of 2s, 3s, 5s, and 8s with a 10s maximum interval. ✓ 2026-10-11
- [x] 5.5 Implement `img_task_` and `vid_task_` stateless encoding/decoding. ✓ 2026-10-11
- [x] 5.6 Verify task lookup works after MCP process restart without a local database. ✓ 2026-10-11
- [x] 5.7 Protect local file I/O resources without limiting task submission concurrency. ✓ 2026-10-11

**Quality Gate:** PASSED — retry, idempotency, backoff, restart, and file I/O resource tests.

## 6. Automated and Client Verification

- [x] 6.1 Add MCP Inspector protocol and `tools/list` tests. ✓ 2026-10-11 — SDK protocol tests and MCP Inspector CLI `tools/list` both passed.
- [x] 6.2 Add Relay mock contract tests for models, pricing, image/video routes, media upload, idempotency, 429, 5xx, and ambiguous results. ✓ 2026-10-11
- [x] 6.3 Add image tests for generate/edit/variation, mask, multi-image, URL, base64, and 300-second processing fallback. ✓ 2026-10-11
- [x] 6.4 Add H3 tests for text, all reference input types, defaults, invalid combinations, idempotency, and restart recovery. ✓ 2026-10-11
- [x] 6.5 Add Claude Code smoke-test configuration. ✓ 2026-10-11 — live `claude -p` with `claude-opus-5-5` through the configured Anthropic-compatible provider invoked `cheapbuddy_list_media_models` and returned both media models; Claude model credentials and `CHEAPBUDDY_API_KEY` were injected separately.
- [x] 6.6 Add Codex smoke-test configuration. ✓ 2026-10-11 — live `codex exec` invoked `cheapbuddy_list_media_models` and returned both media models.
- [x] 6.7 Add OpenCode smoke-test configuration. ✓ 2026-10-11 — live `opencode run --model tokfan/claude-opus-5-5` invoked `cheapbuddy_list_media_models` and returned both media models.

**Quality Gate:** PASSED for protocol, Inspector, Claude Code, Codex, and OpenCode.

## 7. Documentation and Release

- [x] 7.1 Write package README with installation, environment variables, tool schemas, examples, and security behavior. ✓ 2026-10-11
- [x] 7.2 Document that NewAPI MCP is not required and that the package calls existing Relay APIs. ✓ 2026-10-11
- [x] 7.3 Document no-budget/no-confirmation behavior, account-balance charging, and temporary URL expiry. ✓ 2026-10-11
- [x] 7.4 Run secret scanning and dependency/license checks. ✓ 2026-10-11 — secret scan, license metadata check, and official-registry audit passed.
- [x] 7.5 Run npm package dry-run and verify package contents. ✓ 2026-10-11
- [x] 7.6 Run one real image task with billing and artifact reconciliation. ✓ 2026-10-11 — `grok-imagine-image-2.0`, one generated JPEG, Relay temporary media URL returned and fetched with HTTP 200; same-day media usage settled at USD 0.000076 for one request.
- [x] 7.7 Run one real H3 task with reservation, settlement, and artifact reconciliation. ✓ 2026-10-11 — `MiniMax-H3`, 6 seconds, 768P, 16:9; one `vid_task_` completed, authenticated Relay content returned `video/mp4` (2,466,202 bytes), same-day media usage settled at USD 0.092400 for one request.
- [x] 7.8 Publish `@cheapbuddy/media-mcp` only after all automated and client release gates pass. ✓ 2026-10-13 — official registry reports `latest: 0.1.0`; tarball metadata and integrity verified.

**Quality Gate:** AUTOMATED GATES, CLIENT SMOKES, PAID MEDIA RECONCILIATION, AND OFFICIAL NPM PUBLICATION PASSED.

## 8. Completion

- [x] 8.1 All implementation tasks and quality gates are complete. ✓ 2026-10-13 — automated gates, all three client smokes, paid media gates, and npm publication are complete.
- [x] 8.2 Existing Relay and NewAPI behavior remains unchanged. ✓ 2026-10-11 — no Relay/NewAPI source changes; Relay Go tests passed.
- [x] 8.3 Documentation and package metadata are synchronized. ✓ 2026-10-11
- [x] 8.4 The change is ready for `openspec-archive add-cheapbuddy-media-mcp`. ✓ 2026-10-13 — official registry confirms `@cheapbuddy/media-mcp@0.1.0` as `latest`.

### Release Blockers

- None. The package is published and verified through the official npm registry.
