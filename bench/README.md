# Bench harness and results

Local benchmark runs against the api on port 8787 (PayPal sandbox, live OpenRouter). Nothing here is secret: `results.jsonl` holds one row per finished run (scores, findings, tokens, cost, wall time, PayPal errors).

```bash
node bench.mjs "$(node compare-configs.mjs cheap)" compare-cheap   # cheap set, quiet-tuesday + lost-parcels, both profiles
node bench.mjs "$(node compare-configs.mjs top)" compare-top       # claude-sonnet-5.5, gpt-5.5, claude-opus-5.5
node summarise.cjs compare-cheap md                                 # markdown table for a label
```

Labels: `haiku-sandbox`, `haiku-v2`, `haiku-v3` (all agents on claude-haiku-5.5; v3 is after the merchant history repair), `compare-cheap`, `compare-top`.

## Status, 9 Nov 2026

- All 28 comparison cells are in `results.jsonl`: labels `compare-cheap` (16 cells) and `compare-top` (12 cells). `node comparison.cjs` prints the README table; `model-comparison.md` is the README section as written.
- The 28 runs cost $0.95 in total. Scores: baselines 82–91, hardened 93–100 on every model.
- On 8 Nov the last four cheap cells were refused with HTTP 429 by the api's own demo-key fence (`DEMO_DAILY_TOKEN_CAP`, 1.5M tokens per IP per day, in memory): it compares the conservative pre-run estimate against the allowance. The 9 Nov runs started the api with `DEMO_DAILY_TOKEN_CAP=50000000` in the process environment; `.env` was not changed.
- `missing-cheap.json` is the config used for those four cells.
