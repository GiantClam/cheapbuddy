# Delta: Website Pricing and Value Comparison

**Change ID:** `refresh-model-pricing-and-compare-cli-value`
**Affects:** Public model catalog, homepage pricing comparison, billing claims, localized copy, SEO metadata

---

## ADDED

### Requirement: Traceable official model reference prices

The public model catalog MUST distinguish each provider's official API reference price from CheapBuddy's effective customer price. For every enabled token model, it MUST associate a canonical provider model ID, official source URL, retrieval date, currency/region, input and output prices, and any applicable cached-input, long-context, or time-based price tier. Values with unavailable or uncertain sources MUST be marked unverified and MUST NOT support an exact discount claim.

#### Scenario: Model has tiered official pricing

- GIVEN an enabled model has different cached-input or long-context rates
- WHEN its price is shown on the website
- THEN each relevant tier and its unit/condition is shown or directly linked
- AND the displayed comparison uses the matching tier on both sides

#### Scenario: Official model price cannot be verified

- GIVEN no current provider-owned source or canonical model mapping can be confirmed
- WHEN the catalog is rendered
- THEN the site identifies the official reference price as unverified or unavailable
- AND does not claim an exact percentage discount for that model

### Requirement: Comparable CLI subscriptions and API usage

The homepage MUST present CLI subscription entitlements separately from API token prices. A subscription comparison MUST identify its official plan, price, included usage/limits, and source when available; it MUST NOT turn subscription price into unsupported token totals or fixed prompt/message counts. CheapBuddy balance MUST be expressed in its actual currency and MUST NOT be labeled as WorkBuddy credits.

#### Scenario: User compares a CLI plan to CheapBuddy

- GIVEN the comparison includes WorkBuddy, Codex, Claude Code, or OpenCode
- WHEN the plan is displayed
- THEN its official subscription/credit terms are linked and dated
- AND API model token rates are shown as a distinct comparison basis

### Requirement: Evidence-gated customer billing claims

The website MAY claim that user balance has no weekly reset, customer prices do not vary by peak/off-peak periods, successful requests settle according to actual usage, or paid balance never expires only when the corresponding production policy or representative billing evidence has been verified. Promotional balance and request/model limits MUST be described separately where their rules differ.

#### Scenario: Production evidence does not support a billing claim

- GIVEN a claim about expiry, resets, peak pricing, or final usage settlement is not verified
- WHEN pricing copy is prepared
- THEN that claim is omitted or clearly qualified
- AND request limits and promotional-credit policy are not implied to be unlimited or permanent

### Requirement: Model-specific price advantage

The site MUST calculate and describe a CheapBuddy price advantage only for equivalent usage of the same model, region/currency, token type, and applicable context/cache/time tier. It MUST NOT apply one universal discount where any listed route lacks verified price advantage or sustainable positive unit economics.

#### Scenario: Some models do not meet the advertised discount

- GIVEN one model route is at parity, has unknown upstream cost, or cannot sustain the target margin
- WHEN homepage comparison is rendered
- THEN the route is excluded from a universal discount claim or shown with its model-specific price
- AND other verified model comparisons remain available

## MODIFIED

### Requirement: Model price fields are current and interpretable

The model catalog's public `input` and `output` values MUST be maintained from current official provider sources and MUST use a consistent unit, such as price per million tokens. The page MUST expose the checked date and relevant pricing conditions. Media models MUST retain their native task/media billing units and MUST NOT be represented as token-priced unless the provider bills them that way.

#### Scenario: Price data is refreshed

- GIVEN provider pricing has been rechecked
- WHEN a model catalog value is updated
- THEN its official source and retrieval date are updated with the value
- AND the associated tier conditions remain available to the price comparison

## REMOVED

- CheapBuddy package amounts presented as WorkBuddy official credits or as a synthetic WorkBuddy-points multiplier.
- Fixed Claude Code prompt/message-count claims that are not guaranteed by official plan terms.
- Universal discount claims based only on static frontend multipliers without production billing verification.
