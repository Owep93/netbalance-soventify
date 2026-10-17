import { agora } from "@/agora/market";

// Read-only view of the simulated Agora market, polled by the /agora page.
export async function GET() {
  return Response.json(agora.snapshot(), { headers: { "Cache-Control": "no-store" } });
}
