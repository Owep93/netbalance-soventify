import { sendVoiceTurns, type VoiceTurn } from "@/lib/prism";

// Forwards the voice call transcript to PRISM once the call ends.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; turns?: VoiceTurn[] };
  if (!body.conversationId || !Array.isArray(body.turns)) {
    return Response.json({ error: "conversationId and turns are required" }, { status: 400 });
  }
  return Response.json(await sendVoiceTurns(body.conversationId, body.turns));
}
