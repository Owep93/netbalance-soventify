"use client";

import { useState } from "react";
import type { Check } from "@/agent/checks";
import type { TraceEvent } from "@/agent/run";
import type { IntakeReport } from "@/core/intake";
import type { PrismResult } from "@/lib/prism";
import { VoiceIntake } from "./voice-intake";

const LABELS: Record<string, string> = {
  record_failure_report: "Took the failure report",
  run_diagnostics: "Ran diagnostics",
  verify_protection_plan: "Checked the protection plan",
  issue_warranty_credit: "Issued the warranty credit",
  quote_replacement: "Quoted the replacement",
  sell_replacement: "Sold the replacement",
  refurbish_failed_unit: "Refurbished the failed unit",
  list_on_agora: "Listed it on Agora",
  check_agora_bids: "Checked Agora bids",
  accept_agora_bid: "Accepted the best Agora bid",
  collect_payments: "Collected payments",
  reconcile_and_record_carbon: "Reconciled money and recorded carbon",
};

interface Done {
  summary: string;
  unsupportedFigures: string[];
  stoppedEarly: boolean;
  checks: Check[];
  prism: PrismResult;
}

interface RunRecord {
  n: number;
  passed: number;
  total: number;
  prismTraceId: string | null;
}

export function AgentRunner() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>([]);

  async function run(intake?: IntakeReport) {
    setEvents([]);
    setDone(null);
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake }),
      });
      if (!res.body) throw new Error(`Agent request failed (HTTP ${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line);
          if (msg.type === "event") setEvents((prev) => [...prev, msg.event]);
          else if (msg.type === "done") {
            setDone(msg);
            setHistory((h) => [
              ...h,
              {
                n: h.length + 1,
                passed: msg.checks.filter((c: Check) => c.passed).length,
                total: msg.checks.length,
                prismTraceId: msg.prism.sent.trace ? msg.prism.traceId : null,
              },
            ]);
          }
          else if (msg.type === "error") setError(msg.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const tools = events.filter((e) => e.kind === "tool");
  const modelCalls = events.filter((e) => e.kind === "model");

  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <VoiceIntake onCaseOpened={(report) => void run(report)} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent run</h2>
          <p className="text-sm opacity-70">
            The model chooses each step through Nicrron. Every figure comes from tested code.{" "}
            <a href="/agora" target="_blank" rel="noreferrer" className="underline">Watch the resale on Agora</a>
          </p>
        </div>
        <button
          onClick={() => run()}
          disabled={running}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {running ? "Running..." : events.length ? "Run again" : "Run the agent"}
        </button>
      </div>

      {tools.length > 0 && (
        <ol className="space-y-1 text-sm">
          {tools.map((e) => (
            <li key={e.seq} className="flex gap-2">
              <span className={e.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
                {e.ok ? "Done" : "Refused"}
              </span>
              <span>{LABELS[e.name] ?? e.name}</span>
              {!e.ok && (
                <span className="opacity-70">{(e.output as { refused?: string })?.refused}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {running && <p className="mt-2 text-sm opacity-70">Working...</p>}

      {done && (
        <div className="mt-4 rounded-lg bg-black/[0.03] p-4 text-sm dark:bg-white/[0.05]">
          <p className="mb-1 font-medium">Summary for the customer</p>
          <p className="whitespace-pre-wrap">{done.summary || "The agent stopped before finishing."}</p>
          <p className="mt-3 text-xs opacity-70">
            {modelCalls.length} model calls through Nicrron ({modelCalls[0]?.name}), {tools.length} tool calls.{" "}
            {done.unsupportedFigures.length === 0
              ? "Every figure in the summary matches a tool result."
              : `Figures not backed by a tool result: ${done.unsupportedFigures.join(", ")}`}
          </p>
        </div>
      )}
      {done && (
        <div className="mt-4 text-sm">
          <p className="mb-1 font-medium">
            Checks: {done.checks.filter((c) => c.passed).length} of {done.checks.length} passed
          </p>
          <ul className="space-y-0.5">
            {done.checks.map((c) => (
              <li key={c.name}>
                <span className={c.passed ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
                  {c.passed ? "Pass" : "Fail"}
                </span>{" "}
                <span className="opacity-60">{c.area}:</span> {c.name}.{" "}
                <span className="opacity-60">{c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs opacity-70">
            {done.prism.sent.trace
              ? `Sent to PRISM: trace ${done.prism.traceId}` +
                (done.prism.sent.spans ? ", spans" : "") +
                (done.prism.sent.trajectory ? ", trajectory" : "") + "."
              : "Not sent to PRISM."}
            {done.prism.errors.length > 0 && ` Problems: ${done.prism.errors.join("; ")}`}
          </p>
        </div>
      )}

      {history.length > 1 && (
        <div className="mt-4 text-sm">
          <p className="mb-1 font-medium">Repeated runs this session</p>
          <ul className="space-y-0.5 text-xs">
            {history.map((h) => (
              <li key={h.n}>
                Run {h.n}: {h.passed} of {h.total} checks passed
                {h.prismTraceId ? `, PRISM trace ${h.prismTraceId.slice(0, 8)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
