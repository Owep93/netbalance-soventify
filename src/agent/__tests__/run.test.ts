import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AgoraMarket } from "@/agora/market";
import { approveTransfer } from "@/core/credit";
import { dollars } from "@/core/money";
import { buildPrismPayloads } from "@/lib/prism";
import { newCase, stepsDone, type CaseState } from "../case";
import { runChecks } from "../checks";
import { plainLanguage, runAgent, unsupportedFigures, type Complete } from "../run";
import type { ToolContext } from "../tools";

const noEpa = async () => ({ factors: { manufacturing: null, refurbishing: null, grid: null }, subregion: null, errors: [] });

// A finance reviewer who approves as soon as asked, or never.
function ctx(approves = true): ToolContext {
  return {
    fetchEpa: noEpa,
    agora: new AgoraMarket(),
    waitForApproval: async (s: CaseState) => {
      if (!approves) return false;
      const t = s.scenario.creditTransfer;
      s.transfer.approval = approveTransfer(s.scenario, { amount: s.coverage!.containerRacks.credit, source: t.source, destination: t.destination }, "Test reviewer");
      return true;
    },
  };
}

const ARGS: Record<string, unknown> = {
  log_incident: { issue: "coolant leak", everyone_safe: true, rack_offline: true, rack: "Rack 12", gpu_model: "H100 80GB", gpu_count: 8 },
  accept_offer: { offer: "integrated" },
  accept_bid: { bid_id: "BID-2" },
};

/** A fake model that calls the given tools in order ("tool" or "tool:{json args}"), then writes the summary. */
function scripted(steps: string[], summary: string): Complete {
  let i = 0;
  return async () => {
    const step = steps[i++];
    const [name, raw] = step ? [step.split(":")[0], step.includes(":") ? step.slice(step.indexOf(":") + 1) : null] : [null, null];
    const message: OpenAI.Chat.Completions.ChatCompletionMessage = name
      ? { role: "assistant", content: null, refusal: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name, arguments: raw ?? JSON.stringify(ARGS[name] ?? {}) } }] }
      : { role: "assistant", content: summary, refusal: null };
    return { id: "x", object: "chat.completion", created: 0, model: "fake", choices: [{ index: 0, finish_reason: "stop", logprobs: null, message }] };
  };
}

const happy = [
  "log_incident", "attach_inspection_photo", "assess_coverage", "request_credit_transfer", "wait_for_credit_approval",
  "present_offers", "accept_offer", "list_gpu_lot_on_agora", "collect_bids", "accept_bid", "reconcile_transactions", "build_cfo_report",
];
const good = "Cash received is $712,000 with $0 outstanding. Contribution is $234,000, up 80%. Carbon is pending. Payments were simulated.";

async function run(steps: string[], summary = good, approves = true) {
  const state = newCase();
  const r = await runAgent({ state, complete: scripted(steps, summary), model: "fake", ctx: ctx(approves) });
  return { state, r };
}

describe("agent autopilot on the shared case", () => {
  it("completes all six steps and reconciles $712,000", async () => {
    const { state, r } = await run(happy);
    expect(state.trace.filter((e) => e.kind === "tool" && !e.ok)).toEqual([]);
    expect(stepsDone(state)).toEqual([true, true, true, true, true, true]);
    expect(state.reconciliation!.cashReceived).toBe(dollars(712_000));
    expect(state.report!.comparison.improvement).toBe(dollars(104_000));
    expect(r.unsupportedFigures).toEqual([]);
    expect(runChecks(state, { text: r.summary, unsupportedFigures: r.unsupportedFigures }).filter((x) => !x.passed)).toEqual([]);
  });

  it("holds the credit and blocks the offers when no one approves", async () => {
    const { state } = await run(happy.slice(0, 6), "stopped", false);
    expect(state.transfer.decision?.status).toBe("needs approval");
    expect(state.trace.find((e) => e.name === "wait_for_credit_approval")!.ok).toBe(false);
    expect(state.trace.find((e) => e.name === "present_offers")!.ok).toBe(false);
    expect(state.guardEvents.map((g) => g.kind)).toContain("credit transfer held");
  });

  it("refuses sending the credit to a new account", async () => {
    const steps = ["log_incident", "attach_inspection_photo", "assess_coverage", 'request_credit_transfer:{"destination":"ACCT-NEW-4471"}'];
    const { state } = await run(steps, "stopped");
    const ev = state.trace.find((e) => e.name === "request_credit_transfer")!;
    expect(ev.ok).toBe(false);
    expect(JSON.stringify(ev.output)).toMatch(/not the customer's replacement order/);
    expect(state.guardEvents.map((g) => g.kind)).toContain("credit transfer refused");
    expect(state.transfer.approval).toBeNull();
    const guardChecks = runChecks(state).filter((x) => x.area === "guardrail" || x.name === "No step ran out of order");
    expect(guardChecks.every((x) => x.passed)).toBe(true);
  });

  it("refuses the highest headline bid when another nets more", async () => {
    const steps = [...happy.slice(0, 9), 'accept_bid:{"bid_id":"BID-1"}'];
    const { state } = await run(steps, "stopped");
    const ev = state.trace.find((e) => e.name === "accept_bid")!;
    expect(ev.ok).toBe(false);
    expect(JSON.stringify(ev.output)).toMatch(/best net offer/);
  });

  it("refuses coverage before there is a photo", async () => {
    const { state } = await run(["log_incident", "assess_coverage"], "stopped");
    expect(state.trace.find((e) => e.name === "assess_coverage")!.ok).toBe(false);
  });

  it("flags figures in the summary that no tool returned", async () => {
    const { r } = await run(happy, good + " You saved $99,999 and 120 kg of CO2e.");
    expect(r.unsupportedFigures).toEqual(["$99,999", "120 kg"]);
  });

  it("continues from where the presenter left off", async () => {
    const state = newCase();
    await runAgent({ state, complete: scripted(happy.slice(0, 3), "paused"), model: "fake", ctx: ctx() });
    const r = await runAgent({ state, complete: scripted(happy.slice(3), good), model: "fake", ctx: ctx() });
    expect(r.prompt.user).toMatch(/already logged/);
    expect(stepsDone(state).every(Boolean)).toBe(true);
  });
});

describe("PRISM payloads", () => {
  it("builds a trace, a span per step under one root, and a trajectory", async () => {
    const { state, r } = await run(happy);
    const checks = runChecks(state, { text: r.summary, unsupportedFigures: r.unsupportedFigures });
    const p = buildPrismPayloads(state, checks, "proj", "trace-1", r);
    expect(p.trace.metadata.cash_received_cents).toBe(dollars(712_000));
    expect(p.trace.metadata.credit_approval?.id).toBe("APR-014");
    expect(p.spans.spans).toHaveLength(state.trace.length + 1);
    expect(p.trajectory.final_status).toBe("success");
  });

  it("describes a presenter-driven case without a model run", async () => {
    const { state } = await run(happy);
    const p = buildPrismPayloads(state, runChecks(state), "proj", "t");
    expect(p.trace.model).toMatch(/presenter/);
    expect(p.trace.output_message).toMatch(/\$712,000 cash received/);
  });
});

describe("output rules", () => {
  it("removes em-dashes", () => {
    expect(plainLanguage(`Paid ${String.fromCharCode(0x2014)} thanks`)).toBe("Paid, thanks");
  });

  it("does not treat trailing punctuation as part of a figure", () => {
    expect(unsupportedFigures("It was $22,000, plus 47.7%.", '"$22,000" "47.7%"')).toEqual([]);
  });
});
