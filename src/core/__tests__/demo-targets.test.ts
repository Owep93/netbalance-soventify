import { describe, expect, it } from "vitest";
import { avoidedCarbon, carbonSide, type EmissionFactor } from "../carbon";
import { energyBonus } from "../energy";
import { buildExpectedReceipts, reconcile } from "../ledger";
import { dollars } from "../money";
import { buildRecoveryReport } from "../report";
import { scenario, type Scenario } from "../scenario";
import { verifyProtectionPlan } from "../warranty";

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

function withScenario(patch: (s: Scenario) => void): Scenario {
  const copy = structuredClone(scenario);
  patch(copy);
  return copy;
}

describe("money demo targets", () => {
  const report = buildRecoveryReport(scenario, { manufacturing: null, refurbishing: null, grid: null });
  const r = report.reconciliation;

  it("verifies the protection plan from diagnostics", () => {
    expect(report.plan.verified).toBe(true);
  });

  it("matches $27,000 in receipts across the three flows", () => {
    expect(r.matchedTotal).toBe(dollars(27_000));
    expect(r.allSettled).toBe(true);
    expect(r.unmatchedReceipts).toHaveLength(0);
    const byFlow = Object.fromEntries(r.settlements.map((s) => [s.expected.flow, s.receipt?.amount]));
    expect(byFlow).toEqual({
      replacement: dollars(10_500),
      warranty: dollars(12_000),
      resale: dollars(4_500),
    });
  });

  it("collects $10,500 from the customer on a $4,000 upgrade", () => {
    expect(report.upgradeDelta).toBe(dollars(4_000));
    const invoice = r.settlements.find((s) => s.expected.flow === "replacement")!.expected;
    expect(invoice.amount).toBe(dollars(10_500));
  });

  it("does not count the warranty credit again as revenue", () => {
    expect(r.salesValue.replacement).toBe(dollars(22_500));
    expect(r.salesValue.total).toBe(dollars(27_000));
    expect(r.salesValue.total).not.toBe(r.matchedTotal + dollars(12_000));
  });
});

describe("settlement status", () => {
  it("issues no credit and no claim when the plan does not verify", () => {
    const s = withScenario((x) => { x.diagnostics.physicalDamage = true; });
    const plan = verifyProtectionPlan(s.diagnostics, s.protectionPlan);
    expect(plan.verified).toBe(false);
    const expected = buildExpectedReceipts(s, plan.verified);
    expect(expected.find((e) => e.flow === "warranty")).toBeUndefined();
    expect(expected.find((e) => e.flow === "replacement")!.amount).toBe(dollars(22_500));
  });

  it("rejects a failure outside the plan term", () => {
    const s = withScenario((x) => { x.diagnostics.failureDate = "2027-03-01"; });
    expect(verifyProtectionPlan(s.diagnostics, s.protectionPlan).verified).toBe(false);
  });

  it("keeps a missing payment as awaiting, not matched", () => {
    const receipts = scenario.receipts.filter((x) => x.reference !== "CLM-2001");
    const r = reconcile(buildExpectedReceipts(scenario, true), receipts);
    expect(r.matchedTotal).toBe(dollars(15_000));
    expect(r.outstanding).toBe(dollars(12_000));
    expect(r.allSettled).toBe(false);
    expect(r.settlements.find((s) => s.expected.flow === "warranty")!.status).toBe("awaiting payment");
  });

  it("flags a short payment as an amount mismatch", () => {
    const receipts = scenario.receipts.map((x) =>
      x.reference === "AGR-3001" ? { ...x, amount: dollars(4_000) } : x,
    );
    const r = reconcile(buildExpectedReceipts(scenario, true), receipts);
    const resale = r.settlements.find((s) => s.expected.flow === "resale")!;
    expect(resale.status).toBe("amount mismatch");
    expect(resale.difference).toBe(dollars(500));
    expect(r.matchedTotal).toBe(dollars(22_500));
  });

  it("reports a receipt that matches nothing", () => {
    const stray = { ...scenario.receipts[0], id: "RCPT-99", reference: "INV-9999" };
    const r = reconcile(buildExpectedReceipts(scenario, true), [...scenario.receipts, stray]);
    expect(r.unmatchedReceipts.map((x) => x.id)).toEqual(["RCPT-99"]);
  });
});

describe("carbon record", () => {
  const weight = scenario.failedUnit.weight;
  const base = { weight, treatmentRoute: "Refurbish", baseline: "New unit" };

  it("stays pending until EPA factors are fetched", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: null, refurbishingFactor: null });
    expect(c.status).toBe("pending");
    expect(c.kgCo2e).toBeNull();
  });

  it("stays pending when unit weight was not recorded at intake", () => {
    const c = avoidedCarbon({ ...base, weight: null, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(c.status).toBe("pending");
    expect(c.pendingReasons.join(" ")).toMatch(/weight/);
  });

  it("shows both sides, then the difference", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(c.status).toBe("estimated");
    expect(c.manufacturing.kgCo2e).toBeCloseTo(17);
    expect(c.refurbishing.kgCo2e).toBeCloseTo(1.7);
    expect(c.kgCo2e).toBeCloseTo(15.3);
  });

  it("converts metric tons per short ton exactly", () => {
    const f: EmissionFactor = { ...manufacturing, value: 1, unit: { co2e: "metric ton", per: "short ton" } };
    const side = carbonSide({ label: "x", family: "materials", weight, factor: f });
    expect(side.factorKgPerKg).toBeCloseTo(1000 / 907.18474, 10);
  });

  it("stops when units do not match (per dollar factor against kg)", () => {
    const f: EmissionFactor = { ...manufacturing, unit: { co2e: "kg", per: "USD" } };
    const side = carbonSide({ label: "x", family: "materials", weight, factor: f });
    expect(side.status).toBe("pending");
    expect(side.pendingReasons.join(" ")).toMatch(/Units do not match/);
  });

  it("refuses a factor from the wrong country", () => {
    const f: EmissionFactor = { ...manufacturing, jurisdiction: "UK" };
    expect(carbonSide({ label: "x", family: "materials", weight, factor: f }).status).toBe("pending");
  });

  it("refuses a factor from the wrong activity family", () => {
    const side = carbonSide({ label: "x", family: "waste", weight, factor: manufacturing });
    expect(side.status).toBe("pending");
  });

  it("refuses a factor with no source", () => {
    const f: EmissionFactor = { ...manufacturing, source: { ...testSource, url: "" } };
    expect(carbonSide({ label: "x", family: "materials", weight, factor: f }).status).toBe("pending");
  });

  it("requires both sides to use the same source and edition", () => {
    const other: EmissionFactor = { ...refurbishing, source: { ...testSource, edition: "other" } };
    const c = avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: other });
    expect(c.status).toBe("pending");
  });

  it("never labels carbon as verified", () => {
    const c = avoidedCarbon({ ...base, manufacturingFactor: manufacturing, refurbishingFactor: refurbishing });
    expect(["estimated", "pending"]).toContain(c.status);
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
    expect(e.carbon.status).toBe("estimated");
    expect(e.carbon.kgCo2ePerMonth).toBeCloseTo(7_200 * 0.45359237, 6);
  });
});
