// The warranty credit moves from the warranty credit account to the replacement order.
// Moving credit between accounts never happens automatically: a person must approve that
// exact amount, source, and destination. A destination other than the customer's own
// replacement order is refused outright and cannot be approved.
import { formatUsd, type Cents } from "./money";
import type { Scenario } from "./scenario";

export interface TransferRequest {
  amount: Cents;
  source: string;
  destination: string;
}

export interface Approval extends TransferRequest {
  id: string;
  scope: string;
  approver: string;
  approvedAt: string;
}

export type TransferDecision =
  | { status: "applied"; approval: Approval }
  | { status: "needs approval"; reasons: string[] }
  | { status: "refused"; reasons: string[] };

export function checkTransfer(
  s: Scenario,
  req: TransferRequest,
  coveredCredit: Cents,
  approval: Approval | null,
): TransferDecision {
  const t = s.creditTransfer;
  const refusals: string[] = [];
  if (req.source !== t.source) refusals.push(`Source ${req.source} is not the warranty credit account ${t.source}`);
  if (req.destination !== t.destination) {
    refusals.push(`Destination ${req.destination} is not the customer's replacement order ${t.destination}`);
  }
  if (req.amount <= 0 || req.amount > coveredCredit) {
    refusals.push(`Amount ${formatUsd(req.amount)} is more than the covered credit ${formatUsd(coveredCredit)}`);
  }
  if (refusals.length) return { status: "refused", reasons: refusals };

  const matches =
    approval &&
    approval.amount === req.amount &&
    approval.source === req.source &&
    approval.destination === req.destination;
  if (!matches) {
    return {
      status: "needs approval",
      reasons: ["Credit cannot move between accounts automatically. A finance reviewer must approve this exact transfer."],
    };
  }
  return { status: "applied", approval };
}

export function approveTransfer(s: Scenario, req: TransferRequest, approver: string): Approval {
  return {
    ...req,
    id: s.creditTransfer.approvalId,
    scope: s.creditTransfer.scope,
    approver,
    approvedAt: new Date().toISOString(),
  };
}
