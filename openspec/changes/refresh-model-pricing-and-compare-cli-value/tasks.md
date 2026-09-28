# Implementation Tasks: Refresh Model Prices and Explain CheapBuddy Value

**Change ID:** `refresh-model-pricing-and-compare-cli-value`

---

## Phase 1: Establish Current State and Price Evidence

- [x] 1.1 Inventory enabled public models and current official price fields in `src/models.js`.
- [ ] 1.2 For each enabled token model, retrieve the current provider-owned pricing source and record canonical ID, retrieval date, currency/region, input, cached input, output, context thresholds, and time-based tiers. (Partial: evidence is recorded for the routes listed in the research note; `qwen3.8-max-preview` mapping and some pricing conditions remain unverified.)
- [ ] 1.3 Identify non-token-priced and media models; record official billing units or mark the official price as unavailable.
- [ ] 1.4 Inspect production Sub2API and NewAPI route/model mappings, group/model/channel multipliers, channel costs, and effective user billing formula.
- [ ] 1.5 Export redacted before-state rate-card snapshots; do not use local upstream source verification clones as production configuration.

**Quality Gate:** Every enabled model has an evidenced source and route or is explicitly blocked from an exact price/discount claim.

---

## Phase 2: Calculate and Apply Backend Token Prices

- [ ] 2.1 Build a per-model mapping from public ID to upstream ID, channel, backend, billing unit, and production price fields.
- [ ] 2.2 Calculate official reference price, upstream channel cost, configured backend rate, final user debit, and gross margin for matching usage samples.
- [ ] 2.3 Set provider-confirmed channel base rates to current official standard prices and set the public group discount to 0.72×; exclude unresolved routes or price mismatches from the exact-discount claim. MiniMax M3 still uses the provider's old list base and requires a production edit. Margin sustainability remains unverified.
- [ ] 2.4 Update only confirmed token-priced production routes in Sub2API and/or NewAPI; do not modify media rates or apply media multipliers in token rate cards.
- [ ] 2.5 Sub2API values and the 0.72× group multiplier were read back; NewAPI read-back and rollback evidence remain unavailable because its configured admin hostname did not resolve.

**Quality Gate:** Production backend configuration read-back matches the approved per-model calculations and each advertised discount retains positive unit economics.

---

## Phase 3: Update Website Pricing and Comparisons

- [x] 3.1 Update provider reference prices and source dates where verified, including GLM, Kimi, and MiniMax; mark the MiniMax production rate mismatch and keep the `qwen3.8-max-preview` route mapping unverified.
- [ ] 3.2 Show official API reference price and CheapBuddy effective customer price separately, with consistent units and clear assumptions.
- [x] 3.3 Replace synthetic WorkBuddy points with actual CheapBuddy RMB balance and a clearly labeled official WorkBuddy cash-price reference.
- [x] 3.4 Compare Codex, Claude Code, and OpenCode using official sources without translating subscriptions into unsupported token or message counts.
- [ ] 3.5 Add explanatory claims for no weekly balance reset, no customer peak/off-peak pricing, actual-usage billing, and paid balance expiry only where production evidence supports them; disclose request limits and promotional-credit rules separately.
- [ ] 3.6 Refresh Chinese/English page text, comparison source links, SEO metadata, and any rate freshness labels.

**Quality Gate:** Website price values and copy correspond to the approved evidence catalog and do not state a universal advantage where exceptions exist.

---

## Phase 4: Verify Billing and Release Candidate

- [ ] 4.1 Test price calculations for standard input, cached input, output, long context, regional, and peak/off-peak cases where applicable.
- [ ] 4.2 Run representative token requests and compare usage, backend billing records, wallet debit, and displayed customer price.
- [ ] 4.3 Verify a NewAPI media request still uses its native bill and applies the CheapBuddy media multiplier once.
- [ ] 4.4 Validate comparison source links, retrieval dates, model IDs, localized copy, and small-screen layout.
- [ ] 4.5 Run relevant tests, build, and static checks; review the diff and confirm rollback snapshots are accessible.
- [ ] 4.6 Prepare a release candidate and report unresolved price sources/routes; production website publication remains a separate release action.

**Quality Gate:** Relevant checks pass, public values match sampled production billing, and every unsupported claim is removed or qualified.

## Completion Checklist

- [ ] All phases complete
- [ ] Every enabled model is source- and route-mapped
- [ ] Backend changes are read back and sample bills verified
- [ ] Website comparisons and price sources match effective billing
- [ ] Media billing behavior is unchanged
- [ ] Rollback and release notes are ready

## Execution Notes — 2026-09-26

- Official price research and website reference-price updates are recorded in `docs/model-price-research-2026-09-26.md`.
- Official rates for GLM 5.2/5.3, GLM Flash, Kimi K3, and MiniMax M3 were verified against provider pricing pages. MiniMax M3 remains a production mismatch: its current official standard rate is $0.30/$1.20/$0.06, while the channel still has $0.60/$2.40/$0.12. The `qwen3.8-max-preview` mapping remains unverified.
- The logged-in Sub2API production console was inspected: its OpenAI-compatible channel has 17 model rates. After the user's correction, verified routes were reset to provider reference bases and the public balance group was changed from 4× to 0.72×. The saved values were read back. MiniMax M3 was later found to retain its old list-rate base and still needs correction; the redacted before-state, current rate snapshot, and prior eight-request GPT-6 Astra sample are recorded in `docs/model-price-research-2026-09-26.md`.
- The configured NewAPI admin hostname `newapi-admin.cheapbuddy.cc` did not resolve in DNS. NewAPI route mapping, rates, and cost evidence remain unavailable; local verification clones were not treated as production configuration.
- The first interim update incorrectly embedded a discount in some channel rates and retained a 4× group factor. The user corrected the pricing semantics: channel token prices must match provider list prices, with the 0.72× discount applied separately. The Sub2API production configuration was corrected accordingly and read back. DeepSeek routes use official off-peak base rates plus weekday 2× peak multipliers for 09:00–12:00 and 14:00–18:00 Beijing time; the scheduler cannot exclude public holidays.
- The new target is official list price × 0.72 for provider-confirmed routes. This is not verified positive unit economics. The prior Astra usage sample showed a $1.1836 account-cost estimate against about $3.0773 customer charge, but it predates this correction, is not a post-change billing sample, and is not a supplier invoice. Actual acquisition-cost reconciliation and margin by route remain open.
- The MiniMax API price page shows a permanent reduction from $0.60/$2.40/$0.12 to current ≤512K standard rates of $0.30/$1.20/$0.06. Its channel still has the old list-rate base, so the 0.72× group currently charges more than 0.72× the current official standard rate. The production correction could not be applied in this turn because the authenticated admin browser is unavailable. Exclude MiniMax M3 from the exact-discount claim until its channel base is changed. `qwen3.8-max-preview` also remains excluded until its route mapping is verified. Confirm public Grok 4.7 to production Grok 4.6 mapping and test DeepSeek aliases. NewAPI production access remains blocked because `newapi-admin.cheapbuddy.cc` did not resolve in DNS. No media rates were changed. Website effective-price synchronization, balance-policy evidence, billing samples, release checks, and actual supplier cost review remain open.
- The user clarified that MiniMax H3 should be anchored to the official 768P video rate. The official price is $0.08/second and 0.72× computes to $0.0576/second. This is media billing, separate from M3 token pricing and the Sub2API token group multiplier. NewAPI's actual H3 media rate and any separate media multiplier remain unread; do not claim $0.0576/second is active until production read-back confirms it.
- `npm run build` passed, and the website's `src/**/*.test.js` suite passed (32 tests). The package-level `npm test` also discovers tests inside the untracked NewAPI verification clones, where Vitest is not installed; do not install dependencies in those clones as part of this change.
