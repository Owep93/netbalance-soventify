import { PAYMENT_CHANGE_REPLY, screenCallerMessage } from "@/core/guardrail";
import { recordGuardrailBlock } from "@/lib/prism";

// Checks one caller sentence from the live call. Blocked attempts are recorded in PRISM.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; conversationId?: string };
  const text = String(body.text ?? "");
  const result = screenCallerMessage(text);
  if (!result.flagged) return Response.json({ ...result, reply: null, prism: null });

  const prism = await recordGuardrailBlock({
    callerText: text,
    reply: PAYMENT_CHANGE_REPLY,
    rule: result.rule!,
    reason: result.reason!,
    conversationId: body.conversationId ?? null,
  });
  return Response.json({ ...result, reply: PAYMENT_CHANGE_REPLY, prism });
}
