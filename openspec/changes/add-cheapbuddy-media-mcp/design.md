## Context

CheapBuddy already exposes public image and H3 video routes through the Go Relay. Relay owns API-key identity, model visibility, rate limits, idempotency, reservations, settlement, and task ownership. NewAPI owns image/video provider adaptation, H3 polling, task persistence, and artifact capability URLs.

The current NewAPI checkout contains Claude/Responses MCP-related DTO and header conversion code, but no public MCP Server route or MCP tool execution service. The design keeps MCP at the product boundary and reuses the existing media HTTP contract instead of adding a second task and billing path.

## Goals / Non-Goals

**Goals:**

- Publish a local stdio MCP for Claude Code, Codex, and OpenCode.
- Keep media provider logic and billing authoritative in Relay/NewAPI.
- Provide stable image/video tool schemas, job IDs, result normalization, and safe local-file handling.
- Support future backend replacement through a small internal `MediaBackend` interface.

**Non-Goals:**

- A generic MCP platform.
- A NewAPI-hosted MCP Server.
- Remote MCP/OAuth in v1.
- A local key vault, local task database, budgets, batch tool, or video wait tool.

## Decisions

### 1. Independent stdio package

Use a top-level `media-mcp/` Node.js package with the official `@modelcontextprotocol/sdk` and stdio transport.

Alternative considered: add MCP endpoints to NewAPI. Rejected because NewAPI has no current MCP server execution boundary, and doing so would require a new identity, task, artifact, and billing bridge. Relay path forwarding alone would bypass existing media settlement.

### 2. HTTP backend instead of provider access

Implement `CheapBuddyRelayBackend` against the public Relay API. The MCP never receives or sends NewAPI admin tokens, provider keys, or raw Qingyan requests.

Alternative considered: call MiniMax/Qingyan directly. Rejected because it would duplicate H3 mapping, expose provider credentials, and bypass CheapBuddy billing and ownership.

### 3. Six focused tools

Keep catalog, quote, image write, video submit, and job query as separate tools. Use one image tool with an `operation` discriminator and one unified job query tool.

Alternative considered: one generic `generate_media` tool. Rejected because image/video schemas, sync/async behavior, and input validation would become ambiguous for agents.

### 4. Stateless job IDs

Encode the underlying Relay task ID in an `img_task_` or `vid_task_` URL-safe identifier. Decode it on query; rely on Relay for ownership validation.

Alternative considered: local job database. Rejected because it creates persistence, privacy, cleanup, and cross-platform migration work without adding authority.

### 5. Direct multipart for local inputs

Use multipart directly for local image/video/audio files and JSON HTTPS references for remote inputs. Use `/v1/media` only to turn provider `b64_json` image results into short-lived URLs.

Alternative considered: upload all inputs to `/v1/media` first. Rejected because it adds latency and temporary public input URLs without improving the existing target APIs.

### 6. Conservative reliability

Classify errors by safety: no retry for client/auth errors, bounded retries for reads, `Retry-After` for 429, and never create a new idempotency key after an ambiguous submit.

Alternative considered: generic automatic retry. Rejected because it can create duplicate paid media tasks.

### 7. Non-blocking video and bounded image wait

Images may poll internally for up to 300 seconds and then return a resumable job. Videos always submit immediately and require explicit query calls.

Alternative considered: a blocking video wait tool. Rejected because it harms agent concurrency and conflicts with the confirmed submit/query contract.

## Risks / Trade-offs

- **[Provider schema drift]** Dynamic model metadata may omit image limits. Mitigate with conservative defaults and explicit schema fixtures.
- **[Expired artifacts]** Provider/NewAPI URLs may expire. Return expiration metadata and document timely download; do not add permanent MCP storage.
- **[Account balance is the only global spending boundary]** No v1 budgets. Mitigate by making write-tool side effects explicit and retaining optional non-blocking quotes.
- **[Client media rendering varies]** Always return structured HTTPS media links; add MCP image content only as an optional extra.
- **[NewAPI future MCP implementation]** A future hosted MCP could change the backend contract. Keep tool definitions independent of `CheapBuddyRelayBackend` behind `MediaBackend`.

## Migration Plan

1. Add and test the independent `media-mcp/` package without changing Relay or NewAPI routes.
2. Run MCP Inspector, Relay mock, and package security checks.
3. Run Claude Code, Codex, and OpenCode smoke tests.
4. Run opt-in real image and H3 tasks and reconcile billing/artifact output.
5. Publish the npm package only after all release gates pass.
6. Roll back by removing or pinning the npm package version; no server-side migration is required.

No Open Questions remain that would change the selected scope or task breakdown.