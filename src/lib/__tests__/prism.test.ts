import { describe, expect, it } from "vitest";
import { describeGuardrail, type GuardrailVerdict } from "../prism";

const v = (over: Partial<GuardrailVerdict>): GuardrailVerdict => ({
  direction: "input", evaluated: true, blocked: false, reason: null, details: {}, ...over,
});

describe("guardrail wording", () => {
  it("never reports an unevaluated check as passed", () => {
    const text = describeGuardrail(v({ evaluated: false, reason: "plan_not_entitled" }));
    expect(text).toMatch(/not evaluated/);
    expect(text).not.toMatch(/passed/);
  });

  it("reports blocked and passed verdicts", () => {
    expect(describeGuardrail(v({ blocked: true }))).toMatch(/blocked/);
    expect(describeGuardrail(v({ direction: "output" }))).toMatch(/Customer summary: passed/);
  });
});
