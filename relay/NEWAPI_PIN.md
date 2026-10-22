# NewAPI staging pin

## 2026-10-20 rc.45 production promotion

NewAPI `v1.0.0-rc.45+cheapbuddy.20261019` is live in production on deployment
`8f1c6320-ba69-4dc2-bc15-33187b44341e`, source
`5ed6de3793752a29746d1526c9fd60b369ddb743`, image digest
`sha256:6bc584cbd50541116b0a03f5ddeb7a42f39b6fb60fc8217b70763d28f6091c93`.
The production NewAPI channels contain only `gpt-image-2.5`,
`grok-imagine-image-2.0`, and `MiniMax-H3`; text model channels were not added.

Relay compatibility source `a355a14e559e4f8d07a3773d5b0bb00eb9da1075` is live
on deployment `37ecb565-ccde-45c0-9b15-137272a56aa9`, image digest
`sha256:4fd9f279587738335711d909395e082ecee166dab70e10e1ecf17a216166d30a`.
The scoped native PAT contract and the existing H3 override were verified after
publication. Sub2API remains on deployment `84d4fad7-5af8-44a4-9163-69f4e88e809c`.

The post-release image/video regression settled five successful requests for
`$0.184952`, released the unsupported watermark request at zero charge, and
confirmed that idempotent replay creates no additional tasks, receipts, or
wallet changes. Historical pending reconciliation records remain unchanged.
Full evidence: `.omx/logs/rc45-production-regression-20261020.md`.

## 2026-10-20 current production media verification

Current production Relay is source `67a918c12c9d84366face956aee8e2009cdf0296`,
deployment `55f74105-ea6a-4993-bb3d-1bd4dd025521`. The candidate passed 436
PostgreSQL-backed tests/subtests with no failures or skips, the full Linux race
suite, build, vet, formatting, and independent review before publication.

NewAPI's main deployment remains `9a144e03-47b4-4a9c-9b9e-c95b53d0b6b8`.
Its native plugin API now runs the `ecophase_minimax_h3` override `1.0.1`,
source SHA-256 `380103e3e2f04b0f59f012ead765839fedb623e6afee511bdf45824fe07030db`,
from plugin-only commit `06f7f2739034a1efebe46d342c188ca8456d945e`.
This is a runtime override, not a replacement NewAPI host build. Sub2API remains
on deployment `84d4fad7-5af8-44a4-9163-69f4e88e809c`.

Live verification covers image edits/variations, H3 frames and mixed references,
large inline images, Context IR flags, Responses transports, ownership, signed
downloads, and exact-once settlement. All 19 successful tasks settled; five
failed/rejected probes released their holds. Verification-account debits total
`$1.145202`, with no new residual holds or replay-created tasks/receipts.
The provider explicitly rejects `aigc_watermark=true`; default false succeeds.
Historical failed assertions remain in the evidence instead of being rewritten.

Relay reuses the existing temporary-media store, native background observation,
and image editing protocol. Merge these changes into a later rc.45 candidate
and reconcile the active override with its newer built-in plugin before
promotion. Retain source versions required by historical tasks. The earlier
repair section below records the preceding production version.

Evidence: `.omx/logs/media-expanded-20261020.md`,
`.omx/logs/media-expanded-20261019.json`, and
`.omx/logs/media-expanded-rollout-20261020.json`.

## 2026-10-19 production media repair

The preceding production repair used source `f831c0f25e82e1adfeb13aa0e72b463fd59de431`,
deployment `e6ef5aba-81fb-4f21-80c7-f08c2e7a7266`. It restores signed video
downloads, preserves complete image responses, and safely settles explicitly
opted-in image requests above their holds. Production Sub2API is
`0.2.17+cheapbuddy.mediafix.20261019`, deployment
`84d4fad7-5af8-44a4-9163-69f4e88e809c`.

Production NewAPI remains on `9a144e03-47b4-4a9c-9b9e-c95b53d0b6b8`.
This repair does not introduce rc.45-specific bill readers into production.
Merge the media repair into the isolated upgrade candidate before a later
promotion; the historical-task settlement-marker gates below still apply.
Evidence: `.omx/logs/media-repair-rollout-20261019.md` and
`.omx/logs/media-repair-live-20261019.json`.

## 2026-10-19 isolated upgrade candidate

The separate Railway environment `upgrade-20261019` runs the custom rc.45
candidate below. The historical environment and production service are not
promoted by this pin.

| Item | Value |
| --- | --- |
| Upstream release | `v1.0.0-rc.45` |
| Upstream commit | `6cf0d90b5ff27f901697dddd61e0c28aba8efefc` |
| Custom candidate commit | `5ed6de3793752a29746d1526c9fd60b369ddb743` |
| Relay compatibility commit | `ee5803ada295b440502834c178a9736cc7dada94` |
| Runtime version | `v1.0.0-rc.45+cheapbuddy.20261019` |
| Railway environment | `952f8bd5-b2a1-49be-bdbe-5cb0ad8e196f` |
| Railway service | `2f6552b6-a15e-4138-81f5-e027bab6ab47` |
| Deployment | `75fe186d-caeb-45ee-878e-3b2390027775` |
| Deployment image digest | `sha256:5a9f61286821103ab711814e22b6b8fcc8e098482e8fc1b6fd0990d09507bd8f` |

This digest identifies the Railway build and is not a public upstream OCI image
reference. The candidate retains the custom MiniMax-H3 plugin and uses fresh
native databases, synthetic identities, and mocked providers. Real provider
success and production Relay credential compatibility remain promotion gates;
passing local tests alone does not enable a model in production.

The final isolated NewAPI verification records 218 passing checks and no
remaining failures. Six fresh mocked tasks cover changed, equal and zero final
charges, failure refunds, aliases, ownership and repeated retrieval. Both
adapted Relay bill readers return the same native final quota and original
consume-receipt ID across repeated reads. This verifies local Relay readers
against the deployed isolated NewAPI; Relay itself was not deployed, and a
public Relay-to-Sub2API ledger flow was not exercised. Evidence:
`.omx/logs/newapi-upgrade-staging-verification.json`.

The readers require `admin_info.billing_settled` to be boolean `true`, a
terminal task, and exact task/owner/request correlation. The marker proves
completed funding-source processing and a durably stored final task quota;
auxiliary token quota, counters and logs retain native best-effort behavior.
Historical asynchronous tasks without the marker remain pending and must be
drained or explicitly reconciled before production promotion. Never backfill
the marker from terminal status or a changed quota, or blindly replay funding
after a successful adjustment followed by a task-persistence failure.

The rc.45 staging checks use a native, non-expiring scoped PAT for Relay
administration, created through the dashboard verification flow. Verified
scopes are `api_key:read`, `api_key:reveal`, `api_key:write`, `log:read`,
`profile:read`, `usage:read`, `user:read`, and `user:write`. Before any production
promotion, verify the deployed Relay's admin credential against these native
management APIs; do not assume an older opaque access token remains usable.

## Historical first integration pin

Use the official NewAPI release below for the first integration environment:

| Item | Value |
| --- | --- |
| Release | `v1.0.0-rc.30` |
| Git commit | `27ff6a8767e728f879d52770c273d4f73214a430` |
| Image | `calciumion/new-api:v1.0.0-rc.30` |
| OCI multi-arch digest | `sha256:94e853de615144b7dd809583ef96434b5539f52072b6e96c6e53354fa422a871` |
| Release date | `2026-08-31` |

The tag and image digest were resolved from the official GitHub repository and
Docker registry on 2026-09-02. Keep the digest in the Railway NewAPI service
image configuration. A floating `latest` tag is not acceptable for the
integration environment.

Railway staging deployed this exact image successfully on 2026-09-02. The
staging deployment reported the same OCI digest and NewAPI startup version.
The staging admin API also confirmed the native user-login and token-creation
contracts used by Relay (`data.access_token` and string `model_limits`).
Provider success evidence is intentionally still pending: the staging NewAPI
instance currently has zero configured channels.

## Provider verification matrix

Before publishing any model through Relay, configure the exact NewAPI channel
and record the native model ID, route, channel type, input matrix, and one
successful submit/query/result probe. For Qingyan video, the probe must also
verify successful-only usage extraction, actual duration and resolution,
Context IR usage, and zero usage on failure/cancellation.

| Family | Requested models | Required evidence |
| --- | --- | --- |
| Image | `gpt-image-2`, `seedream`, `grok`, `qwen-image`, `nanobanana 2` | native image submit, task/result query, bill/log if paid |
| Qingyan video | `MiniMax-H3` | standalone NewAPI direct access, all prompt/frame/reference input modes, request-scoped multipart files, `openai_video`, Responses stream/retrieve, host-supported cancel semantics, artifact authorization, successful-only usage/pricing |
| Other video | `seedance`, `qwen video`, `kling`, `vidu` | native video submit, task query, bill/log if enabled |
| Audio | `minimax`, `suno` | native audio/Suno submit, task/result query, bill/log if paid |

Relay must remain configured with only rows that pass this matrix. The final
provider response and result URL are returned unchanged; CheapBuddy does not
store the media result.
