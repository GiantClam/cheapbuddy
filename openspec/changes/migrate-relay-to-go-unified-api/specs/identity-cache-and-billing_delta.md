# Delta: Identity, Cache, and Unified Billing

**Change ID:** `migrate-relay-to-go-unified-api`  
**Affects:** Sub2API identity/wallet bridge, NewAPI shadow users, PostgreSQL, Redis, reconciliation

---

## ADDED

### Requirement: Sub2API identity and wallet authority

Sub2API MUST remain the only authority for CheapBuddy users, public API Keys, recharges, balances, text billing, media reservations, captures, and releases. Relay MUST not create a parallel user key or wallet system.

#### Scenario: One user calls text and media

- GIVEN a valid CheapBuddy API Key
- WHEN the user calls a text route and a media route through Relay
- THEN both calls resolve to the same Sub2API user identity
- AND all customer balance changes occur in Sub2API

### Requirement: Lazy isolated NewAPI shadow identity

Relay MUST lazily create or reuse one NewAPI shadow identity per CheapBuddy user. NewAPI tokens MUST be encrypted at rest, retained only server-side, and never returned to clients.

#### Scenario: Concurrent first media calls

- GIVEN two media requests for a user with no current mapping
- WHEN both requests attempt provisioning
- THEN Redis coordination and PostgreSQL uniqueness permit one durable mapping only
- AND neither response exposes a NewAPI credential

### Requirement: Cache-aside identity and mapping cache

Redis MAY accelerate, but MUST NOT become authoritative for, API-key identity and shadow-user mapping. API-key identity cache entries MUST expire within 180 seconds; mapping entries MUST expire within 30 minutes.

#### Scenario: Redis is unavailable

- GIVEN Redis is unavailable
- WHEN Relay needs identity or mapping data
- THEN it retrieves data from Sub2API or PostgreSQL
- AND if the fact source is unavailable, the request fails closed

#### Scenario: Administrator purges a revoked key

- GIVEN an authorized internal operator invalidates a Key or mapping cache entry
- WHEN the next request arrives
- THEN Relay queries the current fact source before allowing it

### Requirement: NewAPI bill plus one CheapBuddy multiplier

NewAPI native bill records MUST measure provider consumption. The customer debit MUST equal the reconciled native bill multiplied once by the configured CheapBuddy media multiplier. The same customer multiplier MUST NOT be applied in NewAPI and Relay/Sub2API simultaneously.

#### Scenario: Successful media task settles

- GIVEN NewAPI emits a final native bill for a completed media task
- WHEN the reconciler processes it
- THEN Relay calculates one customer charge using the configured multiplier
- AND Sub2API captures exactly that amount once

### Requirement: Durable no-Outbox reconciliation

Relay MUST persist request, reservation, native task, native bill, and settlement state in PostgreSQL. It MUST use a Redis leader lock for periodic reconciliation and idempotent Sub2API operation IDs for final correctness. It MUST NOT add an Outbox service or message queue.

#### Scenario: Relay restarts with pending work

- GIVEN a media request is pending reconciliation
- WHEN all Relay instances restart
- THEN a newly elected worker reads the durable state from PostgreSQL
- AND it resumes reconciliation without resubmitting the original media request

### Requirement: Reservation failure outcomes

Relay MUST reserve before submission, release on clear upstream rejection, and retain ambiguous failures pending reconciliation. It MUST not automatically replay or roll back a media submission.

#### Scenario: Upstream times out after submit starts

- GIVEN a reserved media submission has an ambiguous NewAPI timeout
- WHEN Relay cannot determine whether a native task was created
- THEN it records pending reconciliation
- AND it does not submit the request again or silently release the reservation

## MODIFIED

### Requirement: Media pricing ownership

NewAPI technical pricing and bills remain native configuration. CheapBuddy owns the customer-facing media multiplier applied at Sub2API settlement, rather than relying on a NewAPI customer-wallet multiplier.

## REMOVED

- Requirement that Redis be omitted from the first release.
- Requirement that Relay not perform rate limiting or cache coordination.
