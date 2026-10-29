# DeepSeek Flash routing runbook

This is the single configuration and verification runbook, updated 2026-10-29. Earlier instructions in the linked DeepSeek documents are superseded.

## Model contract

The public selectable/config entry formerly named `deepseek/deepseek-v4.1-flash` is now `deepseek-flash`, displayed as **DeepSeek Flash**. New configurations generated for this entry must use `deepseek-flash`. The old namespace ID remains accepted as a routing compatibility alias.

The canonical model and upstream target remain `deepseek-v4.1-flash-1017`; keep its separate selectable catalog entry. Every Flash alias in [the relay alias file](../relay/config/model-aliases.json) resolves directly to this canonical ID. The mistaken no-v name `deepseek-4.1-flash-1017` remains accepted only as a compatibility alias, never as an upstream target.

Audit the alias file itself rather than maintaining a second alias list. Both suppliers' `credentials.model_mapping` must map every Flash alias to the canonical ID, including its identity mapping.

Confirm the deployed `RELAY_MODEL_ALIASES_FILE` loads this file. A nonempty `RELAY_MODEL_ALIASES` replaces the file configuration rather than merging with it. A local file audit alone cannot prove what production loaded.

## Publishing the public model catalog

`cheapbuddy.cc` and `www.cheapbuddy.cc` serve Cloudflare Pages project `cheapbuddy`. The Railway `cheapbuddy` service is a separate frontend origin; deploying it alone does not publish the homepage used by these domains. Build the intended source snapshot with `npm run build`, then publish its `dist` directory with `wrangler pages deploy dist --project-name cheapbuddy --branch main`. Record the source commit when publishing.

Deploy the relay configuration separately to Railway service `relay-prod` in `production`. Verify the public domains display `deepseek-flash` / DeepSeek Flash and that the authenticated `/v1/models` catalog authorizes it. Keep the separate canonical 1017 catalog entry selectable; accept the old namespace only for compatibility. Deployment success or a healthy alternate origin alone does not establish that the public model selector was updated.

## Account order and cost

| Account | Global Priority | Canonical request evidence on 2026-10-28 |
| --- | --- | --- |
| 12 — EcoPhase | 1 | Success with nonempty response content |
| 8 — pptoken | 2 | Success with nonempty response content |

These are the only configured/verified Flash suppliers. Advanced scheduler is `false` in the recorded live state. The ordinary scheduler uses global account `Priority`; lower values win among eligible accounts. Binding priorities affect initial DB ordering and do not override these tiers. Inspect them only as information. Do not reorder or rewrite `group_ids` or memberships to enforce tiers: account PUT processing resets binding priorities to index + 1.

`previous_response_id` and sticky sessions can preserve an established account. The 2026-10-28 trials predate the 2026-10-29 priority change and selected account 8; fresh calls after the change should select account 12 when it is healthy, with account 8 as fallback.

Account 3 (`aiberm`) does not support 1017, as confirmed by the operator on 2026-10-28. Remove all its Flash mappings, preserving its unrelated Claude mappings and credentials. Account 2 (`PPToken · Paid Backup`) remains nonparticipating and must also have no Flash mappings. An empty/unrestricted mapping, a matching wildcard, a mapping target containing Flash, or OpenAI passthrough can still admit Flash requests; the audit rejects these on both excluded accounts. Preserve their unrelated models and credentials.

EcoPhase's account `rate_multiplier = 0.8` is the configured account cost multiplier against the official reference basis. Keep `extra.upstream_billing_rate_sync_enabled = false`. Leave retail group multipliers and model pricing unchanged.

aiberm's older Flash catalog entries and the recorded canonical HTTP 503 do not establish 1017 support. Keep it excluded; any future reconsideration requires explicit provider proof of canonical 1017 support.

## Permissions

The recorded state authorizes Flash aliases and the canonical ID in groups 2 and 4, with shared routes pointing to the canonical model. Keep `deepseek-flash`, the canonical selectable ID and compatibility aliases authorized through the existing group and API key scopes. Do not bypass permissions by changing keys or memberships.

The audit reads existing group allowlists. Check deployed shared/composite routes separately in the admin UI: each Flash name must retain the canonical target without redirecting the request to an older version.

## Run the checks

Run from the repository root with PowerShell 7. Supply credentials through protected environment variables; do not paste keys into scripts or committed files.

| Variable | Used by |
| --- | --- |
| `SUB2API_BASE_URL` | Admin audit base URL |
| `SUB2API_ADMIN_API_KEY` | Admin read credentials |
| `CHEAPBUDDY_API_KEY` | Existing user key for a billed model probe |

```powershell
pwsh -NoProfile -File ./scripts/setup-deepseek-routing.ps1
pwsh -NoProfile -File ./scripts/verify-deepseek-routing.ps1
```

Despite its name, setup performs GET requests only. It requires Flash mappings on accounts 8/12, their global priorities and active/schedulable state, EcoPhase cost/sync settings, existing allowlists, and Flash exclusion on accounts 3/2. Binding priorities are informational. Configuration mismatches or unreadable required data return exit code 2. It neither saves configuration nor tests upstream availability.

The verifier sends exactly one nonstreaming `/v1/chat/completions` request with `max_tokens = 32`, defaulting to public ID `deepseek-flash`. It accepts a base URL with or without `/v1`. Use `-BaseUrl` to select another authorized gateway, or `-AliasFile` on either script to audit a different local alias file.

Compatibility probes are optional; each invocation sends one billed request:

```powershell
pwsh -NoProfile -File ./scripts/verify-deepseek-routing.ps1 -ModelId 'deepseek/deepseek-v4.1-flash'
pwsh -NoProfile -File ./scripts/verify-deepseek-routing.ps1 -ModelId 'deepseek-v4.1-flash-1017'
```

A probe passes only with 2xx and nonempty message content. Empty content, a provider error or HTTP failure returns exit code 1; there are no automatic retries. The script does not print keys or raw exception payloads.

Recorded operator evidence on 2026-10-28: canonical, legacy namespace and `deepseek-flash` Chat Completions requests all returned HTTP 200 with `OK`; a Responses request also returned HTTP 200 with `OK`. Logs identified account 8. This verifies these request paths, not aiberm support or a failover exercise.

The response `model` may echo the public alias; confirm the final upstream `deepseek-v4.1-flash-1017` through Usage, together with the requested name, actual account and recorded usage/cost. Healthy eligible pptoken should normally serve fresh calls, with EcoPhase next. Accounts 3 and 2 must remain excluded.
