# Bench harness and results

Local benchmark runs against the api on port 8787 (PayPal sandbox, live OpenRouter). Nothing here is secret: `results.jsonl` holds one row per finished run (scores, findings, tokens, cost, wall time, PayPal errors).

```bash
node bench.mjs "$(node compare-configs.mjs cheap)" compare-cheap   # cheap set, quiet-tuesday + lost-parcels, both profiles
node bench.mjs "$(node compare-configs.mjs top)" compare-top       # claude-sonnet-5.5, gpt-5.5, claude-opus-5.5
node summarise.cjs compare-cheap md                                 # markdown table for a label
```

Labels so far: `haiku`, `haiku-v2`, `haiku-v3` (all agents on claude-haiku-5.5; v3 is after the merchant history repair), `compare-cheap` (12 of 16 cells; see below).

## Status, 8 Nov 2026 evening

- `compare-cheap.md` has the 12 finished cells: gemini-2.5-flash-lite and deepseek-v4.1-flash on both scenarios, gpt-oss-120b and gpt-6-luna on quiet-tuesday only.
- The last four cells (gpt-oss-120b and gpt-6-luna on lost-parcels) were refused with HTTP 429: the api's own demo-key fence (`DEMO_DAILY_TOKEN_CAP`, 1.5M estimated tokens per IP per day, in memory) was exhausted after 12 live runs because it charges the conservative pre-run estimate, not the measured spend.
- To continue: either raise `DEMO_DAILY_TOKEN_CAP` in `.env` and restart the api, or let `bench.mjs` send `openrouterApiKey` read from `.env` so the runs count as bring-your-own and are not fenced. Then re-run the four missing cells with
  `node bench.mjs "$(node compare-configs.mjs cheap lost-parcels)" compare-cheap` (this re-runs gemini and deepseek too; trim the JSON if that matters), then the `top` set.
- Every cheap model reproduced the Haiku pattern: hardened removes all tracking and waiting findings (98–100), baselines sit at 82–91. The scorer is measuring the merchant, not the model; cost per run is $0.0006–0.011.
