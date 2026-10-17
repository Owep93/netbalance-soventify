import type OpenAI from "openai";
import type { RecoveryReport } from "@/core/report";
import type { IntakeReport } from "@/core/intake";
import type { Scenario } from "@/core/scenario";
import { newCase, ToolRefused, TOOL_SCHEMAS, TOOLS, type ToolContext } from "./tools";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
export type Complete = (params: Params) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

/** One entry per model call or tool call. This is what gets sent to PRISM. */
export interface TraceEvent {
  seq: number;
  at: string;
  kind: "model" | "tool";
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ms: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AgentRun {
  model: string;
  prompt: { system: string; user: string };
  startedAt: string;
  totalMs: number;
  summary: string;
  trace: TraceEvent[];
  report: RecoveryReport | null;
  unsupportedFigures: string[];
  stoppedEarly: boolean;
}

export const systemPrompt = (s: Scenario) => `You are a money operations agent for ${s.seller.name}.
A customer's data center GPU has failed. Work the case end to end with your tools:
take the failure report, run diagnostics, verify the protection plan, issue the warranty
credit if and only if the plan verifies, quote and sell the replacement, refurbish the failed
unit, list it on Agora, check the bids, accept the best bid, collect payments, then reconcile
and record carbon.

Rules:
- Every dollar amount and carbon figure you state must come from a tool result. Never
  calculate, estimate, or round a figure yourself.
- Receipts are not profit. The warranty reimbursement pays for the credit; it is not extra revenue.
- Carbon figures are sourced estimates, not verified or certified. If a tool says pending,
  say pending.
- Say which steps were simulated.
- Use plain language and plain text: no markdown, no bold, no headings. Never use em-dashes.
- Do not mention tools to the customer.
- If a tool refuses, read why, fix the problem, and continue.

When done, give the customer-facing summary in under 200 words, in short paragraphs.`;

const MAX_STEPS = 25;

export async function runAgent(opts: {
  scenario: Scenario;
  complete: Complete;
  model: string;
  ctx: ToolContext;
  // What the caller reported on the voice line. Without it, a scripted report is used.
  intake?: IntakeReport;
  onEvent?: (e: TraceEvent) => void;
}): Promise<AgentRun> {
  const state = newCase(opts.scenario);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const trace: TraceEvent[] = [];
  const record = (e: Omit<TraceEvent, "seq" | "at">, start: number) => {
    const event = { seq: trace.length + 1, at: new Date(start).toISOString(), ...e };
    trace.push(event);
    opts.onEvent?.(event);
  };

  const s = opts.scenario;
  const prompt = {
    system: systemPrompt(s),
    user: opts.intake
      ? `Incident from the support line, with the customer's support portal upload. Company: ${opts.intake.company}. Unit nearest the leak: ${opts.intake.serial}. Details: ${opts.intake.symptoms}`
      : `Incident from ${s.customer.name}: coolant leak in ${s.rack.id} (${s.rack.units.length} ${s.rack.model} GPUs) near a cooling-line connection. Everyone is safe and the rack is offline. Portal upload names ${s.portalUpload.unitNearestLeak} as the unit nearest the leak.`,
  };
  const messages: Message[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  const base = () => ({ model: opts.model, prompt, startedAt, totalMs: Date.now() - t0 });

  for (let step = 0; step < MAX_STEPS; step++) {
    const start = Date.now();
    const res = await opts.complete({
      model: opts.model,
      temperature: 0,
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: "auto",
    });
    const msg = res.choices[0].message;
    record(
      {
        kind: "model",
        name: res.model ?? opts.model,
        input: { messages: messages.length },
        output: { content: msg.content, toolCalls: msg.tool_calls?.map((c) => c.type === "function" ? c.function.name : c.type) ?? [] },
        ok: true,
        ms: Date.now() - start,
        tokensIn: res.usage?.prompt_tokens,
        tokensOut: res.usage?.completion_tokens,
      },
      start,
    );
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      const summary = plainLanguage(msg.content ?? "");
      const toolText = JSON.stringify(trace.filter((e) => e.kind === "tool").map((e) => e.output));
      return {
        ...base(),
        summary,
        trace,
        report: state.report,
        unsupportedFigures: unsupportedFigures(summary, toolText),
        stoppedEarly: false,
      };
    }

    for (const call of calls) {
      if (call.type !== "function") continue;
      const t0 = Date.now();
      const tool = TOOLS[call.function.name];
      let args: Record<string, unknown> = {};
      let output: unknown;
      let ok = true;
      try {
        args = JSON.parse(call.function.arguments || "{}");
        if (!tool) throw new ToolRefused(`Unknown tool ${call.function.name}`);
        output = await tool.run(state, args, opts.ctx);
      } catch (e) {
        ok = false;
        output = { refused: e instanceof Error ? e.message : String(e) };
        if (!(e instanceof ToolRefused) && !(e instanceof SyntaxError)) throw e;
      }
      record({ kind: "tool", name: call.function.name, input: args, output, ok, ms: Date.now() - t0 }, t0);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }

  return { ...base(), summary: "", trace, report: state.report, unsupportedFigures: [], stoppedEarly: true };
}

/** House rule: no em-dashes in anything user-facing. */
export function plainLanguage(text: string): string {
  return text.replace(new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, "g"), ", ");
}

/** Dollar and kg figures in the summary that no tool result contains. */
export function unsupportedFigures(summary: string, toolText: string): string[] {
  const figures = summary.match(/\$\d(?:[\d,]*\d)?(?:\.\d+)?|\d(?:[\d,]*\d)?(?:\.\d+)?\s?kg/g) ?? [];
  const normalize = (f: string) => f.replace(/\s/g, "");
  const haystack = normalize(toolText);
  return [...new Set(figures)].filter((f) => !haystack.includes(normalize(f)));
}
