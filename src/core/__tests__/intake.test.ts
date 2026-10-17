import { describe, expect, it } from "vitest";
import { logIncident } from "../intake";
import { scenario } from "../scenario";

describe("support line incident", () => {
  const base = { issue: "coolant leak", everyoneSafe: true, rackOffline: true, gpuCount: 8 };

  it("matches the rack and model however speech to text writes them", () => {
    for (const [rack, gpuModel] of [["Rack 12", "H100 80GB"], ["rack twelve", "H100"], ["12", "h-100 80 gig"]]) {
      expect(logIncident(scenario, { ...base, rack, gpuModel }).matchesRecords, `${rack} ${gpuModel}`).toBe(true);
    }
  });

  it("returns the technician time from the scenario, never from the model", () => {
    const r = logIncident(scenario, { ...base, rack: "Rack 12", gpuModel: "H100" });
    expect(r.technicianOnSiteBy).toBe("2:00 PM today");
    expect(r.technician).toBe("Maya Chen");
  });

  it("still logs an incident whose rack is not on file, flagged for review", () => {
    const r = logIncident(scenario, { ...base, rack: "Rack 7", gpuModel: "H100" });
    expect(r.priority).toBe("urgent");
    expect(r.matchesRecords).toBe(false);
  });
});
