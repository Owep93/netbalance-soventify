import type { Scenario } from "./scenario";

export interface CoverageCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface CoverageDecision {
  claimId: string;
  policyId: string;
  containerRacks: { covered: boolean; credit: number };
  gpus: { covered: boolean; reason: string };
  checks: CoverageCheck[];
}

/**
 * Applies the demo policy to the inspection finding. The LLM can explain the policy in plain
 * language, but what is covered, and for how much, comes from here.
 */
export function assessCoverage(s: Scenario, photoAttached: boolean): CoverageDecision {
  const external = s.inspection.leakSource === "external cooling system";
  const checks: CoverageCheck[] = [
    {
      label: "Inspection photo attached to the claim",
      passed: photoAttached,
      detail: photoAttached ? `Photo attached to ${s.inspection.id}` : "No photo yet. Coverage waits for evidence",
    },
    {
      label: "Container and racks are covered assets (section 4)",
      passed: photoAttached,
      detail: `Credit toward a replacement under ${s.policy.id}`,
    },
    {
      label: "GPU exclusion checked (section 7)",
      passed: true,
      detail: external
        ? "Leak came from the external cooling system, so GPU damage is excluded"
        : "Leak did not come from the external cooling system; GPU coverage needs a separate review",
    },
  ];
  return {
    claimId: s.policy.claimId,
    policyId: s.policy.id,
    containerRacks: { covered: photoAttached, credit: photoAttached ? s.policy.containerRackCredit : 0 },
    gpus: {
      covered: false,
      reason: external ? s.policy.gpuExclusion : "GPUs are not a covered asset under this policy without a separate review.",
    },
    checks,
  };
}
