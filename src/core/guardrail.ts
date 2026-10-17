// In-house guardrail for the live support call. Every caller sentence is checked as it
// arrives. A request to send money to a new or different account, or bank details read out
// on the call, is blocked: credits only ever go on the invoice, and payment changes are
// confirmed by calling back the number on file.

export interface GuardrailResult {
  flagged: boolean;
  rule: "payment_change_request" | null;
  reason: string | null;
}

const PATTERNS: { test: RegExp; reason: string }[] = [
  {
    test: /\b(new|different|another|changed|updated|other)\s+(bank|account|bank account|routing|payment details|wire)/i,
    reason: "Asked to use a new or different bank account",
  },
  {
    test: /\b(send|pay|transfer|wire|deposit|move)\b[^.?!]{0,40}\b(credit|refund|money|payment|reimbursement|funds|it)\b[^.?!]{0,30}\b(to|into)\b[^.?!]{0,30}\b(account|bank)\b/i,
    reason: "Asked to send a credit or payment to an account",
  },
  {
    test: /\b(routing number|account number|sort code|iban|swift|bank details)\b/i,
    reason: "Gave or asked about bank details",
  },
  {
    test: /\b(our|my|the)\s+bank\s+(has\s+)?(changed|is different|switched)/i,
    reason: "Said their bank details changed",
  },
];

export function screenCallerMessage(text: string): GuardrailResult {
  for (const p of PATTERNS) {
    if (p.test.test(text)) return { flagged: true, rule: "payment_change_request", reason: p.reason };
  }
  return { flagged: false, rule: null, reason: null };
}

/** What the voice agent must say when the guardrail fires. */
export const PAYMENT_CHANGE_REPLY =
  "For your security, we can't change payment details on this call. Credits are applied to your invoice. " +
  "We'll confirm any change by calling the number we have on file.";
