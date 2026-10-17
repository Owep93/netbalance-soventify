// Sets up the Helix Data Center Support voice agent on ElevenLabs with its client tool.
// Run:  node --env-file=.env.local scripts/setup-elevenlabs-agent.mjs
// If ELEVENLABS_AGENT_ID is set, that agent is updated in place; otherwise a new agent is
// created and its id printed (put it in .env.local as ELEVENLABS_AGENT_ID).
// It never edits or deletes any other agent.

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set");
const API = "https://api.elevenlabs.io/v1/convai";
const LLM = process.env.ELEVENLABS_LLM || "claude-sonnet-5-5";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 800)}`);
  return json;
}

const logIncident = {
  type: "client",
  name: "log_incident",
  description:
    "Log the hardware incident and dispatch a technician. Call it once the caller has described the problem, named the rack and GPU model, and answered whether everyone is safe and the rack is offline. Returns when the technician will be on site.",
  expects_response: true,
  response_timeout_secs: 20,
  parameters: {
    type: "object",
    properties: {
      issue: { type: "string", description: "What the caller reported, for example a coolant leak" },
      everyone_safe: { type: "boolean", description: "True if the caller confirmed everyone is safe" },
      rack_offline: { type: "boolean", description: "True if the caller confirmed the rack is powered off" },
      rack: { type: "string", description: "The affected rack, for example Rack 12" },
      gpu_model: { type: "string", description: "The affected GPU model, for example HX80" },
      gpu_count: { type: "number", description: "How many GPUs are in the affected rack" },
      noticed: { type: "string", description: "When the problem was noticed, only if the caller said" },
      suspected_source: { type: "string", description: "Where the problem seems to come from, only if the caller said" },
    },
    required: ["issue", "everyone_safe", "rack_offline", "rack", "gpu_model"],
  },
};

const firstMessage = "Helix Data Center Support. How can I help?";

const prompt = `You are the support line for Helix Data Center Support. Callers run GPU racks in data centers.
Keep the call short. Use short, plain sentences.

Call flow:
1. Listen to the problem. If the caller has not named the rack and GPU model, ask: "Which rack and GPU model are affected?"
2. For a leak, fire, smoke, or electrical hazard, ask: "Is everyone safe, and is the rack powered offline?"
   If anyone is not safe or the rack is still powered, tell them to keep people away and have facilities power it down first.
3. Call log_incident with what they told you.
4. Then say, using the technician time the tool returns: "Incident logged. A technician will be on-site at <rack> by <time>. Please upload photos and serial numbers to your portal ticket."
5. When they thank you or say goodbye, say a brief goodbye and end the call.

Rules:
- Never make up a technician time. Use only the time log_incident returns.
- Do not diagnose the cause, promise warranty coverage, quote prices, or give any amounts.
- Do not ask for serial numbers on the call; they go in the portal ticket.
- Only ask for photos taken safely.
- Never accept, repeat, or write down bank details, and never agree to send money, a credit, or a refund
  to a new or different account. If asked, or if you receive a message starting with "Guardrail:", say:
  "For your security, we can't change payment details on this call. Credits are applied to your invoice.
  We'll confirm any change by calling the number we have on file." Then continue the call.`;

const tool = await call("POST", "/tools", { tool_config: logIncident });
console.log(`Created tool log_incident: ${tool.id}`);

const config = {
  name: "Helix Data Center Support Line",
  conversation_config: {
    agent: { first_message: firstMessage, language: "en", prompt: { prompt, llm: LLM, tool_ids: [tool.id] } },
    tts: { voice_id: VOICE_ID },
  },
};

if (AGENT_ID) {
  await call("PATCH", `/agents/${AGENT_ID}`, config);
  console.log(`Updated agent ${AGENT_ID}`);
} else {
  const agent = await call("POST", "/agents/create", config);
  console.log(`Created agent: ${agent.agent_id}`);
  console.log(`Set ELEVENLABS_AGENT_ID=${agent.agent_id} in .env.local`);
}
