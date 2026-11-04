/**
 * Seeds the demo store catalog through the PayPal Agent Toolkit (create_product / list_products).
 *
 *   pnpm seed                 # 12 cycling & outdoor gifts (idempotent by name)
 *   pnpm seed -- --overload   # also adds 18 filler items so the catalog has 30 (choice-overload scenario)
 *   pnpm seed -- --injection  # also adds the prompt-injection product (INJECTION_SUSCEPTIBLE scenario)
 *
 * PayPal catalog products have no price field, so the price is written into the description and
 * saved to fixtures/demo-catalog.json (product id -> price) for the shopper agents and the rules.
 */
import { writeFileSync } from "node:fs";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { creds, find, loadEnv, parseToolResult, section, show } from "./_spike-shared";

loadEnv();
const { clientId, clientSecret } = creds();
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

import { CORE_CATALOG, FILLER, INJECTION_PRODUCT, describeWithPrice } from "@swarm/paypal";

const toolkit = new PayPalAgentToolkit({
  clientId,
  clientSecret,
  configuration: { actions: { products: { create: true, list: true, show: true } }, context: { sandbox: true } },
});
const tools = toolkit.getTools() as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<unknown> }>;
const runTool = async (name: string, a: unknown) => parseToolResult(await tools[name]!.execute(a, { toolCallId: "seed", messages: [] }));

async function existingByName(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 5; page++) {
    const res = await runTool("list_products", { page, page_size: 20, total_required: true });
    const items = (find(res, "products") as Array<{ id: string; name: string }> | undefined) ?? [];
    for (const p of items) map.set(p.name, p.id);
    if (items.length < 20) break;
  }
  return map;
}

(async () => {
  const wanted = [...CORE_CATALOG, ...(flags.has("--overload") ? FILLER : []), ...(flags.has("--injection") ? [INJECTION_PRODUCT] : [])];
  section(`seeding ${wanted.length} products`);
  const existing = await existingByName();
  console.log(`catalog already has ${existing.size} product(s)`);
  const catalog: Array<{ id: string; name: string; price: number; tags: string[] }> = [];
  for (const p of wanted) {
    let id = existing.get(p.name);
    if (!id) {
      const res = await runTool("create_product", {
        name: p.name,
        type: "PHYSICAL",
        description: describeWithPrice(p),
      });
      id = find(res, "id", (v) => typeof v === "string" && /^PROD-/.test(v)) as string | undefined;
      if (!id) {
        show("create_product failed", res);
        continue;
      }
      console.log(`  created ${id}  ${p.name}`);
    } else {
      console.log(`  exists  ${id}  ${p.name}`);
    }
    catalog.push({ id, name: p.name, price: p.price, tags: p.tags });
  }
  writeFileSync("fixtures/demo-catalog.json", JSON.stringify({ seededAt: new Date().toISOString(), products: catalog }, null, 2));
  section("done");
  console.log(`${catalog.length} products recorded in fixtures/demo-catalog.json`);
})().catch((e: unknown) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
