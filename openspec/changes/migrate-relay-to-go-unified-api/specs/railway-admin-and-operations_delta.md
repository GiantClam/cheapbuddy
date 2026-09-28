# Delta: Railway, Admin, and Operations

**Change ID:** `migrate-relay-to-go-unified-api`  
**Affects:** Railway topology, domains, admin boundary, observability, limits, release process

---

## ADDED

### Requirement: Private upstream and separate admin topology

Relay MUST be the only public user API service. Sub2API and NewAPI user APIs MUST use Railway private networking. Their native admin UIs MAY be exposed through separately protected administrator domains and MUST NOT serve as user API endpoints.

#### Scenario: User tries to bypass Relay

- GIVEN a user knows an upstream service address
- WHEN the user attempts a user API request directly to Sub2API or NewAPI
- THEN the network or upstream access policy rejects the request
- AND the user cannot bypass Relay identity and billing coordination

### Requirement: Native administrator sessions

`admin.cheapbuddy.cc` MUST verify administrator permission using a native Sub2API admin capability before showing links to Sub2API and NewAPI admin consoles. The two native consoles MUST keep separate sessions and CheapBuddy MUST NOT implement SSO or forward credentials.

#### Scenario: Ordinary user opens the admin portal

- GIVEN a non-administrator authenticates at `admin.cheapbuddy.cc`
- WHEN CheapBuddy performs the native permission probe
- THEN the user is denied access to the console picker
- AND no upstream admin console credential is issued

### Requirement: PostgreSQL and Redis logical isolation

Sub2API, NewAPI, and Relay MAY share physical Railway PostgreSQL and Redis resources, but MUST use separate databases/schemas and credentials for PostgreSQL and separate Redis ACL identities/key prefixes. Staging and production MUST not share state.

#### Scenario: Relay database access

- GIVEN Relay connects using its service credential
- WHEN it attempts to access an upstream native table or cache namespace
- THEN least-privilege controls deny access
- AND only Relay-owned mapping and billing-correlation state is accessible

### Requirement: Redis-backed route-specific rate limits

Relay MUST enforce configurable Redis-backed limits independently for text requests, media submissions, and media polling. It MUST return `429` with a retry signal when a limit applies.

#### Scenario: Media submission burst

- GIVEN a user exceeds the configured media submission limit
- WHEN an additional media write arrives
- THEN Relay rejects it with `429`
- AND it creates no reservation or native task

### Requirement: Redacted observability and health

Relay MUST emit structured, redacted events containing request ID, route class, upstream class, model, status, latency, cache state, and billing state. It MUST NOT log API Keys, upstream tokens, provider credentials, full prompts, or media content.

#### Scenario: Operator investigates a delayed bill

- GIVEN reconciliation is pending
- WHEN an operator inspects Relay logs and durable status
- THEN the operator can correlate the request, task, and settlement state using IDs
- AND secrets and full request content are absent

### Requirement: Railway release discipline

The Go Relay, Sub2API, and NewAPI MUST use pinned, reviewable releases. Staging must pass route, provider, billing, cache-failure, two-instance, and SSE contract tests before the public domain is cut over.

#### Scenario: A new NewAPI release is proposed

- GIVEN a newer NewAPI image is available
- WHEN it has not passed the staging contract suite
- THEN production does not use it
- AND models lacking fresh validation remain disabled

## MODIFIED

### Requirement: Relay production capacity

Relay MUST run at least two stateless production instances, using PostgreSQL and Redis coordination, rather than a single Node process.

## REMOVED

- Requirement for a Cloudflare Worker in the business request path.
- Requirement to proxy native admin UIs through the public Relay.
