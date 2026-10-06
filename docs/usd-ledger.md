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

The deployed backend revision is `b485e6a` and frontend revision is `7b15b4c`.
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

Operational evidence is kept outside Git in `output/usd-ledger-20261005/`.
The report records deploy IDs, reconciliation policy, security remediation and
remaining profit limits. Do not copy credentials into this directory or logs.
