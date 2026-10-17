import type { Scenario } from "./scenario";

export interface PlanCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface PlanVerification {
  verified: boolean;
  planId: string;
  checks: PlanCheck[];
}

/**
 * Checks the diagnostics report against the protection plan terms. The LLM can explain
 * the policy in plain language, but whether the credit is issued comes from these checks.
 */
export function verifyProtectionPlan(
  diagnostics: Scenario["diagnostics"],
  plan: Scenario["protectionPlan"],
): PlanVerification {
  const inTerm = diagnostics.failureDate >= plan.start && diagnostics.failureDate <= plan.end;
  const covered = plan.coveredCategories.includes(diagnostics.failureCategory);

  const checks: PlanCheck[] = [
    {
      label: "Serial number matches the plan",
      passed: diagnostics.serial === plan.serial,
      detail: `Diagnostics ${diagnostics.serial}, plan ${plan.serial}`,
    },
    {
      label: "Failure happened during the plan term",
      passed: inTerm,
      detail: `Failed ${diagnostics.failureDate}, plan runs ${plan.start} to ${plan.end}`,
    },
    {
      label: "Failure type is covered",
      passed: covered,
      detail: `"${diagnostics.failureCategory}" ${covered ? "is" : "is not"} in the covered list`,
    },
    {
      label: "No physical or liquid damage",
      passed: !diagnostics.physicalDamage && !diagnostics.liquidDamage,
      detail: diagnostics.physicalDamage || diagnostics.liquidDamage
        ? "Diagnostics found damage the plan excludes"
        : "Diagnostics found no excluded damage",
    },
  ];

  return { verified: checks.every((c) => c.passed), planId: plan.id, checks };
}
