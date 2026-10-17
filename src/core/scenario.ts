// Demo scenario. Every company, unit, approval, bid, pickup, meter reading, and payment
// here is simulated for the hackathon demo. Change the story here, not in the logic.
import { dollars, type Cents } from "./money";

export interface Scenario {
  simulated: true;
  seller: { name: string };
  customer: { name: string; description: string; site: { city: string; state: string; zip: string } };
  failedUnit: {
    model: string;
    serial: string;
    // Recorded in kg at intake. Null means not recorded yet, which keeps carbon pending.
    weight: { value: number; unit: "kg"; source: string; simulated: boolean } | null;
  };
  diagnostics: {
    reportId: string;
    serial: string;
    failureDate: string;
    failureCategory: string;
    summary: string;
    physicalDamage: boolean;
    liquidDamage: boolean;
  };
  protectionPlan: {
    id: string;
    provider: string;
    serial: string;
    start: string;
    end: string;
    coveredCategories: string[];
    credit: Cents;
  };
  replacement: {
    likeForLike: { model: string; price: Cents };
    upgrade: { model: string; price: Cents; why: string };
    installation: Cents;
  };
  resale: {
    marketplace: string;
    listingId: string;
    condition: string;
    askingPrice: Cents;
    feeRate: number;
    simulatedBids: { buyer: string; amount: Cents }[];
    // Expected net payout: highest bid minus the Agora fee. A test keeps these in step.
    netPayout: Cents;
  };
  ids: { invoice: string; warrantyClaim: string };
  receipts: { id: string; payer: string; reference: string; amount: Cents; receivedOn: string; simulated: true }[];
  energy: {
    meterSource: string;
    baselineKwhPerJob: number;
    upgradeKwhPerJob: number;
    jobsPerMonth: number;
    rateUsdPerKwh: number;
    rateSource: string;
    simulated: boolean;
  };
}

export const scenario: Scenario = {
  simulated: true,
  seller: { name: "NetBalance GPU Services" },
  customer: {
    name: "Halcyon Compute",
    description: "Small AI company running its own GPU racks",
    site: { city: "Secaucus", state: "NJ", zip: "07094" },
  },
  failedUnit: {
    model: "GX-400",
    serial: "GX4-23-00871",
    weight: { value: 1.7, unit: "kg", source: "Intake scale reading (simulated)", simulated: true },
  },
  diagnostics: {
    reportId: "DX-7781",
    serial: "GX4-23-00871",
    failureDate: "2026-10-16",
    failureCategory: "memory failure",
    summary: "Uncorrectable ECC errors on two memory stacks, then thermal shutdown under load.",
    physicalDamage: false,
    liquidDamage: false,
  },
  protectionPlan: {
    id: "PP-55120",
    provider: "Sentinel Hardware Protection",
    serial: "GX4-23-00871",
    start: "2024-03-01",
    end: "2027-02-28",
    coveredCategories: ["memory failure", "power delivery failure", "thermal failure"],
    credit: dollars(12_000),
  },
  replacement: {
    likeForLike: { model: "GX-400", price: dollars(18_000) },
    upgrade: {
      model: "GX-500",
      price: dollars(22_000),
      why: "Newer generation that uses less energy for the same workload.",
    },
    installation: dollars(500),
  },
  resale: {
    marketplace: "Agora",
    listingId: "AGR-3001",
    condition: "Refurbished, grade A: memory stacks replaced, burn-in tested 24 hours (simulated)",
    askingPrice: dollars(5_200),
    feeRate: 0.1,
    simulatedBids: [
      { buyer: "Brightline Labs (simulated)", amount: dollars(4_200) },
      { buyer: "Coldwater Compute (simulated)", amount: dollars(4_750) },
      { buyer: "Parallel Refurb Co (simulated)", amount: dollars(5_000) },
    ],
    netPayout: dollars(4_500),
  },
  ids: { invoice: "INV-1001", warrantyClaim: "CLM-2001" },
  receipts: [
    { id: "RCPT-01", payer: "Halcyon Compute", reference: "INV-1001", amount: dollars(10_500), receivedOn: "2026-10-17", simulated: true },
    { id: "RCPT-02", payer: "Sentinel Hardware Protection", reference: "CLM-2001", amount: dollars(12_000), receivedOn: "2026-10-17", simulated: true },
    { id: "RCPT-03", payer: "Agora", reference: "AGR-3001", amount: dollars(4_500), receivedOn: "2026-10-17", simulated: true },
  ],
  energy: {
    meterSource: "Rack meter readings, same benchmark job on both units (simulated)",
    baselineKwhPerJob: 12.0,
    upgradeKwhPerJob: 8.4,
    jobsPerMonth: 2_000,
    rateUsdPerKwh: 0.14,
    rateSource: "Customer electricity contract rate (simulated)",
    simulated: true,
  },
};
