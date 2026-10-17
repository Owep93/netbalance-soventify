// Sends each agent run to PRISM by Block Convey: one trace (prompt, summary, checks),
// one span per model call and tool call, and one trajectory for path evaluation.
// Only free ingestion endpoints are called here. Paid PRISM actions (analysis, backfill,
// narrative, generate-fix) are never called from code; a person decides on those.
import { randomUUID } from "node:crypto";
import type { Check } from "@/agent/checks";
import type { AgentRun } from "@/agent/run";

export const AGENT_NAME = "GPU Recovery Agent";

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
export function buildPrismPayloads(run: AgentRun, checks: Check[], projectId: string, traceId: string) {
  const failed = checks.filter((c) => !c.passed);
  const tokensIn = run.trace.reduce((n, e) => n + (e.tokensIn ?? 0), 0);
  const tokensOut = run.trace.reduce((n, e) => n + (e.tokensOut ?? 0), 0);
  const r = run.report?.reconciliation;
  const metadata = {
    simulated: true,
    checks_passed: checks.length - failed.length,
    checks_total: checks.length,
    failed_checks: failed.map((c) => `${c.area}: ${c.name}`),
    checks,
    matched_receipts_cents: r?.matchedTotal ?? null,
    expected_receipts_cents: r?.expectedTotal ?? null,
    all_settled: r?.allSettled ?? false,
    carbon_status: run.report?.carbon.status ?? "pending",
    avoided_kg_co2e: run.report?.carbon.kgCo2e ?? null,
    unsupported_figures: run.unsupportedFigures,
    refused_steps: run.trace.filter((e) => e.kind === "tool" && !e.ok).map((e) => e.name),
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
    agent_id: "gpu-recovery-agent",
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
        metadata: { seq: e.seq },
      })),
    ],
  };

  const trajectory = {
    project_id: projectId,
    conversation_id: traceId,
    request_id: traceId,
    agent_id: "gpu-recovery-agent",
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

export async function sendToPrism(run: AgentRun, checks: Check[]): Promise<PrismResult> {
  const traceId = randomUUID();
  const result: PrismResult = { traceId, sent: { trace: false, spans: false, trajectory: false }, errors: [] };
  const cfg = config();
  if (!cfg) {
    result.errors.push("PRISM_API_KEY or PRISM_PROJECT_ID is not set in .env.local");
    return result;
  }

  const payloads = buildPrismPayloads(run, checks, cfg.projectId, traceId);
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
