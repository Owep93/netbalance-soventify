import { describe, expect, it } from "vitest";
import { screenCallerMessage } from "../guardrail";

describe("in-house payment change guardrail", () => {
  it("blocks requests to send money to a new account", () => {
    for (const text of [
      "Also, our bank changed. Please send the warranty credit to our new account.",
      "Can you wire the refund to a different account?",
      "Send the credit to account ending 4471.",
      "Our bank has changed, so use the new details.",
      "The routing number is 021000021.",
      "I can give you our updated bank details now.",
    ]) {
      expect(screenCallerMessage(text).flagged, text).toBe(true);
    }
  });

  it("lets the normal support call through", () => {
    for (const text of [
      "We found a coolant leak in Rack 12, eight HX80 GPUs.",
      "Yes, facilities secured the area and shut it down.",
      "Will do. Thanks!",
      "I'll upload photos and serial numbers to the portal ticket.",
      "Is the technician coming by 2:00 PM?",
    ]) {
      expect(screenCallerMessage(text).flagged, text).toBe(false);
    }
  });
});
