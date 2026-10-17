"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseState } from "@/agent/case";
import type { Check } from "@/agent/checks";
import { buildInvoice, reconcile, type CaseMoney } from "@/core/ledger";
import { formatUsd } from "@/core/money";
import type { OfferId } from "@/core/scenario";
import type { Act } from "./use-case";
import { Calendar, Head, Spinner } from "./ui";

type StepProps = { c: CaseState; act: Act };

const later = (fn: () => void) => setTimeout(fn, 0);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function money(c: CaseState, offer: OfferId = c.offer ?? "integrated"): CaseMoney {
  return {
    offer: c.scenario.offers[offer],
    creditApplied: c.transfer.approval?.amount ?? c.coverage?.containerRacks.credit ?? 0,
    gpuSale: c.sale ? { buyer: c.sale.buyer, gross: c.sale.gross, fee: c.sale.fee, net: c.sale.net } : null,
  };
}

/* ---------- Step 2: inspect and cover ---------- */

export function InspectStep({ c, act }: StepProps) {
  const [checking, setChecking] = useState(false);
  const [photoURL, setPhotoURL] = useState("");
  const [explain, setExplain] = useState<{ text: string; model?: string; error?: string } | null>(null);
  const s = c.scenario;

  async function attach(url?: string) {
    if (url) setPhotoURL(url);
    setChecking(true);
    await act("attach_inspection_photo");
    await wait(1200);
    await act("assess_coverage");
    setChecking(false);
  }

  async function askNicrron() {
    setExplain({ text: "" });
    const res = await fetch("/api/explain", { method: "POST" });
    const body = await res.json();
    setExplain(res.ok ? { text: body.text, model: body.model } : { text: "", error: body.error });
  }

  const cov = c.coverage;
  return (
    <>
      <Head i={1} title="The photo starts the warranty check." desc={`${s.dispatch.technician} is at ${s.rack.id}. The ticket requests photos and serial numbers for eight ${s.rack.model} GPUs.`} />
      <div className="body grid2">
        <div>
          {c.photoAttached ? (
            <div className="photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoURL || s.inspection.photo} alt="Illustrative cooling connection leak above the affected GPU tray" />
              <span className="photo-tag">Inspection photo attached · {s.caseId}</span>
            </div>
          ) : (
            <div className="upload">
              <div className="icon">▣</div>
              <h3>&quot;Photograph the leak and GPU tray.&quot;</h3>
              <p className="small muted">Equipment isolated · technician on site</p>
              <button className="btn primary" onClick={() => attach()} disabled={!c.incident || checking}>
                Use example damage photo
              </button>
              <label className="btn">
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={!c.incident} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attach(URL.createObjectURL(f));
                }} />
                Upload field photo
              </label>
            </div>
          )}
        </div>
        <div className="inspection-focus" aria-live="polite">
          {!c.photoAttached ? (
            <div className="empty-record"><span>▤</span><b>Waiting for the inspection photo</b><p>The photo updates the record automatically.</p></div>
          ) : !cov || checking ? (
            <div className="empty-record"><Spinner /><b>Matching evidence to the policy…</b><p>Purchase · policy exclusions · covered assets</p></div>
          ) : (
            <div className="fade-in">
              <span className="badge amber">◐ Partial warranty coverage</span>
              <div className="credit-result">
                <span>Container & racks replacement credit</span>
                <strong>{formatUsd(cov.containerRacks.credit)}</strong>
                <p>{cov.claimId} · linked to the photo and policy {cov.policyId}</p>
              </div>
              <div className="coverage-yes"><b>✓ Container & racks covered</b><span>{formatUsd(cov.containerRacks.credit)} credit toward either replacement package.</span></div>
              <div className="coverage-no"><b>✕ GPUs not covered</b><span>{cov.gpus.reason}</span></div>
              <button className="btn link" onClick={askNicrron} disabled={explain !== null && !explain.text && !explain.error}>
                {explain && !explain.text && !explain.error ? "Asking Nicrron…" : "Explain in plain language (Nicrron) →"}
              </button>
              {explain?.text && <p className="note">{explain.text}<br /><span className="tiny">Written by {explain.model} through Nicrron. The decision itself comes from tested code.</span></p>}
              {explain?.error && <p className="note">Nicrron did not answer: {explain.error}</p>}
              <p className="note">Demo policy {cov.policyId} §4 covers the container and racks; §7 excludes GPUs damaged by external cooling. Seeded technician findings establish the leak source; a photo alone does not prove causation.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Step 3: credit guardrail, then the two offers ---------- */

export function ReplaceStep({ c, act, approve }: StepProps & { approve: () => Promise<boolean> }) {
  const [modal, setModal] = useState(false);
  const [redTeam, setRedTeam] = useState<string | null>(null);
  const requested = useRef(false);
  const shown = useRef(false);
  const s = c.scenario;
  const t = s.creditTransfer;
  const decision = c.transfer.decision;
  const applied = decision?.status === "applied";
  const held = decision?.status === "needs approval";

  useEffect(() => {
    if (c.coverage && !decision && !requested.current && !c.autopilot.running) {
      requested.current = true;
      later(() => void act("request_credit_transfer"));
    }
  }, [c.coverage, decision, c.autopilot.running, act]);

  useEffect(() => {
    if (applied && !c.offersShown && !shown.current && !c.autopilot.running) {
      shown.current = true;
      later(() => void act("present_offers"));
    }
  }, [applied, c.offersShown, c.autopilot.running, act]);

  useEffect(() => {
    if (held && c.autopilot.running) later(() => setModal(true));
  }, [held, c.autopilot.running]);

  async function onApprove() {
    setModal(false);
    await approve();
    if (!c.autopilot.running) await act("wait_for_credit_approval");
  }

  async function tryNewAccount() {
    const ev = await act("request_credit_transfer", { destination: "ACCT-NEW-4471" });
    setRedTeam((ev?.output as { refused?: string })?.refused ?? "Refused");
    await act("request_credit_transfer");
  }

  if (!applied) {
    const credit = c.coverage?.containerRacks.credit ?? 0;
    return (
      <>
        <Head i={2} title="Credit transfer paused for human approval." desc="The guardrail checks the destination account before the warranty credit can be applied." />
        <div className="body guard-body">
          <div className={`guard-status ${held ? "blocked" : "checking"}`}>
            <div className="guard-emblem">{held ? "⛨" : <Spinner />}</div>
            <span className={`badge ${held ? "amber" : "blue"}`}>{held ? "Guardrail · transfer held" : "Checking credit transfer…"}</span>
            <h3>{held ? "Credits cannot move between accounts automatically." : "The agent requests a credit transfer."}</h3>
            <p>{held ? "A human finance reviewer must authorize this specific allocation." : "Validating the source, destination and approval scope."}</p>
          </div>
          <div className="account-transfer">
            <div><span>Source account</span><b>{t.sourceLabel}</b><small>{t.source} · container & racks only</small></div>
            <div className="transfer-amount"><strong>{formatUsd(credit)}</strong><span>{held ? "⏸ Held" : "Checking →"}</span></div>
            <div><span>Destination account</span><b>{t.destinationLabel}</b><small>{t.destination} · new container & racks</small></div>
          </div>
          <div className="guard-timeline">
            <div className="complete">✓ Credit request detected</div>
            <div className={held ? "complete" : "pending"}>{held ? "✓" : "○"} Cross-account rule triggered</div>
            <div className={held ? "complete" : "pending"}>{held ? "✓" : "○"} Human reviewer requested</div>
          </div>
          <div className="guard-action">
            {held ? (
              <button className="btn primary" onClick={() => setModal(true)}>Review credit transfer</button>
            ) : (
              <span className="small muted"><Spinner /> Running approval checks…</span>
            )}
          </div>
          {held && (
            <p className="guard-footnote">
              <button className="btn link" style={{ display: "inline" }} onClick={tryNewAccount}>Test the guardrail: send the credit to a new account →</button>
              {redTeam && <><br />Refused: {redTeam}</>}
            </p>
          )}
          <p className="guard-footnote">No credit has moved. The hold is enforced in our code and each hold, refusal, and approval is recorded in PRISM. GPU damage remains excluded.</p>
        </div>
        {modal && (
          <div className="modal-overlay">
            <section className="modal credit-approval-modal simple-credit-popup" role="dialog" aria-modal="true" aria-labelledby="credit-approval-title">
              <div className="modal-head">
                <div><div className="eyebrow">Guardrail · human approval</div><h2 id="credit-approval-title">Approve credit transfer?</h2></div>
                <button className="btn" aria-label="Close review" onClick={() => setModal(false)}>✕</button>
              </div>
              <div className="approval-amount">{formatUsd(credit)}</div>
              <div className="simple-account-path">
                <div><b>Warranty credit</b><span>{s.customer.name} · {t.source}</span></div>
                <span className="account-arrow">→</span>
                <div><b>Replacement order</b><span>{s.customer.name} · {t.destination}</span></div>
              </div>
              <p className="simple-scope">{t.scope}. GPUs remain excluded.</p>
              <div className="approval-buttons">
                <button className="btn" onClick={() => setModal(false)}>Keep held</button>
                <button className="btn primary" onClick={onApprove}>Approve & show offers</button>
              </div>
              <p className="simple-demo-note">Demo approval · no real funds move{c.autopilot.running ? " · the agent is waiting for you" : ""}</p>
            </section>
          </div>
        )}
      </>
    );
  }

  const ap = c.transfer.approval!;
  return (
    <>
      <Head i={2} title="Same warranty credit. Two ways to replace." desc={`Container & racks: ${formatUsd(ap.amount)} covered. GPUs: not covered by the current warranty.`} />
      <div className="body replacement-body fade-in">
        <div className="approval-strip"><span>✓ Human approval recorded</span><span>{formatUsd(ap.amount)} credit allocation authorized · {ap.id}</span></div>
        <div className="grid2">
          {(["standard", "integrated"] as OfferId[]).map((id) => {
            const o = s.offers[id];
            const inv = buildInvoice(s, money(c, id));
            const premium = id === "integrated";
            return (
              <article key={id} className={`offer compact-offer ${premium ? "premium" : ""}`}>
                <div className="offer-banner">{premium ? "Integrated cooling · recommended" : "External cooling · standard"}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="product"><img src={o.image} alt={`Concept container datacenter, ${o.oneLine}`} /></div>
                <div className="offer-info">
                  <h3>{o.name}</h3>
                  <p className="offer-one-line">{o.oneLine}</p>
                  <div className="offer-funding">
                    <div><span>Package + GPUs + deployment</span><b>{formatUsd(o.packageRevenue + o.deploymentRevenue)}</b></div>
                    {o.servicePlan && <div><span>3-year leak monitoring plan</span><b>+{formatUsd(o.servicePlan.revenue)}</b></div>}
                    <div className="credit-row"><span>Warranty credit · container & racks</span><b>-{formatUsd(ap.amount)}</b></div>
                    <div><span>Remaining balance</span><b>{formatUsd(inv.total - ap.amount)}</b></div>
                  </div>
                  <div className={`compact-finance ${o.financing ? "financed" : ""}`}>
                    {o.financing ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/demo/lender-logo.svg" alt="Illustrative lender logo" />
                        <div><b>{formatUsd(o.financing.amount)} GPU credit line</b><span>Simulated financing · repayable</span></div>
                      </>
                    ) : (
                      <div><b>GPUs paid from customer cash</b><span>No financing selected</span></div>
                    )}
                  </div>
                  <div className="compact-due"><span>Customer cash upfront</span><strong>{formatUsd(inv.customerCash)}</strong></div>
                  {premium ? (
                    <button className="btn primary full" onClick={() => act("accept_offer", { offer: "integrated" })} disabled={!c.offersShown || c.offer !== null}>
                      {c.offer === "integrated" ? "✓ Integrated + financing selected" : "Choose integrated + financing"}
                    </button>
                  ) : (
                    <div className="compact-standard">Warranty credit applies to this option too</div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="compact-offer-note">
          {c.offer ? "✓ Selected: warranty credit + credit line + customer cash. " : "Both packages include new GPUs and deployment. "}
          Concept products and simulated terms; no live lender approval or partnership. Financing is repayable.
        </p>
      </div>
    </>
  );
}

/* ---------- Step 4: GPU lot on Agora ---------- */

export function RecoverStep({ c, act }: StepProps) {
  const started = useRef(false);
  const [arrived, setArrived] = useState(c.sale ? 3 : 0);
  const s = c.scenario;

  useEffect(() => {
    if (!c.offer || started.current || c.autopilot.running) return;
    started.current = true;
    later(async () => {
      if (!c.gpuListed) await act("list_gpu_lot_on_agora");
      if (!c.bidsIn) await act("collect_bids");
    });
  }, [c.offer, c.gpuListed, c.bidsIn, c.autopilot.running, act]);

  useEffect(() => {
    if (!c.bidsIn) return;
    const id = setInterval(() => setArrived((a) => (a >= 3 ? a : a + 1)), 750);
    return () => clearInterval(id);
  }, [c.bidsIn]);

  const collected = [...c.trace].reverse().find((e) => e.name === "collect_bids" && e.ok)?.output as { bidId: string; buyer: string }[] | undefined;
  const bids = s.gpuLot.bids.map((b) => ({ ...b, net: b.gross - b.fee, id: collected?.find((x) => x.buyer === b.buyer)?.bidId }));
  const best = bids.reduce((a, b) => (b.net > a.net ? b : a));
  const highest = bids.reduce((a, b) => (b.gross > a.gross ? b : a));
  const cheapest = bids.reduce((a, b) => (b.fee < a.fee ? b : a));
  const shown = c.sale ? 3 : arrived;

  return (
    <>
      <Head i={3} title="Three GPU offers. One best net return." desc={`${s.gpuLot.condition}.`} />
      <div className="body">
        <div className="auction-status">
          <span className={shown < 3 ? "auction-pulse" : "auction-dot"} />
          <b>{shown < 3 ? "Buyer offers arriving…" : "Best net offer identified"}</b>
          <span>{shown} / 3 offers · simulated Agora market · <a href="/agora" target="_blank" rel="noreferrer">watch on Agora ↗</a></span>
        </div>
        <div className="bids">
          {bids.map((b, i) =>
            shown <= i ? (
              <article key={b.buyer} className="bid pending-bid">
                <Spinner />
                <b style={{ marginTop: 20 }}>Waiting for buyer {i + 1}</b>
                <p>Reviewing condition and collection costs…</p>
                <div className="skeleton" />
              </article>
            ) : (
              <article key={b.buyer} className={`bid ${b === best ? "recommended" : ""} bid-arriving`}>
                <span className={`badge ${b === best ? "green" : ""}`}>
                  {b === best ? "Best net return" : b === highest ? "Highest headline bid" : b === cheapest ? "Lowest shipping cost" : "Offer"}
                </span>
                <h3 style={{ marginTop: 18 }}>{b.buyer}</h3>
                <div className="bid-net">{formatUsd(b.net)}<span>net proceeds · entire lot</span></div>
                <div className="kv"><span>Buyer offer</span><b>{formatUsd(b.gross)}</b></div>
                <div className="kv"><span>Shipping & handling</span><b>-{formatUsd(b.fee)}</b></div>
                {b === best ? (
                  <button className="btn primary full" style={{ marginTop: 20 }} onClick={() => b.id && act("accept_bid", { bid_id: b.id })} disabled={!b.id || shown < 3 || c.sale !== null}>
                    {c.sale ? "✓ Accepted & pickup booked" : shown < 3 ? "Comparing offers…" : `Accept ${formatUsd(b.net)} net & book pickup`}
                  </button>
                ) : (
                  <div className="standard-caption">{formatUsd(best.net - b.net)} less net value</div>
                )}
              </article>
            ),
          )}
        </div>
        {shown === 3 && highest !== best && (
          <div className="success net-explanation">
            <b>Lower bid. Higher net return.</b> {best.buyer} bids {formatUsd(highest.gross - best.gross)} less than {highest.buyer}, but saves{" "}
            {formatUsd(highest.fee - best.fee)} in shipping, so you keep {formatUsd(best.net - highest.net)} more.
          </div>
        )}
        {c.sale ? (
          <Calendar title={`${c.sale.buyer} · secure collection`} desc={`8 modules · ${s.gpuLot.pickupId}`} time="4-5" date={s.date} place={s.customer.site.label} />
        ) : (
          <p className="flow-hint">Accept the best offer to reserve today&apos;s 4-5 PM secure collection slot automatically.</p>
        )}
        <p className="source">Fictional bids and logistics quotes for the same damaged lot; not verified resale prices. No claim of working GPUs. Agora only accepts the best net offer. Collection is simulated.</p>
      </div>
    </>
  );
}

/* ---------- Step 5: reconcile ---------- */

export function ReconcileStep({ c, act }: StepProps) {
  const [revealed, setRevealed] = useState(c.reconciliation ? 4 : 0);
  const [working, setWorking] = useState(false);
  const r = c.reconciliation ?? (c.sale ? reconcile(c.scenario, money(c), []) : null);
  const txs = r?.transactions ?? [];

  async function run() {
    setWorking(true);
    setRevealed(0);
    await act("reconcile_transactions");
    for (let i = 1; i <= 4; i++) {
      await wait(900);
      setRevealed(i);
    }
    setWorking(false);
  }

  const done = !!c.reconciliation?.allSettled && revealed >= txs.length;
  return (
    <>
      <Head i={4} title="Four transactions. Automatically reconciled." desc="Netbalance connects every transaction to its evidence and confirms it is complete." />
      <div className="body">
        <div className="reconcile-action">
          <button className="btn primary reconcile-cta" onClick={run} disabled={!c.sale || working || !!c.reconciliation}>
            {done ? `✓ All ${txs.length} reconciled` : working ? <><Spinner light /> Reconciling…</> : "↻ Reconcile automatically"}
          </button>
        </div>
        <div className="transaction-grid">
          {txs.map((tx, i) => {
            const complete = tx.complete && !!c.reconciliation && (revealed > i || !working);
            const processing = working && revealed === i;
            return (
              <article key={tx.id} className={`transaction-card ${complete ? "complete" : ""} ${processing ? "processing" : ""}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="rec-icon">{complete ? "✓" : processing ? <Spinner /> : i + 1}</span>
                  <span className="tiny muted">{complete ? "Reconciled" : processing ? "Matching…" : "Pending"}</span>
                </div>
                <h3>{tx.title}</h3>
                <strong>{formatUsd(tx.amount)}</strong>
                <p>{tx.source} · {tx.receiptIds.join(" + ")}</p>
              </article>
            );
          })}
        </div>
        {done ? (
          <div className="reconciled-result fade-in">
            <b>{txs.length} / {txs.length} transactions reconciled</b>
            <span>{formatUsd(c.reconciliation!.cashReceived)} cash received · {formatUsd(c.reconciliation!.outstanding)} outstanding · not profit</span>
          </div>
        ) : (
          <p className="flow-hint">One click checks the credit, sale, referral payment and GPU settlement. All transactions are simulated.</p>
        )}
      </div>
    </>
  );
}

/* ---------- Step 6: CFO outcome, carbon, PRISM ---------- */

export function OutcomeStep({ c, act, checks }: StepProps & { checks: Check[] }) {
  const started = useRef(false);
  const [details, setDetails] = useState(false);
  const rep = c.report;

  useEffect(() => {
    if (c.reconciliation?.allSettled && !rep && !started.current && !c.autopilot.running) {
      started.current = true;
      later(() => void act("build_cfo_report"));
    }
  }, [c.reconciliation, rep, c.autopilot.running, act]);

  if (!rep) {
    return (
      <>
        <Head i={5} title="The CFO sees the recovered value." desc="One case, fully reconciled, with the proof attached." />
        <div className="body"><div className="empty-record"><Spinner /><b>Building the CFO view</b><p>Fetching emission factors from the US EPA and checking every figure.</p></div></div>
      </>
    );
  }

  const cmp = rep.comparison;
  const r = rep.reconciliation;
  const m = c.scenario.manualProcess;
  const secs = agentSeconds(c);
  const passed = checks.filter((x) => x.passed).length;

  return (
    <>
      <Head i={5} title="The CFO sees the recovered value." desc="One case, fully reconciled, with the proof attached." />
      <div className="body outcome-body">
        <div className="cfo-headline">
          <div className="cfo-number">+{formatUsd(cmp.improvement)}</div>
          <p>more contribution on this order</p>
          <div className="percent-improvement">↑ +{cmp.improvementPct}% vs. the usual way</div>
        </div>
        <div className="simple-compare">
          <article className="before">
            <div className="eyebrow">The usual way · estimate</div>
            <h3>{formatUsd(cmp.baseline.total)}</h3>
            <div className="compare-line">{m.elapsed} · {m.people} people</div>
            <div className="compare-line muted">Manual matching · no carbon record</div>
          </article>
          <article className="after">
            <div className="eyebrow">With Netbalance</div>
            <h3>{formatUsd(cmp.selected.total)}</h3>
            <div className="compare-line">{secs ? `${secs} seconds` : "Minutes"} · {m.humanTouchpoints.length} people step in</div>
            <div className="compare-line">✓ Every step checked and traced</div>
          </article>
        </div>
        <div className="final-proof" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div><strong>{formatUsd(r.cashReceived)}</strong><span>Cash received · not profit</span></div>
          <div><strong>{formatUsd(r.outstanding)}</strong><span>Outstanding</span></div>
          <div>
            <strong>{rep.carbon.kgCo2e === null ? "Pending" : `${Math.round(rep.carbon.kgCo2e)} kg`}</strong>
            <span>CO2e avoided · estimate</span>
          </div>
          <div><strong>{passed} / {checks.length}</strong><span>PRISM checks passed</span></div>
        </div>
        <div className="final-action">
          <button className="btn primary" onClick={() => setDetails(true)}>View details & evidence ↗</button>
        </div>
        <p className="source" style={{ textAlign: "center" }}>Simulated demo data. Estimates are labeled; the details explain every number.</p>
      </div>
      {details && <Breakdown c={c} checks={checks} onClose={() => setDetails(false)} />}
    </>
  );
}

/** Seconds the autopilot took on this run, start to finish (including the approval), or null. */
function agentSeconds(c: CaseState): number | null {
  const agent = c.autopilot.summary ? c.trace.filter((e) => e.actor === "agent") : [];
  if (!agent.length) return null;
  const last = agent.at(-1)!;
  return Math.max(1, Math.round((new Date(last.at).getTime() + last.ms - new Date(agent[0].at).getTime()) / 1000));
}

function Breakdown({ c, checks, onClose }: { c: CaseState; checks: Check[]; onClose: () => void }) {
  const rep = c.report!;
  const s = c.scenario;
  const inv = buildInvoice(s, money(c));
  const r = rep.reconciliation;
  const cmp = rep.comparison;
  const m = s.manualProcess;
  const secs = agentSeconds(c);
  const nets = s.gpuLot.bids.map((b) => ({ ...b, net: b.gross - b.fee }));
  const best = nets.reduce((a, b) => (b.net > a.net ? b : a));
  const headline = nets.reduce((a, b) => (b.gross > a.gross ? b : a));
  const blocked = c.guardEvents.filter((g) => g.kind === "credit transfer refused").length;
  const line = (lines: { label: string; amount: number }[], label: string) => lines.find((l) => l.label === label)?.amount ?? 0;
  const core = (lines: { label: string; amount: number }[]) =>
    ["Replacement package revenue", "Deployment revenue", "Package cost", "Deployment cost"].reduce((t, l) => t + line(lines, l), 0);
  const kg = (n: number | null) => (n === null ? "pending" : `${n.toFixed(1)} kg CO2e`);
  const sources = [rep.carbon.manufacturing.factor, rep.carbon.refurbishing.factor, rep.energy.carbon.factor].filter((f) => f !== null);
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Financial breakdown" style={{ width: 960 }}>
        <div className="modal-head">
          <div><div className="eyebrow">{s.caseId} · service provider CFO</div><h2>Every dollar, tied to its evidence.</h2></div>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <h3>What Netbalance prevented</h3>
        <ul className="source">
          <li>A {formatUsd(r.naiveTransactionSum - r.cashReceived)} double count: adding the four transactions gives {formatUsd(r.naiveTransactionSum)}; real cash is {formatUsd(r.cashReceived)}.</li>
          <li>Leaving {formatUsd(best.net - headline.net)} on the table by taking the highest headline bid ({headline.buyer}) instead of the best net ({best.buyer}).</li>
          <li>Moving the {formatUsd(c.transfer.approval?.amount ?? 0)} credit without a person&apos;s approval{blocked ? `; ${blocked} attempt${blocked > 1 ? "s" : ""} to send it to another account blocked` : ""}.</li>
        </ul>

        <h3 style={{ marginTop: 18 }}>Time and people</h3>
        <p className="source">
          The usual way (illustrative estimate, not measured): {m.elapsed}, {m.people} people, {m.handsOnHours} hours of hands-on work across {m.roles}.
          With Netbalance: {secs ? `${secs} seconds start to finish on the agent run, including the approval` : "minutes of agent work"}; people step in only for {m.humanTouchpoints.join(", ")}.
          Outside parties (warranty provider, lender, GPU buyer, payments) still take real days; the demo simulates them as instant.
        </p>

        <h3 style={{ marginTop: 18 }}>Where the +{formatUsd(cmp.improvement)} comes from</h3>
        <p className="source">
          +{formatUsd(core(cmp.selected.lines) - core(cmp.baseline.lines))} upgrade contribution,
          +{formatUsd(line(cmp.selected.lines, "Service plan revenue") + line(cmp.selected.lines, "Service plan cost"))} from the {s.offers.integrated.servicePlan?.name ?? "service plan"} (simulated price and delivery cost),
          +{formatUsd(line(cmp.selected.lines, "Net GPU recovery") - line(cmp.baseline.lines, "Net GPU recovery"))} better GPU recovery,
          +{formatUsd(line(cmp.selected.lines, "Financing referral income"))} referral fee: {formatUsd(cmp.baseline.total)} becomes {formatUsd(cmp.selected.total)} (+{cmp.improvementPct}%).
        </p>

        <h3 style={{ marginTop: 18 }}>Carbon and energy (US EPA, fetched live)</h3>
        <p className="source">
          {kg(rep.carbon.kgCo2e)} avoided ({rep.carbon.status === "estimated" ? "sourced estimate" : "pending"}): manufacturing {s.rack.units.length} new modules {kg(rep.carbon.manufacturing.kgCo2e)} minus refurbishing {kg(rep.carbon.refurbishing.kgCo2e)},
          for a {s.gpuLot.weight ? `${s.gpuLot.weight.value} kg lot (${s.gpuLot.weight.source})` : "lot with no recorded weight"}. {rep.carbon.treatmentRoute}.
          {rep.carbon.pendingReasons.length > 0 && ` Pending because: ${rep.carbon.pendingReasons.join("; ")}.`}{" "}
          Energy bonus (simulated meter): {rep.energy.avoidedKwhPerMonth.toLocaleString("en-US")} kWh and {formatUsd(rep.energy.avoidedCostPerMonth)} avoided per month
          {rep.energy.carbon.kgCo2ePerMonth !== null && `, about ${Math.round(rep.energy.carbon.kgCo2ePerMonth).toLocaleString("en-US")} kg CO2e`}. Not ESG certification.
        </p>

        <h3 style={{ marginTop: 18 }}>PRISM checks: {checks.filter((x) => x.passed).length} of {checks.length} passed</h3>
        <div className="evidence-grid">
          {checks.map((x) => (
            <div key={x.name} className="evidence" style={{ cursor: "default" }}>
              {x.passed ? "✓" : "✕"} {x.name}<span>{x.area} · {x.detail}</span>
            </div>
          ))}
        </div>
        <p className="source">{c.prism?.sent.trace ? `Sent to PRISM as trace ${c.prism.traceId}.` : "Not sent to PRISM yet."}</p>

        {c.autopilot.summary && (
          <>
            <h3 style={{ marginTop: 18 }}>Agent summary (Nicrron autopilot)</h3>
            <p className="source" style={{ whiteSpace: "pre-wrap" }}>{c.autopilot.summary}</p>
          </>
        )}

        <h3 style={{ marginTop: 18 }}>Receipts</h3>
        <div className="ledger-wrap">
          <table className="ledger">
            <thead><tr><th>Receipt</th><th>Payer</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {r.settlements.map((x) => (
                <tr key={x.expected.id}>
                  <td>{x.expected.id}<br /><span className="tiny muted">{x.expected.description}</span></td>
                  <td>{x.expected.payer}</td>
                  <td>{x.expected.reference}</td>
                  <td className="money">{formatUsd(x.expected.amount)}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="source">
          Invoice {inv.id}: {inv.lines.map((l) => `${formatUsd(l.amount)} ${l.label.toLowerCase()}`).join(" + ")} = {formatUsd(inv.total)}. Funding: {inv.funding.map((f) => `${formatUsd(f.amount)} ${f.label.toLowerCase()}`).join(" + ")}.
          {c.sale && ` Recovery: ${formatUsd(c.sale.gross)} sale less ${formatUsd(c.sale.fee)} shipping and handling = ${formatUsd(c.sale.net)} cash.`}{" "}
          Total cash receipts: {formatUsd(r.cashReceived)}. The warranty credit is already part of the {formatUsd(inv.total)} sale; adding the four transactions together would wrongly give {formatUsd(r.naiveTransactionSum)}. Warranty credit and lender funding pay the invoice; neither is additional revenue. The customer still owes the credit-line principal plus any interest and fees.
        </p>
        <h3 style={{ marginTop: 22 }}>Contribution comparison</h3>
        <div className="ledger-wrap">
          <table className="ledger">
            <thead><tr><th>Item</th><th>Without Netbalance</th><th>With Netbalance</th></tr></thead>
            <tbody>
              {cmp.selected.lines.map((l, i) => (
                <tr key={l.label}><td>{l.label}</td><td className="money">{formatUsd(cmp.baseline.lines[i].amount)}</td><td className="money">{formatUsd(l.amount)}</td></tr>
              ))}
              <tr><td><b>Transaction contribution</b></td><td className="money">{formatUsd(cmp.baseline.total)}</td><td className="money">{formatUsd(cmp.selected.total)}</td></tr>
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 22 }}>Evidence attached to this case</h3>
        <p className="source">
          Inspection {s.inspection.id}: {s.inspection.finding} Policy {s.policy.id}: §4 covers the container and racks; §7 excludes consequential GPU damage from external cooling. Claim {s.policy.claimId}.{" "}
          {c.transfer.approval && `Approval ${c.transfer.approval.id}: ${c.transfer.approval.approver} authorized ${formatUsd(c.transfer.approval.amount)} from ${c.transfer.approval.source} to ${c.transfer.approval.destination}, ${c.transfer.approval.scope.toLowerCase()}. `}
          {c.sale && `GPU lot ${s.gpuLot.saleId}: sold to ${c.sale.buyer}, pickup ${c.sale.pickup}, serials ${s.rack.units[0].serial} to ${s.rack.units.at(-1)!.serial}. `}
          Guardrail events: {c.guardEvents.map((g) => g.kind).join(", ") || "none"}.
        </p>
        <h3 style={{ marginTop: 22 }}>Carbon sources</h3>
        <p className="source">
          {sources.length
            ? sources.map((f) => `${f!.source.authority}, ${f!.source.edition}, ${f!.source.table}, row "${f!.source.row}" (${f!.source.url})`).join(". ")
            : "EPA factors not fetched; carbon stays pending."}
          {c.epaErrors.length > 0 && ` Fetch problems: ${c.epaErrors.join("; ")}.`}
        </p>
        <p className="source">
          AWS is an illustrative caller, not a claimed customer or endorsement. J.P. Morgan is an illustrative lender, not an asserted partner or committed financing source. All products, warranty provisions, prices, costs, offers, financing, receipts and bids are simulated. Images are AI-generated concepts. No real dispatch, sale, transfer or payment occurs.
        </p>
      </section>
    </div>
  );
}
