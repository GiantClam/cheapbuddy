# CheapBuddy Relay Runbook

## H3 submission reservation

MiniMax-H3 reserves only its planned duration cost, not the legacy fixed
USD 2.00 media hold. The upstream native rate is USD 0.06/second; Relay
applies the configured H3 media multiplier and quota-per-USD conversion with
the same integer ceiling as final settlement. At the current retail rate of
CNY 0.10/second (CNY 6.5/USD, published USD 0.0154/second), 4 seconds holds
USD 0.0616, 6 seconds holds USD 0.0924, and 15 seconds holds USD 0.2310.

Use the requested `seconds` or `duration` (4–15 integer seconds); omission
uses the H3 plugin's 6-second default. Conflicting or unsupported duration
fields must fail before a hold or provider submission. JSON and multipart
must select the same effective duration as the upstream plugin; multipart
file ordering must not hide the requested duration. Do not change upstream
duration defaults or native pricing without checking this reservation rule.

Other models retain their existing reservation policy. Existing idempotent
requests retain their recorded hold amount. The H3 deadline policy below also
releases historical overdue `pending_reconciliation` reservations. Final settlement remains
successful native usage only, and definitive rejected/failed tasks use the
existing idempotent release path.
`GET /v1/pricing?model=MiniMax-H3&duration=4` reports the estimated hold under
`cheapbuddy.reservation`; it does not reserve funds or generate a video.
If a native bill unexpectedly exceeds the recorded hold, keep reconciliation
pending for investigation. Do not silently cap the bill or release a potentially
billable task. This duration rule assumes the current native seconds-only
pricing expression; enabling additional billable facts requires reviewing it.

## Shadow mapping repair

Keep `cheapbuddy_integration.user_mappings` as the source of the encrypted
NewAPI token mapping. First call the internal authenticated cache-purge endpoint
for the affected user. If a token is revoked, repair the mapping only during a
maintenance window, then let the next authenticated media request re-provision
the native NewAPI shadow account/token. Do not expose or copy the NewAPI admin
token to a client.

## Reconciliation inspection

### H3 hold lifecycle and deadline

An insufficient reserve leaves balance and frozen balance unchanged. H3 stores
its request intent before calling reserve, so a lost reserve acknowledgement
cannot orphan a committed hold. Only an exact `billing_request_id` acknowledgement
allows provider submission or a terminal wallet transition.

H3 reserves until its exact, owning NewAPI task reaches SUCCESS. A bill appearing
at submission is not sufficient for capture. Confirmed failed/cancelled tasks
release their hold. `RELAY_H3_TASK_TIMEOUT` defaults to `30m` and must be positive;
the immutable request creation time sets the deadline, not the last lookup time.
At the deadline, an undecided H3 request releases its full original hold even
when task/request IDs are absent or NewAPI is unavailable. This also applies to
historical H3 requests. The reconciler normally runs once per minute; ledger
unavailability delays actual refund until its idempotent retry succeeds.

Capture and release use a database request lock and an atomic, one-way durable
`capture_pending`/`release_pending` decision before calling Sub2API. A lost wallet
response is retried in that same direction; never convert an uncertain capture
into a refund. Terminal states cannot be resurrected by late callbacks. Replaying
a released H3 request returns HTTP 410, not a new task or another charge. Provider
work that completes after an undecided request expires is not charged later to
the customer; any resulting supplier cost is borne by the platform.

Other models retain their existing settlement policy. Do not reset the deadline
on polling, release a captured request, or remove the durable billing decisions.

Inspect `cheapbuddy_integration.media_requests` for rows in `reserved`,
`submitted`, or `pending_reconciliation`. Use `newapi_request_id` to query the
native NewAPI log exactly with `GET /api/log/?request_id=...`; do not use a
model, user, time-window, prompt, or task-ID match. `native_task_id` is the
public NewAPI response/video ID used for native task ownership and polling;
`provider_task_id` is also retained for the underlying NewAPI task ID used by
Responses artifact capability URLs, and is checked against the same CheapBuddy
user mapping before artifact forwarding.
The Relay records the NewAPI bill ID,
final lifecycle state, and the Sub2API billing request ID used for any
capture/release operation. Re-running the reconciler is safe because task
association and Sub2API billing operations are persisted and idempotent. The
Qingyan MiniMax-H3 usage is priced by NewAPI's configured duration,
resolution, and Context IR facts; customer settlement applies
`final_quota × RELAY_MEDIA_MULTIPLIER_BY_MODEL` exactly once. Do not add a
second multiplier or a second settlement authority.

Rows created before this migration have no `newapi_request_id` and are not
eligible for automatic capture. H3 rows expire under the deadline policy above;
other models remain pending for explicit operator review;
do not reintroduce task-ID or heuristic log matching to settle them.

## Upstream outage

Do not resubmit a media POST after an ambiguous timeout. Keep the request in
`pending_reconciliation`, restore NewAPI availability, and allow the native
task/log lookup to resolve it (or the H3 deadline to refund it). A clear NewAPI rejection releases the
reservation. If release or capture cannot reach Sub2API, leave the request
pending and inspect the recorded `last_error` after service recovery.
