// Fetches US EPA emission factors at calculation time and reads them out of EPA's own
// spreadsheets by label, never by fixed row number. If a file cannot be fetched or a label
// is missing, the factor comes back null with a reason, and the carbon record stays pending.
import * as XLSX from "xlsx";
import type { EmissionFactor } from "@/core/carbon";
import type { Factors } from "@/core/report";

export const EPA_SOURCES = {
  warm: {
    name: "Waste Reduction Model (WARM)",
    edition: "WARM v16 (December 2023)",
    url: "https://www.epa.gov/system/files/documents/2023-12/warm_v16.xls",
    landing: "https://www.epa.gov/waste-reduction-model/versions-waste-reduction-model",
  },
  hub: {
    name: "GHG Emission Factors Hub",
    edition: "Emission Factors Hub 2025 (January 2025)",
    url: "https://www.epa.gov/system/files/other-files/2025-01/ghg-emission-factors-hub-2025.xlsx",
    landing: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
  },
  egrid: {
    name: "eGRID summary tables",
    edition: "eGRID2023 rev2 (June 2025)",
    url: "https://www.epa.gov/system/files/documents/2025-06/summary_tables_rev2.xlsx",
    landing: "https://www.epa.gov/egrid/summary-data",
  },
  zip: {
    name: "Power Profiler ZIP code tool",
    edition: "Power Profiler v14.3, eGRID2023 rev2 (June 2025)",
    url: "https://www.epa.gov/system/files/documents/2025-06/power_profiler_zipcode_tool_v14.3.xlsx",
    landing: "https://www.epa.gov/egrid/power-profiler",
  },
} as const;

const AUTHORITY = "US EPA";

// The same WARM material category is used on both sides so they are calculated the same way.
export const ELECTRONICS_CATEGORY = "Mixed Electronics";

type Rows = unknown[][];

function rows(wb: XLSX.WorkBook, sheet: string): Rows {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`sheet "${sheet}" not found`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
}

const text = (v: unknown) => String(v ?? "").trim();
const same = (a: unknown, b: string) => text(a).toLowerCase() === b.toLowerCase();

function numberAt(row: unknown[], col: number, what: string): number {
  const v = row[col];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} is "${text(v)}", not a number`);
  return v;
}

/** Manufacturing side: WARM source reduction factor (materials family). */
export function parseWarmManufacturing(
  wb: XLSX.WorkBook,
  category: string,
  retrievedAt: string,
): EmissionFactor {
  const sheet = "Summary Data";
  const r = rows(wb, sheet);
  const header = r.find((row) => same(row[0], "Material") && text(row[1]).startsWith("Source Reduction"));
  if (!header) throw new Error("WARM source reduction column not found");
  if (!r.some((row) => same(row[0], "All Units in MTCO2E/ton"))) {
    throw new Error("WARM units note (MTCO2E/ton) not found, so units cannot be confirmed");
  }
  const row = r.find((x) => same(x[0], category));
  if (!row) throw new Error(`WARM has no "${category}" row`);
  const raw = numberAt(row, 1, `WARM source reduction for ${category}`);

  return {
    // WARM reports source reduction as a negative (avoided) value. Its size is the
    // emissions from raw material acquisition and manufacturing of a new product.
    value: Math.abs(raw),
    unit: { co2e: "metric ton", per: "short ton" },
    family: "materials",
    category,
    pathway: `Source reduction (raw material and manufacturing emissions; WARM shows ${raw.toFixed(2)}, size used)`,
    jurisdiction: "US",
    source: {
      authority: AUTHORITY,
      edition: EPA_SOURCES.warm.edition,
      url: EPA_SOURCES.warm.landing,
      table: `${sheet}, column "${text(header[1])}"`,
      row: category,
      retrievedAt,
    },
  };
}

/** Refurbishing side: Hub Table 9 end-of-life factor (waste family), no avoided-emission credits. */
export function parseHubWaste(
  wb: XLSX.WorkBook,
  category: string,
  route: "Recycled" | "Landfilled" | "Combusted",
  retrievedAt: string,
): EmissionFactor {
  const sheet = "Emission Factors Hub";
  const r = rows(wb, sheet);
  const start = r.findIndex((row) => row.some((v) => same(v, "Table 9")));
  if (start < 0) throw new Error("Hub Table 9 not found");
  const end = r.findIndex((row, i) => i > start && row.some((v) => same(v, "Table 10")));
  const table = r.slice(start, end < 0 ? undefined : end);

  if (!table.some((row) => row.some((v) => same(v, "Metric Tons CO2e / Short Ton Material")))) {
    throw new Error("Hub Table 9 units (Metric Tons CO2e / Short Ton Material) not found");
  }
  const headerIdx = table.findIndex((row) => row.some((v) => same(v, "Material")));
  if (headerIdx < 0) throw new Error("Hub Table 9 header row not found");
  const header = table[headerIdx];
  const materialCol = header.findIndex((v) => same(v, "Material"));
  const routeCol = header.findIndex((v) => text(v).startsWith(route));
  if (routeCol < 0) throw new Error(`Hub Table 9 has no "${route}" column`);

  const row = table.slice(headerIdx + 1).find((x) => same(x[materialCol], category));
  if (!row) throw new Error(`Hub Table 9 has no "${category}" row`);
  const value = numberAt(row, routeCol, `Hub Table 9 ${route} for ${category}`);

  return {
    value,
    unit: { co2e: "metric ton", per: "short ton" },
    family: "waste",
    category,
    pathway: `${route}: collection, transport, and processing only, no avoided-emission credit`,
    jurisdiction: "US",
    source: {
      authority: AUTHORITY,
      edition: EPA_SOURCES.hub.edition,
      url: EPA_SOURCES.hub.landing,
      table: "Table 9, Scope 3 Category 5 and Category 12 waste factors",
      row: `${category}, ${route}`,
      retrievedAt,
    },
  };
}

/** Looks up the eGRID subregion for a US zip code. Refuses zips that span subregions. */
export function parseZipSubregion(wb: XLSX.WorkBook, zip: string): string {
  const r = rows(wb, "Zip-subregion");
  const row = r.find((x) => text(x[0]).padStart(5, "0") === zip.padStart(5, "0"));
  if (!row) throw new Error(`zip ${zip} not in the EPA Power Profiler lookup`);
  const subregions = row.slice(1, 4).map(text).filter(Boolean);
  if (subregions.length !== 1) {
    throw new Error(`zip ${zip} spans ${subregions.length} eGRID subregions (${subregions.join(", ")}); pick one from the utility`);
  }
  return subregions[0];
}

/** Grid side: eGRID non-baseload CO2e rate, which EPA points to for estimating reductions. */
export function parseEgridNonBaseload(
  wb: XLSX.WorkBook,
  subregion: string,
  retrievedAt: string,
): EmissionFactor {
  const sheet = "Table 1";
  const r = rows(wb, sheet);
  const groupIdx = r.findIndex((row) => row.some((v) => same(v, "Non-baseload output emission rates")));
  if (groupIdx < 0) throw new Error("eGRID non-baseload columns not found");
  const group = r[groupIdx];
  const startCol = group.findIndex((v) => same(v, "Non-baseload output emission rates"));
  const co2eCol = group.findIndex((v, i) => i >= startCol && same(v, "CO₂e"));
  if (co2eCol < 0) throw new Error("eGRID non-baseload CO2e column not found");
  if (!same(r[groupIdx + 1]?.[startCol], "lb/MWh")) throw new Error("eGRID units (lb/MWh) not confirmed");

  const row = r.find((x) => same(x[0], subregion));
  if (!row) throw new Error(`eGRID has no subregion "${subregion}"`);
  const value = numberAt(row, co2eCol, `eGRID non-baseload CO2e for ${subregion}`);

  return {
    value,
    unit: { co2e: "lb", per: "MWh" },
    family: "electricity",
    category: `eGRID subregion ${subregion} (${text(row[1])})`,
    pathway: "Non-baseload output emission rate, CO2e",
    jurisdiction: "US",
    source: {
      authority: AUTHORITY,
      edition: EPA_SOURCES.egrid.edition,
      url: EPA_SOURCES.egrid.landing,
      table: "Table 1, Subregion Output Emission Rates",
      row: subregion,
      retrievedAt,
    },
  };
}

interface Loaded {
  wb: XLSX.WorkBook;
  retrievedAt: string;
}

// One download per file per server process. A failed download is not cached.
const cache = new Map<string, Promise<Loaded>>();

function load(url: string): Promise<Loaded> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`EPA returned HTTP ${res.status} for ${url}`);
      const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array", dense: true });
      return { wb, retrievedAt: new Date().toISOString() };
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export interface EpaResult {
  factors: Factors;
  subregion: string | null;
  errors: string[];
}

export async function fetchEpaFactors(zip: string, category = ELECTRONICS_CATEGORY): Promise<EpaResult> {
  const errors: string[] = [];
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const [manufacturing, refurbishing, grid] = await Promise.all([
    attempt("WARM manufacturing factor", async () => {
      const { wb, retrievedAt } = await load(EPA_SOURCES.warm.url);
      return parseWarmManufacturing(wb, category, retrievedAt);
    }),
    attempt("Hub refurbishing factor", async () => {
      const { wb, retrievedAt } = await load(EPA_SOURCES.hub.url);
      return parseHubWaste(wb, category, "Recycled", retrievedAt);
    }),
    attempt("eGRID grid factor", async () => {
      const [zipFile, egrid] = await Promise.all([load(EPA_SOURCES.zip.url), load(EPA_SOURCES.egrid.url)]);
      return parseEgridNonBaseload(egrid.wb, parseZipSubregion(zipFile.wb, zip), egrid.retrievedAt);
    }),
  ]);

  const subregion = grid ? grid.source.row ?? null : null;
  return { factors: { manufacturing, refurbishing, grid }, subregion, errors };
}
