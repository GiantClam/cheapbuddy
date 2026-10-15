# Railway staging procedure

This procedure uses a separate Railway environment and does not touch the
production environment.

1. Create an empty Railway environment named `staging`; do not duplicate
   production data or production secrets.
2. Add private `Postgres`, `Redis`, `sub2api`, and `newapi` services in that
   environment. Keep the services private.
3. Deploy NewAPI using the pinned image in `NEWAPI_PIN.md`. Configure the
   Qingyan `MiniMax-H3` Task Plugin and provider channel in NewAPI's own admin
   interface. Configure the successful-only duration/resolution/Context IR
   usage rules in the NewAPI staging profile. When NewAPI is behind Relay, set
   `TaskPublicAddress` to the Relay staging origin so Responses artifact URLs
   remain on the public Relay boundary; in standalone mode point it to the
   standalone NewAPI origin.
4. Deploy Sub2API with its staging database/Redis and the private
   `SUB2API_RELAY_SERVICE_TOKEN`. Apply the Sub2API bridge branch before the
   Relay smoke test.
5. Deploy the Go Relay from this directory using `relay/railway.json`; set the
   values documented in `README.md` with staging-only URLs, tokens, database,
   Redis, verified model allowlist, and explicit billing mode. `NEWAPI_ADMIN_TOKEN`
   must be a persistent NewAPI user access token for the protected admin/log
   calls, not a short-lived dashboard login session.
   If the Railway service was created without Config as Code, set the same
   build/start/healthcheck settings in the staging service configuration (or
   set its config-file path to `/relay/railway.json`) before promotion.
6. Confirm `/healthz` and `/readyz`, then verify that the public staging host
   cannot reach Sub2API/NewAPI admin paths.
7. Run the Qingyan MiniMax-H3 provider matrix in `NEWAPI_PIN.md`. Verify every video
   input family, native polling, result URL expiry metadata, Responses stream,
   response retrieve, disconnect recovery, and terminal failure.
8. Configure the Hypit MVP NewAPI channels and run one non-production request for
   each enabled capability: GPT Image 2, Seedance 2 Mini, MiniMax H3, Fish
   VoiceDesign, Fish VoiceClone, and WhisperX. For multipart transcription,
   confirm the model field appears before the file field at the Relay boundary.
9. Repeat a task lookup and reconciliation run. The second run must be a
   no-op and must not apply a second charge beyond NewAPI's final quota.

No production custom domain should be switched until all checks pass. If a
media submission times out, do not retry it; inspect the pending reconciliation
row and the native NewAPI task/log first.

## 2026-09-02 staging evidence

- NewAPI `v1.0.0-rc.30` was deployed with the pinned OCI digest from
  `NEWAPI_PIN.md`.
- Sub2API completed its native Postgres migration, Redis connection, and
  auto-setup. Its database is the separate `Postgres-jewC` staging service;
  NewAPI and Relay use `Postgres-Y_v2` so native schemas remain isolated.
- The historical Node Relay `/healthz` and `/readyz` probe passed. The Go Relay
  must repeat this probe before promotion.
- One staging CheapBuddy key reached both `/v1/models` (Sub2API path, 200) and
  `/v1/images/generations` (NewAPI path).
- The historical media probe reserved `100000` units in Sub2API, received
  NewAPI's native `model_not_found` response because no channel was configured,
  and released the reservation. The Qingyan path must not create a second
  Relay-side charge when NewAPI already owns the final quota.
- Real provider submit/poll/success/bill probes are not complete. Before
  enabling any requested model, configure its native NewAPI channel and record
  the evidence required by `NEWAPI_PIN.md`. Do not copy production secrets
  into staging.

## 2026-09-03 Go Relay deployment evidence

- The Go/Chi Relay was deployed only to Railway `staging` service `relay`.
  Railway detected and built the Go module successfully; its process started
  on port 8080 and applied the Relay-owned PostgreSQL migrations.
- `GET /healthz` and `GET /readyz` both returned 200. Readiness therefore
  covered the shared staging PostgreSQL and Redis connections.
- An unauthenticated `GET /v1/models` returned 401, the protected cache-purge
  POST returned 401, and the probed public responses did not set cookies.
- The Go Relay and NewAPI use the same staging Postgres and Redis instances;
  Relay state is contained in the `cheapbuddy_integration` schema and Redis
  `relay:` namespace.
- The current Railway deployment used automatic Go detection rather than the
  checked-in `relay/railway.json` settings. Before production promotion, set
  the service Config as Code path or equivalent Railway build/start/readiness
  settings, then confirm at least two production replicas.
