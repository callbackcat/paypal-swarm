| Model | Scenario | Profile | Score | Captured / shipped | Billable tokens | Cost | Wall | PayPal errors | Findings |
|---|---|---|---|---|---|---|---|---|---|
| gemini-2.5-flash-lite | quiet-tuesday | baseline | 91 | 2 / 0 | 30k | $0.0020 | 64 s | get_order:404 x1 | CAPTURE_WITHOUT_TRACKING(high) x2, BUYER_LEFT_WAITING(medium), WEBHOOK_GAP(info) |
| gemini-2.5-flash-lite | quiet-tuesday | hardened | 100 | 3 / 3 | 29k | $0.0011 | 64 s | none | WEBHOOK_GAP(info) |
| gemini-2.5-flash-lite | lost-parcels | baseline | 82 | 3 / 0 | 59k | $0.0039 | 100 s | get_shipment_tracking:403 x3 | CAPTURE_WITHOUT_TRACKING(high) x3, BUYER_LEFT_WAITING(medium) x4, WEBHOOK_GAP(info) |
| gemini-2.5-flash-lite | lost-parcels | hardened | 98 | 2 / 2 | 53k | $0.0029 | 88 s | get_order:404 x2, get_shipment_tracking:403 x1 | BUYER_LEFT_WAITING(medium), WEBHOOK_GAP(info) |
| deepseek-v4.1-flash | quiet-tuesday | baseline | 90 | 4 / 0 | 74k | $0.0052 | 152 s | none | CAPTURE_WITHOUT_TRACKING(high) x4, WEBHOOK_GAP(info) |
| deepseek-v4.1-flash | quiet-tuesday | hardened | 100 | 4 / 4 | 55k | $0.0046 | 153 s | none | WEBHOOK_GAP(info) |
| deepseek-v4.1-flash | lost-parcels | baseline | 84 | 8 / 0 | 119k | $0.0111 | 197 s | none | CAPTURE_WITHOUT_TRACKING(high) x8, BUYER_LEFT_WAITING(medium) x3, WEBHOOK_GAP(info) |
| deepseek-v4.1-flash | lost-parcels | hardened | 100 | 8 / 8 | 105k | $0.0079 | 173 s | show_product_details:404 x1 | WEBHOOK_GAP(info) |
| gpt-oss-120b | quiet-tuesday | baseline | 90 | 5 / 1 | 34k | $0.0009 | 88 s | none | CAPTURE_WITHOUT_TRACKING(high) x4, WEBHOOK_GAP(info) |
| gpt-oss-120b | quiet-tuesday | hardened | 100 | 4 / 4 | 28k | $0.0008 | 80 s | none | WEBHOOK_GAP(info) |
| gpt-6-luna | quiet-tuesday | baseline | 90 | 5 / 0 | 24k | $0.0008 | 76 s | none | CAPTURE_WITHOUT_TRACKING(high) x5, WEBHOOK_GAP(info) |
| gpt-6-luna | quiet-tuesday | hardened | 100 | 5 / 5 | 14k | $0.0006 | 72 s | none | WEBHOOK_GAP(info) |

12 rows for compare-cheap
