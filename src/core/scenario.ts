// Demo scenario DC-014, from the team's netbalance-datacenter-demo.html. Every company,
// product, warranty provision, price, cost, bid, financing term, dispatch, meter reading,
// and payment here is simulated for the hackathon demo. AWS is an illustrative caller and
// J.P. Morgan an illustrative lender, not claimed customers or partners. Change the story
// here, not in the logic.
import { dollars, type Cents } from "./money";

export type OfferId = "standard" | "integrated";

export interface Offer {
  id: OfferId;
  name: string;
  oneLine: string;
  image: string;
  packageRevenue: Cents;
  deploymentRevenue: Cents;
  packageCost: Cents;
  deploymentCost: Cents;
  // Optional service plan sold with the package (simulated price and delivery cost).
  servicePlan: { name: string; revenue: Cents; cost: Cents } | null;
  // Financing for the uncovered GPUs. Null means the customer pays from cash.
  financing: { lender: string; amount: Cents; drawId: string; referralFee: Cents; referralId: string; feeReceiptId: string } | null;
}

export interface Bid {
  buyer: string;
  gross: Cents;
  // Shipping and handling the buyer withholds from the payment.
  fee: Cents;
}

export interface Scenario {
  simulated: true;
  caseId: string;
  date: string;
  seller: { name: string };
  customer: { name: string; contact: string; site: { label: string; city: string; state: string; zip: string } };
  rack: { id: string; model: string; units: { slot: number; serial: string }[] };
  dispatch: { technician: string; onSiteBy: string };
  inspection: {
    id: string;
    photo: string;
    finding: string;
    leakSource: "external cooling system" | "unit defect";
  };
  policy: {
    id: string;
    provider: string;
    claimId: string;
    // Section 4: container and racks are covered, with this credit toward a replacement.
    containerRackCredit: Cents;
    // Section 7: GPUs damaged by a leak from the external cooling system are excluded.
    gpuExclusion: string;
  };
  creditTransfer: { source: string; sourceLabel: string; destination: string; destinationLabel: string; approvalId: string; scope: string };
  offers: Record<OfferId, Offer>;
  invoiceId: string;
  remittanceId: string;
  customerPaymentId: string;
  gpuLot: {
    saleId: string;
    paymentId: string;
    pickupId: string;
    pickupWindow: string;
    condition: string;
    bids: Bid[];
    // Weight of the whole lot in kg, recorded at intake. Null keeps carbon pending.
    weight: { value: number; unit: "kg"; source: string; simulated: boolean } | null;
    // Assumed net recovery without Netbalance, for the CFO comparison.
    baselineNet: Cents;
  };
  // Illustrative estimate of the same case handled by hand, for the CFO slide. Not measured.
  manualProcess: {
    people: string;
    roles: string;
    handsOnHours: string;
    elapsed: string;
    humanTouchpoints: string[];
  };
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
  caseId: "DC-014",
  date: "2026-10-17",
  seller: { name: "Helix Data Center Support" },
  customer: {
    name: "AWS",
    contact: "Alex Morgan",
    site: { label: "Ashburn demo site", city: "Ashburn", state: "VA", zip: "20147" },
  },
  rack: {
    id: "Rack 12",
    model: "H100 80GB",
    units: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, serial: `GPU-014-0${i + 1}` })),
  },
  dispatch: { technician: "Maya Chen", onSiteBy: "2:00 PM today" },
  inspection: {
    id: "INS-014",
    photo: "/demo/inspection-leak.jpg",
    finding: "Coolant exposure to 8 GPU modules. The leak originated in the external cooling system.",
    leakSource: "external cooling system",
  },
  policy: {
    id: "DC-PROTECT",
    provider: "DC-PROTECT warranty program",
    claimId: "CLM-014",
    containerRackCredit: dollars(200_000),
    gpuExclusion: "Section 7 excludes consequential GPU damage originating from the external cooling system.",
  },
  creditTransfer: {
    source: "WC-014",
    sourceLabel: "AWS warranty credits",
    destination: "RO-014",
    destinationLabel: "AWS replacement order",
    approvalId: "APR-014",
    scope: "Container and racks only",
  },
  offers: {
    standard: {
      id: "standard",
      name: "Original module",
      oneLine: "Separate cooling skid and external pipework",
      image: "/demo/external-module.jpg",
      packageRevenue: dollars(500_000),
      deploymentRevenue: dollars(20_000),
      packageCost: dollars(390_000),
      deploymentCost: dollars(10_000),
      servicePlan: null,
      financing: null,
    },
    integrated: {
      id: "integrated",
      name: "New integrated module",
      oneLine: "Fewer exposed connections, unified cooling",
      image: "/demo/integrated-module.jpg",
      packageRevenue: dollars(600_000),
      deploymentRevenue: dollars(20_000),
      packageCost: dollars(450_000),
      deploymentCost: dollars(10_000),
      // Leak sensors on every cooling connection, remote monitoring, and scheduled
      // maintenance: the reason the customer wants it after this leak. Simulated terms.
      servicePlan: { name: "3-year leak monitoring and cooling maintenance plan", revenue: dollars(60_000), cost: dollars(18_000) },
      financing: {
        lender: "J.P. Morgan (simulated credit line)",
        amount: dollars(200_000),
        drawId: "DRAW-014",
        referralFee: dollars(2_000),
        referralId: "REF-014",
        feeReceiptId: "FEE-014",
      },
    },
  },
  invoiceId: "INV-014",
  remittanceId: "REM-W014",
  customerPaymentId: "PAY-C014",
  gpuLot: {
    saleId: "SALE-014",
    paymentId: "PAY-G014",
    pickupId: "PU-014",
    pickupWindow: "4 to 5 PM ET today",
    condition: "8 x H100 80GB, coolant-exposed, sold as-is for refurbishment or parts",
    bids: [
      { buyer: "Compute Renewal", gross: dollars(32_000), fee: dollars(2_500) },
      { buyer: "GPU Circular", gross: dollars(31_000), fee: dollars(1_000) },
      { buyer: "Silicon Recovery", gross: dollars(30_000), fee: dollars(500) },
    ],
    weight: { value: 16, unit: "kg", source: "Intake scale reading, whole lot (simulated)", simulated: true },
    baselineNet: dollars(10_000),
  },
  manualProcess: {
    people: "8 to 10",
    roles: "support, dispatch, claims, accounts receivable, controller, sales, financing, asset recovery, accounting, FP&A, sustainability",
    handsOnHours: "30 to 50",
    elapsed: "3 to 6 weeks",
    humanTouchpoints: ["the caller", "the on-site technician", "one finance reviewer"],
  },
  energy: {
    meterSource: "Facility meter, same benchmark job on old and new module (simulated)",
    baselineKwhPerJob: 12.0,
    upgradeKwhPerJob: 8.4,
    jobsPerMonth: 2_000,
    rateUsdPerKwh: 0.14,
    rateSource: "Customer electricity contract rate (simulated)",
    simulated: true,
  },
};
