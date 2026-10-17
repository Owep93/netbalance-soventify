import type { Scenario } from "./scenario";

export interface IntakeReport {
  company: string;
  serial: string;
  symptoms: string;
}

export type IntakeMatch =
  | { ok: true; serial: string; model: string; customer: string }
  | { ok: false; reason: string };

// Speech to text writes serials many ways ("GX4-23-00871", "gx4 23 00871", "G X 4 2 3...").
export function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Checks a reported serial against the units on file. */
export function matchIntake(s: Scenario, report: IntakeReport): IntakeMatch {
  if (!report.serial?.trim()) return { ok: false, reason: "No serial number was given." };
  if (normalizeSerial(report.serial) !== normalizeSerial(s.failedUnit.serial)) {
    return { ok: false, reason: `Serial "${report.serial}" is not on file. Ask the caller to check it.` };
  }
  return { ok: true, serial: s.failedUnit.serial, model: s.failedUnit.model, customer: s.customer.name };
}

/** What the caller reports on the support line. */
export interface IncidentReport {
  issue: string;
  everyoneSafe: boolean;
  rackOffline: boolean;
  noticed: string;
  suspectedSource: string;
  rack: string;
  gpuModel: string;
  gpuCount: number | null;
}

export interface IncidentRecord {
  incidentId: string;
  priority: "urgent";
  technicianEta: string;
  technicianOnSiteBy: string;
  report: IncidentReport;
  // Whether the rack and model match what the customer has on file.
  matchesRecords: boolean;
  recordNote: string;
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12",
};

function rackNumber(rack: string): string {
  const words = rack.toLowerCase().replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w);
  return words.match(/\d+/)?.[0] ?? "";
}

export function logIncident(s: Scenario, report: IncidentReport, incidentId = "INC-1012"): IncidentRecord {
  const rackOk = rackNumber(report.rack) === rackNumber(s.rack.id);
  const modelOk = normalizeSerial(report.gpuModel) === normalizeSerial(s.rack.model);
  return {
    incidentId,
    priority: "urgent",
    technicianEta: `On site at ${s.rack.id} by ${s.dispatch.technicianEta} (simulated)`,
    technicianOnSiteBy: s.dispatch.technicianEta,
    report,
    matchesRecords: rackOk && modelOk,
    recordNote: rackOk && modelOk
      ? `${s.rack.id} with ${s.rack.units.length} ${s.rack.model} GPUs is on file for ${s.customer.name}.`
      : `Reported rack or model does not match records (${s.rack.id}, ${s.rack.model}). Technical review will confirm.`,
  };
}
