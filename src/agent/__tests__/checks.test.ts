import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AgoraMarket } from "@/agora/market";
import { scenario } from "@/core/scenario";
import { buildPrismPayloads } from "@/lib/prism";
import { runChecks } from "../checks";
import { runAgent, type Complete } from "../run";

const steps = [
  "record_failure_report", "run_diagnostics", "verify_protection_plan", "issue_warranty_credit",
  "quote_replacement", "sell_replacement", "refurbish_failed_unit", "list_on_agora",
  "check_agora_bids", "accept_agora_bid", "collect_payments", "reconcile_and_record_carbon",
];
const ARGS: Record<string, string> = {
  record_failure_report: JSON.stringify({ serial: scenario.failedUnit.serial, symptoms: "memory errors" }),
  accept_agora_bid: JSON.stringify({ bidId: "BID-3" }),
};

function scripted(names: string[], summary: string): Complete {
  let i = 0;
  return async () => {
    const name = names[i++];
    const message: OpenAI.Chat.Completions.ChatCompletionMessage = name
      ? { role: "assistant", content: null, refusal: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name, arguments: ARGS[name] ?? "{}" } }] }
      : { role: "assistant", content: summary, refusal: null };
    return { id: "x", object: "chat.completion", created: 0, model: "fake", choices: [{ index: 0, finish_reason: "stop", logprobs: null, message }] };
  };
}

const run = (names: string[], summary: string) =>
  runAgent({
    scenario,
    model: "fake",
    complete: scripted(names, summary),
    ctx: {
      fetchEpa: async () => ({ factors: { manufacturing: null, refurbishing: null, grid: null }, subregion: null, errors: [] }),
      agora: new AgoraMarket(),
    },
  });

const good = "You paid $10,500. We received $27,000 in total. Carbon is pending. Payments were simulated.";

describe("run checks", () => {
  it("passes every check on a clean run", async () => {
    const checks = runChecks(await run(steps, good));
    expect(checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("fails coverage when a step is skipped", async () => {
    const checks = runChecks(await run(steps.filter((s) => s !== "quote_replacement"), good));
    expect(checks.find((c) => c.name === "Every step completed")!.passed).toBe(false);
  });

  it("fails carbon claims on an unsupported figure", async () => {
    const checks = runChecks(await run(steps, good + " You avoided 120 kg of CO2e."));
    const failed = checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).toContain("Every figure in the summary comes from a tool result");
    expect(failed).toContain("Pending carbon stays pending");
  });

  it("fails when carbon is called verified, but not when it says not verified", async () => {
    const bad = runChecks(await run(steps, good + " Your carbon savings are verified."));
    expect(bad.find((c) => c.name === "Carbon is never called verified")!.passed).toBe(false);
    const ok = runChecks(await run(steps, good + " Carbon figures are estimates, not verified."));
    expect(ok.find((c) => c.name === "Carbon is never called verified")!.passed).toBe(true);
  });

  it("fails when simulated steps are not disclosed", async () => {
    const checks = runChecks(await run(steps, "You paid $10,500. Carbon is pending."));
    expect(checks.find((c) => c.name === "Simulated steps are disclosed")!.passed).toBe(false);
  });
});

describe("PRISM payloads", () => {
  it("builds a trace, a span per step under one root, and a trajectory", async () => {
    const r = await run(steps, good);
    const checks = runChecks(r);
    const p = buildPrismPayloads(r, checks, "proj", "trace-1");
    expect(p.trace.project_id).toBe("proj");
    expect(p.trace.metadata.checks_passed).toBe(checks.length);
    expect(p.trace.metadata.matched_receipts_cents).toBe(2_700_000);
    expect(p.spans.spans).toHaveLength(r.trace.length + 1);
    expect(p.spans.spans.slice(1).every((s) => s.parent_span_id === "trace-1-root")).toBe(true);
    expect(p.trajectory.steps).toHaveLength(r.trace.length);
    expect(p.trajectory.final_status).toBe("success");
  });

  it("marks the run as a failure when a check fails", async () => {
    const r = await run(steps, "No disclosure here.");
    const p = buildPrismPayloads(r, runChecks(r), "proj", "t");
    expect(p.trajectory.final_status).toBe("failure");
    expect(p.spans.spans[0].status).toBe("error");
  });
});
