## Purpose

Define the runtime, security, reliability, and release behavior required for a local Media MCP that handles user files and paid media tasks safely.

## ADDED Requirements

### Requirement: Environment-only authentication

The MCP MUST read credentials only from `CHEAPBUDDY_API_KEY` and optional `CHEAPBUDDY_BASE_URL`. It MUST support client configuration `env` injection but MUST NOT persist keys, accept keys as CLI arguments, or implement a login flow in v1.

#### Scenario: Secret redaction

- **WHEN** an HTTP, MCP, or validation error is logged or returned
- **THEN** the full API key, provider credentials, and sensitive authorization headers are absent

### Requirement: Secure media inputs

The MCP MUST support `MediaInput` values containing either an explicit absolute local file path or an HTTPS URL. It MUST reject directories, symlinks, special files, HTTP/file URLs, loopback/private/metadata addresses, embedded URL credentials, invalid MIME types, and oversized inputs.

#### Scenario: Local multipart input

- **WHEN** a valid local regular image, video, or audio file is used as input
- **THEN** the MCP sends it directly as multipart to the target image/video route without first uploading it to `/v1/media`

#### Scenario: Signed HTTPS input

- **WHEN** an HTTPS URL contains a valid signed query string
- **THEN** the MCP preserves the query string and passes the URL to Relay without downloading it locally

### Requirement: Safe result normalization

The MCP MUST accept image `url` and `b64_json` responses. It MUST validate decoded image bytes and, when necessary, upload result bytes through the authenticated `/v1/media` route to obtain a short-lived HTTPS URL. Videos MUST return artifact/resource URLs and MUST NOT be returned as base64.

#### Scenario: Base64 image result

- **WHEN** an image provider returns valid `b64_json`
- **THEN** the MCP validates MIME and size, uploads the bytes through `/v1/media`, and returns a structured media URL with expiration metadata when available

### Requirement: Strict retry and idempotency policy

The MCP MUST NOT retry 400/401/403 errors. It MUST honor `Retry-After` for 429 responses. It MAY retry read/query requests within bounded limits. It MUST NOT retry an ambiguous image/video create with a new idempotency key.

#### Scenario: Ambiguous video submit

- **WHEN** a video create connection fails after the provider may have accepted it
- **THEN** the MCP returns an unknown/accepted-unknown result or retries only with the same idempotency key, never with a new key

### Requirement: Bounded polling

The MCP MUST use bounded polling backoff of 2s, 3s, 5s, and 8s with a maximum interval of 10s, while honoring a server `poll_after_ms` within safe bounds. Image generation MAY poll internally for up to 300 seconds. Video submission MUST remain nonblocking and MUST require explicit query calls.

#### Scenario: Video submit behavior

- **WHEN** `cheapbuddy_submit_video` receives a valid video request
- **THEN** it returns a task identity without waiting for completion, and `cheapbuddy_get_media_job` performs one bounded query per call

### Requirement: Side-effect transparency without forced confirmation

Write tools MUST clearly document that they consume CheapBuddy balance and MUST return billing metadata. Quote tools MUST be optional and MUST NOT be a required precondition for generation. The MCP MUST NOT implement user-configurable budgets in v1.

#### Scenario: Automatic generation

- **WHEN** a valid write request is called without a preceding quote and the existing CheapBuddy balance is sufficient
- **THEN** the MCP submits the task automatically, returns billing metadata or a pending-final-charge state, and does not pause for confirmation

### Requirement: Client compatibility and release verification

Before npm publication, the implementation MUST pass automated protocol/contract tests, MCP Inspector checks, and real smoke tests in Claude Code, Codex, and OpenCode. At least one real image task and one real H3 task MUST be reconciled with CheapBuddy billing and artifact URLs.

#### Scenario: Release gate

- **WHEN** the package is prepared for publication
- **THEN** all automated tests, secret scans, package checks, and three-client smoke tests pass, with no duplicate task or charge evidence

### Requirement: No permanent MCP state

The MCP MUST remain stateless across process restarts except for in-memory model catalog caching. Job IDs, task ownership, billing state, and artifacts remain authoritative in CheapBuddy Relay/NewAPI.

#### Scenario: Process restart

- **WHEN** the MCP process exits and restarts
- **THEN** previously returned job IDs remain queryable with the same API key, without a local task database