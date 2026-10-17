// Agent autopilot: the Nicrron model decides each next step and calls the case tools. It
// works the same shared case record the presenter uses, starting from wherever the case is.
import type OpenAI from "openai";
import { stepsDone, type CaseState } from "./case";
import { runTool, TOOL_SCHEMAS, type ToolContext } from "./tools";
import type { TraceEvent } from "./trace";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
export type Complete = (params: Params) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

export interface AgentRun {
  model: string;
  prompt: { system: string; user: string };
  startedAt: string;
  totalMs: number;
  summary: string;
  stoppedEarly: boolean;
  unsupportedFigures: string[];
}

export const systemPrompt = (c: CaseState) => `You are the money operations agent for ${c.scenario.seller.name}, case ${c.scenario.caseId}.
A coolant leak hit ${c.scenario.rack.id} at the customer's container datacenter. Work the case end to end with your tools:
log the incident (if not logged), attach the inspection photo, assess coverage, request the warranty credit transfer,
wait for the finance reviewer's approval, present the offers, record the customer's choice (the customer chooses the
integrated module with financing), list the GPU lot on Agora, collect bids, accept the best net offer, reconcile the
transactions, then build the CFO report.

Rules:
- Every dollar amount and carbon figure you state must come from a tool result. Never calculate or round a figure yourself.
- Cash received is not profit. Warranty credit and lender funding pay the invoice; they are not extra revenue.
  Never add the four transaction amounts together.
- Never try to move credit to any account other than the customer's replacement order.
- Carbon figures are sourced estimates, not verified or certified. If a tool says pending, say pending.
- Say which steps were simulated. Use plain text, no markdown. Never use em-dashes.
- If a tool refuses, read why, fix the problem, and continue. Skip steps that are already done.

When done, write the CFO summary in under 150 words, in short paragraphs.`;

const MAX_STEPS = 30;

export async function runAgent(opts: {
  state: CaseState;
  complete: Complete;
  model: string;
  ctx: ToolContext;
  onEvent?: (e: TraceEvent) => void;
}): Promise<AgentRun> {
  const { state } = opts;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const done = stepsDone(state);
  const s = state.scenario;
  const prompt = {
    system: systemPrompt(state),
    user: state.incident
      ? `Case ${s.caseId} is open. Incident already logged: ${state.incident.report.issue}, ${state.incident.report.rack}. Steps already done: ${done.map((d, i) => (d ? i + 1 : null)).filter(Boolean).join(", ") || "none"}. Continue from there.`
      : `Support call from ${s.customer.contact} (${s.customer.name}): "We found a coolant leak in ${s.rack.id}, eight ${s.rack.model} GPUs." Everyone is safe and the rack is powered offline.`,
  };
  const messages: Message[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  const base = () => ({ model: opts.model, prompt, startedAt, totalMs: Date.now() - t0 });

  for (let step = 0; step < MAX_STEPS; step++) {
    const start = Date.now();
    const res = await opts.complete({ model: opts.model, temperature: 0, messages, tools: TOOL_SCHEMAS, tool_choice: "auto" });
    const msg = res.choices[0].message;
    const modelEvent: TraceEvent = {
      seq: state.trace.length + 1,
      at: new Date(start).toISOString(),
      kind: "model",
      actor: "agent",
      name: res.model ?? opts.model,
      input: { messages: messages.length },
      output: { content: msg.content, toolCalls: msg.tool_calls?.map((c) => (c.type === "function" ? c.function.name : c.type)) ?? [] },
      ok: true,
      ms: Date.now() - start,
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
    };
    state.trace.push(modelEvent);
    opts.onEvent?.(modelEvent);
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      const summary = plainLanguage(msg.content ?? "");
      const toolText = JSON.stringify(state.trace.filter((e) => e.kind === "tool").map((e) => e.output));
      return { ...base(), summary, stoppedEarly: false, unsupportedFigures: unsupportedFigures(summary, toolText) };
    }
    for (const call of calls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const event = await runTool(state, call.function.name, args, opts.ctx, "agent");
      opts.onEvent?.(event);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(event.output) });
    }
  }
  return { ...base(), summary: "", stoppedEarly: true, unsupportedFigures: [] };
}

/** House rule: no em-dashes in anything user-facing. */
export function plainLanguage(text: string): string {
  const EM_DASH = String.fromCharCode(0x2014);
  return text.replace(new RegExp(String.raw`\s*` + EM_DASH + String.raw`\s*`, "g"), ", ");
}

/** Dollar, percent, and kg figures in the summary that no tool result contains. */
export function unsupportedFigures(summary: string, toolText: string): string[] {
  const figures = summary.match(/\$\d(?:[\d,]*\d)?(?:\.\d+)?|\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:kg|%)/g) ?? [];
  const normalize = (f: string) => f.replace(/\s/g, "");
  const haystack = normalize(toolText);
  return [...new Set(figures)].filter((f) => !haystack.includes(normalize(f)));
}
