import type { Scenario } from "./scenario";

/** What the caller reports on the support line. */
export interface IncidentReport {
  issue: string;
  everyoneSafe: boolean;
  rackOffline: boolean;
  rack: string;
  gpuModel: string;
  gpuCount: number | null;
}

export interface IncidentRecord {
  incidentId: string;
  priority: "urgent";
  report: IncidentReport;
  technician: string;
  technicianOnSiteBy: string;
  // Whether the rack and model match what the customer has on file.
  matchesRecords: boolean;
  recordNote: string;
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12",
};

const compact = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

function rackNumber(rack: string): string {
  const words = rack.toLowerCase().replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w);
  return words.match(/\d+/)?.[0] ?? "";
}

export function logIncident(s: Scenario, report: IncidentReport): IncidentRecord {
  const rackOk = rackNumber(report.rack) === rackNumber(s.rack.id);
  // "H100", "H100 80GB" and "H 100" all match the H100 80GB on file.
  const modelOk = compact(report.gpuModel).includes(compact(s.rack.model.split(" ")[0]));
  return {
    incidentId: s.caseId,
    priority: "urgent",
    report,
    technician: s.dispatch.technician,
    technicianOnSiteBy: s.dispatch.onSiteBy,
    matchesRecords: rackOk && modelOk,
    recordNote: rackOk && modelOk
      ? `${s.rack.id} with ${s.rack.units.length} ${s.rack.model} GPUs is on file for ${s.customer.name}.`
      : `Reported rack or model does not match records (${s.rack.id}, ${s.rack.model}). Technical review will confirm.`,
  };
}
