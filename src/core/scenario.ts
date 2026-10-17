// Demo scenario. Every company, unit, approval, bid, pickup, meter reading, and payment
// here is simulated for the hackathon demo. Change the story here, not in the logic.
import { dollars, type Cents } from "./money";

export interface Scenario {
  simulated: true;
  seller: { name: string };
  customer: { name: string; description: string; site: { city: string; state: string; zip: string } };
  // The rack named on the support call. One unit failed; the rest passed inspection.
  rack: { id: string; model: string; units: { slot: number; serial: string }[] };
  // What the customer uploads through the support portal after the call (simulated).
  portalUpload: { photos: string[]; unitNearestLeak: string };
  // Technician dispatch promised on the support call (simulated).
  dispatch: { technicianEta: string; simulated: true };
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
    // Where any liquid came from. Leaks from the unit's own defective part are a covered
    // defect; external liquid (spills, facility plumbing) is excluded by the plan.
    liquidSource: "none" | "unit defect" | "external";
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

const RACK_SERIALS = [
  "HX80-12-01-0864", "HX80-12-02-0865", "HX80-12-03-0867", "HX80-12-04-0869",
  "HX80-12-05-0871", "HX80-12-06-0872", "HX80-12-07-0874", "HX80-12-08-0876",
];
const FAILED_SERIAL = RACK_SERIALS[4];

export const scenario: Scenario = {
  simulated: true,
  seller: { name: "Helix GPU Support" },
  customer: {
    name: "Halcyon Compute",
    description: "Small AI company running its own GPU racks",
    site: { city: "Secaucus", state: "NJ", zip: "07094" },
  },
  rack: {
    id: "Rack 12",
    model: "HX80",
    units: RACK_SERIALS.map((serial, i) => ({ slot: i + 1, serial })),
  },
  portalUpload: {
    photos: [
      "Cooling-line connection at slot 5, coolant beading at the fitting (simulated)",
      "Coolant residue on the rack drip tray below slot 5 (simulated)",
    ],
    unitNearestLeak: FAILED_SERIAL,
  },
  dispatch: { technicianEta: "2:00 PM today", simulated: true },
  failedUnit: {
    model: "HX80",
    serial: FAILED_SERIAL,
    weight: { value: 1.7, unit: "kg", source: "Intake scale reading (simulated)", simulated: true },
  },
  diagnostics: {
    reportId: "DX-7781",
    serial: FAILED_SERIAL,
    failureDate: "2026-10-17",
    failureCategory: "cooling fitting defect",
    summary:
      "Coolant leak traced to a cracked factory quick-disconnect fitting on the HX80 in slot 5. " +
      "Coolant reached that card, which no longer powers on. The other seven HX80s in Rack 12 passed inspection.",
    physicalDamage: false,
    liquidDamage: true,
    liquidSource: "unit defect",
  },
  protectionPlan: {
    id: "PP-55120",
    provider: "Sentinel Hardware Protection",
    serial: FAILED_SERIAL,
    start: "2024-03-01",
    end: "2027-02-28",
    coveredCategories: ["cooling fitting defect", "memory failure", "power delivery failure", "thermal failure"],
    credit: dollars(12_000),
  },
  replacement: {
    likeForLike: { model: "HX80", price: dollars(18_000) },
    upgrade: {
      model: "HX90",
      price: dollars(22_000),
      why: "Newer generation that uses less energy for the same workload.",
    },
    installation: dollars(500),
  },
  resale: {
    marketplace: "Agora",
    listingId: "AGR-3001",
    condition:
      "Refurbished, grade A: board cleaned and inspected, cooling fitting replaced, burn-in tested 24 hours (simulated)",
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
