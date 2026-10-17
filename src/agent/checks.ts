// Checks run on every agent run and sent to PRISM with the trace, so repeated runs
// show whether the agent covers every step, gets the math right, settles every flow,
// and makes no carbon claim it cannot back up.
import { formatUsd } from "@/core/money";
import type { AgentRun } from "./run";
import { TOOLS } from "./tools";

export type CheckArea = "coverage" | "calculation" | "settlement" | "carbon claims" | "house rules";

export interface Check {
  area: CheckArea;
  name: string;
  passed: boolean;
  detail: string;
}

export function runChecks(run: AgentRun): Check[] {
  const tools = run.trace.filter((e) => e.kind === "tool");
  const done = new Set(tools.filter((e) => e.ok).map((e) => e.name));
  const missing = Object.keys(TOOLS).filter((t) => !done.has(t));
  const refusals = tools.filter((e) => !e.ok);
  const report = run.report;
  const r = report?.reconciliation;
  const checks: Check[] = [];

  checks.push({
    area: "coverage",
    name: "Every step completed",
    passed: missing.length === 0 && !run.stoppedEarly,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : `All ${done.size} steps completed`,
  });
  checks.push({
    area: "coverage",
    name: "No step was refused",
    passed: refusals.length === 0,
    detail: refusals.length
      ? refusals.map((e) => `${e.name}: ${(e.output as { refused?: string }).refused}`).join("; ")
      : "The agent called every step in a valid order",
  });

  checks.push({
    area: "calculation",
    name: "Matched receipts equal expected receipts",
    passed: !!r && r.matchedTotal === r.expectedTotal,
    detail: r ? `${formatUsd(r.matchedTotal)} matched of ${formatUsd(r.expectedTotal)} expected` : "Not reconciled",
  });
  checks.push({
    area: "calculation",
    name: "Warranty credit not counted again as revenue",
    passed: !!r && r.salesValue.total === r.salesValue.replacement + r.salesValue.resale && r.salesValue.total <= r.expectedTotal,
    detail: r ? `Value sold ${formatUsd(r.salesValue.total)}, receipts ${formatUsd(r.matchedTotal)}` : "Not reconciled",
  });

  checks.push({
    area: "settlement",
    name: "Every money flow settled",
    passed: !!r && r.allSettled && r.unmatchedReceipts.length === 0,
    detail: r
      ? r.settlements.map((x) => `${x.expected.id} ${x.status}`).join(", ") +
        (r.unmatchedReceipts.length ? `; unmatched receipts: ${r.unmatchedReceipts.map((x) => x.id).join(", ")}` : "")
      : "Not reconciled",
  });

  checks.push({
    area: "carbon claims",
    name: "Every figure in the summary comes from a tool result",
    passed: run.unsupportedFigures.length === 0,
    detail: run.unsupportedFigures.length ? `Unsupported: ${run.unsupportedFigures.join(", ")}` : "All figures backed",
  });
  const claimsVerified = /\bverified\b[^.]*\b(carbon|co2e?)\b|\b(carbon|co2e?)\b[^.]*(?<!not |never )\bverified\b/i;
  checks.push({
    area: "carbon claims",
    name: "Carbon is never called verified",
    passed: !claimsVerified.test(run.summary.replace(/\bnot (been )?verified\b/gi, "")),
    detail: "Carbon must be described as a sourced estimate",
  });
  const pending = report?.carbon.status !== "estimated";
  checks.push({
    area: "carbon claims",
    name: "Pending carbon stays pending",
    passed: !pending || !/\d\s?kg/i.test(run.summary),
    detail: pending ? "Carbon is pending, so the summary must not give a kg figure" : "Carbon is a sourced estimate",
  });

  checks.push({
    area: "house rules",
    name: "Simulated steps are disclosed",
    passed: /simulated/i.test(run.summary),
    detail: "The summary must say which steps were simulated",
  });

  return checks;
}
