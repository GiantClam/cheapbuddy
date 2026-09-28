# Delta: Production Token Rate Cards

**Change ID:** `refresh-model-pricing-and-compare-cli-value`
**Affects:** Operator-managed Sub2API and NewAPI production token pricing; customer debit verification

---

## ADDED

### Requirement: Token prices are mapped to verified production routes

Before changing a production token rate, the operator MUST map the public CheapBuddy model ID to the canonical upstream model ID, actual provider/channel, serving backend, billing unit, and price fields. Each mapping MUST identify whether the route is served by Sub2API, NewAPI, or both. Local upstream source clones and test deployments MUST NOT be treated as production rate-card evidence.

#### Scenario: Model routes through one backend

- GIVEN a model is confirmed to route through Sub2API only
- WHEN its production token price is updated
- THEN only its relevant Sub2API route/rate-card entry is changed
- AND NewAPI is not modified for that model

#### Scenario: Model routes through both backends

- GIVEN the same customer model can route through Sub2API and NewAPI
- WHEN its price is updated
- THEN both applicable backend rate cards are independently read, changed, and verified
- AND their final customer debit calculations are consistent with the intended model price

### Requirement: Rate-card updates preserve an auditable effective price

Every production rate-card update MUST retain a before-state snapshot and a per-model calculation of official reference price, upstream channel cost when available, configured backend price, all applicable multipliers, and final user debit. The update MUST be read back from the production backend and validated against a representative usage bill. It MUST preserve positive unit economics for each route advertised as discounted; unsupported routes MUST receive a model-specific exception or no discount claim.

#### Scenario: Rate-card change is applied

- GIVEN an approved per-model rate calculation and before-state snapshot
- WHEN the operator updates a production backend
- THEN the operator records the resulting rate-card value and read-back evidence
- AND a representative bill confirms the intended final customer debit
- AND a rollback value remains available

#### Scenario: A route cannot retain the target advantage

- GIVEN upstream cost or applicable multipliers make the target discount unsustainable
- WHEN a rate update is calculated
- THEN the system/operator MUST use a route-specific price or mark the route as an exception
- AND MUST NOT silently apply a global multiplier that creates a loss or false public discount

### Requirement: Token pricing changes do not alter media billing

Token price updates MUST NOT modify NewAPI media pricing or the existing media settlement formula. For NewAPI media requests, NewAPI native usage/bill MUST remain the source of truth, and the configured CheapBuddy media multiplier MUST be applied exactly once in its existing settlement stage.

#### Scenario: Token rate catalog is refreshed while NewAPI media is enabled

- GIVEN the NewAPI media route remains enabled
- WHEN text-token rates are changed
- THEN media rate-card fields and settlement behavior remain unchanged
- AND a representative media bill still applies the CheapBuddy multiplier once

## MODIFIED

### Requirement: Production token rates are source-checked

Before a token rate is published or advertised, its official provider price MUST be checked against a provider-owned source and recorded with a retrieval date and applicable region, currency, cache, context, and time-of-day conditions. The effective customer rate MUST be compared on the same basis. Where either the official source or production route is unknown, the rate MUST be treated as unverified and excluded from exact public discount claims.

#### Scenario: Official price changes upstream

- GIVEN a provider changes its published input, output, cache, or tier rate
- WHEN the affected CheapBuddy model is reviewed
- THEN the official reference and backend effective customer rate are recalculated together
- AND frontend and backend values are updated or the discount claim is withheld

## REMOVED

- Production rate changes justified only by frontend constants, unverified local backend source, or a blanket multiplier without a route-level final debit check.
