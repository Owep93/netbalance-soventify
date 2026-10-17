import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  parseEgridNonBaseload,
  parseHubWaste,
  parseWarmManufacturing,
  parseZipSubregion,
} from "../epa";

// Tiny workbooks laid out like the EPA files, with made-up numbers. They test the label
// lookups and unit checks; the real values are only ever read from epa.gov.
function book(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return wb;
}

const at = "2026-10-17T00:00:00Z";

const warm = book({
  "Summary Data": [
    ["Material", "Source Reduction: Current Mix or 100% Virgin", "Recycling of Post-Consumer Material"],
    ["Glass", -0.5, -0.2],
    ["CRT Displays", "NA", -0.5],
    ["Mixed Electronics", -2, -0.9],
    [],
    ["All Units in MTCO2E/ton", "", ""],
  ],
});

const hub = book({
  "Emission Factors Hub": [
    ["", "Table 8", "Something else"],
    ["", "", "Material", "RecycledA"],
    ["", "", "Mixed Electronics", 99],
    ["", "Table 9", "Scope 3 Category 5"],
    ["", "", "", "Metric Tons CO2e / Short Ton Material"],
    ["", "", "Material", "RecycledA", "LandfilledB", "CombustedC"],
    ["", "", "Mixed Electronics", 0.5, 0.02, 0.96],
    ["", "Table 10", "Next"],
  ],
});

const egrid = book({
  "Table 1": [
    ["1. Subregion Output Emission Rates (eGRID2023)", "V2", "V3", "V4", "V5"],
    ["eGRID subregion acronym", "eGRID subregion name", "Total output emission rates", "CO₂e", "Non-baseload output emission rates", "CO₂e"],
    ["", "", "lb/MWh", "", "lb/MWh", ""],
    ["eGRID subregion acronym", "eGRID subregion name", "CO₂", "CO₂e", "CO₂", "CO₂e"],
    ["RFCE", "RFC East", 1, 2, 3, 2000],
    ["U.S.", "", 1, 2, 3, 4],
  ],
});

const zips = book({
  "Zip-subregion": [
    ["zip", "Subregion 1", "Subregion 2", "Subregion 3"],
    ["07094", "RFCE", "", ""],
    ["12345", "NYUP", "RFCE", ""],
  ],
});

describe("EPA spreadsheet parsing", () => {
  it("reads the WARM source reduction factor by label and uses its size", () => {
    const f = parseWarmManufacturing(warm, "Mixed Electronics", at);
    expect(f.value).toBe(2);
    expect(f.unit).toEqual({ co2e: "metric ton", per: "short ton" });
    expect(f.family).toBe("materials");
    expect(f.source.authority).toBe("US EPA");
  });

  it("refuses a WARM category with no factor", () => {
    expect(() => parseWarmManufacturing(warm, "CRT Displays", at)).toThrow(/not a number/);
  });

  it("refuses WARM when the units note is missing", () => {
    const noUnits = book({ "Summary Data": [["Material", "Source Reduction: Current Mix"], ["Mixed Electronics", -2]] });
    expect(() => parseWarmManufacturing(noUnits, "Mixed Electronics", at)).toThrow(/units/);
  });

  it("reads Hub Table 9, not an earlier table with the same row", () => {
    const f = parseHubWaste(hub, "Mixed Electronics", "Recycled", at);
    expect(f.value).toBe(0.5);
    expect(f.family).toBe("waste");
  });

  it("resolves a zip to one eGRID subregion and refuses split zips", () => {
    expect(parseZipSubregion(zips, "07094")).toBe("RFCE");
    expect(() => parseZipSubregion(zips, "12345")).toThrow(/spans 2/);
    expect(() => parseZipSubregion(zips, "99999")).toThrow(/not in/);
  });

  it("reads the non-baseload CO2e rate, not the total output rate", () => {
    const f = parseEgridNonBaseload(egrid, "RFCE", at);
    expect(f.value).toBe(2000);
    expect(f.unit).toEqual({ co2e: "lb", per: "MWh" });
  });
});
