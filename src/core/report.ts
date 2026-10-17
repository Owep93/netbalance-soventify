import { avoidedCarbon, type AvoidedCarbon, type EmissionFactor } from "./carbon";
import { compare, contribution, type Comparison } from "./contribution";
import { energyBonus, type EnergyBonus } from "./energy";
import { reconcile, type CaseMoney, type Receipt, type Reconciliation } from "./ledger";
import type { Scenario } from "./scenario";

export interface Factors {
  manufacturing: EmissionFactor | null;
  refurbishing: EmissionFactor | null;
  grid: EmissionFactor | null;
}

export interface CfoReport {
  reconciliation: Reconciliation;
  comparison: Comparison;
  carbon: AvoidedCarbon;
  energy: EnergyBonus;
}

/** The CFO view: money reconciled, contribution against the baseline, and the carbon record. */
export function buildCfoReport(s: Scenario, m: CaseMoney, receipts: Receipt[], factors: Factors): CfoReport {
  const baseline = contribution(s.offers.standard, s.gpuLot.baselineNet, 0);
  const selected = contribution(m.offer, m.gpuSale?.net ?? 0, m.offer.financing?.referralFee ?? 0);
  return {
    reconciliation: reconcile(s, m, receipts),
    comparison: compare(baseline, selected),
    carbon: avoidedCarbon({
      weight: s.gpuLot.weight,
      manufacturingFactor: factors.manufacturing,
      refurbishingFactor: factors.refurbishing,
      treatmentRoute: m.gpuSale
        ? `Sold to ${m.gpuSale.buyer} for refurbishment or parts. Holds only if the buyer refurbishes the modules for reuse`
        : "Not sold yet",
      baseline: `Manufacturing ${s.rack.units.length} new GPU modules of the same total weight`,
    }),
    energy: energyBonus(s.energy, factors.grid),
  };
}
