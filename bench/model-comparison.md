### Model comparison and pricing guide

Same two scenarios, same seeded shoppers, same chaos, eight models. Every cell is one run with all three agents (shoppers, merchant, analyst) on that one model, against the PayPal sandbox with live OpenRouter calls, 8–9 Nov 2026.

| Model (all three agents) | List price in / out per M | Quiet Tuesday baseline → hardened | Lost parcels baseline → hardened | Shoppers who paid, of 5 / of 10 | Cost per run | Wall per run | PayPal tool errors |
|---|---|---|---|---|---|---|---|
| `gpt-oss-120b` | $0.019 / $0.071 | 90 → 100 | 90 → 93 | 4–5 / 8–9 | $0.0008–$0.0021 | 80–89 s | `pay_order:503` ×1 |
| `gpt-6-luna` | $0.1 / $0.5 | 90 → 100 | 90 → 100 | 5 / 7 | $0.0006–$0.0015 | 72–88 s | `get_shipment_tracking:403` ×7 |
| `gemini-2.5-flash-lite` | $0.1 / $0.4 | 91 → 100 | 82 → 98 | 2–3 / 2–3 | $0.0011–$0.0039 | 64–100 s | `get_order:404` ×3, `get_shipment_tracking:403` ×4 |
| `deepseek-v4.1-flash` | $0.051 / $0.567 | 90 → 100 | 84 → 100 | 4 / 8 | $0.0046–$0.011 | 152–197 s | `show_product_details:404` ×1 |
| `claude-haiku-5.5` | $0.1 / $0.5 | 90 → 100 | 90 → 100 | 5 / 7–9 | $0.0010–$0.0046 | 64–104 s | `show_product_details:404` ×2, `update_shipment_tracking:403` ×3 |
| `claude-sonnet-5.5` | $2 / $10 | 90 → 100 | 90 → 100 | 5 / 8 | $0.023–$0.048 | 68–76 s | `get_shipment_tracking:403` ×1 |
| `gpt-5.5` | $5 / $30 | 90 → 100 | 90 → 100 | 5 / 7 | $0.053–$0.134 | 72–116 s | `get_shipment_tracking:403` ×7, `show_product_details:404` ×1 |
| `claude-opus-5.5` | $4 / $20 | 90 → 100 | 90 → 100 | 5 / 8 | $0.065–$0.161 | 72–108 s | `show_product_details:404` ×14, `get_shipment_tracking:403` ×3, `update_shipment_tracking:403` ×1 |

What the numbers say:

- **The score follows the merchant, not the model.** Baselines land at 82–91 and hardened runs at 93–100 on every model, from a $0.02 open-weights model to Opus 5.5. The baseline merchant never ships (`CAPTURE_WITHOUT_TRACKING` on every order) and the hardened profile clears it. A top-tier model does not rescue a merchant process that has no tracking step.
- **Cost spans more than 250× for the same verdict.** $0.0006 a run on GPT-6 Luna, $0.16 on Opus 5.5. Sonnet 5.5 costs about 10–20× Haiku 5.5; GPT-5.5 and Opus 5.5 about 30–60×.
- **Shoppers differ more than merchants.** Gemini 2.5 Flash Lite shoppers reached payment 2–3 times where every other model reached it 4–5 times of 5 and 7–9 times of 10. The readiness score does not move, because it scores the store, but the conversion column does.
- **Bigger is not cleaner on tools.** Opus 5.5 asked for product ids that do not exist 14 times (`show_product_details` 404). Every tool error is a `paypal.error` event in the Arena and the Report trail.
- **The one hardened run under 98** is gpt-oss-120b on Lost parcels (93): a `pay_order` 503, a retry flagged as `DUPLICATE_CAPTURE_ATTEMPT`, and one buyer left waiting.

Which model to pick:

| Use | Model | Why |
|---|---|---|
| The crowd, CI smoke runs, anything repeated | `claude-haiku-5.5` or `gpt-6-luna` | under half a cent a run, full shopper completion, 100 on hardened |
| Lowest list price | `gpt-oss-120b` | cheapest per token, yet not per run: it used 113–131k billable tokens on Lost parcels where GPT-6 Luna used 21–46k |
| Avoid for timing-sensitive demos | `deepseek-v4.1-flash` | same scores, about twice the wall time (150–200 s) |
| "How does a frontier shopping agent treat my store" | `claude-sonnet-5.5`, `gpt-5.5`, `claude-opus-5.5` | no gain on score here; pick one when the point is to simulate the agent your customers actually use |

Assumptions and limits:

- One run per cell, so there is no variance estimate. Baselines differ by up to 9 points across models running the same merchant process (82–91); treat a difference of that size as noise.
- Only Quiet Tuesday and Lost parcels were run across models. Black Friday and Dispute storm are measured on Haiku only (table above).
- The shipped default (Haiku shoppers, Sonnet merchant and analyst) was not benchmarked as a mix; expect its cost between the Haiku and Sonnet rows.
- Cost is the run footer's number: OpenRouter's reported cost when present, otherwise the price table in `packages/agents/src/llm.ts`. List prices are OpenRouter's on 8 Nov 2026. The 28 comparison runs cost $0.95 in total.
- The Haiku row comes from the scenario runs above, not from a separate comparison pass.
- Raw rows are in `bench/results.jsonl`; `node bench/comparison.cjs` prints this table and `bench/README.md` has the commands to repeat it.
