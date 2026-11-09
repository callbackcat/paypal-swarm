// Cost of a recorded run. Rows recorded before the per-step cost fix (9 Nov 2026) carry only the last step's cost per
// turn, so the list-price cost of the recorded tokens is the better number for them; rows after the fix carry
// OpenRouter's summed cost, which runs about 10 % above list. Taking the larger of the two is right for both.
// USD per million tokens: input, output, cache read (packages/agents/src/llm.ts).
const PRICE = {
  "anthropic/claude-haiku-5.5": [0.1, 0.5, 0.01], "anthropic/claude-sonnet-5.5": [2, 10, 0.1], "anthropic/claude-opus-5.5": [4, 20, 0.2], "openai/gpt-5.5": [5, 30, 0.5],
  "google/gemini-2.5-flash-lite": [0.1, 0.4, 0.01], "openai/gpt-6-luna": [0.1, 0.5, 0.01], "openai/gpt-oss-120b": [0.019, 0.071, 0.017], "deepseek/deepseek-v4.1-flash": [0.051, 0.567, 0.018],
};
const modelOf = (r) => (r.models && r.models.shopper) || "anthropic/claude-haiku-5.5";
const listCost = (r) => {
  const p = PRICE[modelOf(r)];
  if (!p) return 0;
  const cached = r.tokensCached || 0;
  return (((r.tokensIn || 0) - cached) * p[0] + cached * p[2] + (r.tokensOut || 0) * p[1]) / 1e6;
};
const cost = (r) => Math.max(Number(r.costUsd || 0), listCost(r));
module.exports = { PRICE, modelOf, listCost, cost };
