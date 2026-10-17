// The case tools. The presenter's buttons, the voice call, and the Nicrron agent all act
// through these, so they share one record and one set of rules. Every number comes from
// src/core. Tools refuse to run out of order, and the warranty credit never moves between
// accounts without a person's approval.
import type OpenAI from "openai";
import type { AgoraMarket } from "@/agora/market";
import { assessCoverage } from "@/core/coverage";
import { checkTransfer } from "@/core/credit";
import { logIncident } from "@/core/intake";
import { buildExpectedReceipts, buildInvoice, reconcile, simulatedReceipts, type CaseMoney } from "@/core/ledger";
import { formatUsd } from "@/core/money";
import { buildCfoReport } from "@/core/report";
import type { OfferId } from "@/core/scenario";
import type { EpaResult } from "@/lib/epa";
import type { CaseState, GuardEvent } from "./case";
import type { TraceEvent } from "./trace";

export class ToolRefused extends Error {}

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ToolRefused(message);
}

export interface ToolContext {
  fetchEpa: () => Promise<EpaResult>;
  agora: AgoraMarket;
  // Waits until a person approves (or the wait times out). Autopilot only.
  waitForApproval?: (state: CaseState) => Promise<boolean>;
  // Records a guardrail event in PRISM. Returns the PRISM trace id, or null.
  recordGuard?: (kind: GuardEvent["kind"], detail: string) => Promise<string | null>;
}

type Handler = (state: CaseState, args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;

interface Tool {
  description: string;
  parameters: Record<string, unknown>;
  run: Handler;
}

const noArgs = { type: "object", properties: {}, additionalProperties: false };

function caseMoney(state: CaseState): CaseMoney {
  const s = state.scenario;
  return {
    offer: s.offers[state.offer ?? "integrated"],
    creditApplied: state.transfer.decision?.status === "applied" ? state.transfer.approval!.amount : 0,
    gpuSale: state.sale ? { buyer: state.sale.buyer, gross: state.sale.gross, fee: state.sale.fee, net: state.sale.net } : null,
  };
}

async function guard(state: CaseState, ctx: ToolContext, kind: GuardEvent["kind"], detail: string) {
  const prismTraceId = ctx.recordGuard ? await ctx.recordGuard(kind, detail) : null;
  state.guardEvents.push({ at: new Date().toISOString(), kind, detail, prismTraceId });
}

export const TOOLS: Record<string, Tool> = {
  log_incident: {
    description: "Log the incident reported on the support call and dispatch a technician.",
    parameters: {
      type: "object",
      properties: {
        issue: { type: "string" },
        everyone_safe: { type: "boolean" },
        rack_offline: { type: "boolean" },
        rack: { type: "string" },
        gpu_model: { type: "string" },
        gpu_count: { type: "number" },
      },
      required: ["issue", "everyone_safe", "rack_offline", "rack", "gpu_model"],
      additionalProperties: false,
    },
    run(state, a) {
      const record = logIncident(state.scenario, {
        issue: String(a.issue ?? ""),
        everyoneSafe: a.everyone_safe === true,
        rackOffline: a.rack_offline === true,
        rack: String(a.rack ?? ""),
        gpuModel: String(a.gpu_model ?? ""),
        gpuCount: Number.isFinite(Number(a.gpu_count)) ? Number(a.gpu_count) : null,
      });
      state.incident = record;
      return {
        incident: record.incidentId,
        priority: record.priority,
        technician: record.technician,
        onSiteBy: record.technicianOnSiteBy,
        note: `${record.recordNote} Dispatch is simulated for the demo.`,
      };
    },
  },

  attach_inspection_photo: {
    description: "Attach the technician's inspection photo of the leak and GPU tray to the ticket.",
    parameters: noArgs,
    run(state) {
      need(state.incident, "Log the incident first.");
      state.photoAttached = true;
      return { attached: state.scenario.inspection.id, finding: state.scenario.inspection.finding, note: "Technician finding is simulated." };
    },
  },

  assess_coverage: {
    description: "Apply the warranty policy to the inspection finding: what is covered and for how much.",
    parameters: noArgs,
    run(state) {
      need(state.photoAttached, "Attach the inspection photo first. Coverage waits for evidence.");
      const c = assessCoverage(state.scenario, true);
      state.coverage = c;
      return {
        claim: c.claimId,
        containerAndRacks: { covered: c.containerRacks.covered, credit: formatUsd(c.containerRacks.credit) },
        gpus: { covered: c.gpus.covered, reason: c.gpus.reason },
      };
    },
  },

  request_credit_transfer: {
    description:
      "Request moving the warranty credit from the warranty credit account to the customer's replacement order. It is held until a finance reviewer approves.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Destination account. The customer's replacement order unless told otherwise." },
      },
      additionalProperties: false,
    },
    async run(state, a, ctx) {
      need(state.coverage, "Assess coverage first.");
      const t = state.scenario.creditTransfer;
      const req = { amount: state.coverage.containerRacks.credit, source: t.source, destination: String(a.destination || t.destination) };
      const decision = checkTransfer(state.scenario, req, state.coverage.containerRacks.credit, state.transfer.approval);
      state.transfer.decision = decision;
      if (decision.status === "refused") {
        await guard(state, ctx, "credit transfer refused", decision.reasons.join(" "));
        throw new ToolRefused(decision.reasons.join(" "));
      }
      if (decision.status === "needs approval") {
        await guard(state, ctx, "credit transfer held", `${formatUsd(req.amount)} ${req.source} to ${req.destination}: waiting for a finance reviewer`);
        return { status: "held", amount: formatUsd(req.amount), from: req.source, to: req.destination, reason: decision.reasons[0] };
      }
      return { status: "applied", amount: formatUsd(req.amount), approval: decision.approval.id };
    },
  },

  wait_for_credit_approval: {
    description: "Wait for the finance reviewer to approve the held credit transfer, then apply it.",
    parameters: noArgs,
    async run(state, _a, ctx) {
      need(state.transfer.decision, "Request the credit transfer first.");
      if (state.transfer.decision.status !== "applied") {
        const approved = ctx.waitForApproval ? await ctx.waitForApproval(state) : state.transfer.approval !== null;
        need(approved && state.transfer.approval, "No approval yet. The credit stays where it is.");
        const t = state.scenario.creditTransfer;
        const req = { amount: state.coverage!.containerRacks.credit, source: t.source, destination: t.destination };
        state.transfer.decision = checkTransfer(state.scenario, req, state.coverage!.containerRacks.credit, state.transfer.approval);
        need(state.transfer.decision.status === "applied", "The approval does not match this transfer.");
      }
      return { status: "applied", approval: state.transfer.approval!.id, scope: state.transfer.approval!.scope };
    },
  },

  present_offers: {
    description: "Present the two replacement packages, with the warranty credit applied to either.",
    parameters: noArgs,
    run(state) {
      need(state.transfer.decision?.status === "applied", "The warranty credit must be approved and applied first.");
      state.offersShown = true;
      return (["standard", "integrated"] as OfferId[]).map((id) => {
        const inv = buildInvoice(state.scenario, { ...caseMoney(state), offer: state.scenario.offers[id] });
        return {
          offer: id,
          name: state.scenario.offers[id].name,
          invoiceTotal: formatUsd(inv.total),
          funding: inv.funding.map((f) => `${f.label}: ${formatUsd(f.amount)}`),
          customerCashUpfront: formatUsd(inv.customerCash),
        };
      });
    },
  },

  accept_offer: {
    description: "Record the customer's choice of replacement package.",
    parameters: {
      type: "object",
      properties: { offer: { type: "string", enum: ["standard", "integrated"] } },
      required: ["offer"],
      additionalProperties: false,
    },
    run(state, a) {
      need(state.offersShown, "Present the offers first.");
      need(state.offer === null, "An offer was already accepted.");
      const id = a.offer === "standard" ? "standard" : "integrated";
      state.offer = id;
      const inv = buildInvoice(state.scenario, caseMoney(state));
      return {
        accepted: state.scenario.offers[id].name,
        invoice: inv.id,
        total: formatUsd(inv.total),
        customerCashUpfront: formatUsd(inv.customerCash),
        note: "Customer approval and financing are simulated for the demo.",
      };
    },
  },

  list_gpu_lot_on_agora: {
    description: "List the damaged GPU lot on the Agora reseller market.",
    parameters: noArgs,
    run(state, _a, ctx) {
      need(state.offer, "Settle the replacement first.");
      const s = state.scenario;
      if (!state.gpuListed) {
        ctx.agora.createListing({
          id: s.gpuLot.saleId,
          title: `${s.rack.units.length} x ${s.rack.model} GPU lot`,
          condition: s.gpuLot.condition,
          serials: s.rack.units.map((u) => u.serial),
        });
        state.gpuListed = true;
      }
      return { listing: s.gpuLot.saleId, condition: s.gpuLot.condition, note: "Agora is a simulated market for the demo." };
    },
  },

  collect_bids: {
    description: "Collect buyer offers on the GPU lot, with each buyer's shipping and handling.",
    parameters: noArgs,
    run(state, _a, ctx) {
      need(state.gpuListed, "List the GPU lot on Agora first.");
      const bids = ctx.agora.collectBids(state.scenario.gpuLot.saleId, state.scenario.gpuLot.bids);
      state.bidsIn = true;
      return bids.map((b) => ({ bidId: b.id, buyer: b.buyer, offer: formatUsd(b.gross), shipping: formatUsd(b.fee), net: formatUsd(b.net) }));
    },
  },

  accept_bid: {
    description: "Accept a GPU lot offer and book pickup. Agora only allows the best net offer.",
    parameters: {
      type: "object",
      properties: { bid_id: { type: "string" } },
      required: ["bid_id"],
      additionalProperties: false,
    },
    run(state, a, ctx) {
      need(state.bidsIn, "Collect the bids first.");
      const s = state.scenario;
      try {
        state.sale = ctx.agora.acceptBid(s.gpuLot.saleId, String(a.bid_id ?? ""), `${s.gpuLot.pickupId}, ${s.gpuLot.pickupWindow}`);
      } catch (e) {
        throw new ToolRefused(e instanceof Error ? e.message : String(e));
      }
      return {
        buyer: state.sale.buyer,
        offer: formatUsd(state.sale.gross),
        shipping: formatUsd(state.sale.fee),
        net: formatUsd(state.sale.net),
        pickup: state.sale.pickup,
        note: "The sale and pickup are simulated for the demo.",
      };
    },
  },

  reconcile_transactions: {
    description: "Collect the simulated payments and reconcile every transaction against its evidence.",
    parameters: noArgs,
    run(state) {
      need(state.sale, "Sell the GPU lot first.");
      const m = caseMoney(state);
      state.receipts = simulatedReceipts(buildExpectedReceipts(state.scenario, m), state.scenario.date);
      const r = reconcile(state.scenario, m, state.receipts);
      state.reconciliation = r;
      return {
        transactions: r.transactions.map((t) => ({ name: t.title, amount: formatUsd(t.amount), reconciled: t.complete })),
        cashReceived: formatUsd(r.cashReceived),
        outstanding: formatUsd(r.outstanding),
        note: "Cash received is not profit. The four transaction amounts must not be added together. Payments are simulated.",
      };
    },
  },

  build_cfo_report: {
    description: "Build the CFO outcome: contribution against the baseline, and the carbon record from EPA factors fetched now.",
    parameters: noArgs,
    async run(state, _a, ctx) {
      need(state.reconciliation?.allSettled, "Reconcile every transaction first.");
      const epa = await ctx.fetchEpa();
      state.epaErrors = epa.errors;
      const report = buildCfoReport(state.scenario, caseMoney(state), state.receipts!, epa.factors);
      state.report = report;
      const kg = (n: number | null) => (n === null ? "pending" : `${n.toFixed(1)} kg CO2e`);
      const c = report.comparison;
      return {
        contribution: { baseline: formatUsd(c.baseline.total), selected: formatUsd(c.selected.total), improvement: formatUsd(c.improvement), improvementPct: `${c.improvementPct}%` },
        cashReceived: formatUsd(report.reconciliation.cashReceived),
        outstanding: formatUsd(report.reconciliation.outstanding),
        carbon: {
          status: report.carbon.status,
          avoided: kg(report.carbon.kgCo2e),
          manufacturingNew: kg(report.carbon.manufacturing.kgCo2e),
          refurbishing: kg(report.carbon.refurbishing.kgCo2e),
          condition: report.carbon.treatmentRoute,
        },
        energy: `${report.energy.avoidedKwhPerMonth.toLocaleString("en-US")} kWh and ${formatUsd(report.energy.avoidedCostPerMonth)} avoided per month`,
        fetchErrors: epa.errors,
      };
    },
  },
};

export const TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(TOOLS).map(
  ([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }),
);

/** Runs one tool on the case and records it in the trace. Refusals are recorded, not thrown. */
export async function runTool(
  state: CaseState,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  actor: TraceEvent["actor"],
): Promise<TraceEvent> {
  const t0 = Date.now();
  let output: unknown;
  let ok = true;
  try {
    const tool = TOOLS[name];
    if (!tool) throw new ToolRefused(`Unknown tool ${name}`);
    output = await tool.run(state, args, ctx);
  } catch (e) {
    if (!(e instanceof ToolRefused)) throw e;
    ok = false;
    output = { refused: e.message };
  }
  const event: TraceEvent = {
    seq: state.trace.length + 1,
    at: new Date(t0).toISOString(),
    kind: "tool",
    actor,
    name,
    input: args,
    output,
    ok,
    ms: Date.now() - t0,
  };
  state.trace.push(event);
  state.updatedAt = new Date().toISOString();
  return event;
}

