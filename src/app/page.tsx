import type { CarbonSide } from "@/core/carbon";
import { formatUsd } from "@/core/money";
import { buildRecoveryReport } from "@/core/report";
import { scenario } from "@/core/scenario";

// EPA factors are not wired yet, so carbon shows as pending rather than a guessed number.
const report = buildRecoveryReport(scenario, { manufacturing: null, refurbishing: null, grid: null });

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "matched" || status === "estimated" || status === "covered"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : status === "pending" || status === "awaiting payment"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SideCard({ side }: { side: CarbonSide }) {
  return (
    <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{side.label}</span>
        <StatusPill status={side.status} />
      </div>
      <p className="text-sm opacity-70">Activity family: {side.family}</p>
      <p className="mt-2 text-2xl font-semibold">
        {side.kgCo2e === null ? "Pending" : `${side.kgCo2e.toFixed(1)} kg CO2e`}
      </p>
      <p className="mt-1 text-xs opacity-70">{side.method}</p>
    </div>
  );
}

export default function Home() {
  const { reconciliation: r, carbon, energy, plan } = report;
  const weight = scenario.failedUnit.weight;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide opacity-60">GPU recovery</p>
        <h1 className="text-3xl font-bold">
          {scenario.customer.name}: {scenario.failedUnit.model} failure, reconciled
        </h1>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          Demo data. Approvals, bids, pickup, meter readings, and payments are simulated.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm opacity-70">Matched receipts</p>
          <p className="text-3xl font-bold">{formatUsd(r.matchedTotal)}</p>
          <p className="text-xs opacity-70">
            of {formatUsd(r.expectedTotal)} expected. Receipts are not profit.
          </p>
        </div>
        <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm opacity-70">Avoided CO2e (estimate)</p>
          <p className="text-3xl font-bold">
            {carbon.kgCo2e === null ? "Pending" : `${carbon.kgCo2e.toFixed(1)} kg`}
          </p>
          <p className="text-xs opacity-70">Sourced estimate, not ESG certification</p>
        </div>
        <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm opacity-70">Avoided energy cost</p>
          <p className="text-3xl font-bold">{formatUsd(energy.avoidedCostPerMonth)}/mo</p>
          <p className="text-xs opacity-70">
            {energy.avoidedKwhPerMonth.toLocaleString("en-US")} kWh per month, simulated meter data
          </p>
        </div>
      </div>

      <Section title="Protection plan check">
        <div className="mb-3 flex items-center gap-2">
          <span>Plan {plan.planId}</span>
          <StatusPill status={plan.verified ? "covered" : "not covered"} />
        </div>
        <ul className="space-y-1 text-sm">
          {plan.checks.map((c) => (
            <li key={c.label}>
              {c.passed ? "Pass" : "Fail"}: {c.label}. <span className="opacity-70">{c.detail}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Money flows">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="opacity-70">
              <tr>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Payer</th>
                <th className="py-2 pr-4">What it is</th>
                <th className="py-2 pr-4 text-right">Expected</th>
                <th className="py-2 pr-4 text-right">Received</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {r.settlements.map((s) => (
                <tr key={s.expected.id} className="border-t border-black/10 align-top dark:border-white/15">
                  <td className="py-2 pr-4 font-mono">{s.expected.id}</td>
                  <td className="py-2 pr-4">{s.expected.payer}</td>
                  <td className="py-2 pr-4">
                    {s.expected.description}
                    <ul className="mt-1 text-xs opacity-70">
                      {s.expected.lines.map((l) => (
                        <li key={l.label}>
                          {l.label}: {formatUsd(l.amount)}
                          {l.note ? ` (${l.note})` : ""}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-2 pr-4 text-right">{formatUsd(s.expected.amount)}</td>
                  <td className="py-2 pr-4 text-right">{s.receipt ? formatUsd(s.receipt.amount) : "None yet"}</td>
                  <td className="py-2"><StatusPill status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm opacity-80">
          Value sold: {formatUsd(r.salesValue.replacement)} replacement and installation, plus{" "}
          {formatUsd(r.salesValue.resale)} resale. The warranty reimbursement pays for the credit already
          taken off the customer invoice, so it is not counted again as revenue.
        </p>
      </Section>

      <Section title="Carbon record">
        <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline opacity-70">Unit weight: </dt><dd className="inline">{weight ? `${weight.value} kg (${weight.source})` : "Not recorded"}</dd></div>
          <div><dt className="inline opacity-70">Treatment route: </dt><dd className="inline">{carbon.treatmentRoute}</dd></div>
          <div><dt className="inline opacity-70">Baseline: </dt><dd className="inline">{carbon.baseline}</dd></div>
          <div><dt className="inline opacity-70">Method: </dt><dd className="inline">{carbon.method}</dd></div>
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <SideCard side={carbon.manufacturing} />
          <SideCard side={carbon.refurbishing} />
        </div>
        {carbon.pendingReasons.length > 0 && (
          <div className="mt-4 text-sm">
            <p className="font-medium">Why this is pending</p>
            <ul className="list-disc pl-5 opacity-80">
              {carbon.pendingReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}
      </Section>
    </main>
  );
}
