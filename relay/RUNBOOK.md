# CheapBuddy Relay Runbook

## Shadow mapping repair

Keep `cheapbuddy_integration.user_mappings` as the source of the encrypted
NewAPI token mapping. First call the internal authenticated cache-purge endpoint
for the affected user. If a token is revoked, repair the mapping only during a
maintenance window, then let the next authenticated media request re-provision
the native NewAPI shadow account/token. Do not expose or copy the NewAPI admin
token to a client.

## Reconciliation inspection

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
eligible for automatic capture. Keep them pending for explicit operator review;
do not reintroduce task-ID or heuristic log matching to settle them.

## Upstream outage

Do not resubmit a media POST after an ambiguous timeout. Keep the request in
`pending_reconciliation`, restore NewAPI availability, and allow the native
task/log lookup to resolve it. A clear NewAPI rejection releases the
reservation. If release or capture cannot reach Sub2API, leave the request
pending and inspect the recorded `last_error` after service recovery.
