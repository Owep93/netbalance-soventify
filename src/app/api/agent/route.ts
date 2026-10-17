import { runChecks } from "@/agent/checks";
import { runAgent } from "@/agent/run";
import { sendToPrism } from "@/lib/prism";
import { agora } from "@/agora/market";
import type { IntakeReport } from "@/core/intake";
import { scenario } from "@/core/scenario";
import { fetchEpaFactors } from "@/lib/epa";
import { nicrronComplete, nicrronModel } from "@/lib/nicrron";

// Streams one JSON line per agent step, then a final "done" line with the summary.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { intake?: IntakeReport };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        agora.reset();
        const run = await runAgent({
          scenario,
          complete: nicrronComplete(),
          model: nicrronModel(),
          ctx: { fetchEpa: () => fetchEpaFactors(scenario.customer.site.zip), agora },
          intake: body.intake,
          onEvent: (event) => send({ type: "event", event }),
        });
        const checks = runChecks(run);
        send({ type: "checks", checks });
        const prism = await sendToPrism(run, checks);
        send({
          type: "done",
          summary: run.summary,
          unsupportedFigures: run.unsupportedFigures,
          stoppedEarly: run.stoppedEarly,
          checks,
          prism,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
