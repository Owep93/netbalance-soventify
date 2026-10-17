import { describe, expect, it } from "vitest";
import { avoidedCarbon, carbonSide, type EmissionFactor } from "../carbon";
import { compare, contribution } from "../contribution";
import { assessCoverage } from "../coverage";
import { approveTransfer, checkTransfer } from "../credit";
import { energyBonus } from "../energy";
import { buildExpectedReceipts, buildInvoice, reconcile, simulatedReceipts, type CaseMoney } from "../ledger";
import { dollars } from "../money";
import { scenario, type Scenario } from "../scenario";

// Test-only factors. These numbers are made up to exercise the arithmetic and are never
// shown in the app. Real factors are fetched from the EPA at calculation time.
const testSource = {
  authority: "TEST AUTHORITY",
  edition: "test edition",
  url: "https://example.test/factors",
  retrievedAt: "2026-10-17T00:00:00Z",
};
const manufacturing: EmissionFactor = {
  value: 10, unit: { co2e: "kg", per: "kg" }, family: "materials",
  category: "Test electronics", pathway: "Manufacture", jurisdiction: "US", source: testSource,
};
const refurbishing: EmissionFactor = {
  value: 1, unit: { co2e: "kg", per: "kg" }, family: "waste",
  category: "Test electronics", pathway: "Refurbish", jurisdiction: "US", source: testSource,
};
const grid: EmissionFactor = {
  value: 1000, unit: { co2e: "lb", per: "MWh" }, family: "electricity",
  category: "Test subregion", pathway: "Grid output", jurisdiction: "US", source: testSource,
};

const withScenario = (patch: (s: Scenario) => void): Scenario => {
  const copy = structuredClone(scenario);
  patch(copy);
  return copy;
};

// The demo path: integrated package with financing, credit approved, best-net GPU sale.
const demo: CaseMoney = {
  offer: scenario.offers.integrated,
  creditApplied: dollars(200_000),
  gpuSale: { buyer: "GPU Circular", gross: dollars(31_000), fee: dollars(1_000), net: dollars(30_000) },
};
const allPaid = () => simulatedReceipts(buildExpectedReceipts(scenario, demo), scenario.date);

describe("coverage", () => {
  it("covers container and racks for $200,000 once the photo is attached", () => {
    const c = assessCoverage(scenario, true);
    expect(c.containerRacks).toEqual({ covered: true, credit: dollars(200_000) });
    expect(c.gpus.covered).toBe(false);
    expect(c.gpus.reason).toMatch(/external cooling/);
  });

  it("gives no credit before there is evidence", () => {
    expect(assessCoverage(scenario, false).containerRacks.credit).toBe(0);
  });
});

describe("credit transfer guardrail", () => {
  const t = scenario.creditTransfer;
  const req = { amount: dollars(200_000), source: t.source, destination: t.destination };

  it("never moves credit between accounts without a person's approval", () => {
    expect(checkTransfer(scenario, req, dollars(200_000), null).status).toBe("needs approval");
  });

  it("applies the transfer once that exact transfer is approved", () => {
    const approval = approveTransfer(scenario, req, "Finance reviewer");
    expect(checkTransfer(scenario, req, dollars(200_000), approval).status).toBe("applied");
  });

  it("does not let an approval for one amount cover another", () => {
    const approval = approveTransfer(scenario, { ...req, amount: dollars(100_000) }, "Finance reviewer");
    expect(checkTransfer(scenario, req, dollars(200_000), approval).status).toBe("needs approval");
  });

  it("refuses a destination other than the customer's replacement order", () => {
    const d = checkTransfer(scenario, { ...req, destination: "ACCT-NEW-4471" }, dollars(200_000), null);
    expect(d.status).toBe("refused");
  });

  it("refuses more than the covered credit", () => {
    expect(checkTransfer(scenario, { ...req, amount: dollars(250_000) }, dollars(200_000), null).status).toBe("refused");
  });
});

describe("money demo targets", () => {
  it("funds the $680,000 invoice with $280,000 cash, $200,000 warranty, $200,000 credit line", () => {
    const inv = buildInvoice(scenario, demo);
    expect(inv.lines.map((l) => l.amount)).toEqual([dollars(600_000), dollars(20_000), dollars(60_000)]);
    expect(inv.total).toBe(dollars(680_000));
    expect(inv.customerCash).toBe(dollars(280_000));
    expect(inv.funding.map((f) => f.amount)).toEqual([dollars(280_000), dollars(200_000), dollars(200_000)]);
  });

  it("charges $320,000 cash for the standard package with no financing", () => {
    const inv = buildInvoice(scenario, { ...demo, offer: scenario.offers.standard });
    expect(inv.total).toBe(dollars(520_000));
    expect(inv.customerCash).toBe(dollars(320_000));
    expect(inv.funding).toHaveLength(2);
  });

  it("reconciles $712,000 received across four transactions, nothing outstanding", () => {
    const r = reconcile(scenario, demo, allPaid());
    expect(r.cashReceived).toBe(dollars(712_000));
    expect(r.outstanding).toBe(0);
    expect(r.allSettled).toBe(true);
    expect(r.transactions.map((t) => [t.id, t.amount, t.complete])).toEqual([
      ["warranty", dollars(200_000), true],
      ["sale", dollars(680_000), true],
      ["referral", dollars(2_000), true],
      ["gpu", dollars(30_000), true],
    ]);
  });

  it("does not add the four transactions together as cash", () => {
    const r = reconcile(scenario, demo, allPaid());
    expect(r.naiveTransactionSum).toBe(dollars(912_000));
    expect(r.cashReceived).not.toBe(r.naiveTransactionSum);
  });

  it("leaves the warranty and the sale open until the remittance arrives", () => {
    const r = reconcile(scenario, demo, allPaid().filter((x) => x.id !== scenario.remittanceId));
    expect(r.outstanding).toBe(dollars(200_000));
    expect(r.transactions.find((t) => t.id === "warranty")!.complete).toBe(false);
    expect(r.transactions.find((t) => t.id === "sale")!.complete).toBe(false);
    expect(r.transactions.find((t) => t.id === "gpu")!.complete).toBe(true);
  });

  it("flags a short payment and a receipt that matches nothing", () => {
    const receipts = allPaid().map((x) => (x.id === scenario.gpuLot.paymentId ? { ...x, amount: dollars(29_000) } : x));
    receipts.push({ ...receipts[0], id: "PAY-X999", reference: "INV-999" });
    const r = reconcile(scenario, demo, receipts);
    expect(r.settlements.find((x) => x.expected.id === scenario.gpuLot.paymentId)!.status).toBe("amount mismatch");
    expect(r.unmatchedReceipts.map((x) => x.id)).toEqual(["PAY-X999"]);
    expect(r.allSettled).toBe(false);
  });

  it("shows +$104,000 contribution, +80.0% over the baseline", () => {
    const c = compare(
      contribution(scenario.offers.standard, scenario.gpuLot.baselineNet, 0),
      contribution(scenario.offers.integrated, dollars(30_000), dollars(2_000)),
    );
    expect(c.baseline.total).toBe(dollars(130_000));
    expect(c.selected.total).toBe(dollars(234_000));
    expect(c.improvement).toBe(dollars(104_000));
    expect(c.improvementPct).toBe(80);
  });

  it("gets $42,000 of the improvement from the service plan ($60,000 less $18,000 to deliver)", () => {
    const withPlan = contribution(scenario.offers.integrated, dollars(30_000), dollars(2_000));
    const withoutPlan = contribution({ ...scenario.offers.integrated, servicePlan: null }, dollars(30_000), dollars(2_000));
    expect(withPlan.total - withoutPlan.total).toBe(dollars(42_000));
  });

  it("does not count loan principal or the warranty credit as contribution", () => {
    const c = contribution(scenario.offers.integrated, dollars(30_000), dollars(2_000));
    expect(c.lines.map((l) => l.label).join(" ")).not.toMatch(/warranty|draw|loan/i);
  });

  it("treats a leak from the unit's own defect differently from external cooling", () => {
    const s = withScenario((x) => { x.inspection.leakSource = "unit defect"; });
    expect(assessCoverage(s, true).gpus.reason).not.toMatch(/external cooling/);
  });
});

describe("carbon record", () => {
  const weight = scenario.gpuLot.weight;
  const base = { weight, treatmentRoute: "Refurbish", baseline: "New modules" };

  it("stays pending until EPA factors are fetched", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: null, refurbishingFactor: null });
    expect(c.status).toBe("pending");
    expect(c.kgCo2e).toBeNull();
  });

  it("stays pending when lot weight was not recorded at intake", () => {
    const c = avoidedCarbon({ ...base, weight: null, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(c.status).toBe("pending");
    expect(c.pendingReasons.join(" ")).toMatch(/weight/);
  });

  it("shows both sides, then the difference", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(c.status).toBe("estimated");
    expect(c.manufacturing.kgCo2e).toBeCloseTo(160);
    expect(c.refurbishing.kgCo2e).toBeCloseTo(16);
    expect(c.kgCo2e).toBeCloseTo(144);
  });

  it("converts metric tons per short ton exactly", () => {
    const f: EmissionFactor = { ...manufacturing, value: 1, unit: { co2e: "metric ton", per: "short ton" } };
    expect(carbonSide({ label: "x", family: "materials", weight, factor: f }).factorKgPerKg).toBeCloseTo(1000 / 907.18474, 10);
  });

  it("stops when units do not match (per dollar factor against kg)", () => {
    const f: EmissionFactor = { ...manufacturing, unit: { co2e: "kg", per: "USD" } };
    const side = carbonSide({ label: "x", family: "materials", weight, factor: f });
    expect(side.status).toBe("pending");
    expect(side.pendingReasons.join(" ")).toMatch(/Units do not match/);
  });

  it("refuses a factor from the wrong country, family, or with no source", () => {
    expect(carbonSide({ label: "x", family: "materials", weight, factor: { ...manufacturing, jurisdiction: "UK" } }).status).toBe("pending");
    expect(carbonSide({ label: "x", family: "waste", weight, factor: manufacturing }).status).toBe("pending");
    expect(carbonSide({ label: "x", family: "materials", weight, factor: { ...manufacturing, source: { ...testSource, url: "" } } }).status).toBe("pending");
  });

  it("requires both sides to use the same authority and material category", () => {
    const other: EmissionFactor = { ...refurbishing, category: "Desktop CPUs" };
    expect(avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: other }).status).toBe("pending");
  });

  it("never labels carbon as verified", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(JSON.stringify(c)).not.toMatch(/verified/i);
  });
});

describe("energy bonus", () => {
  it("shows avoided energy cost against the metered baseline", () => {
    const e = energyBonus(scenario.energy, null);
    expect(e.avoidedKwhPerMonth).toBeCloseTo(7_200);
    expect(e.avoidedCostPerMonth).toBe(dollars(1_008));
    expect(e.carbon.status).toBe("pending");
  });

  it("converts a grid factor in lb per MWh to kg per kWh", () => {
    const e = energyBonus(scenario.energy, grid);
    expect(e.carbon.kgCo2ePerMonth).toBeCloseTo(7_200 * 0.45359237, 6);
  });
});
