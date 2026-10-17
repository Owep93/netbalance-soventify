import { avoidedCarbon, type AvoidedCarbon, type EmissionFactor } from "./carbon";
import { energyBonus, type EnergyBonus } from "./energy";
import { buildExpectedReceipts, reconcile, upgradeDelta, type Reconciliation } from "./ledger";
import type { Cents } from "./money";
import type { Scenario } from "./scenario";
import { verifyProtectionPlan, type PlanVerification } from "./warranty";

export interface Factors {
  manufacturing: EmissionFactor | null;
  refurbishing: EmissionFactor | null;
  grid: EmissionFactor | null;
}

export interface RecoveryReport {
  simulated: boolean;
  plan: PlanVerification;
  upgradeDelta: Cents;
  reconciliation: Reconciliation;
  carbon: AvoidedCarbon;
  energy: EnergyBonus;
}

/** The single view: three money flows reconciled plus the carbon record. */
export function buildRecoveryReport(s: Scenario, factors: Factors): RecoveryReport {
  const plan = verifyProtectionPlan(s.diagnostics, s.protectionPlan);
  const expected = buildExpectedReceipts(s, plan.verified);

  return {
    simulated: s.simulated,
    plan,
    upgradeDelta: upgradeDelta(s),
    reconciliation: reconcile(expected, s.receipts),
    carbon: avoidedCarbon({
      weight: s.failedUnit.weight,
      manufacturingFactor: factors.manufacturing,
      refurbishingFactor: factors.refurbishing,
      treatmentRoute: `Refurbish and resell on ${s.resale.marketplace} (reuse)`,
      baseline: `Manufacturing a new ${s.failedUnit.model}-class unit of the same weight`,
    }),
    energy: energyBonus(s.energy, factors.grid),
  };
}
