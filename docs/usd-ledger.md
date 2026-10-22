# CheapBuddy USD ledger

## Settlement contract

The wallet, usage charges, account procurement costs, recharge credits, referral
balances and refund deductions use genuine USD. A provider credit labelled "$"
is not evidence of its cash denomination. PPToken credit costs CNY 1 per nominal
unit, so its account cost cards must be converted from CNY before comparison.

`BALANCE_USD_TO_CNY_RATE=6.5` is the business settlement rate (CNY per USD), not a
live market quote. A CNY payment is divided by that rate; a USD payment is already
USD. `balance_recharge_multiplier` remains a separate promotional multiplier.
Order `amount`, `bonus_amount` and `refund_amount` retain eight decimal places;
`pay_amount` retains the payment currency's existing two-decimal representation.
Payment gateways continue to receive native currency amounts and their required
minor units. See [Stripe currency rules](https://docs.stripe.com/currencies).

Each recharge tier can explicitly promise one `credited_balance` in USD across
both payment currencies. For example, CNY 15 and USD 2.31 both credit USD
2.30769231. The USD payment's two-decimal price is a fixed package price, not an
instruction to issue 2.31 credits. Duplicate native prices cannot promise
different credits, including a mixture of automatic FX and fixed credits.

New balance orders persist `ledger_currency`, `ledger_version`, the FX rate,
original native amount, payment base, USD payment base and final credit in their
provider snapshot. Fulfillment redeems the saved order amount. Later FX changes
do not change existing orders. Refund deductions are USD and are converted
proportionally to the original native `pay_amount` before the gateway call.
Repeated payment callbacks retain the existing order/redeem idempotency controls.

## Historical cutover

Historical wallets lack a complete funding-lot ledger. Existing numerical wallet,
frozen and referral balances are grandfathered as USD, with a cutover audit;
they are never indiscriminately divided by 6.5. Historical numeric credits are
not evidence of cash revenue. Record original cash, original currency and any
extra grandfathered credit separately. Original orders retain their promised
amount, including orders awaiting settlement during rollout.

Historical Alipay orders are CNY. Store `original_payment_currency` independently
of provider-instance metadata; do not fabricate a provider snapshot just to label
an old order. Preserve all existing snapshot fields. Historical wallet snapshots
and order annotations must be idempotent and recorded under a stable cutover ID.

This policy preserves purchased entitlements but creates a subsidy liability for
legacy CNY credits. It cannot retroactively guarantee a cash profit on them.
New signup credit is a USD promotion with an explicit budget; the previous CNY 1
gift corresponds to USD 0.15384615 at the settlement rate.

## Kimi procurement and pricing

The rate examples below describe the October 6 deployment. The October 19
cash-cost reconciliation at the end of this document supersedes its 5% reserve
and retail examples; current effective prices are USD 2.5 / 12.5 / 0.25 per
million input / output / cache-read tokens.

PPToken's confirmed cost after its 0.65 account factor is CNY 13 input, 65 output
and 1.3 cached input per million tokens. At FX 6.5 this is USD 2, 10 and 0.2.
Use input cost as the conservative cache-write reserve. The account multiplier
is 1 because the custom cost card already incorporates the supplier factor and
FX. Automatic upstream multiplier sync must remain off for this account.

For target model gross margin `m` and procurement buffer `b`, require an effective
customer price of at least `cost_USD * (1+b) / (1-m)`. With `m=0.20`, `b=0.05` and
public group factor 0.72, Kimi channel bases per million tokens are USD 3.645834
input/cache-write, 18.229167 output and 0.364584 cached input. Round prices up,
not down. Effective prices are about USD 2.625 / 13.125 / 0.2625. The resulting
model gross margin is at least 23.8095%, or 20% against the buffered cost.

This is a model procurement margin. Net profit additionally depends on payment
fees, fixed per-payment fees, refunds, referral commissions, promotions and
operating expenses. Original payment processing fees may remain after refund;
see [Stripe refunds](https://docs.stripe.com/refunds). Reconcile actual cash
receipts and supplier invoices independently of wallet credits. Verify other
supplier cost cards from cash denomination before including them in an overall
profit claim.

Kimi must remain active and schedulable. Its prior recurring paid health test is
disabled; validate pricing with an explicitly audited, bounded manual request.
Never solve a billing discrepancy by pausing this account.

## Rollout and verification

1. Capture sanitized wallet, order, settings and price-card evidence.
2. Stage the USD precision migration and ledger FX/tier settings. Apply Kimi USD
   cost and customer price cards while preserving other channel configuration.
3. Deploy the backend, then the wallet/payment UI. Keep the existing service
   healthy during the rolling deployment. Annotate any intervening legacy orders.
4. Confirm PostgreSQL monetary scales are eight decimals and live checkout quotes
   agree for CNY/USD package payments. Verify saved unpaid orders, then cancel
   them without performing customer payments.
5. Check one bounded Kimi request: the account selected, tokens, wallet debit,
   calculated procurement cost and margin. Remove only its temporary operator
   key. Record deployment IDs and results in the operational report.

Backend tests cover FX parity, canonical tier credits, frozen order precision,
proportional refunds, legacy currency fallback and rejection of ambiguous prices.
Existing payment tests cover duplicate callbacks and refund recovery. Frontend
tests cover explicit USD labels and native payment-currency rendering.

The existing optional daily payment limit excludes pending orders. Several
pending orders can be paid beyond that configured limit; serialization and a
reservation policy require a separate change. Production has no daily cap, so
this does not alter current settlement or margin. Do not describe it as a strict
cash acceptance cap.

## Production acceptance — 2026-10-06

The USD rollout used backend revision `b485e6a` and frontend revision `7b15b4c`.
The subsequent frontend patch `5799641` upgrades only the existing transitive
source-map-js dependency to patched 1.2.2 and documents the acceptance evidence.
The patched frontend deployment is `2e70392f-abc7-4a55-861c-82cc98477fea`.
Production uses settlement FX 6.5, recharge multiplier 1, no recharge bonus,
and signup credit USD 0.15384615. Live CNY 15 and USD 2.31 test orders each
saved USD 2.30769231 with frozen FX 6.5. Both unpaid test orders were cancelled.
No customer payment was made for checkout verification.

Cutover `cheapbuddy-usd-20261006-v1` preserved all 22 wallet snapshots,
including 21 customer wallets, and annotated 73 legacy balance orders. The 18
completed legacy orders collected CNY 696, equivalent to USD 107.07692308 in
aggregate, but issued 696 nominal credits. The grandfathered excess of roughly
USD 588.92308 is additional entitlement, not a realized procurement loss.

`cheapbuddy_ledger_cost_reconciliation` separately records 806 historical Kimi
requests, original cost snapshots and a reconstructed USD procurement estimate
of 30.7656004. It does not rewrite usage charges, balances or old cost snapshots.
Historical prices and funding are incomplete, so the estimate cannot establish
the cash margin of every historical request. Historical account-cost charts
still need this audit normalization before cross-period comparison.

One bounded Kimi request selected account 5 and the actual Kimi upstream. Its
wallet debit was USD 0.0010526251 and procurement cost USD 0.000802: 23.80953%
model gross margin, or 20.00001% against a 5% cost reserve. Its temporary key was
deleted. No recurring test was created; the existing paid test remains disabled,
while the Kimi account remains active and schedulable. Stale Kimi-to-GLM mappings
were removed from fallback accounts 2 and 3 without disabling either account.

Stripe checkout now offers only its activated card method; domestic Alipay
continues through its existing CNY provider. Re-enable other Stripe methods only
after confirming that this merchant account has activated them.

Regression coverage includes frozen-credit fulfillment after an FX change,
callback replay and proportional refunds below the native payment tolerance.
The new USD calculation module has 92.86% statement coverage; this percentage is
not overall backend coverage. Payment tests across service and handler packages,
Go vet, the embedded-server build, 53 frontend tests and the Vite build passed.
The patched dependency installation, 53 frontend tests and Vite build were
verified again; the official npm registry audit reported zero vulnerabilities.

Operational evidence is kept outside Git in `output/usd-ledger-20261005/`.
The report records deploy IDs, reconciliation policy, security remediation and
remaining profit limits. Do not copy credentials into this directory or logs.

## GLM procurement and retained fallback routes

The October 19 reconciliation below supersedes this section's retail prices
and 5% reserve. Its primary-route-only margin scope remains in effect.

On 2026-10-06, 42 GLM-5.3 requests through account 7 matched PPToken's request
and token totals. Supplier cash cost was CNY 15.6416553, or USD 2.4064085077;
wallet charges totaled USD 3.7288079833. The old account-cost total USD 5.68036182
used an international reference price because this account lacked a procurement
card. This was a cost-reporting discrepancy; USD recharge conversion alone
cannot repair a missing supplier card.

The primary account 7 procurement card now uses CNY 8/28/2 per million tokens,
times its supplier factor 0.45, divided by 6.5. The paid backup account 2 also
has an explicit GLM-5.3 card using nominal CNY 1.4/4.4/0.26, times supplier factor
3.5, divided by 6.5. Both local account factors remain 1. Existing GLM-5.2 and
Kimi cards are retained. Procurement price fields retain ten decimal places,
so reconcile supplier cash independently of tiny price-card rounding differences.

The user requires all backup routes to remain available for reliability, and
subsequently specified that fallback procurement must not determine retail
prices. Accounts 2, 3 and 7 retain their GLM-5.3 mappings and scheduling. Set
retail prices from primary account 7 cash cost only, using the agreed 20% target
against a 5% cost reserve and group factor 0.72. Channel bases per million tokens
are USD 1.009616 input, 3.533654 output and 0.252404 cached input. Effective prices
are USD 0.72692352, 2.54423088 and 0.18173088 respectively. This produces about
23.81% primary procurement margin, or 20% against the buffered primary cost.

The original 42-request snapshot had 35.46% procurement margin, or 32.24% after
a 5% cost reserve. Repricing that same token mix with the new rates would reduce
charges from USD 3.7288079833 to USD 3.1584130258, about 15.30%. This is a replay
calculation, not a retroactive change to customer charges. Other model prices
were preserved. Procurement cards are still recorded for paid fallback routes;
retain their actual costs as a separate reliability expense. Lower retail prices
can make fallback requests unprofitable, so primary-price margin must not be
presented as the realized margin including failover expenses.

Account 3 had no customer requests in this snapshot. Its public pricing and
token-use endpoints do not establish the account's actual cash procurement
denomination and rate. Keep its fallback route and flag its cash cost as
unverified; do not guarantee margin for every future route mix. Cache writes
were also absent from the snapshot; retail writes remain free while supplier
cost cards conservatively reserve input cost pending verification.

Historical usage, customer balances and API keys were not rewritten. Today's
cash reconciliation and exact configuration acceptance are in the ignored
`output/usd-ledger-20261005/glm-report-20261006.md` operational report. The latest
retail policy and persisted-price evidence are in `glm-primary-pricing-report.md`
and `glm-primary-retail-verification.json` in the same directory.

## Other model USD procurement audit — 2026-10-06

**Historical record; cash-denomination conclusion withdrawn on 2026-10-19.**
The `unit=USD` label below describes supplier nominal credits, not demonstrated
USD cash expenditure. The earlier fitted costs and minimum-margin claims in
this section must not be used as current procurement evidence. The cash-cost
reconciliation below replaces verified text prices. Remaining legacy and media
cost statistics require separate cash reconciliation.

The customer ledger remains USD for every account and the settlement FX remains 6.5 CNY per
USD. The live supplier unit check returned `unit=USD` for accounts 2, 4, 5, 6, 7 and 8.
Account 3 (Aiberm) returns HTTP 404 for both billing and usage, so its fallback cash
denomination remains explicitly unverified. No account was disabled, unscheduled, remapped, or
removed.

Supplier `/v1/usage` responses identify `actual_cost` as USD, but the suppliers do not expose a
cash invoice or input/output/cache/long-context rate card. The added cards preserve the observed
model token mix and use the authorized USD usage cost as cost evidence. They are suitable for the
observed mix and reconciliation; they do not prove every future service tier or long-context mix
until supplier invoices are available. Account 6 has model-specific long-context/service-tier
differences and must be reconciled separately.

The effective customer price is calculated as `procurement cost × 1.05 ÷ 0.80`, after the public
group factor of 0.72, with prices rounded upward so the persisted value itself still clears 20%.
Account 2's observed MiniMax M3 and Qwen 3.8 Max costs were above their old public prices; both
cards were raised to the USD cost floor. Cache writes use the input cost as a conservative
reserve when the supplier did not expose a write rate. Persisted cards and margin evidence are
in `output/usd-ledger-20261005/`.

The reconciled public cards for every model other than Kimi K3 and GLM 5.3 now have a verified
primary cost mapping and a minimum buffered margin of at least 20%. Models with no auditable
cost card (`doubao-seed-2.0-code`, `doubao-seed-2.0-pro` and `qwen3.8-max-preview`) were removed
from the public pricing list while their supplier account mappings remain available as fallback
configuration. This prevents an unpriced request from becoming a free or loss-making request.

`grok-imagine-image-2.0` is billed separately as a fixed per-request media model. The observed
supplier cost was USD 5.608 for 36 requests (USD 0.15577778 each); its public base price is now
USD 0.283970 per request, yielding USD 0.2044584 after the group factor and about 20% margin
against a 5% reserve. `gpt-image-2.5` has no verified supplier cost and has no public billing
card; its supplier mapping remains available for later audited rollout. Media pricing must never
be inferred from token cards.

The same primary-route check found `glm-5.3-flash` underpriced. Account 7's supplier snapshot
contained 34 requests with USD 0.33566418 actual cost after its 0.45 supplier factor. Its public
base prices are now USD 0.751954 input, 2.631625 output, 0.216198 cached input and 0.751954
cache write per million tokens. These prices produce at least 20% buffered margin after the 0.72
group factor for the observed cost mix.

## MiniMax H3 media price — 2026-10-06

MiniMax-H3 remains on the USD ledger. The requested customer rate of CNY 0.10 per
second converts at the fixed settlement rate of CNY 6.5 per USD to USD
0.0153846154 per second. Per the four-decimal upward-rounding policy, the saved
customer price is USD 0.0154 per second.

NewAPI's native H3 rate is USD 0.0600 per second and CheapBuddy's media quota is
500,000 quota per USD. The production Relay multiplier is therefore
`0.2566666666`; integer settlement uses ceiling rounding, producing 7,700 quota
or USD 0.0154 for one successful second, USD 0.0616 for four seconds, and
USD 0.1232 for eight seconds. The existing Grok and GPT image fallback entries
remain in `RELAY_MEDIA_MULTIPLIER_BY_MODEL`; no backup route or account was
removed or disabled.

The read-only authenticated pricing check returned HTTP 200 with the expected
H3 billing expression `tier("base", u("seconds") * 0.06)` and multiplier. The
sanitized evidence is `output/usd-ledger-20261005/h3-price-final-20261006.json`.

## Production integration evidence — 2026-10-07

Using the supplied ordinary-user test account, both previously blocked production
checks now pass. The account/catalog check observed the public settings, ordinary
user session, existing group-2 model Key, model catalog, subscriptions and checkout
catalog with no blockers; the catalog contained 12 text, 1 image and 1 video model.
The production regression check also passed refresh-token rotation and revocation,
Key creation/idempotent replay/conflict handling, model access control, unknown task
isolation, media usage, CNY/USD recharge quote validation, logout and cleanup.

The regression runner created one random test Key and deleted it, logged out both
refresh sessions, and created no payment order or paid text, image or video request.
The sanitized reports are `output/usd-ledger-20261005/coworkany-evidence-20261007.json`
and `output/usd-ledger-20261005/production-regression-evidence-20261007.json`.

## DeepSeek peak surcharge removal and margin correction — 2026-10-19

**Superseded by the cash-denomination correction below on the same day.**
The removal of the 12 peak multipliers remains valid. The USD cost interpretation,
USD 1.25 / 5 / 0.025 retail examples, and replay estimate below were incorrect:
PPToken's nominal debit requires CNY-to-USD conversion. They are retained only
as the earlier operational record, not as current prices or verified USD costs.

The user requested a 20% model gross margin and cancellation of DeepSeek's peak
doubling. The authenticated PPToken account-8 usage API reports USD. Its observed
V4.1 sample of 2,099,474 uncached input, 28,803 output and 6,862,336 cache-read
tokens reconciles exactly to USD 2.35193272 at USD 1 / 4 / 0.02 per million tokens.
These are effective supplier rates; do not apply its 0.5 account factor again.
The shared channel's existing account-cost statistic instead used a lower
fallback estimate, so it must not be treated as the supplier bill.

V4.1 retail now targets `verified supplier cost / 0.8`, with no additional 5%
reserve. Channel 1, group 2 at 0.72, saves input/output/cache-read bases of
USD 1.736112 / 6.944445 / 0.034723 per million tokens. Channel 3, group 4 at 1.1,
saves USD 1.136364 / 4.545455 / 0.022728. After their existing group factors,
both yield approximately USD 1.25 / 5 / 0.025. Cache-write pricing conservatively
retains the input-cost reserve because the supplier sample has no cache writes.

All three DeepSeek pricing rows in each of these two channels have their
09:00–12:00 and 14:00–18:00 time multipliers set to 1. The period definitions
remain stored, but they impose no surcharge. Other model prices and context
intervals retain their previous semantic values. Supplier routes, account
scheduling, group factors, historical charges and wallet balances were preserved.
The admin form also materialized disabled feature flags that were previously
absent; these retain the same disabled behavior.

The prior last-request charge of USD 1.0815815368 would be approximately USD
0.5150375 under the new rates, a 52.38% reduction. This is a replay, not a refund.
The 20% calculation is against verified PPToken usage rates, not a guarantee of
net business profit or of EcoPhase procurement margin. EcoPhase's inspected
usage endpoints did not expose its actual bill; its procurement cost remains
unverified. No new paid inference was submitted for this configuration change.

Sanitized before/after snapshots, supplier evidence, exact margin calculations,
semantic preservation checks and UI proof are in `.omx/logs/deepseek-margin-*`
and `.omx/tmp/deepseek-price-*-20261019.result.txt`. Historical documentation
above describes its original configuration; it does not override this later
DeepSeek policy.

## Cash-cost reconciliation and unbuffered 20% margin — 2026-10-19

The later "Separate GPT cash costs and Claude policy costs" section below
supersedes only this section's Claude retail/cost basis. GPT and other verified
non-Claude retail corrections remain in effect.

This section supersedes all earlier supplier-currency assumptions and retail
examples for the text cards it verifies. Authenticated PPToken funding history
shows CNY 200 purchasing 210 nominal dollar-labelled credits including a 10-credit
promotion, and CNY 100.60 purchasing 100 credits including a payment fee. A label
of `unit=USD` is insufficient to establish USD cash cost. Use the conservative
ordinary funding basis CNY 1 per credit, excluding promotional bonuses. The
existing business settlement rate remains CNY 6.5 per USD.

For each observed token category, calculate:

```
cash USD cost = supplier nominal rate * current supplier group factor / 6.5
effective customer USD price = cash USD cost / 0.8
channel price = effective customer USD price / CheapBuddy group factor
```

There is no extra 5% reserve. Group factors remain 0.72 for normal OpenAI and
1.1 for shared/Claude; explicit cards compensate for those factors. Two Astra
group-level overrides were also reconciled because they take priority over the
channel card. Twelve DeepSeek time periods remain at multiplier 1, and the
groups' peak pricing remains disabled. Grok's observed long-context cost tier
remains separate from clock-time pricing.

Production transaction `cb-all-model-cash-margin-20261019-v2`, audit log 21555,
committed 38 price rows and two group overrides, updating 168 monetary fields.
Supplement `cb-all-model-cash-margin-20261019-v3-legacy`, audit log 21557, then
updated eight more fields on the two legacy V4 Flash cards using an additional
direct quote of nominal CNY 3 / 9 / 0.25 before the supplier's 0.5 factor.
The combined exact-rational plan verifies 126 observed-category fields against at least
20% primary procurement margin after upward rounding to 12 decimals per token.
The other 50 fields retain their old cache/input ratios at the new base price
and are explicitly provisional; their independent supplier cost is unverified.
Unknown MiniMax M3, GLM 5.2, Grok 4.6 and mixed legacy DeepSeek Pro/0731/vision cards, media
tariffs, and unobserved fast/flex/reasoning tariffs are outside this guarantee.
Existing cost-statistics cards were preserved and require a separate cash-cost
reconciliation; do not treat their displayed totals as verified procurement.

Examples of effective customer prices in USD per million tokens (small stored
rounding differences between groups are possible):

| Model | Input | Output | Cache read |
| --- | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 0.19230840 | 0.76923144 | 0.00384624 |
| GPT 6 Sol | 0.11076984 | 0.55384632 | 0.01107720 |
| GPT 6 Astra | 0.55384632 | 2.76923088 | 0.05538528 |
| Kimi K3 | 2.50000056 | 12.50000064 | 0.25000056 |
| GLM 5.3 | 0.69230808 | 2.42307720 | 0.17307720 |
| Claude Opus 5.5 | 0.42307760 | 2.11538470 | 0.02115410 |

The operation invalidated 164 API-key authentication caches and the channel
cache. Fresh production reads verify the stored plan, group factors, context
metadata and unchanged routing. No paid inference was needed. This is primary
model procurement gross margin, excluding fallback route expenses, funding fees,
taxes, promotions and operating costs. It cannot guarantee net profit or every
future route/tier mix. Historical usage and balances were not rewritten; the
separately requested USD 1.50 account credit was a distinct earlier operation.

Sanitized exact calculations, before/after snapshots, transaction receipt and
verification are in `.omx/logs/all-model-margin-*` and
`.omx/logs/all-model-price-plan-20261019.json`. Funding denomination proof is in
`.omx/logs/supplier-cash-denomination-20261019.txt`.

## Separate GPT cash costs and Claude policy costs — 2026-10-19

The user explicitly selected **official Claude USD token prices multiplied by
1.1** as the Claude cost basis, followed by a 20% gross margin. This is a
user-defined pricing cost estimate, distinct from the previously observed
PPToken cash procurement cost. Do not describe the policy estimate as an audited
supplier invoice. Claude prices are not divided by the CNY settlement FX.

Shared group 4 has six enabled exact Claude routes to the Anthropic platform,
and continues to support GPT and Claude with one shared API key. The parent
shared group remains the billing group; provider routing does not substitute
the standalone Claude group's pricing or statistics rules.

| Configuration | GPT | Claude |
| --- | --- | --- |
| Cost basis | Observed nominal CNY supplier rates × supplier factor ÷ 6.5, stored as USD | Official USD token prices |
| Account cost multiplier | 1; supplier factor and FX already included in the cost card | 1.1, applied once |
| Customer price target | Actual procurement USD cost ÷ 0.8 | Official USD price × 1.1 ÷ 0.8 = × 1.375 |
| Shared channel base with group multiplier 1.1 | Target USD price ÷ 1.1 | Official USD price × 1.25 |

Production operation `cb-family-cost-policy-20261019-v1`, audit log 21561,
updated all 12 Claude cards in channels 2 and 3. Input, output, five-minute
cache writes, one-hour cache writes and cache reads use current official USD
prices. All 60 configured fields exactly satisfy the selected 20% policy margin.
GPT and all other customer prices remain unchanged.

The official baseline is the [Anthropic price table](https://platform.claude.com/docs/en/about-claude/pricing).
For example, Opus 5.5 input/output base prices are USD 4/20 per million tokens;
policy costs are USD 4.4/22 and final customer prices USD 5.5/27.5. Sonnet 5.5
final input/output prices are USD 2.75/13.75. Fable 5/5.1 final input/output
prices are USD 13.75/68.75. The operation does not enable clock-time peaks.

Accounts 9, 10 and 11 now use cost multiplier 1.1. Their already-disabled
automatic upstream multiplier write-back remains disabled; upstream billing
probes remain enabled and retain supplier observations independently. This
prevents a supplier's 0.55/1/1.6 group declaration from replacing the selected
Claude policy cost factor.

Cost-statistics rules are separate from retail cards. Claude rules contain
unscaled official USD prices and match only account IDs 9/10/11. GPT rules
match only account 6, whose normalized USD cash cost cards were corrected in
channel 1 and added to shared channel 3. New cost rules have empty group-ID
lists because rule selectors use account OR group matching, and blank pricing
platforms because statistics use the parent composite group's platform. The
Claude channel's "apply retail pricing to account statistics" switch is now
off. The statistics table retains its existing ten-decimal token-cost precision;
tiny GPT cost rounding differences remain, while retail calculations retain
the exact procurement fractions.

Production reads verify all planned values and unchanged routes/group factors.
The scheduler's full account and metadata caches show GPT factor 1 and Claude
factors 1.1. Three account-change events were emitted and channel/authentication
caches were refreshed for 164 keys. No paid inference or historical-ledger
rewrite was performed.

The configured five-category price arithmetic is verified; runtime cost
reporting is not fully verified for special tiers. Source inspection found an
existing Anthropic statistics path that omits five-minute/one-hour cache-write
token breakdown, and custom statistics rules do not apply Fast/service-tier
modifiers. Those paths can misstate reported margins even when the configured
retail prices are correct. They require a separate backend correction and paid
or representative integration acceptance before claiming all special-tier
runtime margins. This configuration operation does not change application code.

Evidence: `.omx/logs/model-family-policy-plan-20261019.json`,
`model-family-policy-applied-20261019.json`,
`model-family-policy-verification-20261019.json` and
`claude-official-price-basis-20261019.json`.

## DeepSeek V4.1 Flash fixed off-peak discount — 2026-10-19

The user selected **official USD off-peak prices multiplied by 0.72 for the
entire day**, with peak charging kept disabled. This section supersedes the
DeepSeek V4.1 Flash cost-plus-20%-margin retail examples above. It does not
change the selected GPT, Claude, Kimi or other model policies.

| Final customer price, USD per million tokens | Uncached input | Output | Cache read |
| --- | ---: | ---: | ---: |
| Normal group 2 | 0.108 | 0.432 | 0.00216 |
| Shared group 4, after stored rounding | 0.1079991 | 0.4319997 | 0.0021593 |

The group factors remain 0.72 and 1.1. Channel 1 card 526 uses official USD
off-peak bases; channel 3 card 508 compensates for the 1.1 group factor. Bases
are rounded down to twelve decimals per token so the customer price does not
exceed the advertised fixed discount. All existing time-period factors remain
1 and both group peak switches remain off. No holiday scheduler is required
for this fixed-price policy.

Both retail cards and group allowlists explicitly cover `deepseek-flash`,
`deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017` and
`deepseek/deepseek-v4.1-flash`. Billing continues to use the requested model,
without depending on Relay alias rewriting. No account mappings or priorities
were changed. In particular, EcoPhase account 12 still excludes the two
unsupported request IDs `deepseek-flash` and `deepseek-v4.1-flash-1017`.

PPToken procurement statistics are maintained separately in genuine USD. Its
observed nominal debit rates 1 / 4 / 0.02 per million tokens already include
the supplier factor 0.5; divide once by the established 6.5 CNY/USD settlement
rate. Do not multiply by 0.5 or divide by 6.5 again. Accounts 2 and 8 retain
account multiplier 1 and disabled upstream multiplier write-back. Cost rule
selectors contain account IDs only, with empty group-ID lists; blank cost-card
platforms permit the shared composite group to match.

The existing ten-decimal cost-card scale stores input/output/cache-read at
USD 0.1538 / 0.6154 / 0.0031 per million tokens; their exact cash basis is
0.1538461538 / 0.6153846154 / 0.0030769231. The cache-read rounding is about
0.75% above that basis, and is a statistics precision limitation rather than
a retail surcharge. Account 8's 1017 input/output tariff was independently
reconciled against four supplier usage records. Its cache tariff and account
2's cache tariff remain same-series estimates pending independent cached-usage
evidence. EcoPhase procurement and the legacy DeepSeek cost cards remain
unverified; fallback model-cost statistics must not be presented as audited
cash costs.

This fixed discount is intentionally below the currently verified PPToken
procurement cost: off-peak model gross margin is approximately -42.45% before
fees and operating expenses. A 20% margin is not promised for this policy.

Production operation `cb-deepseek-usd-fixed72-20261019-v1`, audit 21572,
updated two retail cards, two allowlists, cost row 180 and added cost rules
95/96. Supplement `cb-deepseek-usd-fixed72-20261019-v2-cost1017`, audit 21574,
added the account-8-specific 1017 cost match and shared rule 98 after obtaining
its supplier evidence. Both transactions were first exercised with rollback.
The first commit refreshed 161 API-key authentication caches and the channel
cache; the cost-only supplement refreshed the channel cache.

Production reads verified all changes, unchanged other model cards, unchanged
account routing and group factors. Fourteen nonzero requests covered both
groups, all four direct model IDs, Relay access, streaming and seven cache-hit
cases. Persisted customer charges matched price recomputation within the
ten-decimal usage scale, and the wallet matched the sum of per-entry charges
rounded to eight decimals. Two empty-message requests were rejected with 400,
created no usage records and did not debit the wallet. Two additional 1017
requests verified the new USD procurement rule in both groups.

One separate long 1017 probe timed out at the client while the upstream
completed; its persisted nonzero usage is charged and is recorded separately.
Do not describe all client timeouts as free failures. The current runtime did
not populate `billing_usage_entries` for these probes; wallet verification uses
the before/after balance and persisted `usage_logs.actual_cost`. A full durable
wallet-entry ledger migration is a separate backend task.

Existing balances and historical usage were not rewritten. Operational plans,
sanitized snapshots, receipts, rollback SQL and runtime reconciliation are in
`.omx/logs/deepseek-usd-72-*` and `.omx/tmp/deepseek-usd-72-*`. No application
source or dependency changes were required for this configuration rollout.
