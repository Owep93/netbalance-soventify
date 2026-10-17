// Server-side wiring for the case tools: live EPA fetch, the shared Agora market, PRISM
// recording of guardrail events, and the wait for a person's credit approval.
import type { CaseState, GuardEvent } from "@/agent/case";
import { runChecks } from "@/agent/checks";
import type { AgentRun } from "@/agent/run";
import type { ToolContext } from "@/agent/tools";
import { agora } from "@/agora/market";
import { fetchEpaFactors } from "@/lib/epa";
import { recordGuardrailBlock, sendToPrism } from "@/lib/prism";

const ACTION: Record<GuardEvent["kind"], "held" | "approved" | "refused" | "blocked"> = {
  "credit transfer held": "held",
  "credit transfer approved": "approved",
  "credit transfer refused": "refused",
  "payment change blocked": "blocked",
};

export async function recordGuard(state: CaseState, kind: GuardEvent["kind"], detail: string): Promise<string | null> {
  const r = await recordGuardrailBlock({
    callerText: detail,
    reply: kind,
    rule: "credit_transfer_approval",
    reason: detail,
    conversationId: state.scenario.caseId,
    action: ACTION[kind],
    agentName: "Netbalance Recovery Agent",
  });
  return r.recorded ? r.traceId : null;
}

export function caseContext(state: CaseState, approvalTimeoutMs = 180_000): ToolContext {
  return {
    fetchEpa: () => fetchEpaFactors(state.scenario.customer.site.zip),
    agora,
    recordGuard: (kind, detail) => recordGuard(state, kind, detail),
    waitForApproval: async (s) => {
      const until = Date.now() + approvalTimeoutMs;
      while (Date.now() < until) {
        if (s.transfer.approval) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    },
  };
}

/** Runs the checks and sends the finished case to PRISM. */
export async function finishCase(state: CaseState, agentRun: AgentRun | null = null) {
  const checks = runChecks(state, agentRun ? { text: agentRun.summary, unsupportedFigures: agentRun.unsupportedFigures } : undefined);
  const prism = await sendToPrism(state, checks, agentRun);
  state.prism = { traceId: prism.traceId, sent: prism.sent, errors: prism.errors };
  return { checks, prism };
}
