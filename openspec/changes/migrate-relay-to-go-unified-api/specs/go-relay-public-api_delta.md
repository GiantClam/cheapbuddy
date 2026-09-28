# Delta: Go Relay Public API

**Change ID:** `migrate-relay-to-go-unified-api`  
**Affects:** Relay runtime, public API routing, identity, streaming, model discovery

---

## ADDED

### Requirement: Go and Chi Relay runtime

The production Relay MUST be implemented in Go using Chi for routing and standard-library HTTP proxying. It MUST be stateless at the instance level and support horizontal Railway scaling.

#### Scenario: Concurrent traffic reaches separate instances

- GIVEN two healthy Go Relay instances are deployed
- WHEN concurrent text, media, and SSE requests arrive
- THEN either instance may handle a request
- AND durable identity, billing, and task state remains consistent across instances

### Requirement: One public user API entrypoint

The platform MUST expose `api.cheapbuddy.cc` as the sole public user API entrypoint. It MUST accept only configured user-facing API routes and reject admin, login, configuration, and unknown paths.

#### Scenario: Unsupported path arrives

- GIVEN an external client calls an admin or unknown URL at the public API domain
- WHEN the request reaches Relay
- THEN Relay returns a stable not-found or forbidden response
- AND it does not forward the request upstream

### Requirement: Native transparent user API proxying

Relay MUST preserve supported native request bodies, model IDs, response statuses, response envelopes, task IDs, and result URLs. It MUST not buffer SSE or large upstream response bodies before sending them to the client.

#### Scenario: Streaming text request

- GIVEN a valid text request that requests SSE streaming
- WHEN Sub2API sends incremental events
- THEN Relay forwards events incrementally to the client
- AND request cancellation reaches the upstream request context

#### Scenario: Native media task submission

- GIVEN a verified media path and model
- WHEN NewAPI accepts the request
- THEN Relay returns the native response without media-protocol rewriting
- AND the client can use the returned native task identifier for polling

### Requirement: Path-first, model-assisted routing

Relay MUST choose an upstream from configured route ownership. For ambiguous compatible endpoints it MUST use the requested model and a configured media model set. It MUST fail closed for unowned paths or models.

#### Scenario: Ambiguous completion path with a media model

- GIVEN an allowed compatible completion route
- AND the body contains an enabled media model
- WHEN Relay evaluates the route
- THEN it forwards to NewAPI
- AND it does not send the request to Sub2API

### Requirement: Unified model discovery

`GET /v1/models` MUST expose available Sub2API text models plus only media models that are enabled, provider-verified, and priced for settlement.

#### Scenario: A media model is disabled

- GIVEN a media model lacks a configured provider or billing multiplier
- WHEN a client requests `/v1/models`
- THEN the model is absent
- AND a subsequent request using that model fails closed

### Requirement: Optional media idempotency key

Relay MUST recognize `Idempotency-Key` and compatible `X-Request-ID` for media write operations. Repeated media writes with the same authenticated identity and key MUST not create duplicate reservations or submissions. Requests without an idempotency key are independent requests.

#### Scenario: Client retries after a timeout

- GIVEN a media submission has an idempotency key
- WHEN the client retries using the same key after an ambiguous network result
- THEN Relay returns the existing operation state when available
- AND does not submit another native media task

## MODIFIED

### Requirement: Relay implementation language

The Relay runtime changes from the existing Node.js implementation to Go. The Node relay MUST NOT remain in the production user request path after this change passes release validation.

## REMOVED

- Requirement for buffered response proxying.
- Requirement that the Relay omit SSE support for supported user APIs.
