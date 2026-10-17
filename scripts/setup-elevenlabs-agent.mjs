// Creates the "GPU Recovery Intake" voice agent on ElevenLabs with its two client tools.
// Run once:  node --env-file=.env.local scripts/setup-elevenlabs-agent.mjs
// Then put the printed agent id in .env.local as ELEVENLABS_AGENT_ID.
// It only creates new things; it never edits or deletes existing agents or tools.

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set");
const API = "https://api.elevenlabs.io/v1/convai";
const LLM = process.env.ELEVENLABS_LLM || "claude-sonnet-5-5";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";

async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 800)}`);
  return json;
}

const tools = [
  {
    type: "client",
    name: "open_recovery_case",
    description:
      "Open a GPU recovery case once you have the company name, the GPU serial number (read back and confirmed), and what happened. Returns whether the serial is on file.",
    expects_response: true,
    response_timeout_secs: 20,
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", description: "The caller's company name" },
        serial: { type: "string", description: "The failed GPU's serial number, exactly as confirmed with the caller" },
        symptoms: { type: "string", description: "What the caller says happened, in their words" },
      },
      required: ["company", "serial", "symptoms"],
    },
  },
  {
    type: "client",
    name: "book_installation",
    description: "Book installation of the replacement GPU after the case is open. Returns the confirmed slot.",
    expects_response: true,
    response_timeout_secs: 20,
    parameters: {
      type: "object",
      properties: {
        preferred_time: { type: "string", description: "The caller's preferred day and time window, for example Tuesday morning" },
        contact_name: { type: "string", description: "Who the technician should ask for on site" },
      },
      required: ["preferred_time"],
    },
  },
];

const prompt = `You are the recovery line for NetBalance GPU Services. A customer is calling because a data center GPU failed.

Steps:
1. Ask for the company name, the GPU serial number, and what happened.
2. Read the serial number back one character at a time and get a yes before using it.
3. Call open_recovery_case with the company, serial, and symptoms. If it says the serial is not on file, ask the caller to check it and try again.
4. Once the case is open, say that the recovery agent is now checking their protection plan, the replacement, and the resale of the failed unit, and that they can watch it on screen. Do not state prices, credits, or carbon figures: the written summary will have them.
5. Offer to book installation of the replacement. Ask for a preferred day and time window and who to ask for on site, then call book_installation and repeat back what it returns. Say the booking is simulated for this demo.
6. Thank them and end the call.

Rules: short, plain spoken sentences. Never invent amounts or promise coverage. If you are unsure, say so.`;

const toolIds = [];
for (const tool_config of tools) {
  const created = await call("/tools", { tool_config });
  toolIds.push(created.id);
  console.log(`Created tool ${tool_config.name}: ${created.id}`);
}

const agent = await call("/agents/create", {
  name: "GPU Recovery Intake",
  conversation_config: {
    agent: {
      first_message: "NetBalance GPU Services, recovery line. Which company are you calling from, and what happened to your GPU?",
      language: "en",
      prompt: { prompt, llm: LLM, tool_ids: toolIds },
    },
    tts: { voice_id: VOICE_ID },
  },
});
console.log(`Created agent: ${agent.agent_id}`);
console.log(`Set ELEVENLABS_AGENT_ID=${agent.agent_id} in .env.local`);
