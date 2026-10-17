# CLAUDE.md - Money Talks 2 Hackathon

## Project
AI GPU Recovery Agent. Money Talks 2 hackathon, Money Operations track. One-day build.
A small AI company's data center GPU fails. The agent: takes the failure report, verifies
the protection plan from diagnostics, issues a $12,000 warranty credit, sells a $22,000
newer and more power-efficient replacement ($4,000 upgrade over the $18,000 like-for-like
unit, $500 installation, $10,500 collected), refurbishes and resells the failed unit
($4,500 net), then reconciles all three money flows plus a carbon record.

## Demo targets
- $27,000 in matched receipts: $10,500 customer + $12,000 warranty reimbursement + $4,500 buyer payment.
- Receipts are not profit. Do not count the credit again as revenue.
- The same view shows estimated avoided CO2e in kg, with weight, treatment route,
  baseline, factor source, and method attached. Missing evidence means pending, not verified.

## Carbon methodology (from Soventify)
Every carbon number follows these rules:
1. Name the activity family: refurbishing a failed GPU is waste (e-waste); manufacturing
   a new GPU is materials.
2. Use the jurisdiction's authority: US figures come from the EPA, fetched at calculation
   time. Never copy a factor from memory. A factor from the wrong country is worse than none.
3. Multiply only when the units match: unit weight in kg times a factor in kg CO2e per kg.
   If units do not match, stop. Record unit weight in kg at intake.
4. Avoided CO2e = carbon of manufacturing a new GPU minus carbon of refurbishing the old
   one. Show both sides separately, then the difference. Both sides calculated the same way.
5. Every carbon figure carries its source: authority, edition, link. No source, no number.
   Carbon here is a sourced estimate, not ESG compliance certification.
6. Energy bonus: the replacement draws less power per workload. Meter it against a baseline
   and show avoided energy cost next to avoided carbon.

## Sponsor tools (judging checks usage via an AI agent)
- ElevenLabs: voice agent for the failure report call and booking.
- Nicrron x Ninoo: model gateway (one API key, 65+ models). All agent LLM calls go
  through it: orchestration, diagnostic and policy interpretation, upgrade explanations.
- PRISM by Block Convey: traces agent actions; tests coverage, calculations, settlement
  status, and unsupported carbon claims. Demo improvement with repeated tests.
- Agora: the reseller market where the refurbished failed unit is listed and sold. It is
  simulated in-app (`src/agora/market.ts`, page `/agora`, API `/api/agora`) and labeled as
  simulated. Agora only allows accepting the highest bid; payout = bid minus fee.

## Agent
- `src/agent/run.ts` is the loop; `src/agent/tools.ts` holds the tools. Tools refuse to run
  out of order (no credit before the plan verifies, no Agora listing before refurbishing).
- LLM calls go through Nicrron (`src/lib/nicrron.ts`, OpenAI SDK, base URL
  `https://api.nicrron.ai/v1`), pinned to `anthropic/claude-sonnet-5-5` with
  `openai/gpt-6-sol` as fallback. Avoid DeepSeek and Kimi: they may train on API data.
- Every step is a `TraceEvent` (the PRISM feed). The summary is checked for dollar and kg
  figures that no tool returned (`unsupportedFigures`).
- Keys live in `.env.local` (gitignored). `.env.example` lists the variables.

## ElevenLabs voice intake
- Agent "GPU Recovery Intake" was created by `scripts/setup-elevenlabs-agent.mjs` (Claude Sonnet
  5.5, two client tools: `open_recovery_case`, `book_installation`). Its id is
  `ELEVENLABS_AGENT_ID` in `.env.local`. The "Netbalance CFO" agent on the account is unrelated;
  leave it alone.
- The browser gets a signed URL from `/api/voice/session`; the API key never reaches the client.
  `open_recovery_case` checks the serial via `/api/intake`, then starts the recovery agent with
  what the caller said. The transcript goes to PRISM `/api/voice/turns` when the call ends.
- The key needs ElevenLabs Agents read and write permissions.

## PRISM (Block Convey)
- Each run sends a trace, spans, and a trajectory (`src/lib/prism.ts`), with the checks in
  `src/agent/checks.ts` (coverage, calculation, settlement, carbon claims, house rules) as metadata.
- Auth header is `X-PRISMtrace-Key`, not Bearer. Start any investigation with
  `GET /api/setup-doctor?project_id=...`. Full route list: `/openapi.json` (needs the header).
- Reads and ingestion are free. Analysis, backfill, narrative, and generate-fix spend credits:
  never call them without stating the cost and getting a yes. Check
  `GET /api/credits/balance?org_id=...` first. A 402 means out of credits; stop, do not retry.

## Build decisions
- Next.js + TypeScript, run locally for the demo. No Vercel or other hosting.
- The LLM decides which step to take and calls tools. Every dollar and carbon number
  comes from deterministic, tested code in `src/core`, never from the model.
- Scenario data (company, units, prices, simulated payments) lives in one file,
  `src/core/scenario.ts`, so the story can be changed without touching logic.
- Tests: `npm test` (Vitest). The demo targets above are asserted in tests.
- Next.js 16 here has Cache Components on: use `await connection()` for per-request
  pages, not `export const dynamic`. Read `node_modules/next/dist/docs/` before Next APIs.

## EPA data (fetched live by `src/lib/epa.ts`, read by label, never by row number)
- Manufacturing side (materials): WARM v16, sheet `Summary Data`, `Mixed Electronics`,
  column `Source Reduction`. WARM shows it as negative (avoided); its size is used.
- Refurbishing side (waste): Emission Factors Hub 2025, Table 9, `Mixed Electronics`,
  `Recycled` (no avoided-emission credit). EPA has no refurbishment pathway; this is the
  closest proxy and the page says so. Do not use WARM's net recycling factor (double counts).
- Both are MTCO2E per short ton, converted exactly to kg CO2e per kg.
- Grid: zip to subregion via EPA Power Profiler (07094 is RFCE), then eGRID2023 rev2
  Table 1 non-baseload CO2e in lb/MWh, which EPA points to for estimating reductions.
- If a fetch or label lookup fails, that figure stays pending and the error is shown.

## House rules
- Plain language in anything user-facing. Never use em-dashes.
- Never present an estimate as a verified figure. Pending stays pending.
- Approvals, bids, pickup, and payments in the demo are simulated; label them as such.
