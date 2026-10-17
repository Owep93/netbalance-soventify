import { getCase } from "@/agent/case";
import { approveTransfer } from "@/core/credit";
import { formatUsd } from "@/core/money";
import { recordGuard } from "@/lib/case-context";

// A person (the finance reviewer) approves the held warranty credit transfer.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { approver?: string };
  const state = getCase();
  if (state.transfer.decision?.status !== "needs approval" || !state.coverage) {
    return Response.json({ error: "There is no held credit transfer to approve." }, { status: 409 });
  }
  const t = state.scenario.creditTransfer;
  const req2 = { amount: state.coverage.containerRacks.credit, source: t.source, destination: t.destination };
  state.transfer.approval = approveTransfer(state.scenario, req2, body.approver || "Demo finance reviewer");
  const prismTraceId = await recordGuard(state, "credit transfer approved", `${state.transfer.approval.id}: ${formatUsd(req2.amount)} ${req2.source} to ${req2.destination}, ${t.scope}`);
  state.guardEvents.push({ at: new Date().toISOString(), kind: "credit transfer approved", detail: `${state.transfer.approval.id} by ${state.transfer.approval.approver}`, prismTraceId });
  state.updatedAt = new Date().toISOString();
  return Response.json({ approval: state.transfer.approval, case: state });
}
