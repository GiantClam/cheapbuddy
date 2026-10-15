# Proposal: CheapBuddy Media MCP

**Change ID:** `add-cheapbuddy-media-mcp`
**Created:** 2026-10-11
**Status:** Published — `@cheapbuddy/media-mcp@0.1.0`
**Source plan:** `docs/media-mcp-development-plan-2026-10-10.md`

## Why

CheapBuddy already exposes image and MiniMax-H3 video capabilities through authenticated HTTP APIs, Relay billing, and NewAPI task plugins, but Claude Code, Codex, and OpenCode cannot discover and call those media capabilities as native MCP tools. NewAPI contains Claude/Responses MCP protocol conversion fields but no public MCP Server, so adding generic MCP routing there would introduce a new identity, task, and billing bridge.

A local MCP package can solve the distribution problem now while reusing the existing Relay/NewAPI media boundary and avoiding duplicate provider or billing logic. This is timely because the image/H3 HTTP and billing primitives already exist.

## What Changes

- Add a top-level Node.js 20+ package, `media-mcp/`, published as `@cheapbuddy/media-mcp` and started through `npx`.
- Use the official `@modelcontextprotocol/sdk` with local stdio transport.
- Support Claude Code, Codex, and OpenCode with environment-only authentication.
- Expose six focused tools for model discovery, optional pricing, image operations, H3 submission, and unified media-job retrieval.
- Support image generate/edit/variation, edit masks, multiple reference images, full H3 reference input coverage, structured `MediaJob` results, strict idempotency, and safe local/HTTPS media inputs.
- Keep Relay authoritative for authentication, model visibility, rate limits, idempotency, reservations, settlement, and task ownership; keep NewAPI authoritative for provider adaptation, H3 polling, artifacts, and upstream credentials.
- Explicitly do not add a NewAPI MCP Server, generic Relay MCP route, budgets, mandatory confirmation, batch tools, video wait tools, account usage tools, local key persistence, arbitrary provider passthrough, remote MCP/OAuth, or independent binaries.

## Capabilities

### New Capabilities

- `media-mcp/tools`: Local stdio MCP tool inventory, image/video operations, dynamic model discovery, pricing estimates, and unified media jobs.
- `media-mcp/runtime`: Environment authentication, local/remote media input security, HTTP backend behavior, retries, polling, result normalization, stateless job IDs, and release verification.

### Modified Capabilities

- None. Existing Relay and NewAPI requirements remain authoritative and are consumed without adding a generic MCP route.

## Impact

| Component | Change Required | Details |
|-----------|-----------------|---------|
| `media-mcp/` | Yes | New npm package, MCP server, HTTP backend, validators, normalizers, and tests. |
| Relay API | No route change expected | MCP consumes existing `/v1/models`, `/v1/pricing`, image routes, video routes, and `/v1/media`. |
| NewAPI | No | Reuse existing image routes and H3 Task Plugin; do not add MCP server endpoints. |
| Database | No | MCP has no local database; Relay remains the source of task and billing state. |
| Website UI | No for v1 | Publish standalone MCP documentation; no creative UI is added. |
| Documentation | Yes | Add package README, client configuration examples, tool reference, and security guidance. |
| CI/release | Yes | Add package tests, lint/secret checks, npm dry-run, and publish gates. |

## Architecture Considerations

```text
MCP client
  -> official MCP SDK / stdio
  -> media-mcp tool layer
  -> MediaBackend abstraction
  -> CheapBuddyRelayBackend
  -> CheapBuddy Relay HTTP API
  -> NewAPI image routes or H3 Task Plugin
```

`MediaBackend` is an internal replacement boundary only. v1 implements the CheapBuddy HTTP backend; it does not implement a NewAPI-hosted MCP backend. The package must not reproduce H3 provider mapping, task polling formulas, or billing calculations.

## Success Criteria

- [x] The package initializes through stdio using only environment-injected credentials; the CLI entrypoint is ready for `npx @cheapbuddy/media-mcp`.
- [x] `tools/list` returns all six tools with stable input schemas.
- [x] Image generate/edit/variation and H3 reference workflows are implemented against existing Relay APIs and covered by Relay mock tests.
- [x] Image generation waits up to 300 seconds, then returns a resumable job when still processing.
- [x] Video submission returns immediately and never creates a duplicate task on ambiguous retry.
- [x] Claude Code, Codex, and OpenCode each complete a client smoke test. Claude Code with local `claude-opus-5-5` through the configured Anthropic-compatible provider, Codex, and OpenCode all passed on 2026-10-11.
- [x] One real image task and one real H3 task reconcile against CheapBuddy billing and artifact URLs on 2026-10-11.
- [x] Automated tests and secret/error handling prevent credentials, internal URLs, and provider data from being exposed through normal MCP responses.

Automated implementation, paid media reconciliation, MCP Inspector, Claude
Code, Codex, and OpenCode gates were completed on 2026-10-11. The package was
published to the official npm registry and verified as the `latest` `0.1.0`
release on 2026-10-13. Real image and H3 tasks were executed against the
supplied test account before publication.

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| NewAPI MCP fields are mistaken for an available MCP Server | High | High | Keep MCP independent and do not add `/mcp` forwarding. |
| Image schemas are incomplete or inconsistent | Medium | Medium | Use dynamic schema when present and conservative defaults when absent. |
| Ambiguous submit causes duplicate charges | Medium | High | Preserve idempotency keys and never retry unknown create with a new key. |
| Local file input leaks sensitive files | Medium | High | Accept explicit regular files only; reject symlinks/special files and redact errors. |
| Temporary URLs expire | Medium | Medium | Return `expires_at` and document timely download; no permanent MCP storage. |
| Client media rendering differs | Medium | Medium | Always return structured links; add MCP image content only as an optional extra. |

## Verification Strategy

1. Protocol and schema tests with MCP Inspector.
2. Unit tests for input validation, job IDs, polling, retry classification, and result normalization.
3. Relay mock contract tests for models, pricing, images, videos, media upload, idempotency, 429, and ambiguous results.
4. Real client smoke tests for Claude Code, Codex, and OpenCode.
5. Opt-in real image and H3 tasks with billing and artifact reconciliation.

The implementation is ready for publication. Do not archive the change until
the npm package has been published and the package can be installed from the
official registry.
