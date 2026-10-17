import { getCase } from "@/agent/case";
import { runTool } from "@/agent/tools";
import { caseContext, finishCase } from "@/lib/case-context";

// Runs one case tool for the presenter's buttons or the voice call. Same tools as the agent.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { tool?: string; args?: Record<string, unknown>; actor?: "presenter" | "voice" };
  const state = getCase();
  if (state.autopilot.running) return Response.json({ error: "The agent autopilot is running this case." }, { status: 409 });
  const event = await runTool(state, String(body.tool ?? ""), body.args ?? {}, caseContext(state), body.actor === "voice" ? "voice" : "presenter");
  if (event.ok && event.name === "build_cfo_report" && !state.prism) await finishCase(state);
  return Response.json({ event, case: state });
}
