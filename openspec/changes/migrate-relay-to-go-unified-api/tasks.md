# Implementation Tasks: Go Unified Public API Relay

**Change ID:** `migrate-relay-to-go-unified-api`

---

## Phase 0: Contract and Migration Baseline

- [x] 0.1 Record the supported public paths, methods, model-routing rules, and upstream ownership in a versioned route contract. ✓ `relay/ROUTE_CONTRACT.md`
- [ ] 0.2 Record exact pinned Sub2API/NewAPI releases and real provider/channel evidence for each production-visible media model.
- [x] 0.3 Compare the Node Relay behavior with this change and document every intentional compatibility change. ✓ `relay/ROUTE_CONTRACT.md`
- [x] 0.4 Define Go API error, request-ID, idempotency, stream timeout, and redaction conventions. ✓ Go Relay contract and tests
- [ ] 0.5 Keep Node Relay out of the production cutover path once Go acceptance criteria pass; do not delete it until migration evidence is complete.

**Quality gate:** route contract and migration matrix reviewed; no unverified model or endpoint is enabled.

## Phase 1: Go Service Foundation

- [x] 1.1 Create the Go module and Railway build/runtime files under `relay/`. ✓ `relay/go.mod`, `relay/railway.json`
- [x] 1.2 Add Chi routing, request-ID, panic recovery, CORS, health, readiness, structured logging, and graceful shutdown. ✓ Go Relay runtime
- [x] 1.3 Configure shared `http.Transport` pools, proxy-safe header handling, request contexts, and bounded per-upstream timeouts. ✓ Go Relay runtime
- [x] 1.4 Implement streaming `httputil.ReverseProxy` behavior for SSE and large responses without buffering. ✓ SSE integration test
- [ ] 1.5 Add unit and integration tests for response streaming, cancellation, headers, CORS, and error boundaries.

**Quality gate:** Go service builds, lint/tests pass, and a synthetic SSE stream is relayed incrementally.

## Phase 2: Durable State and Shared Infrastructure

- [ ] 2.1 Create a Relay-owned PostgreSQL schema, migrations, least-privilege role, and repository layer.
- [x] 2.2 Add durable user mapping, media request, reservation, settlement, and reconciliation state with unique constraints. ✓ Relay migration v1-v3
- [ ] 2.3 Configure a dedicated Relay Redis ACL/prefix and add resilient client health handling.
- [x] 2.4 Implement cache-aside API-key identity cache (180 seconds) and user mapping cache (30 minutes). ✓ Redis cache-aside implementation
- [x] 2.5 Implement internal targeted cache purge and safe cache-miss/failure fallback. ✓ protected purge endpoint and origin fallback
- [x] 2.6 Add Redis provisioning/reconciliation locks with PostgreSQL uniqueness/idempotency as final correctness controls. ✓ lock implementation and database constraints

**Quality gate:** PostgreSQL remains authoritative; Redis loss does not allow invalid identity or duplicate settlement.

## Phase 3: Identity, Routing, and Transparent User APIs

- [x] 3.1 Validate user API Keys through the Sub2API internal identity contract; do not create a second key store. ✓ private bridge client
- [x] 3.2 Implement lazy NewAPI shadow-user/token provisioning with encrypted server-side token storage. ✓ encrypted PostgreSQL mapping
- [x] 3.3 Implement explicit user-route allowlist and reject admin, login, configuration, and unknown paths. ✓ Chi route classifier
- [x] 3.4 Implement path-first/model-assisted routing using Railway configuration. ✓ configured media model ownership
- [x] 3.5 Proxy text routes to Sub2API and media routes to NewAPI while preserving native body, headers, status, and response envelope. ✓ Go reverse proxy
- [x] 3.6 Implement native media task polling authorization so a user cannot query another user's task. ✓ task ownership query
- [x] 3.7 Implement `GET /v1/models` aggregation for available text plus verified/priced media models. ✓ model aggregator
- [x] 3.8 Add optional `Idempotency-Key`/`X-Request-ID` support for media writes. ✓ durable idempotency key

**Quality gate:** a single public API Key successfully calls text and supported media paths; non-user paths and cross-user task access are rejected.

## Phase 4: Billing and Reconciliation

- [x] 4.1 Reserve the configured bounded Sub2API amount before a media submission. ✓ private bridge call
- [x] 4.2 Persist correlation before the upstream submit and release once on clear rejection. ✓ durable reservation state
- [x] 4.3 Associate native task IDs and native NewAPI bills with the durable media request. ✓ native response/log correlation
- [x] 4.4 Compute customer charge as `native NewAPI bill × CheapBuddy media multiplier` exactly once. ✓ reconciliation calculation
- [x] 4.5 Capture/release via idempotent Sub2API billing operations; do not write wallet balances directly. ✓ bridge-only wallet operations
- [x] 4.6 Run a Redis-leader-protected reconciliation worker; restore pending work from PostgreSQL after restart. ✓ Go worker
- [ ] 4.7 Cover timeout, missing bill, terminal failure, duplicate reconciliation, and idempotent retry cases without media resubmission.

**Quality gate:** every terminal media request reaches exactly one safe accounting outcome; ambiguous cases remain durable and diagnosable.

## Phase 5: Capacity, Security, and Operations

- [x] 5.1 Implement Redis-backed per-key/per-user rate limiting, with separate text, media-submission, and media-poll limits. ✓ configured Redis rate limiter and unauthenticated IP guard
- [ ] 5.2 Add metrics-friendly structured events for latency, upstream class, cache behavior, billing state, and reconciliation lag.
- [x] 5.3 Ensure no logs, metrics, errors, or client responses disclose user keys, provider keys, NewAPI tokens, or full prompts. ✓ redacted errors/logging and upstream header filtering
- [ ] 5.4 Configure Railway private network URLs, secrets, TLS domains, CORS, protected admin domains, and two production Relay replicas.
- [x] 5.5 Add readiness checks for PostgreSQL, Redis, and required configuration; keep liveness independent of upstream availability. ✓ `/healthz` and degraded-aware `/readyz`
- [x] 5.6 Document incident procedures for cache purge, mapping repair, delayed bill reconciliation, and upstream outage. ✓ `relay/RUNBOOK.md`

**Quality gate:** security review passes; direct user access to upstreams is blocked; two instances operate without duplicate state changes.

## Phase 6: Staging Validation and Production Cutover

- [ ] 6.1 Run real staging provider probes for every enabled image, video, and audio model.
- [ ] 6.2 Run contract tests for JSON, multipart, SSE, async polling, `/v1/models`, CORS, and idempotency.
- [ ] 6.3 Run load tests covering text concurrency, stream concurrency, media submission burst, cache miss, and Redis outage fallback.
- [ ] 6.4 Run billing failure injection and two-instance reconciliation validation.
- [ ] 6.5 Deploy Go Relay to production, point `api.cheapbuddy.cc` to it, and perform controlled smoke tests.
- [ ] 6.6 Mark the Node Relay deployment inactive only after production validation; retain deployment evidence and rollback instructions at the infrastructure level.

**Quality gate:** all release-gate checks in `proposal.md` pass and production uses the Go Relay exclusively.

## Completion Checklist

- [ ] All tasks and quality gates are complete.
- [ ] All enabled models have current provider and billing evidence.
- [ ] Documentation, Railway configuration, route allowlist, and model catalog are synchronized.
- [ ] Ready for `/openspec-archive migrate-relay-to-go-unified-api` after production validation.

## Blockers

- Real Provider submit/poll/success/native-bill evidence is unavailable until NewAPI channels are configured in Railway staging.
- PostgreSQL/Redis production roles, ACLs, private networking, two Relay replicas, CORS, domains, and the Railway Config as Code source path require Railway configuration changes and are intentionally not changed from local source code.
- Production cutover of `api.cheapbuddy.cc` is not authorized by this implementation task and remains gated by staging validation.

## 2026-09-03 Staging deployment evidence

- Final Go Relay deployment `9dc96571-b514-494c-b299-cddfa11ce5f3` succeeded in the explicit `staging/relay` target; no production service or domain was changed.
- Public staging probes passed for `/healthz` and `/readyz` (200), unauthenticated `/v1/models` (401), and unauthenticated internal cache purge (401). Probed responses did not set cookies.
- The Railway manifest used automatic Go detection; it did not apply the checked-in Config as Code fields. Production remains blocked until service build/start/readiness policy and two-replica scaling are explicitly configured and verified.

## 2026-09-03 Local Docker concurrency evidence

- A disposable Docker stack ran the Go Relay with local PostgreSQL, Redis, and
  contract mocks only; no Railway service or real provider was used.
- The text/SSE workload completed 300 requests at 100-way concurrency with no
  failures. The independent .NET client sample measured 100.0 RPS, first-byte
  P50/P95 of 2/982 ms, and full-stream P50/P95 of 486/1461 ms.
- A media clear-rejection workload completed 100 requests at 50-way
  concurrency with no failures and 357.8 RPS. The mock observed exactly 100
  `reserve` and 100 `release` operations; the PostgreSQL rows were all
  `released`. A repeated pre-existing idempotency batch returned 409 without
  creating new mock billing operations.
- This is a local regression signal only. Task 6.3 remains incomplete until
  staging covers real upstream latency, Redis outage fallback, and production
  replica behavior.

## 2026-09-03 Local direct-connection regression evidence

- All local probes used `127.0.0.1` or the Compose network. The load client
  explicitly disables environment proxy use; no VPN, proxy, Railway service,
  real NewAPI channel, or real provider was contacted.
- The local model-list aggregation completed 1,000 requests at 200-way
  concurrency with 0 failures, 262.0 RPS, and 46/58 ms P50/P95 response time.
- With the local Redis container stopped, `/healthz` remained 200 and
  `/readyz` returned 200 with `status=degraded` and `redis=unavailable`. A
  text/SSE workload of 20 requests at 10-way concurrency completed with 0
  failures and 1,455/1,487 ms P50/P95 full-stream time. Redis then recovered
  and `/readyz` returned `status=ready`.
- The current Relay image completed the media clear-rejection workload at 100
  requests and 50-way concurrency with 0 failures and 249.9 RPS. The latest
  200 mock billing events contained exactly 100 `reserve` and 100 `release`
  operations.
- Cache keys after recovery showed the configured 180-second identity and
  30-minute mapping TTLs, and the identity key remained SHA-256-derived rather
  than exposing API-key material.
