import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AgoraMarket } from "@/agora/market";
import { dollars } from "@/core/money";
import { scenario } from "@/core/scenario";
import { plainLanguage, runAgent, unsupportedFigures, type Complete } from "../run";

const noEpa = async () => ({
  factors: { manufacturing: null, refurbishing: null, grid: null },
  subregion: null,
  errors: ["EPA not fetched in tests"],
});
const ctx = () => ({ fetchEpa: noEpa, agora: new AgoraMarket() });

const ARGS: Record<string, string> = {
  record_failure_report: JSON.stringify({ serial: scenario.failedUnit.serial, symptoms: "memory errors" }),
  accept_agora_bid: JSON.stringify({ bidId: "BID-3" }),
};

/** A fake model that calls the given tools in order, then writes the summary. */
function scripted(steps: string[], summary: string): Complete {
  let i = 0;
  return async () => {
    const name = steps[i++];
    const message: OpenAI.Chat.Completions.ChatCompletionMessage = name
      ? {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [{
            id: `call_${i}`,
            type: "function",
            function: {
              name: name.split(":")[0],
              arguments: name.includes(":") ? JSON.stringify({ bidId: name.split(":")[1] }) : ARGS[name] ?? "{}",
            },
          }],
        }
      : { role: "assistant", content: summary, refusal: null };
    return {
      id: "x", object: "chat.completion", created: 0, model: "fake",
      choices: [{ index: 0, finish_reason: name ? "tool_calls" : "stop", logprobs: null, message }],
    };
  };
}

const happyPath = [
  "record_failure_report",
  "run_diagnostics",
  "verify_protection_plan",
  "issue_warranty_credit",
  "quote_replacement",
  "sell_replacement",
  "refurbish_failed_unit",
  "list_on_agora",
  "check_agora_bids",
  "accept_agora_bid",
  "collect_payments",
  "reconcile_and_record_carbon",
];

describe("agent loop", () => {
  it("reaches $27,000 matched receipts on the happy path", async () => {
    const run = await runAgent({
      scenario, model: "fake", ctx: ctx(),
      complete: scripted(happyPath, "Collected $10,500 from you. Carbon is pending."),
    });
    expect(run.trace.filter((e) => e.kind === "tool" && !e.ok)).toHaveLength(0);
    expect(run.report?.reconciliation.matchedTotal).toBe(dollars(27_000));
    expect(run.report?.carbon.status).toBe("pending");
    expect(run.unsupportedFigures).toEqual([]);
  });

  it("refuses a warranty credit before the plan is verified", async () => {
    const run = await runAgent({
      scenario, model: "fake", ctx: ctx(),
      complete: scripted(["record_failure_report", "issue_warranty_credit"], "done"),
    });
    const credit = run.trace.find((e) => e.name === "issue_warranty_credit")!;
    expect(credit.ok).toBe(false);
    expect(JSON.stringify(credit.output)).toMatch(/Verify the protection plan first/);
  });

  it("refuses invoicing without the credit when the plan verified", async () => {
    const run = await runAgent({
      scenario, model: "fake", ctx: ctx(),
      complete: scripted(["record_failure_report", "run_diagnostics", "verify_protection_plan", "sell_replacement"], "done"),
    });
    expect(run.trace.find((e) => e.name === "sell_replacement")!.ok).toBe(false);
  });

  it("refuses an unknown serial", async () => {
    const complete: Complete = async () => ({
      id: "x", object: "chat.completion", created: 0, model: "fake",
      choices: [{ index: 0, finish_reason: "tool_calls", logprobs: null, message: {
        role: "assistant", content: null, refusal: null,
        tool_calls: [{ id: "c", type: "function", function: { name: "record_failure_report", arguments: '{"serial":"NOPE","symptoms":"x"}' } }],
      } }],
    });
    let calls = 0;
    const once: Complete = async (p) => (calls++ === 0 ? complete(p) : scripted([], "stopped")(p));
    const run = await runAgent({ scenario, model: "fake", ctx: ctx(), complete: once });
    expect(run.trace.find((e) => e.kind === "tool")!.ok).toBe(false);
  });

  it("flags figures in the summary that no tool returned", async () => {
    const run = await runAgent({
      scenario, model: "fake", ctx: ctx(),
      complete: scripted(happyPath, "You saved $9,999 and 120 kg of CO2e."),
    });
    expect(run.unsupportedFigures).toEqual(["$9,999", "120 kg"]);
  });
});

describe("Agora resale", () => {
  it("keeps the expected payout in step with the highest bid minus the fee", () => {
    const top = Math.max(...scenario.resale.simulatedBids.map((b) => b.amount));
    expect(top - Math.round(top * scenario.resale.feeRate)).toBe(scenario.resale.netPayout);
  });

  it("refuses a bid that is not the highest", async () => {
    const steps = happyPath.slice(0, happyPath.indexOf("accept_agora_bid")).concat("accept_agora_bid:BID-1");
    const run = await runAgent({ scenario, model: "fake", ctx: ctx(), complete: scripted(steps, "stopped") });
    const accept = run.trace.find((e) => e.name === "accept_agora_bid")!;
    expect(accept.ok).toBe(false);
    expect(JSON.stringify(accept.output)).toMatch(/not the highest bid/);
  });

  it("records the listing, bids, and sale on the market", async () => {
    const market = new AgoraMarket();
    await runAgent({ scenario, model: "fake", ctx: { fetchEpa: noEpa, agora: market }, complete: scripted(happyPath, "done") });
    const listing = market.get(scenario.resale.listingId);
    expect(listing.status).toBe("sold");
    expect(listing.bids).toHaveLength(3);
    expect(listing.sale).toMatchObject({ price: dollars(5_000), fee: dollars(500), netPayout: dollars(4_500) });
  });

  it("refuses selling on Agora before refurbishing", async () => {
    const run = await runAgent({
      scenario, model: "fake", ctx: ctx(),
      complete: scripted(["record_failure_report", "run_diagnostics", "list_on_agora"], "stopped"),
    });
    expect(run.trace.find((e) => e.name === "list_on_agora")!.ok).toBe(false);
  });
});

describe("output rules", () => {
  it("removes em-dashes", () => {
    expect(plainLanguage(`Paid ${String.fromCharCode(0x2014)} thanks`)).toBe("Paid, thanks");
    expect(plainLanguage("Invoice 2014 paid")).toBe("Invoice 2014 paid");
  });

  it("does not treat trailing punctuation as part of a figure", () => {
    expect(unsupportedFigures("It was $22,000, plus $500.", '"$22,000" "$500"')).toEqual([]);
  });

  it("matches figures regardless of spacing", () => {
    expect(unsupportedFigures("38.9 kg avoided", '"38.9 kg CO2e"')).toEqual([]);
  });
});
