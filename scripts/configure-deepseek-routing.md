# DeepSeek Flash routing runbook

This is the single configuration and verification runbook, updated 2026-10-28. Earlier instructions in the linked DeepSeek documents are superseded.

## Model contract

The canonical model is `deepseek-v4.1-flash-1017`. Every Flash alias in [the relay alias file](../relay/config/model-aliases.json) resolves directly to it. This includes the preserved client ID `deepseek/deepseek-v4.1-flash` and the mistaken no-v name `deepseek-4.1-flash-1017`, which remains accepted as an alias. The correct 1017 ID is valid for clients and upstream requests; never forbid it.

The 2026-10-28 configuration covers 21 names: 20 relay aliases plus the canonical ID. Audit the file itself rather than maintaining a second alias list. Each tier's `credentials.model_mapping` must map every one of those names to the canonical ID, including its identity mapping.

Confirm the deployed `RELAY_MODEL_ALIASES_FILE` loads this file. A nonempty `RELAY_MODEL_ALIASES` replaces the file configuration rather than merging with it. A local file audit alone cannot prove what production loaded.

## Account order and cost

| Account | Global Priority | Canonical request evidence on 2026-10-28 |
| --- | --- | --- |
| 8 — pptoken | 1 | Success with nonempty response content |
| 12 — EcoPhase | 2 | Success with nonempty response content |
| 3 — aiberm | 3 | HTTP 503: auto group has no available channel; pending provider enablement |

Advanced scheduler is currently `false` in the recorded live state. The ordinary scheduler uses global account `Priority`; lower values win among eligible accounts. Binding priorities affect initial DB ordering and do not override these tiers. Inspect them only as information. Do not reorder or rewrite `group_ids` or memberships to enforce tiers: account PUT processing resets binding priorities to index + 1.

`previous_response_id` and sticky sessions can preserve an established account. Fresh calls without session affinity selected account 8 in 3/3 recorded trials on 2026-10-28.

All three accounts have the 21 canonical mappings saved. Account 2 (`PPToken · Paid Backup`) has had its Flash mappings removed and must stay outside this candidate set. An empty mapping, matching wildcard, or OpenAI passthrough can still make it a competitor; preserve its unrelated models.

EcoPhase's account `rate_multiplier = 0.8` is a cost multiplier against the official reference basis provided and source-verified in this session. Keep `extra.upstream_billing_rate_sync_enabled = false`. This is not a customer discount: leave retail group multipliers and model pricing unchanged.

aiberm's upstream catalog currently lists only `deepseek-v4.1-flash` / `deepseek-v4-flash`. Catalog visibility and saved canonical mappings do not establish support for 1017. There are three configured tiers, with two providers verified to return content; the third remains pending provider enablement.

## Permissions

The recorded live state has all 21 names in groups 2 and 4's model allowlists and shared routes for those names pointing to the canonical model. Keep the requested public IDs and the canonical ID authorized through the existing group and API key scopes. Do not bypass permissions by changing keys or memberships.

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

Despite its name, setup performs GET requests only. It audits actual file aliases, account mappings, global priorities, account state, EcoPhase cost/sync settings, existing allowlists and account 2's exclusion. Binding priorities are informational. Configuration mismatches or unreadable required data return exit code 2. It neither saves configuration nor tests upstream availability.

The verifier sends exactly one nonstreaming `/v1/chat/completions` request with `max_tokens = 32`, defaulting to the canonical ID. It accepts a base URL with or without `/v1`. Use `-BaseUrl` to select another authorized gateway, or `-AliasFile` on either script to audit a different local alias file.

Compatibility probes are optional; each invocation sends one billed request:

```powershell
pwsh -NoProfile -File ./scripts/verify-deepseek-routing.ps1 -ModelId 'deepseek/deepseek-v4.1-flash'
pwsh -NoProfile -File ./scripts/verify-deepseek-routing.ps1 -ModelId 'deepseek-4.1-flash-1017'
```

A probe passes only with 2xx and nonempty message content. Empty content, a provider error or HTTP failure returns exit code 1; there are no automatic retries. The script does not print keys or raw exception payloads.

Latest operator evidence on 2026-10-28: canonical, legacy namespace and `deepseek-flash` Chat Completions requests all returned HTTP 200 with `OK`; a Responses request also returned HTTP 200 with `OK`. Logs identified account 8. This verifies these request paths, not aiberm availability or a failover exercise.

Check Usage for the requested name, final upstream canonical ID, actual account and recorded usage/cost. Healthy eligible pptoken should normally serve fresh calls, with EcoPhase next. Enable aiberm as an available third layer only after a fresh per-account canonical request succeeds with content; its recorded 503 is not a frontend permission success.
