import { getCase, stepsDone } from "@/agent/case";
import { runChecks } from "@/agent/checks";

// The shared case record, polled by the demo screens.
export async function GET() {
  const c = getCase();
  const summary = c.autopilot.summary ? { text: c.autopilot.summary, unsupportedFigures: c.autopilot.unsupportedFigures } : undefined;
  return Response.json(
    { case: c, steps: stepsDone(c), checks: runChecks(c, summary) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
