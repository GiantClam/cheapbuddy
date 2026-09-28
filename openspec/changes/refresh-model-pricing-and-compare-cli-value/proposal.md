# Proposal: Refresh Model Prices and Explain CheapBuddy Value

**Change ID:** `refresh-model-pricing-and-compare-cli-value`
**Created:** 2026-09-26
**Status:** Draft

---

## Problem Statement

CheapBuddy's homepage mixes a synthetic WorkBuddy-points figure with customer balance and contains model reference prices that can become stale. Users cannot reliably compare the amount they pay with an equivalent official API workload, and operators lack one verified mapping from the public model catalog to Sub2API/NewAPI production rate cards. A displayed discount can therefore be inaccurate or hide a route whose effective customer price no longer has a sustainable advantage.

## Proposed Solution

Research the latest official API price for each enabled token model, record source and pricing conditions, map public IDs to actual provider routes, and update the production rate card in every backend that serves that model. Compare the resulting effective customer debit to the same official model, region, currency, token type, and context tier. Refresh the website's official reference prices and explain CLI subscription value separately from API usage pricing. Keep paid-balance, weekly-reset, peak/off-peak, and actual-settlement claims gated on production evidence.

Sub2API and NewAPI remain independently deployed upstream services. The change defines auditable operator steps and verification; it does not add a new control-plane API or modify provider billing formulas. NewAPI media billing continues to use its native bill and the existing one-time CheapBuddy media multiplier.

## Scope

### In Scope

- Verify official per-token prices for the enabled model catalog, including cached input, output, context tiers, regional/currency differences, and time-based prices where applicable.
- Maintain an auditable model-to-provider/channel/backend mapping and the effective-price calculation.
- Update only relevant Sub2API/NewAPI token rate-card entries, with a before snapshot, after read-back, sample bill verification, and rollback record.
- Update website model reference prices, their official sources and verification dates, and same-model value comparisons.
- Correct homepage comparisons among WorkBuddy, Codex, Claude Code, and OpenCode so subscription entitlements are not represented as API token usage.
- State no weekly balance reset, no customer peak/off-peak rate, pay for actual usage, and paid balance expiry only when verified; distinguish paid balance from promotional credits and request limits.

### Out of Scope

- Automatically scraping official prices or continuously changing production rates without operator review.
- Changing upstream provider price formulas, CheapBuddy media multipliers, NewAPI provider/plugin behavior, or customer wallet settlement architecture.
- Claiming every model has one universal discount or that API usage is equivalent to a CLI subscription.
- Publishing/deploying the website or applying production rate changes as part of proposal authoring.

## Impact Analysis

| Component | Change Required | Details |
|-----------|-----------------|---------|
| Website model catalog | Yes | Add current official reference prices, sources, verification dates, and tier conditions to `src/models.js` or the existing price source. |
| Website comparison/UI | Yes | Revise `src/main.jsx`, `src/i18n.js`, `src/pricing.js`, and SEO metadata to show real balance and comparable units. |
| Sub2API production | Yes, operational | Update token rate-card entries for models actually routed through Sub2API; export and verify the effective group/channel/model multipliers. |
| NewAPI production | Conditional, operational | Update token rates only for text-token models actually routed and billed through NewAPI. Do not apply token rates to media routes. |
| API/database | No new API or schema assumed | Keep the existing customer billing and settlement contracts. Add a persistent catalog schema only if repository inspection shows the current data source cannot represent required price conditions. |
| Tests/docs | Yes | Cover calculations, source freshness, localized claims, routing-to-rate mapping, and operator update/rollback evidence. |

## Architecture Considerations

- `src/models.js` is the current public catalog source. Its `input` and `output` fields are display strings; they are not proof of the production customer debit.
- Sub2API is the documented text API backend. NewAPI is independently deployed and currently has distinct media billing responsibilities; include it in token-rate changes only where a real token route exists.
- Separate official list price, upstream channel cost, backend configured rate, and final customer debit. Do not conflate their units or apply group/channel/customer multipliers twice.
- Preserve NewAPI native usage/bill as source of truth for media tasks and apply the current CheapBuddy media multiplier exactly once.
- Store dates and conditions so comparisons remain interpretable after provider price changes. If a source or route cannot be verified, withhold an exact discount claim for that model.

## Success Criteria

- [ ] Every enabled token model has a current official source, retrieval date, canonical model mapping, region/currency, input/cached-input/output rates, and applicable tiers—or is explicitly marked unverified/non-token-priced.
- [ ] Every model routed through Sub2API or NewAPI has a recorded production rate-card snapshot and post-change read-back for the backend(s) that actually serve it.
- [ ] Sample usage bills match the intended final customer debit; public displayed customer prices and official comparison prices use the same model and usage conditions.
- [ ] Any advertised price advantage is supported by positive unit economics and a same-model comparison; exceptions are shown individually rather than hidden by a universal discount.
- [ ] CLI subscription comparisons show the official entitlement and limits separately from API token-price comparisons.
- [ ] Paid-balance expiry, weekly reset, peak/off-peak, and actual-usage settlement claims are published only with production evidence.
- [ ] NewAPI media bills and one-time media multiplier behavior are unchanged.

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Official prices or provider conditions change | High | High | Record source and checked date; refresh before public claims and recheck when a source expires. |
| Public model IDs map to aliases or different upstream models | Medium | High | Verify route and provider model IDs in production before editing prices. |
| Backend multipliers are misunderstood or applied twice | Medium | High | Snapshot effective formula and verify with a sample request/bill before and after changes. |
| CheapBuddy price undercuts official price but loses money against channel cost | Medium | High | Check both official comparison and actual upstream cost; set model-specific pricing or withhold discount claims. |
| NewAPI text token and media routes are mixed | Medium | High | Scope NewAPI token changes only to confirmed token-priced routes; keep media settlement requirements separate. |

