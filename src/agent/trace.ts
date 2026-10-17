/** One entry per model call or tool call. This is what gets sent to PRISM. */
export interface TraceEvent {
  seq: number;
  at: string;
  kind: "model" | "tool";
  // Who triggered it: the Nicrron agent (autopilot) or the presenter clicking through.
  actor: "agent" | "presenter" | "voice";
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ms: number;
  tokensIn?: number;
  tokensOut?: number;
}
