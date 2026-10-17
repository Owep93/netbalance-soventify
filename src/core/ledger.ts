// Reconciles the DC-014 money flows. Five receipts settle four transactions:
//   warranty credit  -> REM-W014 (warranty remittance)
//   new sale INV-014 -> PAY-C014 (customer cash) + REM-W014 + DRAW-014 (lender draw)
//   financing referral -> FEE-014
//   used GPU sale    -> PAY-G014 (net of shipping and handling)
// REM-W014 appears in two transactions but is cash received once. Warranty credit and lender
// funding pay the invoice; neither is extra revenue. Receipts are not profit.
import { sum, type Cents } from "./money";
import type { Offer, Scenario } from "./scenario";

export type TransactionId = "warranty" | "sale" | "referral" | "gpu";

export interface ExpectedReceipt {
  id: string;
  payer: string;
  reference: string;
  description: string;
  amount: Cents;
}

export interface Receipt {
  id: string;
  payer: string;
  reference: string;
  amount: Cents;
  receivedOn: string;
  simulated: true;
}

export type SettlementStatus = "matched" | "awaiting payment" | "amount mismatch";

export interface Settlement {
  expected: ExpectedReceipt;
  receipt: Receipt | null;
  status: SettlementStatus;
  difference: Cents;
}

export interface Transaction {
  id: TransactionId;
  title: string;
  source: string;
  amount: Cents;
  receiptIds: string[];
  complete: boolean;
}

export interface CaseMoney {
  offer: Offer;
  creditApplied: Cents;
  gpuSale: { buyer: string; gross: Cents; fee: Cents; net: Cents } | null;
}

export interface Invoice {
  id: string;
  lines: { label: string; amount: Cents }[];
  total: Cents;
  funding: { label: string; receiptId: string; amount: Cents }[];
  customerCash: Cents;
}

export interface Reconciliation {
  settlements: Settlement[];
  transactions: Transaction[];
  unmatchedReceipts: Receipt[];
  expectedCash: Cents;
  cashReceived: Cents;
  outstanding: Cents;
  allSettled: boolean;
  // What you would get by wrongly adding the four transaction amounts together.
  naiveTransactionSum: Cents;
}

export function buildInvoice(s: Scenario, m: CaseMoney): Invoice {
  const o = m.offer;
  const total = o.packageRevenue + o.deploymentRevenue + (o.servicePlan?.revenue ?? 0);
  const financed = o.financing?.amount ?? 0;
  const customerCash = total - m.creditApplied - financed;
  const funding = [
    { label: "Customer cash", receiptId: s.customerPaymentId, amount: customerCash },
    ...(m.creditApplied > 0
      ? [{ label: `Warranty credit, container and racks (${s.policy.claimId})`, receiptId: s.remittanceId, amount: m.creditApplied }]
      : []),
    ...(o.financing ? [{ label: o.financing.lender, receiptId: o.financing.drawId, amount: financed }] : []),
  ];
  return {
    id: s.invoiceId,
    lines: [
      { label: `${o.name} package`, amount: o.packageRevenue },
      { label: "Deployment", amount: o.deploymentRevenue },
      ...(o.servicePlan ? [{ label: o.servicePlan.name, amount: o.servicePlan.revenue }] : []),
    ],
    total,
    funding,
    customerCash,
  };
}

export function buildExpectedReceipts(s: Scenario, m: CaseMoney): ExpectedReceipt[] {
  const inv = buildInvoice(s, m);
  const expected: ExpectedReceipt[] = [
    {
      id: s.customerPaymentId,
      payer: s.customer.name,
      reference: inv.id,
      description: "Customer cash toward the replacement invoice",
      amount: inv.customerCash,
    },
  ];
  if (m.creditApplied > 0) {
    expected.push({
      id: s.remittanceId,
      payer: s.policy.provider,
      reference: s.policy.claimId,
      description: "Warranty remittance for the container and racks credit",
      amount: m.creditApplied,
    });
  }
  const f = m.offer.financing;
  if (f) {
    expected.push({ id: f.drawId, payer: f.lender, reference: inv.id, description: "Credit line draw for the uncovered GPUs", amount: f.amount });
    expected.push({ id: f.feeReceiptId, payer: f.lender, reference: f.referralId, description: "Financing referral fee", amount: f.referralFee });
  }
  if (m.gpuSale) {
    expected.push({
      id: s.gpuLot.paymentId,
      payer: m.gpuSale.buyer,
      reference: s.gpuLot.saleId,
      description: "Used GPU lot, net of shipping and handling",
      amount: m.gpuSale.net,
    });
  }
  return expected;
}

/** The receipts the simulated payers send once each step is complete. */
export function simulatedReceipts(expected: ExpectedReceipt[], date: string): Receipt[] {
  return expected.map((e) => ({ id: e.id, payer: e.payer, reference: e.reference, amount: e.amount, receivedOn: date, simulated: true }));
}

export function reconcile(s: Scenario, m: CaseMoney, receipts: Receipt[]): Reconciliation {
  const expected = buildExpectedReceipts(s, m);
  const used = new Set<string>();
  const settlements: Settlement[] = expected.map((e) => {
    const receipt = receipts.find((r) => r.id === e.id && r.reference === e.reference && !used.has(r.id)) ?? null;
    if (!receipt) return { expected: e, receipt: null, status: "awaiting payment", difference: e.amount };
    used.add(receipt.id);
    const difference = e.amount - receipt.amount;
    return { expected: e, receipt, status: difference === 0 ? "matched" : "amount mismatch", difference };
  });
  const matched = (id: string) => settlements.some((x) => x.expected.id === id && x.status === "matched");

  const inv = buildInvoice(s, m);
  const f = m.offer.financing;
  const transactions: Transaction[] = [];
  if (m.creditApplied > 0) {
    transactions.push({
      id: "warranty", title: "Warranty credit", source: `Container and racks, ${s.policy.claimId}`,
      amount: m.creditApplied, receiptIds: [s.remittanceId], complete: matched(s.remittanceId),
    });
  }
  transactions.push({
    id: "sale", title: "New datacenter sale", source: `Replacement invoice ${inv.id}`,
    amount: inv.total, receiptIds: inv.funding.map((x) => x.receiptId),
    complete: inv.funding.every((x) => matched(x.receiptId)),
  });
  if (f) {
    transactions.push({
      id: "referral", title: "Financing referral earned", source: `Referral agreement ${f.referralId}`,
      amount: f.referralFee, receiptIds: [f.feeReceiptId], complete: matched(f.feeReceiptId),
    });
  }
  if (m.gpuSale) {
    transactions.push({
      id: "gpu", title: "Used GPU sale", source: `GPU lot ${s.gpuLot.saleId}`,
      amount: m.gpuSale.net, receiptIds: [s.gpuLot.paymentId], complete: matched(s.gpuLot.paymentId),
    });
  }

  const expectedCash = sum(expected.map((e) => e.amount));
  const cashReceived = sum(settlements.filter((x) => x.status === "matched").map((x) => x.receipt!.amount));
  return {
    settlements,
    transactions,
    unmatchedReceipts: receipts.filter((r) => !used.has(r.id)),
    expectedCash,
    cashReceived,
    outstanding: expectedCash - cashReceived,
    allSettled: settlements.every((x) => x.status === "matched") && receipts.every((r) => used.has(r.id)),
    naiveTransactionSum: sum(transactions.map((t) => t.amount)),
  };
}
