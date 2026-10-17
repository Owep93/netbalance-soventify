// The agent's tools. The LLM chooses which to call; every number comes from src/core.
// Tools refuse to run out of order, so the model cannot, for example, issue a credit
// before the protection plan is verified.
import type OpenAI from "openai";
import type { AgoraMarket } from "@/agora/market";
import type { EpaResult } from "@/lib/epa";
import { normalizeSerial } from "@/core/intake";
import { buildExpectedReceipts, upgradeDelta, type Receipt } from "@/core/ledger";
import { formatUsd } from "@/core/money";
import { buildRecoveryReport, type RecoveryReport } from "@/core/report";
import type { Scenario } from "@/core/scenario";
import { verifyProtectionPlan, type PlanVerification } from "@/core/warranty";

export interface CaseState {
  scenario: Scenario;
  intake: { serial: string; symptoms: string; weightKg: number | null } | null;
  diagnostics: Scenario["diagnostics"] | null;
  plan: PlanVerification | null;
  creditIssued: boolean;
  replacementSold: boolean;
  refurbished: boolean;
  resaleSale: { netPayout: number } | null;
  receipts: Receipt[] | null;
  report: RecoveryReport | null;
}

export function newCase(scenario: Scenario): CaseState {
  return {
    scenario,
    intake: null,
    diagnostics: null,
    plan: null,
    creditIssued: false,
    replacementSold: false,
    refurbished: false,
    resaleSale: null,
    receipts: null,
    report: null,
  };
}

export class ToolRefused extends Error {}

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ToolRefused(message);
}

export interface ToolContext {
  fetchEpa: () => Promise<EpaResult>;
  agora: AgoraMarket;
}

type Handler = (state: CaseState, args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;

interface Tool {
  description: string;
  parameters: Record<string, unknown>;
  run: Handler;
}

const noArgs = { type: "object", properties: {}, additionalProperties: false };

export const TOOLS: Record<string, Tool> = {
  record_failure_report: {
    description: "Record the customer's GPU failure report at intake, including the unit weight in kg.",
    parameters: {
      type: "object",
      properties: {
        serial: { type: "string", description: "Serial number of the failed GPU" },
        symptoms: { type: "string", description: "What the customer reported, in plain words" },
      },
      required: ["serial", "symptoms"],
      additionalProperties: false,
    },
    run(state, args) {
      const s = state.scenario;
      const raw = String(args.serial ?? "");
      need(normalizeSerial(raw) === normalizeSerial(s.failedUnit.serial), `No unit with serial "${raw}" on file for ${s.customer.name}.`);
      const serial = s.failedUnit.serial;
      state.intake = { serial, symptoms: String(args.symptoms ?? ""), weightKg: s.failedUnit.weight?.value ?? null };
      return {
        customer: s.customer.name,
        model: s.failedUnit.model,
        serial,
        unitWeight: s.failedUnit.weight
          ? `${s.failedUnit.weight.value} kg (${s.failedUnit.weight.source})`
          : "Not recorded. Carbon will stay pending.",
      };
    },
  },

  run_diagnostics: {
    description: "Run diagnostics on the failed unit and return the report.",
    parameters: noArgs,
    run(state) {
      need(state.intake, "Record the failure report first.");
      state.diagnostics = state.scenario.diagnostics;
      return { ...state.diagnostics, note: "Diagnostics run is simulated for the demo." };
    },
  },

  verify_protection_plan: {
    description: "Check the diagnostics report against the protection plan terms.",
    parameters: noArgs,
    run(state) {
      need(state.diagnostics, "Run diagnostics first.");
      state.plan = verifyProtectionPlan(state.diagnostics, state.scenario.protectionPlan);
      return {
        verified: state.plan.verified,
        planId: state.plan.planId,
        provider: state.scenario.protectionPlan.provider,
        checks: state.plan.checks,
      };
    },
  },

  issue_warranty_credit: {
    description: "Issue the warranty credit on the replacement invoice and file the reimbursement claim. Only allowed when the plan is verified.",
    parameters: noArgs,
    run(state) {
      need(state.plan, "Verify the protection plan first.");
      need(state.plan.verified, "The protection plan did not verify, so no credit can be issued.");
      need(!state.creditIssued, "The warranty credit was already issued.");
      state.creditIssued = true;
      const s = state.scenario;
      return {
        credit: formatUsd(s.protectionPlan.credit),
        appliesTo: s.ids.invoice,
        reimbursementClaim: s.ids.warrantyClaim,
        claimedFrom: s.protectionPlan.provider,
        note: "The reimbursement pays for this credit. It is not extra revenue.",
      };
    },
  },

  quote_replacement: {
    description: "Quote the like-for-like replacement and the newer, more power-efficient upgrade.",
    parameters: noArgs,
    run(state) {
      need(state.plan, "Verify the protection plan first, so the quote knows whether a credit applies.");
      const s = state.scenario;
      const credit = state.creditIssued ? s.protectionPlan.credit : 0;
      const due = (price: number) => formatUsd(price + s.replacement.installation - credit);
      return {
        likeForLike: { model: s.replacement.likeForLike.model, price: formatUsd(s.replacement.likeForLike.price), customerPays: due(s.replacement.likeForLike.price) },
        upgrade: {
          model: s.replacement.upgrade.model,
          price: formatUsd(s.replacement.upgrade.price),
          customerPays: due(s.replacement.upgrade.price),
          why: s.replacement.upgrade.why,
          kWhPerJob: { current: s.energy.baselineKwhPerJob, upgrade: s.energy.upgradeKwhPerJob },
        },
        upgradeCostsMore: formatUsd(upgradeDelta(s)),
        installation: formatUsd(s.replacement.installation),
        warrantyCredit: formatUsd(credit),
      };
    },
  },

  sell_replacement: {
    description: "Sell the upgrade replacement with installation and issue the customer invoice.",
    parameters: noArgs,
    run(state) {
      need(state.plan, "Verify the protection plan first.");
      need(!state.plan.verified || state.creditIssued, "The plan verified, so issue the warranty credit before invoicing.");
      need(!state.replacementSold, "The replacement was already sold.");
      state.replacementSold = true;
      const invoice = buildExpectedReceipts(state.scenario, state.plan.verified).find((e) => e.flow === "replacement")!;
      return {
        invoice: invoice.id,
        lines: invoice.lines.map((l) => ({ item: l.label, amount: formatUsd(l.amount) })),
        customerPays: formatUsd(invoice.amount),
        note: "Customer approval and installation booking are simulated for the demo.",
      };
    },
  },

  refurbish_failed_unit: {
    description: "Refurbish the failed unit so it can be resold.",
    parameters: noArgs,
    run(state) {
      need(state.diagnostics, "Run diagnostics first.");
      need(!state.refurbished, "The failed unit is already refurbished.");
      state.refurbished = true;
      return {
        serial: state.scenario.failedUnit.serial,
        condition: state.scenario.resale.condition,
        note: "Refurbishment is simulated for the demo.",
      };
    },
  },

  list_on_agora: {
    description: "List the refurbished unit for sale on the Agora reseller market.",
    parameters: noArgs,
    run(state, _args, ctx) {
      need(state.refurbished, "Refurbish the failed unit first.");
      const s = state.scenario;
      const listing = ctx.agora.createListing({
        id: s.resale.listingId,
        title: `Refurbished ${s.failedUnit.model} GPU`,
        serial: s.failedUnit.serial,
        condition: s.resale.condition,
        askingPrice: s.resale.askingPrice,
        feeRate: s.resale.feeRate,
      });
      return {
        marketplace: s.resale.marketplace,
        listing: listing.id,
        askingPrice: formatUsd(listing.askingPrice),
        agoraFee: `${Math.round(listing.feeRate * 100)}% of the sale price`,
        note: "Agora is a simulated marketplace for the demo.",
      };
    },
  },

  check_agora_bids: {
    description: "Check the bids on the Agora listing.",
    parameters: noArgs,
    run(state, _args, ctx) {
      const id = state.scenario.resale.listingId;
      need(ctx.agora.listings.has(id), "List the unit on Agora first.");
      const bids = ctx.agora.collectBids(id, state.scenario.resale.simulatedBids);
      return {
        listing: id,
        bids: bids.map((b) => ({ bidId: b.id, buyer: b.buyer, amount: formatUsd(b.amount) })),
        note: "Bids come from simulated buyers.",
      };
    },
  },

  accept_agora_bid: {
    description: "Accept a bid on the Agora listing. Agora only allows the highest bid.",
    parameters: {
      type: "object",
      properties: { bidId: { type: "string", description: "The bidId to accept" } },
      required: ["bidId"],
      additionalProperties: false,
    },
    run(state, args, ctx) {
      const id = state.scenario.resale.listingId;
      need(ctx.agora.listings.has(id), "List the unit on Agora first.");
      need(ctx.agora.get(id).bids.length > 0, "Check the bids first.");
      let sale;
      try {
        sale = ctx.agora.acceptBid(id, String(args.bidId ?? ""));
      } catch (e) {
        throw new ToolRefused(e instanceof Error ? e.message : String(e));
      }
      state.resaleSale = { netPayout: sale.netPayout };
      // What we expect to receive comes from the actual sale, not the plan.
      state.scenario = { ...state.scenario, resale: { ...state.scenario.resale, netPayout: sale.netPayout } };
      return {
        listing: id,
        buyer: sale.buyer,
        salePrice: formatUsd(sale.price),
        agoraFee: formatUsd(sale.fee),
        netPayout: formatUsd(sale.netPayout),
        pickup: sale.pickup,
        note: "The sale, pickup, and payout are simulated for the demo.",
      };
    },
  },

  collect_payments: {
    description: "Collect the customer payment, the warranty reimbursement, and the Agora payout.",
    parameters: noArgs,
    run(state) {
      need(state.replacementSold, "Sell the replacement first.");
      need(state.resaleSale, "Sell the failed unit on Agora first.");
      const s = state.scenario;
      const open = new Set(buildExpectedReceipts(s, state.creditIssued).map((e) => e.id));
      state.receipts = [
        ...s.receipts.filter((r) => open.has(r.reference) && r.reference !== s.resale.listingId),
        {
          id: "RCPT-AGORA",
          payer: s.resale.marketplace,
          reference: s.resale.listingId,
          amount: state.resaleSale.netPayout,
          receivedOn: new Date().toISOString().slice(0, 10),
          simulated: true,
        },
      ];
      return {
        received: state.receipts.map((r) => ({ from: r.payer, reference: r.reference, amount: formatUsd(r.amount) })),
        note: "Payments are simulated for the demo.",
      };
    },
  },

  reconcile_and_record_carbon: {
    description: "Reconcile all three money flows and build the carbon record from EPA factors fetched now.",
    parameters: noArgs,
    async run(state, _args, ctx) {
      need(state.receipts, "Collect payments first.");
      const epa = await ctx.fetchEpa();
      const s = { ...state.scenario, receipts: state.receipts };
      const report = buildRecoveryReport(s, epa.factors);
      state.report = report;
      const r = report.reconciliation;
      const kg = (n: number | null) => (n === null ? "pending" : `${n.toFixed(n < 1 ? 2 : 1)} kg CO2e`);
      return {
        matchedReceipts: formatUsd(r.matchedTotal),
        expectedReceipts: formatUsd(r.expectedTotal),
        outstanding: formatUsd(r.outstanding),
        settlements: r.settlements.map((x) => ({ reference: x.expected.id, payer: x.expected.payer, expected: formatUsd(x.expected.amount), status: x.status })),
        valueSold: { replacement: formatUsd(r.salesValue.replacement), resale: formatUsd(r.salesValue.resale) },
        receiptsAreNotProfit: true,
        carbon: {
          status: report.carbon.status,
          avoided: kg(report.carbon.kgCo2e),
          manufacturingNewUnit: kg(report.carbon.manufacturing.kgCo2e),
          refurbishingFailedUnit: kg(report.carbon.refurbishing.kgCo2e),
          treatmentRoute: report.carbon.treatmentRoute,
          baseline: report.carbon.baseline,
          pendingReasons: report.carbon.pendingReasons,
          sources: [report.carbon.manufacturing.factor, report.carbon.refurbishing.factor]
            .filter((f) => f !== null)
            .map((f) => `${f.source.authority}, ${f.source.edition}, ${f.category}`),
        },
        energy: {
          avoidedPerMonth: `${report.energy.avoidedKwhPerMonth.toLocaleString("en-US")} kWh, ${formatUsd(report.energy.avoidedCostPerMonth)}`,
          avoidedCarbonPerMonth: report.energy.carbon.kgCo2ePerMonth === null
            ? "pending"
            : `${Math.round(report.energy.carbon.kgCo2ePerMonth).toLocaleString("en-US")} kg CO2e`,
          status: report.energy.carbon.status,
        },
        fetchErrors: epa.errors,
      };
    },
  },
};

export const TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(TOOLS).map(
  ([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }),
);
