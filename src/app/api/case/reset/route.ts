import { resetCase } from "@/agent/case";
import { agora } from "@/agora/market";

export async function POST() {
  agora.reset();
  resetCase();
  return Response.json({ ok: true });
}
