// Carbon rules (see CLAUDE.md): name the activity family, use the jurisdiction's authority,
// multiply only matching units, show both sides then the difference, attach a source to
// every number. Carbon here is a sourced estimate, never a verified or certified figure.
import { describeUnit, normalizeFactor, UnitMismatchError, type FactorUnit } from "./units";

export type ActivityFamily = "materials" | "waste" | "electricity";

/** There is deliberately no "verified" status: these are sourced estimates. */
export type CarbonStatus = "estimated" | "pending";

export interface SourceRef {
  authority: string;
  edition: string;
  url: string;
  table?: string;
  row?: string;
  retrievedAt: string;
}

export interface EmissionFactor {
  value: number;
  unit: FactorUnit;
  family: ActivityFamily;
  category: string;
  pathway: string;
  jurisdiction: string;
  source: SourceRef;
}

export interface WeightRecord {
  value: number;
  unit: "kg";
  source: string;
  simulated: boolean;
}

export interface CarbonSide {
  label: string;
  family: ActivityFamily;
  status: CarbonStatus;
  kgCo2e: number | null;
  weight: WeightRecord | null;
  factor: EmissionFactor | null;
  factorKgPerKg: number | null;
  method: string;
  pendingReasons: string[];
}

export interface AvoidedCarbon {
  status: CarbonStatus;
  kgCo2e: number | null;
  manufacturing: CarbonSide;
  refurbishing: CarbonSide;
  treatmentRoute: string;
  baseline: string;
  method: string;
  pendingReasons: string[];
}

export const JURISDICTION = "US";

/** Problems with a factor that stop it being used. Empty means usable. */
export function factorProblems(
  factor: EmissionFactor | null,
  family: ActivityFamily,
): string[] {
  if (!factor) return ["Emission factor has not been fetched from the EPA yet"];
  const problems: string[] = [];
  if (factor.jurisdiction !== JURISDICTION) {
    problems.push(`Factor is for ${factor.jurisdiction}, not ${JURISDICTION}`);
  }
  if (factor.family !== family) {
    problems.push(`Factor is for the ${factor.family} family, this activity is ${family}`);
  }
  const s = factor.source;
  if (!s.authority || !s.edition || !s.url) {
    problems.push("Factor has no complete source (authority, edition, link). No source, no number");
  }
  if (!Number.isFinite(factor.value)) problems.push("Factor value is not a number");
  return problems;
}

export function carbonSide(input: {
  label: string;
  family: "materials" | "waste";
  weight: WeightRecord | null;
  factor: EmissionFactor | null;
}): CarbonSide {
  const { label, family, weight, factor } = input;
  const pendingReasons: string[] = [];

  if (!weight) pendingReasons.push("Unit weight was not recorded in kg at intake");
  else if (weight.unit !== "kg" || !(weight.value > 0)) {
    pendingReasons.push("Unit weight must be a positive number in kg");
  }
  pendingReasons.push(...factorProblems(factor, family));

  let factorKgPerKg: number | null = null;
  let conversion: string | null = null;
  if (factor && pendingReasons.length === 0) {
    try {
      const n = normalizeFactor(factor.value, factor.unit, "kg");
      factorKgPerKg = n.value;
      conversion = n.conversion;
    } catch (e) {
      if (!(e instanceof UnitMismatchError)) throw e;
      pendingReasons.push(`Units do not match: ${e.message}. Calculation stopped`);
    }
  }

  const estimated = pendingReasons.length === 0 && factorKgPerKg !== null && weight !== null;
  const method = estimated
    ? `${weight.value} kg x ${round(factorKgPerKg!)} kg CO2e per kg ` +
      `(${factor!.source.authority} ${factor!.source.edition}, ${factor!.category}, ` +
      `${factor!.pathway}, published as ${describeUnit(factor!.unit)})` +
      (conversion ? `. ${conversion}` : "")
    : "Not calculated until the missing evidence is in place";

  return {
    label,
    family,
    status: estimated ? "estimated" : "pending",
    kgCo2e: estimated ? weight.value * factorKgPerKg! : null,
    weight,
    factor,
    factorKgPerKg,
    method,
    pendingReasons,
  };
}

/** Avoided CO2e = manufacturing a new unit minus refurbishing the old one. */
export function avoidedCarbon(input: {
  weight: WeightRecord | null;
  manufacturingFactor: EmissionFactor | null;
  refurbishingFactor: EmissionFactor | null;
  treatmentRoute: string;
  baseline: string;
}): AvoidedCarbon {
  const manufacturing = carbonSide({
    label: "Manufacturing a new unit (baseline)",
    family: "materials",
    weight: input.weight,
    factor: input.manufacturingFactor,
  });
  const refurbishing = carbonSide({
    label: "Refurbishing the failed unit",
    family: "waste",
    weight: input.weight,
    factor: input.refurbishingFactor,
  });

  const pendingReasons = [
    ...manufacturing.pendingReasons.map((r) => `Manufacturing side: ${r}`),
    ...refurbishing.pendingReasons.map((r) => `Refurbishing side: ${r}`),
  ];

  const m = input.manufacturingFactor?.source;
  const r = input.refurbishingFactor?.source;
  if (m && r && (m.authority !== r.authority || m.edition !== r.edition)) {
    pendingReasons.push(
      "Both sides must be calculated the same way, but they use different sources or editions",
    );
  }

  const estimated =
    pendingReasons.length === 0 &&
    manufacturing.kgCo2e !== null &&
    refurbishing.kgCo2e !== null;

  return {
    status: estimated ? "estimated" : "pending",
    kgCo2e: estimated ? manufacturing.kgCo2e! - refurbishing.kgCo2e! : null,
    manufacturing,
    refurbishing,
    treatmentRoute: input.treatmentRoute,
    baseline: input.baseline,
    method: "Avoided CO2e = carbon of manufacturing a new unit minus carbon of refurbishing " +
      "the failed unit, both as unit weight in kg x an EPA factor in kg CO2e per kg",
    pendingReasons,
  };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
