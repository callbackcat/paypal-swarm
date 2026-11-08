// Prints the bench config JSON for the model comparison: every model drives shoppers, merchant and analyst.
// Usage: node compare-configs.mjs cheap|top|all [scenario,...]
const sets = {
  cheap: ["google/gemini-2.5-flash-lite", "deepseek/deepseek-v4.1-flash", "openai/gpt-oss-120b", "openai/gpt-6-luna"],
  top: ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5", "anthropic/claude-opus-5.5"],
};
sets.all = [...sets.cheap, ...sets.top];
const models = sets[process.argv[2] ?? "cheap"];
const scenarios = (process.argv[3] ?? "quiet-tuesday,lost-parcels").split(",");
const out = [];
for (const m of models)
  for (const scenario of scenarios)
    for (const merchantProfile of ["baseline", "hardened"])
      out.push({ scenario, merchantProfile, name: `bench ${m.split("/")[1]} ${scenario} ${merchantProfile}`, models: { shopper: m, merchant: m, analyst: m } });
process.stdout.write(JSON.stringify(out));
