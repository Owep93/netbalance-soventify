// Sends each completed case to PRISM by Block Convey: one trace (input, outcome, checks),
// one span per model call and tool call, and one trajectory for path evaluation. Works for
// both the agent autopilot and the presenter clicking through.
// Only free ingestion endpoints are called here. Paid PRISM actions (analysis, backfill,
// narrative, generate-fix) are never called from code; a person decides on those.
import { randomUUID } from "node:crypto";
import type { CaseState } from "@/agent/case";
import type { Check } from "@/agent/checks";
import type { AgentRun } from "@/agent/run";
import { formatUsd } from "@/core/money";

export const AGENT_NAME = "Netbalance Recovery Agent";

export interface PrismResult {
  traceId: string;
  sent: { trace: boolean; spans: boolean; trajectory: boolean };
  errors: string[];
}

function config() {
  const key = process.env.PRISM_API_KEY;
  const projectId = process.env.PRISM_PROJECT_ID;
  const host = process.env.PRISM_BASE_URL || "https://api.prism.blockconvey.com";
  if (!key || !projectId) return null;
  return { key, projectId, host };
}

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Builds the three PRISM payloads. Pure, so it can be tested without a network. */
export function buildPrismPayloads(
  c: CaseState,
  checks: Check[],
  projectId: string,
  traceId: string,
  agentRun: AgentRun | null = null,
  guardrails: GuardrailVerdict[] = [],
) {
  const events = c.trace;
  const first = events[0]?.at ?? new Date().toISOString();
  const last = events.at(-1);
  const totalMs = last ? new Date(last.at).getTime() + last.ms - new Date(first).getTime() : 0;
  const s = c.scenario;
  const outcome = c.report
    ? `Case ${s.caseId}: ${formatUsd(c.report.reconciliation.cashReceived)} cash received, ` +
      `${formatUsd(c.report.reconciliation.outstanding)} outstanding, contribution ${formatUsd(c.report.comparison.selected.total)} ` +
      `(+${formatUsd(c.report.comparison.improvement)}, ${c.report.comparison.improvementPct}%), carbon ${c.report.carbon.status}.`
    : `Case ${s.caseId} not finished.`;
  const run = {
    model: agentRun?.model ?? "presenter (no model)",
    prompt: agentRun?.prompt ?? { system: `Presenter-driven case ${s.caseId}`, user: `Coolant leak in ${s.rack.id}, ${s.rack.units.length} ${s.rack.model} GPUs` },
    summary: agentRun?.summary || outcome,
    startedAt: agentRun?.startedAt ?? first,
    totalMs: agentRun?.totalMs ?? totalMs,
    stoppedEarly: agentRun?.stoppedEarly ?? false,
    unsupportedFigures: agentRun?.unsupportedFigures ?? [],
    trace: events,
  };
  const failed = checks.filter((x) => !x.passed);
  const tokensIn = events.reduce((n, e) => n + (e.tokensIn ?? 0), 0);
  const tokensOut = events.reduce((n, e) => n + (e.tokensOut ?? 0), 0);
  const r = c.reconciliation;
  const metadata = {
    simulated: true,
    checks_passed: checks.length - failed.length,
    checks_total: checks.length,
    failed_checks: failed.map((c) => `${c.area}: ${c.name}`),
    checks,
    case_id: s.caseId,
    driven_by: agentRun ? "agent autopilot" : "presenter",
    cash_received_cents: r?.cashReceived ?? null,
    expected_cash_cents: r?.expectedCash ?? null,
    all_settled: r?.allSettled ?? false,
    contribution_cents: c.report?.comparison.selected.total ?? null,
    carbon_status: c.report?.carbon.status ?? "pending",
    avoided_kg_co2e: c.report?.carbon.kgCo2e ?? null,
    credit_approval: c.transfer.approval ? { id: c.transfer.approval.id, approver: c.transfer.approval.approver, amount_cents: c.transfer.approval.amount } : null,
    guard_events: c.guardEvents.map((g) => g.kind),
    unsupported_figures: run.unsupportedFigures,
    refused_steps: run.trace.filter((e) => e.kind === "tool" && !e.ok).map((e) => e.name),
    guardrails: guardrails.map((g) => ({ direction: g.direction, evaluated: g.evaluated, blocked: g.blocked, reason: g.reason })),
  };

  const trace = {
    project_id: projectId,
    trace_id: traceId,
    model: run.model,
    input_messages: [
      { role: "system", content: run.prompt.system },
      { role: "user", content: run.prompt.user },
    ],
    output_message: run.summary || "(agent stopped before writing a summary)",
    latency_ms: run.totalMs,
    token_count_input: tokensIn,
    token_count_output: tokensOut,
    session_id: traceId,
    agent_id: "netbalance-recovery-agent",
    agent_name: AGENT_NAME,
    metadata,
  };

  const rootId = `${traceId}-root`;
  const end = (at: string, ms: number) => new Date(new Date(at).getTime() + ms).toISOString();
  const spans = {
    trace_id: traceId,
    project_id: projectId,
    session_id: traceId,
    metadata: { agent_name: AGENT_NAME, simulated: true },
    spans: [
      {
        span_id: rootId,
        parent_span_id: null,
        name: AGENT_NAME,
        span_type: "agent",
        input_text: run.prompt.user,
        output_text: run.summary,
        start_time: run.startedAt,
        end_time: end(run.startedAt, run.totalMs),
        duration_ms: run.totalMs,
        status: failed.length ? "error" : "ok",
        error_message: failed.length ? metadata.failed_checks.join("; ") : null,
        metadata,
      },
      ...run.trace.map((e) => ({
        span_id: `${traceId}-${e.seq}`,
        parent_span_id: rootId,
        name: e.name,
        span_type: e.kind === "model" ? "llm" : "tool",
        input_text: text(e.input),
        output_text: text(e.output),
        start_time: e.at,
        end_time: end(e.at, e.ms),
        duration_ms: e.ms,
        status: e.ok ? "ok" : "error",
        error_message: e.ok ? null : text((e.output as { refused?: string })?.refused ?? e.output),
        token_count_input: e.tokensIn ?? null,
        token_count_output: e.tokensOut ?? null,
        model: e.kind === "model" ? e.name : null,
        metadata: { seq: e.seq, actor: e.actor },
      })),
    ],
  };

  const trajectory = {
    project_id: projectId,
    conversation_id: traceId,
    request_id: traceId,
    agent_id: "netbalance-recovery-agent",
    agent_name: AGENT_NAME,
    model: run.model,
    total_duration_ms: run.totalMs,
    final_status: failed.length || run.stoppedEarly ? "failure" : "success",
    steps: run.trace.map((e) => ({
      step_type: e.kind === "model" ? "llm_call" : "tool_call",
      label: e.kind === "model" ? `Model decides next step (${e.name})` : e.name,
      input_summary: text(e.input).slice(0, 500),
      output_summary: text(e.output).slice(0, 500),
      tool_name: e.kind === "tool" ? e.name : undefined,
      duration_ms: e.ms,
      token_count: (e.tokensIn ?? 0) + (e.tokensOut ?? 0) || undefined,
      status: e.ok ? "success" : "error",
    })),
  };

  return { trace, spans, trajectory };
}

export async function sendToPrism(
  c: CaseState,
  checks: Check[],
  agentRun: AgentRun | null = null,
  guardrails: GuardrailVerdict[] = [],
): Promise<PrismResult> {
  const traceId = randomUUID();
  const result: PrismResult = { traceId, sent: { trace: false, spans: false, trajectory: false }, errors: [] };
  const cfg = config();
  if (!cfg) {
    result.errors.push("PRISM_API_KEY or PRISM_PROJECT_ID is not set in .env.local");
    return result;
  }

  const payloads = buildPrismPayloads(c, checks, cfg.projectId, traceId, agentRun, guardrails);
  const post = async (name: keyof PrismResult["sent"], path: string, body: unknown) => {
    try {
      const res = await fetch(`${cfg.host}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-PRISMtrace-Key": cfg.key },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      result.sent[name] = true;
    } catch (e) {
      result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // The trace first, so spans and the trajectory attach to an existing trace.
  await post("trace", "/api/traces", payloads.trace);
  await Promise.all([
    post("spans", "/api/spans/ingest", payloads.spans),
    post("trajectory", "/api/trajectories", payloads.trajectory),
  ]);
  return result;
}

export interface VoiceTurn {
  role: "user" | "agent";
  message: string;
  time_in_call_secs?: number;
  step_type?: string;
}

/** Sends the voice call transcript to PRISM, keyed by the ElevenLabs conversation id. */
export async function sendVoiceTurns(conversationId: string, turns: VoiceTurn[]) {
  const cfg = config();
  if (!cfg) return { ok: false, error: "PRISM_API_KEY or PRISM_PROJECT_ID is not set in .env.local" };
  try {
    const res = await fetch(`${cfg.host}/api/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRISMtrace-Key": cfg.key },
      body: JSON.stringify({
        project_id: cfg.projectId,
        conversation_id: conversationId,
        agent_id: process.env.ELEVENLABS_AGENT_ID,
        agent_name: "GPU Recovery Intake (voice)",
        status: "completed",
        turns,
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface GuardrailVerdict {
  direction: "input" | "output";
  evaluated: boolean;
  blocked: boolean;
  reason: string | null;
  details: Record<string, unknown>;
}

/**
 * Checks text against the project's PRISM guardrail rules. Free to call. On a plan without
 * guardrails PRISM answers evaluated: false and lets the text through (fail-open); callers
 * must show that as "not evaluated", never as "passed".
 */
export async function evaluateGuardrail(
  direction: "input" | "output",
  content: string,
  traceId?: string,
): Promise<GuardrailVerdict> {
  const cfg = config();
  const verdict = (evaluated: boolean, blocked: boolean, reason: string | null, details = {}) =>
    ({ direction, evaluated, blocked, reason, details }) as GuardrailVerdict;
  if (!cfg) return verdict(false, false, "PRISM is not configured");
  try {
    const res = await fetch(`${cfg.host}/api/guardrails/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRISMtrace-Key": cfg.key },
      body: JSON.stringify({
        project_id: cfg.projectId,
        direction,
        messages: [{ role: direction === "input" ? "user" : "assistant", content }],
        trace_id: traceId,
        agent_id: "netbalance-recovery-agent",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return verdict(false, false, `HTTP ${res.status}`, body);
    const { evaluated, blocked, reason, ...rest } = body;
    return verdict(evaluated === true, blocked === true, typeof reason === "string" ? reason : null, rest);
  } catch (e) {
    return verdict(false, false, e instanceof Error ? e.message : String(e));
  }
}

export function describeGuardrail(v: GuardrailVerdict): string {
  const side = v.direction === "input" ? "Caller report" : "Customer summary";
  if (!v.evaluated) return `${side}: not evaluated by PRISM guardrails (${v.reason ?? "no reason given"})`;
  return v.blocked ? `${side}: blocked by PRISM guardrails` : `${side}: passed PRISM guardrails`;
}

/** Records an in-house guardrail event (a block, a hold, or an approval) as a PRISM trace. */
export async function recordGuardrailBlock(opts: {
  callerText: string;
  reply: string;
  rule: string;
  reason: string;
  conversationId: string | null;
  action?: "blocked" | "held" | "approved" | "refused";
  agentName?: string;
}): Promise<{ recorded: boolean; traceId: string; error?: string }> {
  const traceId = randomUUID();
  const cfg = config();
  if (!cfg) return { recorded: false, traceId, error: "PRISM is not configured" };
  try {
    const res = await fetch(`${cfg.host}/api/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRISMtrace-Key": cfg.key },
      body: JSON.stringify({
        project_id: cfg.projectId,
        trace_id: traceId,
        model: "in-house-guardrail",
        input_messages: [{ role: "user", content: opts.callerText }],
        output_message: opts.reply,
        latency_ms: 0,
        session_id: opts.conversationId ?? traceId,
        agent_id: opts.agentName ? "netbalance-recovery-agent" : "helix-support-line",
        agent_name: opts.agentName ?? "Helix Datacenter Support Line (voice)",
        metadata: {
          guardrail: opts.rule,
          guardrail_source: "in-house",
          action: opts.action ?? "blocked",
          reason: opts.reason,
          simulated: true,
        },
      }),
    });
    if (!res.ok) return { recorded: false, traceId, error: `HTTP ${res.status}` };
    return { recorded: true, traceId };
  } catch (e) {
    return { recorded: false, traceId, error: e instanceof Error ? e.message : String(e) };
  }
}
