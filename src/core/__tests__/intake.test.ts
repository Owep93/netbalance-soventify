import { describe, expect, it } from "vitest";
import { logIncident, matchIntake, normalizeSerial } from "../intake";
import { scenario } from "../scenario";

describe("voice intake", () => {
  it("accepts the serial however speech to text writes it", () => {
    for (const spoken of ["HX80-12-05-0871", "hx80 12 05 0871", "H X 8 0 - 1 2 - 0 5 - 0 8 7 1", "HX8012050871"]) {
      const m = matchIntake(scenario, { company: "Halcyon", serial: spoken, symptoms: "x" });
      expect(m).toMatchObject({ ok: true, serial: "HX80-12-05-0871" });
    }
  });

  it("refuses a serial that is not on file", () => {
    const m = matchIntake(scenario, { company: "Halcyon", serial: "HX80-12-04-0869", symptoms: "x" });
    expect(m.ok).toBe(false);
  });

  it("refuses an empty serial", () => {
    expect(matchIntake(scenario, { company: "Halcyon", serial: " ", symptoms: "x" }).ok).toBe(false);
  });

  it("normalizes to letters and digits only", () => {
    expect(normalizeSerial("hx80-12 05-0871")).toBe("HX8012050871");
  });
});

describe("support line incident", () => {
  const base = {
    issue: "coolant leak", everyoneSafe: true, rackOffline: true, noticed: "about thirty minutes ago",
    suspectedSource: "near a cooling-line connection", gpuCount: 8,
  };

  it("matches the rack and model however speech to text writes them", () => {
    for (const [rack, gpuModel] of [["Rack 12", "HX80"], ["rack twelve", "H X 80"], ["12", "hx-80"]]) {
      expect(logIncident(scenario, { ...base, rack, gpuModel }).matchesRecords).toBe(true);
    }
  });

  it("still logs an incident whose rack is not on file, flagged for review", () => {
    const r = logIncident(scenario, { ...base, rack: "Rack 7", gpuModel: "HX80" });
    expect(r.priority).toBe("urgent");
    expect(r.matchesRecords).toBe(false);
  });
});
