## Purpose

Provide a discoverable local MCP tool surface for CheapBuddy image and video capabilities while preserving the existing Relay and NewAPI media contracts.

## ADDED Requirements

### Requirement: Local stdio Media MCP server

The project MUST provide a top-level Node.js package published as `@cheapbuddy/media-mcp` and started through stdio using the official `@modelcontextprotocol/sdk`. The package MUST support Node.js 20 or later and MUST NOT require NewAPI to expose an MCP Server.

#### Scenario: MCP initialization

- **WHEN** Node.js 20+ and `CHEAPBUDDY_API_KEY` are present and the package starts through stdio
- **THEN** it initializes a valid MCP server, writes only protocol frames to stdout, and writes diagnostics to stderr

#### Scenario: Missing API key

- **WHEN** `CHEAPBUDDY_API_KEY` is absent at startup
- **THEN** the package returns a local configuration error and makes no network request

### Requirement: Tool inventory

The MCP server MUST expose exactly these v1 tools: `cheapbuddy_list_media_models`, `cheapbuddy_quote_image`, `cheapbuddy_generate_image`, `cheapbuddy_quote_video`, `cheapbuddy_submit_video`, and `cheapbuddy_get_media_job`.

#### Scenario: Tool discovery

- **WHEN** a valid MCP client calls `tools/list`
- **THEN** all six tools are returned with stable input schemas, and write tools state that they consume CheapBuddy balance

### Requirement: Dynamic media model discovery

The server MUST obtain image and video model visibility and capabilities from the authenticated `GET /v1/models` response. It MUST cache the result in memory for no more than 60 seconds, MUST NOT persist it to disk, and MUST refresh it after model-not-found or capability/auth refresh conditions.

#### Scenario: Account-specific catalog

- **WHEN** two API keys with different model permissions call `cheapbuddy_list_media_models`
- **THEN** each receives only the models and capabilities visible to that key

### Requirement: Unified image operations

`cheapbuddy_generate_image` MUST accept an explicit `operation` of `generate`, `edit`, or `variation`. It MUST require an explicit model ID and MUST reject unknown provider-specific fields.

#### Scenario: Image generation

- **WHEN** a visible image model is called with `operation: generate` and a valid prompt
- **THEN** the tool calls the image generations route and returns a structured `MediaJob` with completed media or a resumable processing job

#### Scenario: Image edit with mask

- **WHEN** `operation: edit` includes at least one image input and an optional mask
- **THEN** the tool sends the images and mask to the image edits route and accepts the mask only for edit

#### Scenario: Invalid mask operation

- **WHEN** `operation` is `generate` or `variation` and a mask is supplied
- **THEN** the tool rejects the request locally without calling Relay

#### Scenario: Multi-image operation

- **WHEN** a model's dynamic schema permits multiple images and the request stays within its limit
- **THEN** the tool accepts the inputs; requests above the limit are rejected before submission

### Requirement: Unified H3 submission

`cheapbuddy_submit_video` MUST require an explicit visible model and MUST support text, first frame, last frame, reference image, reference video, and reference audio inputs. It MUST call the existing `/v1/videos` route and MUST return immediately after acceptance or a clear accepted-unknown state.

#### Scenario: H3 text-to-video defaults

- **WHEN** a valid `MiniMax-H3` text-to-video request omits `seconds` and `resolution` but supplies a valid `ratio`
- **THEN** the tool uses `seconds: 6` and `resolution: 768P` and returns the normalized request values

#### Scenario: H3 reference-video defaults

- **WHEN** a valid reference-media request omits `ratio`
- **THEN** the tool uses `adaptive` without inventing a fixed ratio

#### Scenario: H3 unsupported input combination

- **WHEN** a request contains an invalid combination of frame and reference roles
- **THEN** the tool rejects the request before submission with a structured validation error

### Requirement: Unified media job retrieval

`cheapbuddy_get_media_job` MUST accept only an MCP-generated opaque job ID. Job IDs MUST use `img_task_` or `vid_task_` prefixes followed by URL-safe encoding of the underlying Relay task ID. The mapping MUST be stateless and survive MCP process restarts.

#### Scenario: Restart recovery

- **WHEN** a new MCP process queries a previously returned `vid_task_` ID using the same API key
- **THEN** it resolves and queries the underlying Relay task without a local database

### Requirement: Unified MediaJob response

Image and video operations MUST normalize results into `queued`, `in_progress`, `completed`, `failed`, or `unknown` states. Completed results MUST expose structured media assets with URL, MIME type, and expiration metadata when available.

#### Scenario: Image processing timeout

- **WHEN** an image task remains incomplete after 300 seconds of internal polling
- **THEN** the tool returns a resumable `img_task_` job ID and `poll_after_ms` without submitting the task again

#### Scenario: Video completion

- **WHEN** a completed H3 task is queried
- **THEN** the tool returns a short-lived artifact URL and `status: completed` without exposing the provider URL or credentials

### Requirement: Optional non-blocking quotes

The quote tools MUST be read-only, MUST distinguish a non-exact `estimate` from a `rate_card`, and MUST NOT lock balance or be required before a write tool.

#### Scenario: Rate card only

- **WHEN** the server cannot calculate a task-specific image amount
- **THEN** `cheapbuddy_quote_image` returns `pricing_type: rate_card`, `estimated_amount: null`, and states that final charge depends on successful upstream usage

### Requirement: Existing media APIs remain authoritative

The MCP MUST treat CheapBuddy Relay HTTP APIs as the public media contract. It MUST NOT duplicate NewAPI provider adapters, H3 polling formulas, media billing formulas, or Relay settlement logic.

#### Scenario: Existing H3 billing path

- **WHEN** an H3 task is submitted through the MCP and later completes or fails
- **THEN** Relay and NewAPI remain responsible for reservation, settlement, usage, artifacts, and task ownership, while MCP only normalizes the public response