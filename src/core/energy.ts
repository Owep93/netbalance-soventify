import { factorProblems, type CarbonStatus, type EmissionFactor } from "./carbon";
import { type Cents } from "./money";
import type { Scenario } from "./scenario";
import { normalizeFactor, UnitMismatchError } from "./units";

export interface EnergyBonus {
  baselineKwhPerJob: number;
  upgradeKwhPerJob: number;
  jobsPerMonth: number;
  avoidedKwhPerMonth: number;
  avoidedCostPerMonth: Cents;
  meterSource: string;
  rateSource: string;
  simulated: boolean;
  carbon: {
    status: CarbonStatus;
    kgCo2ePerMonth: number | null;
    factor: EmissionFactor | null;
    method: string;
    pendingReasons: string[];
  };
}

/** Avoided energy from metered kWh per job against the old unit as the baseline. */
export function energyBonus(e: Scenario["energy"], gridFactor: EmissionFactor | null): EnergyBonus {
  const avoidedKwhPerMonth = (e.baselineKwhPerJob - e.upgradeKwhPerJob) * e.jobsPerMonth;
  const avoidedCostPerMonth = Math.round(avoidedKwhPerMonth * e.rateUsdPerKwh * 100);

  const pendingReasons = factorProblems(gridFactor, "electricity");
  let kgPerKwh: number | null = null;
  let conversion: string | null = null;
  if (gridFactor && pendingReasons.length === 0) {
    try {
      const n = normalizeFactor(gridFactor.value, gridFactor.unit, "kWh");
      kgPerKwh = n.value;
      conversion = n.conversion;
    } catch (err) {
      if (!(err instanceof UnitMismatchError)) throw err;
      pendingReasons.push(`Units do not match: ${err.message}. Calculation stopped`);
    }
  }

  const estimated = pendingReasons.length === 0 && kgPerKwh !== null;

  return {
    baselineKwhPerJob: e.baselineKwhPerJob,
    upgradeKwhPerJob: e.upgradeKwhPerJob,
    jobsPerMonth: e.jobsPerMonth,
    avoidedKwhPerMonth,
    avoidedCostPerMonth,
    meterSource: e.meterSource,
    rateSource: e.rateSource,
    simulated: e.simulated,
    carbon: {
      status: estimated ? "estimated" : "pending",
      kgCo2ePerMonth: estimated ? avoidedKwhPerMonth * kgPerKwh! : null,
      factor: gridFactor,
      method: estimated
        ? `${avoidedKwhPerMonth} kWh x ${kgPerKwh} kg CO2e per kWh ` +
          `(${gridFactor!.source.authority} ${gridFactor!.source.edition}, ${gridFactor!.category})` +
          (conversion ? `. ${conversion}` : "")
        : "Not calculated until the missing evidence is in place",
      pendingReasons,
    },
  };
}
