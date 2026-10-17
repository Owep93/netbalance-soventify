import { logIncident, type IncidentReport } from "@/core/intake";
import { scenario } from "@/core/scenario";

// Called by the voice agent's log_incident tool at the end of the support call.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const report: IncidentReport = {
    issue: String(b.issue ?? ""),
    everyoneSafe: b.everyone_safe === true || b.everyone_safe === "true",
    rackOffline: b.rack_offline === true || b.rack_offline === "true",
    noticed: String(b.noticed ?? ""),
    suspectedSource: String(b.suspected_source ?? ""),
    rack: String(b.rack ?? ""),
    gpuModel: String(b.gpu_model ?? ""),
    gpuCount: Number.isFinite(Number(b.gpu_count)) ? Number(b.gpu_count) : null,
  };
  // What the customer's support portal upload will contain (simulated).
  const portal = {
    customer: scenario.customer.name,
    rackUnits: scenario.rack.units,
    photos: scenario.portalUpload.photos,
    unitNearestLeak: scenario.portalUpload.unitNearestLeak,
  };
  return Response.json({ record: logIncident(scenario, report), portal });
}
