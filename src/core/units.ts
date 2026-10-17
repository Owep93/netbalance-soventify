// Exact conversion constants. A factor is only used when its denominator has the
// same dimension as the activity data (mass for mass, energy for energy). Anything
// else, such as a per-dollar or per-unit factor applied to kg, is a unit mismatch.

export const MASS_TO_KG = {
  kg: 1,
  "metric ton": 1000,
  "short ton": 907.18474,
  lb: 0.45359237,
} as const;

export const ENERGY_TO_KWH = {
  kWh: 1,
  MWh: 1000,
} as const;

export type MassUnit = keyof typeof MASS_TO_KG;
export type EnergyUnit = keyof typeof ENERGY_TO_KWH;
export type FactorDenominator = MassUnit | EnergyUnit | "USD" | "unit";

export interface FactorUnit {
  co2e: MassUnit;
  per: FactorDenominator;
}

export class UnitMismatchError extends Error {}

function isMass(u: string): u is MassUnit {
  return u in MASS_TO_KG;
}

function isEnergy(u: string): u is EnergyUnit {
  return u in ENERGY_TO_KWH;
}

export function describeUnit(unit: FactorUnit): string {
  return `${unit.co2e} CO2e per ${unit.per}`;
}

/**
 * Converts a factor to kg CO2e per kg (activity in mass) or kg CO2e per kWh
 * (activity in energy). Throws UnitMismatchError when the dimensions differ.
 */
export function normalizeFactor(
  value: number,
  unit: FactorUnit,
  target: "kg" | "kWh",
): { value: number; conversion: string | null } {
  const co2eToKg = MASS_TO_KG[unit.co2e];
  let perToTarget: number;

  if (target === "kg") {
    if (!isMass(unit.per)) {
      throw new UnitMismatchError(
        `factor is in ${describeUnit(unit)} but the activity is measured in kg`,
      );
    }
    perToTarget = MASS_TO_KG[unit.per];
  } else {
    if (!isEnergy(unit.per)) {
      throw new UnitMismatchError(
        `factor is in ${describeUnit(unit)} but the activity is measured in kWh`,
      );
    }
    perToTarget = ENERGY_TO_KWH[unit.per];
  }

  const converted = (value * co2eToKg) / perToTarget;
  const conversion =
    unit.co2e === "kg" && unit.per === target
      ? null
      : `${describeUnit(unit)} converted to kg CO2e per ${target} ` +
        `(1 ${unit.co2e} = ${co2eToKg} kg; 1 ${unit.per} = ${perToTarget} ${target})`;

  return { value: converted, conversion };
}
