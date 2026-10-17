"use client";

import { useEffect, useState } from "react";
import type { TraceEvent } from "@/agent/trace";
import { CallStep } from "./call-step";
import { Intro } from "./intro";
import { InspectStep, OutcomeStep, ReconcileStep, RecoverStep, ReplaceStep } from "./steps";
import { STEP_NAMES, Spinner } from "./ui";
import { useCase } from "./use-case";

const CAPTIONS = ["Dispatch confirmed", "Partial coverage checked", "Replacement accepted", "GPU pickup booked", "Reconciliation complete"];

export function Demo() {
  const { data, error, act, approve, reset, refresh } = useCase();
  // -1 is the CFO workspace opening page; 0 to 5 are the six steps.
  const [step, setStep] = useState(-1);
  const [autoLog, setAutoLog] = useState<TraceEvent[]>([]);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const steps = data?.steps ?? [false, false, false, false, false, false];
  const firstOpen = Math.min(steps.findIndex((d) => !d) === -1 ? 5 : steps.findIndex((d) => !d), 5);

  // While the autopilot runs, follow it to the step it is working on.
  useEffect(() => {
    if (autoRunning) setTimeout(() => setStep(firstOpen), 0);
  }, [autoRunning, firstOpen]);

  async function autopilot() {
    setAutoLog([]);
    setAutoNote(null);
    setAutoRunning(true);
    try {
      const res = await fetch("/api/agent", { method: "POST" });
      if (!res.body || !res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line);
          if (msg.type === "event") {
            setAutoLog((l) => [...l, msg.event]);
            void refresh();
          } else if (msg.type === "guardrail") setAutoNote(msg.text);
          else if (msg.type === "error") setAutoNote(`Autopilot stopped: ${msg.message}`);
          else if (msg.type === "done") setAutoNote(`Autopilot finished. ${msg.checks.filter((x: { passed: boolean }) => x.passed).length} of ${msg.checks.length} checks passed. ${msg.prism.sent.trace ? "Sent to PRISM." : ""}`);
        }
      }
    } catch (e) {
      setAutoNote(`Autopilot stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAutoRunning(false);
      await refresh();
      setStep(5);
    }
  }

  async function onReset() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    await reset();
    setAutoLog([]);
    setAutoNote(null);
    setStep(-1);
  }

  const c = data?.case;
  const tools = autoLog.filter((e) => e.kind === "tool");

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;600;650;700&family=Manrope:wght@500;600;650;700;750;800&display=swap" precedence="default" />
      <header>
        <button type="button" className="brand" style={{ border: 0, background: "none", padding: 0, cursor: "pointer" }} onClick={() => setStep(-1)} aria-label="Back to the CFO workspace">
          netbalance<span>.</span>
        </button>
        <div className="header-right">
          <button className="btn primary" onClick={autopilot} disabled={autoRunning || !c}>
            {autoRunning ? <><Spinner light /> Agent working…</> : "▶ Agent autopilot"}
          </button>
          <button className="btn ghost" onClick={onReset} disabled={autoRunning}>Reset demo ↻</button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <h1>Revenue Growth Agent</h1>
            <p>Turns customer service events into new revenue and reconciled cash.</p>
          </div>
          {c && (
            <div className="case">
              <b>{c.scenario.caseId} · {c.scenario.customer.name} illustrative scenario</b>
              <br />
              {c.scenario.customer.site.city}, Virginia · {new Date(`${c.scenario.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          )}
        </section>
        <nav className="steps with-workspace" aria-label="Demo progress">
          <button type="button" onClick={() => setStep(-1)} className={`step ${step === -1 ? "active" : ""}`} aria-current={step === -1 ? "step" : undefined}>
            <span className="number">⌂</span>
            <strong>CFO workspace</strong>
          </button>
          {STEP_NAMES.map((n, i) => (
            <button key={n} type="button" onClick={() => setStep(i)} className={`step ${step === i ? "active" : ""} ${steps[i] ? "done" : ""}`} aria-current={step === i ? "step" : undefined}>
              <span className="number">{steps[i] ? "✓" : i + 1}</span>
              <strong>{n}</strong>
            </button>
          ))}
        </nav>

        {(autoRunning || autoNote) && (
          <div className="alert" style={{ marginBottom: 16 }}>
            <b>Nicrron agent autopilot.</b>{" "}
            {tools.length ? `Last step: ${tools.at(-1)!.name}${tools.at(-1)!.ok ? "" : " (refused)"} · ${tools.length} tool calls so far. ` : "Starting… "}
            {c?.transfer.decision?.status === "needs approval" && autoRunning && "Waiting for your approval of the credit transfer. "}
            {autoNote}
          </div>
        )}
        {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="workspace">
          <section className="panel">
            <div id="screen">
              {!c ? (
                <div className="body"><div className="empty-record"><Spinner /><b>Loading case</b></div></div>
              ) : step === -1 ? (
                <Intro c={c} onStart={() => setStep(0)} />
              ) : step === 0 ? (
                <CallStep c={c} act={act} />
              ) : step === 1 ? (
                <InspectStep c={c} act={act} />
              ) : step === 2 ? (
                <ReplaceStep c={c} act={act} approve={approve} />
              ) : step === 3 ? (
                <RecoverStep c={c} act={act} />
              ) : step === 4 ? (
                <ReconcileStep c={c} act={act} />
              ) : (
                <OutcomeStep c={c} act={act} checks={data!.checks} />
              )}
            </div>
            {step >= 0 && <div className="panel-foot">
              <span id="stepcaption" aria-live="polite">
                {step === 5 ? "Demo complete" : steps[step] ? `✓ ${CAPTIONS[step]}` : `Step ${step + 1} of 6`}
              </span>
              <span className="actions">
                <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={autoRunning}>
                  ← Back
                </button>
                {step < 5 && (
                <button className="btn primary" id="next" onClick={() => setStep(step + 1)} disabled={!steps[step] || autoRunning}>
                  Next step →
                </button>
                )}
              </span>
            </div>}
          </section>
        </div>
        <footer>
          Hackathon simulation · fictional warranty, prices, bids and transactions · live: ElevenLabs voice, Nicrron agent, PRISM traces and checks, US EPA factors · Agora market simulated
        </footer>
      </main>
    </>
  );
}
