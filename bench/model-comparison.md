### Model comparison and pricing guide

Same two scenarios, same seeded shoppers, same chaos, eight models. Every cell is one run with all three agents (shoppers, merchant, analyst) on that one model, against the PayPal sandbox with live OpenRouter calls, 8–9 Nov 2026.

| Model (all three agents) | List price in / out per M | Quiet Tuesday baseline → hardened | Lost parcels baseline → hardened | Shoppers who paid, of 5 / of 10 | Cost per run | Wall per run | PayPal tool errors |
|---|---|---|---|---|---|---|---|
| `gpt-oss-120b` | $0.019 / $0.071 | 90 → 100 | 90 → 93 | 4–5 / 8–9 | $0.0020–$0.0042 | 80–89 s | `pay_order:503` ×1 |
| `gpt-6-luna` | $0.1 / $0.5 | 90 → 100 | 90 → 100 | 5 / 7 | $0.0039–$0.0090 | 72–88 s | `get_shipment_tracking:403` ×7 |
| `gemini-2.5-flash-lite` | $0.1 / $0.4 | 91 → 100 | 82 → 98 | 2–3 / 2–3 | $0.0035–$0.0071 | 64–100 s | `get_order:404` ×3, `get_shipment_tracking:403` ×4 |
| `deepseek-v4.1-flash` | $0.051 / $0.567 | 90 → 100 | 84 → 100 | 4 / 8 | $0.0085–$0.020 | 152–197 s | `show_product_details:404` ×1 |
| `claude-haiku-5.5` | $0.1 / $0.5 | 90 → 100 | 90 → 100 | 5 / 7–9 | $0.0084–$0.020 | 64–104 s | `show_product_details:404` ×2, `update_shipment_tracking:403` ×3 |
| `claude-sonnet-5.5` | $2 / $10 | 90 → 100 | 90 → 100 | 5 / 8 | $0.107–$0.317 | 68–76 s | `get_shipment_tracking:403` ×1 |
| `gpt-5.5` | $5 / $30 | 90 → 100 | 90 → 100 | 5 / 7 | $0.318–$0.630 | 72–116 s | `get_shipment_tracking:403` ×7, `show_product_details:404` ×1 |
| `claude-opus-5.5` | $4 / $20 | 90 → 100 | 90 → 100 | 5 / 8 | $0.296–$0.738 | 72–108 s | `show_product_details:404` ×14, `get_shipment_tracking:403` ×3, `update_shipment_tracking:403` ×1 |

What the numbers say:

- **The score follows the merchant, not the model.** Baselines land at 82–91 and hardened runs at 93–100 on every model, from a $0.02 open-weights model to Opus 5.5. The baseline merchant never ships (`CAPTURE_WITHOUT_TRACKING` on every order) and the hardened profile clears it. A top-tier model does not rescue a merchant process that has no tracking step.
- **Cost spans more than 300× for the same verdict.** $0.002 a run on gpt-oss-120b, $0.74 on Opus 5.5. Sonnet 5.5 costs about 15× Haiku 5.5; GPT-5.5 and Opus 5.5 about 35×.
- **Shoppers differ more than merchants.** Gemini 2.5 Flash Lite shoppers reached payment 2–3 times where every other model reached it 4–5 times of 5 and 7–9 times of 10. The readiness score does not move, because it scores the store, but the conversion column does.
- **Bigger is not cleaner on tools.** Opus 5.5 asked for product ids that do not exist 14 times (`show_product_details` 404), because the catalog shows names and it passed slugs of them. The shopper tool now resolves slugs, list numbers and shortened names before the call. Every tool error is a `paypal.error` event in the Arena and the Report trail.
- **The one hardened run under 98** is gpt-oss-120b on Lost parcels (93): a `pay_order` 503, a retry flagged as `DUPLICATE_CAPTURE_ATTEMPT`, and one buyer left waiting.

Which model to pick:

| Use | Model | Why |
|---|---|---|
| The crowd, CI smoke runs, anything repeated | `claude-haiku-5.5` or `gpt-6-luna` | one to two cents a run or less, full shopper completion, 100 on hardened |
| Lowest cost | `gpt-oss-120b` | $0.002–0.004 a run, the cheapest here even though it used the most billable tokens; the one hardened run that dropped to 93 was on this model |
| Avoid for timing-sensitive demos | `deepseek-v4.1-flash` | same scores, about twice the wall time (150–200 s) |
| "How does a frontier shopping agent treat my store" | `claude-sonnet-5.5`, `gpt-5.5`, `claude-opus-5.5` | no gain on score here at $0.10–0.74 a run; pick one when the point is to simulate the agent your customers actually use |

Assumptions and limits:

- One run per cell, so there is no variance estimate. Baselines differ by up to 9 points across models running the same merchant process (82–91); treat a difference of that size as noise.
- Only Quiet Tuesday and Lost parcels were run across models. Black Friday and Dispute storm are measured on Haiku only (table above).
- The shipped default (Haiku shoppers, Sonnet merchant and analyst) was not benchmarked as a mix; expect its cost between the Haiku and Sonnet rows.
- Cost is each run's recorded tokens priced at OpenRouter list prices of 8 Nov 2026, cache reads at the cache-read price. These runs were recorded before a cost-accounting fix on 9 Nov: a turn's cost was read from its last step only, which under-reported it by 2–8×. Two runs after the fix reported 10–12 % above the list-price figure, so read the column as a floor. The 28 comparison runs cost about $4.50.
- The Haiku row comes from the scenario runs above, not from a separate comparison pass.
- Raw rows are in `bench/results.jsonl`; `node bench/comparison.cjs` prints this table and `bench/README.md` has the commands to repeat it.
