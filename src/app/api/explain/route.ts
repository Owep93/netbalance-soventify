import { getCase } from "@/agent/case";
import { plainLanguage, unsupportedFigures } from "@/agent/run";
import { formatUsd } from "@/core/money";
import { nicrronComplete, nicrronModel } from "@/lib/nicrron";

// Nicrron explains the coverage decision in plain language. The decision itself (what is
// covered and for how much) comes from src/core; the model only puts it into words.
export async function POST() {
  const state = getCase();
  const c = state.coverage;
  if (!c) return Response.json({ error: "Assess coverage first." }, { status: 409 });
  const facts = {
    finding: state.scenario.inspection.finding,
    policy: c.policyId,
    claim: c.claimId,
    containerAndRacks: { covered: c.containerRacks.covered, credit: formatUsd(c.containerRacks.credit) },
    gpus: { covered: c.gpus.covered, reason: c.gpus.reason },
  };
  const t0 = Date.now();
  try {
    const res = await nicrronComplete()({
      model: nicrronModel(),
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Explain a warranty coverage decision to a finance manager in at most 3 short plain sentences. " +
            "Use only the facts given; state no figure that is not in them. Say the technician finding is simulated. No markdown. Never use em-dashes.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
    const text = plainLanguage(res.choices[0].message.content ?? "");
    const unsupported = unsupportedFigures(text, JSON.stringify(facts));
    state.trace.push({
      seq: state.trace.length + 1,
      at: new Date(t0).toISOString(),
      kind: "model",
      actor: "presenter",
      name: res.model ?? nicrronModel(),
      input: { explain: "coverage", facts },
      output: { content: text, unsupportedFigures: unsupported },
      ok: unsupported.length === 0,
      ms: Date.now() - t0,
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
    });
    return Response.json({ text, model: res.model, unsupported });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
