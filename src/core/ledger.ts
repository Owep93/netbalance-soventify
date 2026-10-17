import { formatUsd, sum, type Cents } from "./money";
import type { Scenario } from "./scenario";

export type Flow = "replacement" | "warranty" | "resale";

export interface LineItem {
  label: string;
  amount: Cents;
  note?: string;
}

/** Money we expect to receive, with the document it is billed against. */
export interface ExpectedReceipt {
  id: string;
  flow: Flow;
  payer: string;
  description: string;
  lines: LineItem[];
  amount: Cents;
}

export type Receipt = Scenario["receipts"][number];

export type SettlementStatus = "matched" | "awaiting payment" | "amount mismatch";

export interface Settlement {
  expected: ExpectedReceipt;
  receipt: Receipt | null;
  status: SettlementStatus;
  difference: Cents;
}

export interface Reconciliation {
  settlements: Settlement[];
  unmatchedReceipts: Receipt[];
  expectedTotal: Cents;
  matchedTotal: Cents;
  outstanding: Cents;
  allSettled: boolean;
  // Value of what was sold. The warranty reimbursement pays for part of the replacement
  // sale; it is not extra revenue, so it does not appear here a second time.
  salesValue: { replacement: Cents; resale: Cents; total: Cents };
}

export function upgradeDelta(s: Scenario): Cents {
  return s.replacement.upgrade.price - s.replacement.likeForLike.price;
}

/** Builds the three expected money flows. No verified plan means no credit and no claim. */
export function buildExpectedReceipts(s: Scenario, planVerified: boolean): ExpectedReceipt[] {
  const { likeForLike, upgrade, installation } = s.replacement;

  const invoiceLines: LineItem[] = [
    {
      label: `${upgrade.model} replacement unit`,
      amount: upgrade.price,
      note: `${likeForLike.model} like-for-like is ${formatUsd(likeForLike.price)}; the upgrade adds ${formatUsd(upgradeDelta(s))}`,
    },
    { label: "Installation", amount: installation },
  ];
  if (planVerified) {
    invoiceLines.push({
      label: `Warranty credit (plan ${s.protectionPlan.id})`,
      amount: -s.protectionPlan.credit,
    });
  }

  const expected: ExpectedReceipt[] = [
    {
      id: s.ids.invoice,
      flow: "replacement",
      payer: s.customer.name,
      description: "Replacement sale, customer share",
      lines: invoiceLines,
      amount: sum(invoiceLines.map((l) => l.amount)),
    },
  ];

  if (planVerified) {
    expected.push({
      id: s.ids.warrantyClaim,
      flow: "warranty",
      payer: s.protectionPlan.provider,
      description: "Warranty reimbursement for the credit on the replacement invoice",
      lines: [{ label: `Claim under plan ${s.protectionPlan.id}`, amount: s.protectionPlan.credit }],
      amount: s.protectionPlan.credit,
    });
  }

  expected.push({
    id: s.resale.listingId,
    flow: "resale",
    payer: s.resale.marketplace,
    description: `Refurbished ${s.failedUnit.model} sold on ${s.resale.marketplace}, net payout`,
    lines: [{ label: "Net payout", amount: s.resale.netPayout }],
    amount: s.resale.netPayout,
  });

  return expected;
}

export function reconcile(expected: ExpectedReceipt[], receipts: Receipt[]): Reconciliation {
  const used = new Set<string>();

  const settlements: Settlement[] = expected.map((e) => {
    const receipt = receipts.find((r) => r.reference === e.id && !used.has(r.id)) ?? null;
    if (!receipt) return { expected: e, receipt: null, status: "awaiting payment", difference: e.amount };
    used.add(receipt.id);
    const difference = e.amount - receipt.amount;
    return { expected: e, receipt, status: difference === 0 ? "matched" : "amount mismatch", difference };
  });

  const matched = settlements.filter((s) => s.status === "matched");
  const expectedTotal = sum(expected.map((e) => e.amount));
  const matchedTotal = sum(matched.map((s) => s.receipt!.amount));

  const replacementSale = expected.find((e) => e.flow === "replacement");
  const replacementValue = replacementSale
    ? sum(replacementSale.lines.filter((l) => l.amount > 0).map((l) => l.amount))
    : 0;
  const resaleValue = sum(expected.filter((e) => e.flow === "resale").map((e) => e.amount));

  return {
    settlements,
    unmatchedReceipts: receipts.filter((r) => !used.has(r.id)),
    expectedTotal,
    matchedTotal,
    outstanding: expectedTotal - matchedTotal,
    allSettled: settlements.every((s) => s.status === "matched"),
    salesValue: {
      replacement: replacementValue,
      resale: resaleValue,
      total: replacementValue + resaleValue,
    },
  };
}
