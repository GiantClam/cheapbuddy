# Official model pricing research — 2026-09-26

This record captures provider-published reference prices checked on 2026-09-26. Rates are per 1 million tokens (MTok) unless noted. The public group applies a separate 0.72× multiplier. Most verified Sub2API channel bases were updated to provider reference rates, but the MiniMax M3 base still reflects the provider's original list rate rather than its current standard API rate; see the exception below. Supplier costs and positive margin have not been verified.

## Verified provider rates

| Public model | Provider/model reference | Input | Cached input | Output | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| GPT-6 Astra | OpenAI | $10.00 | $1.00 | $50.00 | Cache write $12.50; above 272K input tokens, long-context rates change. |
| GPT-6 Sol | OpenAI | $2.00 | $0.20 | $10.00 | Cache write $2.50; above 272K input tokens, long-context rates change. |
| GPT-6 Luna | OpenAI | $0.10 | $0.01 | $0.50 | Cache write $0.125; above 272K input tokens, long-context rates change. |
| GPT-5.6 Sol | OpenAI | $4.00 | $0.40 | $20.00 | Cache write $5.00; promotional rates shown through at least 2026-11-21. |
| GPT-5.6 Terra | OpenAI | $2.00 | $0.20 | $12.00 | Cache write $2.50; above 272K input tokens, long-context rates change. |
| MiniMax-M3 | MiniMax API | $0.30 | $0.06 | $1.20 | Current standard API rate at ≤512K, shown after the provider's permanent 50% reduction from $0.60/$2.40/$0.12 list rates; higher context and priority tiers differ. |
| Grok 4.6 | xAI | $2.00–$4.00 | $0.50–$1.00 | $6.00–$12.00 | Production route `grok-4.6`; above 200K prompt tokens, long-context rates apply. |
| Kimi K3 | Moonshot Kimi API | $3.00 | $0.30 | $15.00 | Cache write $3.00; flat price across context lengths. |
| GLM-5.3 / GLM-5.2 | Zhipu BigModel, China | ¥8.00 | ¥2.00 | ¥28.00 | Cache storage is currently listed as limited-time free. |
| GLM-5.3 Flash | Zhipu BigModel, China | ¥0.80 | ¥0.23 | ¥2.80 | Standard price; the page also describes a limited-time half-price offer. |
| Doubao Seed 2.0 Code / Pro | Volcengine Ark, China | ¥3.20 | ¥0.64 | ¥16.00 | Default tier through 32K input; higher input tiers are ¥4.80/¥24 and ¥9.60/¥48. Cache storage is billed by time. |
| DeepSeek V4.1 Flash | DeepSeek API, China | ¥1–¥2 | ¥0.02–¥0.04 | ¥4–¥8 | Off-peak/peak rates; peak is weekdays 09:00–12:00 and 14:00–18:00 Beijing time. |
| DeepSeek V4 Pro legacy aliases | DeepSeek API, China | ¥1–¥2 | ¥0.02–¥0.04 | ¥4–¥8 | Since 2026-09-14, `deepseek-v4-pro` requests route to V4.1 Flash and are billed at Flash rates until V4.1 Pro launches. |
| Qwen 3.8 Max | Alibaba Cloud Model Studio, Beijing | ¥12.00 | ¥1.50 | ¥36.00 | Explicit cache creation ¥15 and cache hit ¥1; region affects prices. |

Sources: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [OpenAI GPT-6 launch pricing](https://developers.openai.com/api/docs/changelog), [MiniMax API pricing](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise), [xAI Grok 4.6](https://docs.x.ai/developers/models/grok-4.6), [Kimi API platform](https://platform.kimi.ai/zh-hans), [Zhipu BigModel pricing](https://open.bigmodel.cn/pricing), [Volcengine Ark pricing](https://www.volcengine.com/docs/84458/1585097?lang=zh&redirect=1), [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/), [DeepSeek V4.1 Flash release](https://api-docs.deepseek.com/zh-cn/news/news260910/), [Alibaba Qwen 3.8 Max](https://help.aliyun.com/zh/model-studio/qwen3-8-max).

## Not verifiable from provider pricing pages

| Production model entry | Provider source | Status |
| --- | --- | --- |
| `qwen3.8-max-preview` | Alibaba Cloud Model Studio | The official page lists `qwen3.8-max`, but an exact current mapping for the `-preview` route was not confirmed. |

The `qwen3.8-max-preview` channel entry retains its previous base values and is not covered by the exact 0.72× official-price claim. Do not replace unknown values with third-party estimates.

## Verified price mismatch still requiring a production edit

MiniMax's official API page labels $0.60 input, $2.40 output, and $0.12 cache-read as the former list rates and shows the current standard tier at $0.30/$1.20/$0.06 (≤512K context). The production `MiniMax-M3` channel base was already $0.60/$2.40/—/$0.12 and was not changed in the correction. At a 0.72× group factor, the effective $0.432/$1.728 is 1.44× the current official standard price, not 0.72×. It must be changed to $0.30/$1.20/—/$0.06 before this model can be included in the discount claim. The logged-in admin browser was not available in the current correction turn, so this remaining production edit was not applied.

## MiniMax H3 video price anchor (media, not tokens)

MiniMax's current official API price for H3 video output at 768P is **$0.08 per second**; 2K output is $0.13 per second. The CheapBuddy API guide says H3 currently supports only 768P, so use the 768P rate as the comparable official anchor for this integration. At a 0.72× target, the arithmetic customer rate is **$0.0576 per second** (about ¥0.3866 at the reference FX rate). This is a media-task charge, not an MTok rate and not governed by the Sub2API token group multiplier. The production NewAPI media rate and any separate CheapBuddy media multiplier could not be inspected in this session, so the calculated rate is not evidence of a saved or effective production price. [MiniMax official API pricing](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise)

## Public plan and comparison references

- USD comparisons use an indicative rate of ¥6.71 per USD, rounded from the IMF representative rate of ¥6.7117 for 2026-09-24, the latest published rate in the report query checked on 2026-09-26. This is a comparison reference, not a payment conversion rate. [IMF exchange-rate report](https://www.imf.org/external/np/fin/ert/GUI/Pages/Report.aspx?CF=Compressed&CT=%27CHN%27&CUF=Period&DS=Ascending&DT=Blank&EX=REP&P=MonthToDate)
- Tencent WorkBuddy Enterprise add-on: ¥100 for 2,000 Credits, with eligibility and expiry conditions. This is a cash-price reference, not a conversion of CheapBuddy RMB balance into WorkBuddy Credits. [Tencent documentation](https://cloud.tencent.com/document/product/1831/134333)
- OpenAI API comparison: GPT-6 Sol input/output rates above can illustrate token-equivalent API list-price usage. Codex plan allowances depend on subscription, model, and task and are not a fixed API-token cash conversion. [Codex plan usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- Claude subscription comparison: Claude Pro is $20/month, Max 5x is $100/month, and Max 20x is $200/month. Plan usage is variable; no fixed prompt count is inferred. [Claude plans](https://claude.com/pricing)
- OpenCode Go: $10/month; published model-dependent monthly usage value is approximately $15–$60. It is not a proratable allowance. [OpenCode Go](https://dev.opencode.ai/docs/go/)

## Production Sub2API configuration — official base rates and separate discount

The logged-in production Sub2API admin at `admin.cheapbuddy.cc` showed one enabled OpenAI-compatible channel with 17 global price entries. The public `CheapBuddy OpenAI` group now uses a 0.72× rate multiplier. For verified routes updated in the correction, channel prices use the current provider reference price and customer token prices are those bases × 0.72, subject to currency conversion and official context/time conditions. MiniMax M3 remains on an older official list price and Qwen preview remains unmapped; neither is covered by this statement.

Rates below are Sub2API channel base rates in USD/MTok, shown as input/output/cache-write/cache-read. CNY prices are converted at ¥6.7117/USD and rounded to six decimals. Customer values show effective input/output before long-context or time-tier variation. Two separate account-specific statistics rules were left unchanged because they are cost accounting, not customer rates. Long-context tier pricing remains enabled in the public group.

On 2026-09-26, the user clarified that the provider's current token price belongs in the model rate card and that the discount belongs in the group multiplier. The earlier configuration embedded a discount in the channel rate and multiplied it by 4×; the confirmed routes were corrected to official current bases and a separate 0.72× group rate. Supplier acquisition costs and positive margin remain unverified. The channel has 17 entries; MiniMax M3 still uses the provider's prior list base rather than current standard pricing, and the `qwen3.8-max-preview` route remains unmapped. Both are excluded from the exact-discount claim.

| Model / route shown in production | Channel base input/output/cache-write/cache-read | Effective customer input/output | Official comparison |
| --- | --- | --- | --- |
| `gpt-6-astra` | $10 / $50 / $12.50 / $1 | $7.20 / $36 | Official input/output/cache-read bases, then 0.72×; long-context tiers apply. |
| `gpt-6-sol` | $2 / $10 / $2.50 / $0.20 | $1.44 / $7.20 | Official bases, then 0.72×; long-context tiers apply. |
| `gpt-6-luna` | $0.10 / $0.50 / $0.125 / $0.01 | $0.072 / $0.36 | Official bases, then 0.72×; long-context tiers apply. |
| `gpt-5.6-sol` | $4 / $20 / $5 / $0.40 | $2.88 / $14.40 | Official promotional bases, then 0.72×. |
| `gpt-5.6-terra` | $2 / $12 / $2.50 / $0.20 | $1.44 / $8.64 | Official bases, then 0.72×; long-context tiers apply. |
| `MiniMax-M3` | $0.60 / $2.40 / — / $0.12 | $0.432 / $1.728 | **Mismatch:** current official standard base is $0.30/$1.20/$0.06 at ≤512K. Production base needs correction; exclude from the 0.72× claim until then. |
| `grok-4.6` | $2 / $6 / — / $0.50 | $1.44 / $4.32 | Official standard short-context bases, then 0.72×; ≥200K context uses higher official tiers. Public-site label says Grok 4.7, so route mapping needs confirmation. |
| `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-flash`, and legacy Pro aliases | $0.148994 / $0.595974 / $0 / $0.002979 | $0.72 / $2.88 | Official off-peak ¥1/¥4/¥0.02 cache hit converted at reference FX; configured weekday peak schedule doubles these rates from 09:00–12:00 and 14:00–18:00 Beijing time. |
| `qwen3.8-max` | $1.787923 / $5.363768 / $2.234903 / $0.223490 | $8.64 / $25.92 | Official Beijing ¥12/¥36/¥15 explicit cache creation/¥1 cache hit converted at reference FX, then 0.72×. |
| `glm-5.3` and `glm-5.2` | $1.191948 / $4.171819 / $0 / $0.297987 | $5.76 / $20.16 | Official ¥8/¥28/¥2 cached input converted at reference FX; cache storage is currently promotional/free. |
| `glm-5.3-flash` | $0.119195 / $0.417182 / $0 / $0.034269 | $0.576 / $2.016 | Official standard ¥0.80/¥2.80/¥0.23 cache hit converted at reference FX; channel cache-write is set to zero. |
| `kimi-k3` | $3 / $15 / $3 / $0.30 | $2.16 / $10.80 | Official Kimi API bases, then 0.72×. |
| Doubao Seed 2.0 Code / Pro | $0.476779 / $2.383897 / — / $0.095356 | $2.304 / $11.52 | Official first-tier ¥3.20/¥16/¥0.64 cache hit converted at reference FX; higher context tiers and timed cache storage need separate treatment. |

Before-state values for changed channel routes (USD/MTok, input/output/cache-write/cache-read) included: Doubao Code/Pro $0.444444/$2.222222/—/$0.088889; GLM 5.2/5.3 $1.111111/$3.888889/—/$0.277778; Kimi K3 $11.666667/$58.333333/—/$1.166667; DeepSeek Flash $0.14/$0.28/$0/$0.0028; GLM Flash $0.027/$0.09/$0/$0.0054; GPT-6 Astra $1.8/$9/$2.25/$0.18; GPT-5.6 Sol $0.72/$3/$0.9/$0.072; Qwen Max $0.32184/$0.96552/$0.45/$0.04023; GPT-6 Sol $0.36/$1.8/$0.45/$0.036; GPT-6 Luna $0.018/$0.09/$0.0225/$0.0018. Other affected routes and previous group settings are preserved in the task execution history. The group changed from 4× to 0.72×; Codex web search base was set to $0.056, yielding $0.04032 at 0.72× (displayed as $0.04). Rollback requires restoring the earlier values, resetting group factor to 4×, and clearing the web-search override to restore its earlier default.

Sub2API's usage page showed eight `gpt-6-astra` requests: customer charge $3.0773, account-cost statistic $1.1836, and unmultiplied standard base $0.7693 under the previous configuration. The standard amount is the channel price; the cost statistic is the system's account-cost estimate, not a provider invoice. The updated official-base × 0.72 setup is intended to preserve roughly the same customer charge for that sample, but this is not a post-change billing verification and proves no supplier margin. Other models had no samples in the selected 24-hour window.

The account list displayed upstream-declared multipliers of 0.50× for the DeepSeek account, 0.45× for the GLM account, and 0.65× for the Kimi account. The active GPT and Grok accounts had no detected multiplier. These are Sub2API account-cost inputs, not supplier invoices; confirm them against actual account statements before treating them as procurement cost.

After editing, the Sub2API channel editor was reopened and changed rates were read back with saved values shown above; the public `CheapBuddy OpenAI` group read back as 0.72×. DeepSeek weekday peak multipliers are configured for 09:00–12:00 and 14:00–18:00 Beijing time. The admin scheduler offers weekdays but no public-holiday exception, so a Chinese public holiday on a weekday may be charged at the configured peak rate despite the provider's off-peak price. The page reported “渠道更新成功”. The Codex search field accepts only thousandths; its $0.056 base yields $0.04032 at 0.72× and displays rounded to $0.04.

The README-configured NewAPI admin host `newapi-admin.cheapbuddy.cc` still did not resolve in DNS when checked, so its admin UI, route mapping, and production rates could not be inspected or changed. The configured `sub2api-admin.cheapbuddy.cc` host also did not resolve; `admin.cheapbuddy.cc` itself served the Sub2API console. Local Sub2API data and NewAPI verification clones were not used as production configuration.

The rate changes do not establish positive unit economics. Before treating the target as sustainable, reconcile supplier invoices/acquisition costs and calculate margin by route. Correct the MiniMax M3 production base before advertising the exact discount for that model. Confirm the public Grok 4.7 to production Grok 4.6 mapping. NewAPI remains unchanged: its configured admin hostname `newapi-admin.cheapbuddy.cc` did not resolve in DNS. No media rates were changed. DeepSeek holiday scheduling, high-context and regional tiers, provider promotions, and the unverified Qwen preview route are not fully represented by a single flat price; qualify comparisons accordingly.
