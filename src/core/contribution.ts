// The supplier's transaction contribution for one replacement order, before tax, overhead,
// and unmodeled costs. Loan principal is not contribution; the referral fee is separate income.
import type { Cents } from "./money";
import type { Offer } from "./scenario";

export interface ContributionLine {
  label: string;
  amount: Cents;
}

export interface Contribution {
  lines: ContributionLine[];
  total: Cents;
}

export function contribution(offer: Offer, gpuNet: Cents, referral: Cents): Contribution {
  const lines: ContributionLine[] = [
    { label: "Replacement package revenue", amount: offer.packageRevenue },
    { label: "Deployment revenue", amount: offer.deploymentRevenue },
    { label: "Package cost", amount: -offer.packageCost },
    { label: "Deployment cost", amount: -offer.deploymentCost },
    { label: "Service plan revenue", amount: offer.servicePlan?.revenue ?? 0 },
    { label: "Service plan cost", amount: -(offer.servicePlan?.cost ?? 0) },
    { label: "Net GPU recovery", amount: gpuNet },
    { label: "Financing referral income", amount: referral },
  ];
  return { lines, total: lines.reduce((t, l) => t + l.amount, 0) };
}

export interface Comparison {
  baseline: Contribution;
  selected: Contribution;
  improvement: Cents;
  // Percent improvement over the baseline, to one decimal place.
  improvementPct: number;
}

export function compare(baseline: Contribution, selected: Contribution): Comparison {
  const improvement = selected.total - baseline.total;
  return { baseline, selected, improvement, improvementPct: Math.round((improvement / baseline.total) * 1000) / 10 };
}
