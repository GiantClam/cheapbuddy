# Proposal: Replace the Relay with a Go Unified Public API

**Change ID:** `migrate-relay-to-go-unified-api`  
**Created:** 2026-09-02  
**Status:** Implementation in progress  
**Supersedes architecture in:** `add-newapi-media-provider-support` (the Node Relay runtime design only)

---

## Problem Statement

CheapBuddy needs one public API endpoint, one user-facing API Key, and one Sub2API wallet for text and media usage. Text belongs to Sub2API; image, video, and audio capabilities belong to NewAPI. Exposing the two upstream services directly would split user credentials and recharge flows.

The existing Relay baseline is Node.js and only supports an allowlisted subset of requests. It buffers upstream responses and therefore cannot safely become the production-wide streaming API entrypoint. It also predates the confirmed cache, high-concurrency, model discovery, and pricing decisions.

## Proposed Solution

Replace the production Relay runtime with a Go service built with Chi and the standard-library reverse proxy:

```text
Client
  -> api.cheapbuddy.cc
  -> Go Relay (Chi + net/http + httputil.ReverseProxy)
       -> Sub2API: text, user identity, wallet
       -> NewAPI: media provider channels, native tasks, native bills

PostgreSQL: durable mapping, request, reservation, reconciliation state
Redis: non-authoritative cache, rate limit, provisioning lock, worker lock
```

The Relay is the sole public user API entrypoint. It validates CheapBuddy API Keys through Sub2API, lazily provisions one NewAPI shadow identity per user, chooses the upstream by configured path and model ownership, and transparently proxies supported user APIs. It does not normalize provider protocols, store media, own task state, or expose NewAPI credentials.

Sub2API remains the customer wallet and payment authority. NewAPI continues to create native media tasks and record native provider consumption. The Relay reserves Sub2API balance before media submission and, after native bill reconciliation, applies the configured CheapBuddy media multiplier exactly once when it settles the Sub2API wallet.

## Confirmed Design Decisions

- `api.cheapbuddy.cc` is the only public user API domain.
- Relay proxies all supported user API traffic, not arbitrary URLs or admin/system endpoints.
- CheapBuddy/Sub2API is the sole user, API Key, balance, recharge, and text-billing authority.
- NewAPI shadow identities are created lazily on first media use; NewAPI tokens never leave Relay.
- Routing is path-first and model-assisted for ambiguous OpenAI-compatible paths; all routing is configuration-driven.
- Native media paths, request bodies, model IDs, task IDs, result URLs, and response envelopes are preserved.
- SSE is streamed end-to-end without response buffering. The first release adds no WebSocket or webhook contract.
- Async media tasks are polled through the same public API domain; CheapBuddy stores no media content or result copy.
- NewAPI native bills measure media consumption. CheapBuddy's per-model media multiplier is applied once during Sub2API settlement.
- A clear NewAPI rejection releases the reservation. Ambiguous submission failures remain pending reconciliation; Relay never auto-replays a media submission or request-level rollback.
- PostgreSQL is the durable source for mappings and settlement state. Redis is an optimization and coordination layer only.
- Redis cache TTLs: API Key identity 180 seconds; user-to-NewAPI mapping 30 minutes. Redis failure falls back to the fact source; unavailable fact sources fail closed.
- Media writes support optional `Idempotency-Key` and compatible `X-Request-ID`; absent keys mean independent billable submissions.
- `GET /v1/models` returns the available Sub2API text models plus verified, priced media models.
- Provider channels, native model capabilities, and NewAPI technical pricing stay in NewAPI. Relay has no provider adapter layer.
- Production runs at least two stateless Go Relay instances. Railway is the only business runtime.
- Admin traffic is separate: CheapBuddy's admin portal checks native Sub2API admin permission, then links to independent Sub2API/NewAPI native admin sessions. No SSO is added.

## Scope

### In Scope

- Go replacement Relay under `relay/`, using Chi, `net/http`, `httputil.ReverseProxy`, `pgx`, `go-redis`, and `slog`.
- Transparent request/response/SSE forwarding for approved user routes.
- Configured path-plus-model routing, native task polling, and unified model discovery.
- Sub2API identity lookup, lazy NewAPI shadow-user/token mapping, encrypted server-side token storage, and concurrency protection.
- Sub2API media reservation and idempotent settlement driven by NewAPI native bills.
- Shared PostgreSQL and Redis physical resources with service-level logical isolation.
- Redis cache-aside reads, rate limiting, provisioning locks, reconciliation leadership, and cache purge endpoint restricted to internal operators.
- Structured redacted logging, request IDs, health/readiness, metrics-friendly counters, and production/staging contract tests.
- Railway-only deployment, private upstream networking, protected admin domains, and release documentation.

### Out of Scope

- Creative media UI, gallery, editor, object storage, CDN, or permanent media result retention.
- Provider adapters, custom media request/response schemas, model-name rewriting, or generic gateway protocol normalization.
- A new user system, public NewAPI credentials, user-facing NewAPI wallet, or separate media recharge flow.
- WebSocket/webhook media completion APIs, custom task queues, an Outbox service, Kafka/RabbitMQ, automatic media-submit retry, or automatic rollback/replay.
- Modifying NewAPI core source or requiring Cloudflare Workers.
- Custom admin SSO or proxying the Sub2API/NewAPI admin UIs through Relay.

## Impact Analysis

| Component | Change | Details |
|---|---|---|
| `relay/` | Replace | Move the production relay implementation from Node.js to Go + Chi while retaining the externally approved public contract. |
| Public API | Modify | `api.cheapbuddy.cc` becomes the sole user API entrypoint and aggregates model discovery. |
| Sub2API | Minimal private bridge | Continues native identity, wallet, text billing, reservation, capture, and release operations. |
| NewAPI | Configuration only | Provides provider channels, task interfaces, native bills, and shadow users without core source changes. |
| PostgreSQL | Add Relay-owned schema | Stores only mappings and billing correlation/state; does not modify native upstream tables. |
| Redis | Add Relay namespace | Cache, rate limit, locks, and explicit invalidation; never wallet truth or final settlement state. |
| CheapBuddy frontend | Small admin/config update | Keeps API-first UI; uses public API endpoint and separate admin portal links. |
| Railway | Modify | Adds Go Relay deployment, private upstream connectivity, two production instances, and staged cutover. |

## Success Criteria

- [ ] One CheapBuddy API Key and one Sub2API balance work for text and verified media models through `api.cheapbuddy.cc`.
- [ ] Go Relay forwards supported JSON, multipart, polling, and SSE traffic without buffering or response-schema rewriting.
- [ ] No user can access a NewAPI credential, another user's task, or an upstream user API endpoint directly.
- [ ] NewAPI native media bills reconcile to one and only one Sub2API settlement using the configured CheapBuddy media multiplier.
- [ ] Clear upstream rejection releases funds; ambiguous submissions do not auto-replay and remain safely reconcilable.
- [ ] Redis reduces mapping/identity reads at the confirmed TTLs without becoming a billing source of truth.
- [ ] Multiple Relay instances do not create duplicate shadow identities or duplicate settlements.
- [ ] Only verified, priced media models appear in `/v1/models` and are routable.
- [ ] Staging contract, load, failure-injection, security, and provider-success/billing probes pass before production cutover.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Upstream API changes break proxy compatibility | High | Pin versions, run staging contract tests, preserve native contracts, and release only verified routes/models. |
| SSE is accidentally buffered or timed out | High | Use Go streaming proxy tests with long-lived streams and separate stream timeouts. |
| Cached key remains valid after revocation | Medium | Bound cache at 180 seconds, add internal targeted purge, and never use expired cache entries. |
| Duplicate provisioning or settlement under concurrency | High | Redis short locks plus PostgreSQL unique constraints and idempotent Sub2API billing operation IDs. |
| NewAPI bill is absent or delayed | High | Persist pending reconciliation; do not release or re-submit ambiguous work; alert operators. |
| Relay becomes a single point of failure | High | At least two stateless Railway instances, readiness checks, and horizontally scalable shared state. |
| Direct upstream exposure bypasses billing | High | Keep user APIs private; expose only protected native admin domains and the Relay public API. |

## Release Gate

The change may be promoted only after all of the following are true:

1. Go Relay contract tests prove passthrough of text, multipart media submit, media polling, and SSE.
2. Every production-visible media model has a real configured provider, native NewAPI task success, and associated native bill probe.
3. Reservation, capture, release, delayed bill, timeout, duplicate reconciliation, and idempotency tests pass.
4. Redis cache, lock, rate-limit, and outage fallback tests pass with two Relay instances.
5. Sub2API/NewAPI user APIs are private and public routes cannot bypass Relay billing.
6. The pinned Sub2API/NewAPI versions, environment configuration, CORS, domains, and admin boundaries are reviewed in Railway staging.
