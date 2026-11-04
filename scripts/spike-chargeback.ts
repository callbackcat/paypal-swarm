/**
 * Day-1 spike 2 (throwaway): can Swarm open a dispute programmatically against a card-funded capture
 * using the sandbox-only process-chargeback endpoint, see it through the toolkit, and settle it?
 *
 *   pnpm spike:chargeback                       # uses capture id + merchant id saved by spike-approval
 *   pnpm spike:chargeback <captureId> <merchantId> [amount]
 *   pnpm spike:chargeback -- --adjudicate       # also settle BUYER_FAVOR (needs UNDER_REVIEW + adjudicate link)
 *   pnpm spike:chargeback -- --accept           # also test accept-claim with a plain-sentence note (toolkit regex quirk)
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { creds, find, loadEnv, loadLast, parseToolResult, pp, saveLast, section, show } from "./_spike-shared";

loadEnv();
const { clientId, clientSecret } = creds();
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const last = loadLast();
const captureId = args[0] ?? (last.captureId as string | undefined);
const merchantId = args[1] ?? process.env.PAYPAL_MERCHANT_ID ?? (last.merchantId as string | undefined);
const amount = args[2] ?? (last.amount as string | undefined) ?? "12.50";
if (!captureId || !merchantId) {
  console.error("Need a capture id and merchant id. Run `pnpm spike:approval` first or pass them as arguments.");
  process.exit(1);
}

const toolkit = new PayPalAgentToolkit({
  clientId,
  clientSecret,
  configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } },
});
const tools = toolkit.getTools() as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<unknown> }>;
const runTool = async (name: string, a: unknown) =>
  parseToolResult(await tools[name]!.execute(a, { toolCallId: "spike", messages: [] }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

(async () => {
  section(`1. process-chargeback on capture ${captureId} (merchant ${merchantId}, ${amount} USD)`);
  const now = new Date();
  const due = new Date(now.getTime() + 10 * 86400_000);
  const { status, headers, body } = await pp(`/v2/customer-support/process-chargeback`, {
    method: "POST",
    body: {
      adjacency: "PAYPAL",
      file_layout: "ATCK_CB",
      merchant_id: merchantId,
      financial_institution: { processor: "FDMS" },
      transaction: { id_enc: captureId, amount: { currency_code: "USD", value: amount } },
      instrument: { instrument_type: "CARD", card_brand: "VISA", credit_card_transaction_id: digits(16), external: false },
      dispute: {
        id: null,
        stage: "CHARGEBACK",
        response_date: due.toISOString(),
        status: "2",
        amount: { currency_code: "USD", value: amount },
        receive_date: now.toISOString(),
        event_code: "CHARGEBACK_INITIATED",
        money_movement_date: now.toISOString(),
        event_type: "DEBIT",
        chargeback_type: "REPORTED_TO_PROCESSOR",
        processor_info: { reference_number: digits(23), reason_code: "1330", notes: "SWARM_SPIKE" },
      },
    },
  });
  show(`HTTP ${status}`, body);
  const href = (find(body, "href") as string | undefined) ?? headers.get("location") ?? "";
  const disputeId = (find(body, "dispute_id") as string | undefined) ?? href.match(/PP-[A-Z]-\d+/)?.[0];
  if (status !== 201 || !disputeId) {
    console.log("\nVERDICT: process-chargeback did not return 201 + dispute id. Fallback = pre-seed disputes from the sandbox buyer UI.");
    process.exit(2);
  }
  console.log(`\nOK: dispute ${disputeId} created`);
  saveLast({ disputeId });

  section("2. toolkit sees it? (list_disputes by transaction, then get_dispute; sandbox may lag)");
  let seen: unknown = null;
  for (let i = 0; i < 6 && !seen; i++) {
    const list = await runTool("list_disputes", { disputed_transaction_id: captureId, page_size: 10 });
    const items = find(list, "items") as unknown[] | undefined;
    if (items?.length) seen = items;
    else {
      console.log(`  attempt ${i + 1}: not visible yet`);
      await sleep(5000);
    }
  }
  show("list_disputes", seen ?? "(not visible after 30 s)");
  const detail = await runTool("get_dispute", { dispute_id: disputeId });
  show("get_dispute", {
    status: find(detail, "status"),
    reason: find(detail, "reason"),
    links: (find(detail, "links") as unknown[] | undefined)?.map((l) => (l as { rel: string }).rel),
  });

  if (flags.has("--accept")) {
    section("3a. accept-claim directly with a plain-sentence note (the toolkit tool rejects sentences by regex)");
    const r = await pp(`/v1/customer/disputes/${disputeId}/accept-claim`, {
      method: "POST",
      body: { note: "Refunding the customer in full.", accept_claim_type: "REFUND" },
    });
    show(`HTTP ${r.status}`, r.body);
  }
  if (flags.has("--adjudicate")) {
    section("3b. adjudicate BUYER_FAVOR (sandbox-only; needs UNDER_REVIEW + adjudicate link)");
    const r = await pp(`/v1/customer/disputes/${disputeId}/adjudicate`, {
      method: "POST",
      body: { adjudication_outcome: "BUYER_FAVOR" },
    });
    show(`HTTP ${r.status}`, r.body);
    const after = await runTool("get_dispute", { dispute_id: disputeId });
    show("get_dispute after adjudicate", { status: find(after, "status"), outcome: find(after, "dispute_outcome") });
  }
  section("SUMMARY");
  console.log(JSON.stringify({ captureId, merchantId, disputeId, visibleViaToolkit: !!seen }, null, 2));
})().catch((e: unknown) => {
  const err = e as { result?: unknown; body?: unknown };
  console.error("SPIKE FAILED:", err?.result ?? err?.body ?? e);
  process.exit(1);
});
