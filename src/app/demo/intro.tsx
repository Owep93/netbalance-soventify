"use client";

import type { CaseState } from "@/agent/case";
import { formatUsd } from "@/core/money";

/** Opening page: the CFO workspace with the new incident, before step 1. */
export function Intro({ c, onStart }: { c: CaseState; onStart: () => void }) {
  const s = c.scenario;
  const closed = !!c.report;
  const status = [
    {
      label: "Warranty recovery",
      value: c.coverage ? `${formatUsd(c.coverage.containerRacks.credit)} covered` : "Assessing eligibility",
    },
    {
      label: "Net financial impact",
      value: c.report ? `+${formatUsd(c.report.comparison.improvement)} contribution` : "Calculating exposure",
    },
    {
      label: "Financial settlement",
      value: c.reconciliation?.allSettled ? `${formatUsd(c.reconciliation.cashReceived)} reconciled` : "Awaiting resolution",
    },
  ];

  return (
    <>
      <div className="panel-head">
        <div>
          <div className="eyebrow">CFO workspace</div>
          <h2 className="intro-title">Recover value. Protect margin.</h2>
          <p>Turn damaged hardware into warranty credits, recovery proceeds, and reconciled cash.</p>
        </div>
        <span className="badge green">Money operations</span>
      </div>
      <div className="body">
        <div className="intro-incident">
          <div className="intro-incident-head">
            <div>
              <h3>New customer incident · {s.customer.name}</h3>
              <p className="small muted">Cooling leak · {s.rack.id} · Eight GPUs affected</p>
            </div>
            <span className="badge">{s.caseId} · {closed ? "Closed" : "Open"}</span>
          </div>
          <div className="intro-status">
            {status.map((x) => (
              <div key={x.label}>
                <span className="label">{x.label}</span>
                <b>{x.value}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="intro-agent">
          <span className="intro-avatar">N</span>
          <div>
            <b>Netbalance agent</b>
            <p>I&apos;ll pursue warranty credits, recover value from affected GPUs, and reconcile every transaction. You approve transfers.</p>
          </div>
        </div>
        <button className="btn primary intro-start" onClick={onStart}>Start financial recovery →</button>
        <p className="tiny muted" style={{ marginTop: 14 }}>Demo simulation · no real transfers or payments</p>
      </div>
    </>
  );
}
