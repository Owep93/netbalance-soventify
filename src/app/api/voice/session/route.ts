// Returns a short-lived signed URL for the ElevenLabs voice agent, so the API key
// never reaches the browser.
export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!key || !agentId) {
    return Response.json({ error: "ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID is not set in .env.local" }, { status: 500 });
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": key }, cache: "no-store" },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.signed_url) {
    return Response.json({ error: `ElevenLabs returned HTTP ${res.status}` }, { status: 502 });
  }
  return Response.json({ signedUrl: body.signed_url }, { headers: { "Cache-Control": "no-store" } });
}
