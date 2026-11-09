| Model | Scenario | Profile | Score | Captured / shipped | Billable tokens | Cost | Wall | PayPal errors | Findings |
|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5.5 | quiet-tuesday | baseline | 90 | 5 / 0 | 36k | $0.1339 | 68 s | none | CAPTURE_WITHOUT_TRACKING(high) x5, WEBHOOK_GAP(info) |
| claude-sonnet-5.5 | quiet-tuesday | hardened | 100 | 5 / 5 | 20k | $0.1068 | 68 s | none | WEBHOOK_GAP(info) |
| claude-sonnet-5.5 | lost-parcels | baseline | 90 | 8 / 0 | 100k | $0.3173 | 76 s | get_shipment_tracking:403 x1 | CAPTURE_WITHOUT_TRACKING(high) x8, WEBHOOK_GAP(info) |
| claude-sonnet-5.5 | lost-parcels | hardened | 100 | 8 / 8 | 41k | $0.2046 | 76 s | none | WEBHOOK_GAP(info) |
| gpt-5.5 | quiet-tuesday | baseline | 90 | 5 / 0 | 42k | $0.3234 | 72 s | none | CAPTURE_WITHOUT_TRACKING(high) x5, WEBHOOK_GAP(info) |
| gpt-5.5 | quiet-tuesday | hardened | 100 | 5 / 5 | 39k | $0.3177 | 84 s | none | WEBHOOK_GAP(info) |
| gpt-5.5 | lost-parcels | baseline | 90 | 7 / 0 | 81k | $0.6299 | 88 s | get_shipment_tracking:403 x7 | CAPTURE_WITHOUT_TRACKING(high) x7, WEBHOOK_GAP(info) |
| gpt-5.5 | lost-parcels | hardened | 100 | 7 / 7 | 61k | $0.5446 | 116 s | show_product_details:404 x1 | WEBHOOK_GAP(info) |
| claude-opus-5.5 | quiet-tuesday | baseline | 90 | 5 / 0 | 38k | $0.2955 | 72 s | none | CAPTURE_WITHOUT_TRACKING(high) x5, WEBHOOK_GAP(info) |
| claude-opus-5.5 | quiet-tuesday | hardened | 100 | 5 / 5 | 33k | $0.3059 | 80 s | none | WEBHOOK_GAP(info) |
| claude-opus-5.5 | lost-parcels | baseline | 90 | 8 / 0 | 107k | $0.7385 | 108 s | show_product_details:404 x6, get_shipment_tracking:403 x3 | CAPTURE_WITHOUT_TRACKING(high) x8, WEBHOOK_GAP(info) |
| claude-opus-5.5 | lost-parcels | hardened | 100 | 8 / 8 | 45k | $0.4778 | 96 s | show_product_details:404 x8, update_shipment_tracking:403 x1 | WEBHOOK_GAP(info) |

12 rows for compare-top
