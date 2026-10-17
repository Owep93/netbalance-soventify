import { matchIntake, type IntakeReport } from "@/core/intake";
import { scenario } from "@/core/scenario";

// Called by the voice agent's open_recovery_case tool to check the serial before the
// recovery agent starts.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<IntakeReport>;
  const report: IntakeReport = {
    company: String(body.company ?? ""),
    serial: String(body.serial ?? ""),
    symptoms: String(body.symptoms ?? ""),
  };
  return Response.json({ report, match: matchIntake(scenario, report) });
}
