# DeepSeek routing status

See [the DeepSeek routing runbook](../scripts/configure-deepseek-routing.md) for the configuration and 2026-10-28 per-account evidence.

The renamed public/config entry is `deepseek-flash`, displayed as DeepSeek Flash; the old namespace remains a routing compatibility alias. Keep the separate selectable `deepseek-v4.1-flash-1017` entry and the same canonical upstream target.

Only pptoken account 8 (priority 1) and EcoPhase account 12 (priority 2, account cost multiplier 0.8) are configured/verified Flash suppliers. aiberm account 3 has no 1017 support; remove its false Flash capability while preserving unrelated Claude models and credentials. Account 2 remains excluded. Response model names may echo the public alias; confirm the final canonical upstream through Usage.

Earlier 2026-10-15, 2026-10-19 and 2026-10-27 configuration instructions are superseded by that runbook.
