import { getCase } from "@/agent/case";
import { runAgent } from "@/agent/run";
import { caseContext, finishCase } from "@/lib/case-context";
import { nicrronComplete, nicrronModel } from "@/lib/nicrron";
import { describeGuardrail, evaluateGuardrail } from "@/lib/prism";

// Agent autopilot: the Nicrron agent works the shared case. Streams one JSON line per step.
export async function POST() {
  const state = getCase();
  if (state.autopilot.running) return Response.json({ error: "The autopilot is already running." }, { status: 409 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      state.autopilot = { running: true, summary: null, unsupportedFigures: [] };
      try {
        const run = await runAgent({
          state,
          complete: nicrronComplete(),
          model: nicrronModel(),
          ctx: caseContext(state),
          onEvent: (event) => send({ type: "event", event }),
        });
        // Output guardrail on the summary (PRISM; not evaluated on plans without guardrails).
        const out = await evaluateGuardrail("output", run.summary);
        send({ type: "guardrail", text: describeGuardrail(out), verdict: out });
        if (out.blocked) run.summary = "This summary was withheld by PRISM guardrails pending review.";
        state.autopilot = { running: false, summary: run.summary, unsupportedFigures: run.unsupportedFigures };
        const { checks, prism } = await finishCase(state, run);
        send({ type: "done", summary: run.summary, stoppedEarly: run.stoppedEarly, checks, prism });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        state.autopilot.running = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
