import { describe, expect, it } from "vitest";
import { matchIntake, normalizeSerial } from "../intake";
import { scenario } from "../scenario";

describe("voice intake", () => {
  it("accepts the serial however speech to text writes it", () => {
    for (const spoken of ["GX4-23-00871", "gx4 23 00871", "G X 4 - 2 3 - 0 0 8 7 1", "GX42300871"]) {
      const m = matchIntake(scenario, { company: "Halcyon", serial: spoken, symptoms: "x" });
      expect(m).toMatchObject({ ok: true, serial: "GX4-23-00871" });
    }
  });

  it("refuses a serial that is not on file", () => {
    const m = matchIntake(scenario, { company: "Halcyon", serial: "GX4-23-00872", symptoms: "x" });
    expect(m.ok).toBe(false);
  });

  it("refuses an empty serial", () => {
    expect(matchIntake(scenario, { company: "Halcyon", serial: " ", symptoms: "x" }).ok).toBe(false);
  });

  it("normalizes to letters and digits only", () => {
    expect(normalizeSerial("gx4-23 00871")).toBe("GX42300871");
  });
});
