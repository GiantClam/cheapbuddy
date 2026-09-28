# Delta: CheapBuddy MiniMax-H3 Billing and Reconciliation

**Change ID:** `add-newapi-media-provider-support`
**Affects:** Relay reservation/settlement and NewAPI bill correlation

## ADDED

### Requirement: NewAPI native bill is mandatory

CheapBuddy MUST NOT publish a billable MiniMax-H3 model until a successful NewAPI plugin task produces a queryable native NewAPI bill/log with a stable `request_id`. The plugin MAY report only provider facts exposed by the Qingyan/NewAPI contract; it MUST NOT invent price, quota, duration, resolution, or Context IR usage.

Relay MUST use the persisted NewAPI `request_id` as its only final-bill correlation. It MUST NOT infer a bill from a provider task ID, public response/video ID, model, prompt, time window, or provider `usage=0` field.

#### Scenario: Native bill is absent

- GIVEN NewAPI accepted a MiniMax-H3 task but no final bill exists for its persisted `request_id`
- WHEN Relay reconciles the task
- THEN it records `pending_reconciliation`
- AND it neither guesses an amount nor captures the customer wallet

### Requirement: Fixed reservation and one-time settlement

For exact enabled `MiniMax-H3`, Relay MUST require an explicit media billing mode, fixed configured maximum reservation, and configured CheapBuddy media multiplier. Relay MUST reserve the maximum before a non-idempotent NewAPI create. It MUST reject before submission if the configuration or wallet reservation is unavailable.

After NewAPI reports a final successful bill, Relay MUST capture `NewAPI final quota × CheapBuddy media multiplier` exactly once and release any unused reserved amount. The multiplier MUST be applied in Relay/Sub2API settlement only; it MUST NOT be applied in NewAPI or more than once during reconciliation.

#### Scenario: Successful task

- GIVEN a valid MiniMax-H3 request has a durable reservation
- WHEN Relay finds the final NewAPI bill by its persisted `request_id`
- THEN it calculates the customer amount from final quota multiplied once by the configured media multiplier
- AND it captures that amount exactly once
- AND it persists the bill and settlement identities

### Requirement: Terminal failure and asynchronous connection handling

Relay MUST release a reservation exactly once after a clear NewAPI validation/rejection response. It MUST settle failed, cancelled, rejected, and confirmed no-result terminal tasks at zero and release the reservation exactly once.

An accepted task MUST retain its reservation when the SSE client disconnects or when `background: true` returns before completion. HTTP connection state MUST NOT be treated as task success, failure, or cancellation.

#### Scenario: SSE disconnect

- GIVEN a reserved streaming MiniMax-H3 request disconnects before completion
- WHEN NewAPI continues its task lifecycle
- THEN Relay retains the reservation
- AND later reconciles from the final NewAPI state and bill

### Requirement: Ambiguous submission and idempotency

Provider 5xx responses, network timeouts, missing submit responses, and other ambiguous acceptance outcomes MUST enter durable `accepted_unknown`/pending reconciliation. Relay MUST retain the reservation and MUST NOT submit another create. Only the tested NewAPI identical-key Qingyan recovery is permitted; no component may create a recovery task with a new provider key.

For one user and client `Idempotency-Key`, the same canonical request MUST reuse the original response/video identity; a different canonical request MUST return `409 idempotency_conflict`. `X-Request-ID` MUST remain trace-only.

### Requirement: Durable separate lifecycles

Relay MUST persist user identity, canonical request hash, client/provider idempotency keys, public response/video ID, NewAPI request ID, native task ID, native bill ID, reservation ID, settlement ID, provider lifecycle, billing lifecycle, and sanitized last error. Provider state and billing state MUST be separate. Reconciliation transitions MUST be idempotent across repeated runs and multiple Relay instances.

#### Scenario: Two reconciler instances

- GIVEN two Relay instances observe the same final NewAPI bill
- WHEN both reconcile the same stored request
- THEN at most one Sub2API capture/release operation occurs
- AND the second instance records an already-applied/no-op outcome

### Requirement: Existing text billing isolation

The MiniMax-H3 reservation and settlement path MUST be limited to the exact enabled video model. It MUST NOT change existing Sub2API text wallet operations, text model prices, text route behavior, or historical text accounting records.

#### Scenario: Text request after MiniMax-H3 enablement

- GIVEN MiniMax-H3 is enabled
- WHEN a caller sends an existing text request
- THEN existing text routing and billing behavior remain unchanged
- AND no video reservation, NewAPI bill lookup, or media settlement is created

## MODIFIED

### Requirement: Media billing ownership

NewAPI owns technical provider usage and its native bill. CheapBuddy owns customer-wallet reservation and settlement. Relay must reconcile the final NewAPI bill once; it must not duplicate Qingyan pricing formulas or apply the CheapBuddy multiplier twice.

## REMOVED

- Provider-side or Relay-side guessed pricing as a substitute for a native NewAPI bill.
- Media settlement based on loose task/model/prompt/time correlations.
- Applying a multiplier in NewAPI or repeatedly in Relay/Sub2API.
