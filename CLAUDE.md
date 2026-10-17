# CLAUDE.md - Money Talks 2 Hackathon

## Project
Netbalance: container datacenter recovery. Money Talks 2 hackathon, Money Operations track.
The story, numbers, and design come from the team's `netbalance-datacenter-demo.html`; this
repo makes it real with live integrations.

Case DC-014 (all simulated): Alex Morgan (AWS, illustrative caller) calls Helix Data Center
Support about a coolant leak in Rack 12, eight H100 80GB GPUs, at the Ashburn, Virginia site.
The demo opens on a CFO workspace page (the new incident, live status, "Start financial
recovery"), then six steps:
1. Call & dispatch: incident logged, technician Maya Chen on site by 2:00 PM.
2. Inspect & cover: the photo starts the warranty check. Policy DC-PROTECT section 4 covers the
   container and racks with a $200,000 credit (CLM-014); section 7 excludes the GPUs because the
   leak came from the external cooling system.
3. Choose replacement: the credit transfer from WC-014 to replacement order RO-014 is held until
   a person approves (APR-014). Offers: original module $520,000 (customer cash $320,000) or
   integrated module $620,000 plus a $60,000 3-year leak monitoring and cooling maintenance plan
   ($680,000), with a $200,000 simulated J.P. Morgan GPU credit line (customer cash $280,000).
   The customer picks integrated. The service plan's $60,000 price and $18,000 delivery cost are
   simulated assumptions, added so the improvement reaches the team's 80% target honestly.
4. Recover GPUs: the damaged lot is sold as-is on Agora to the best NET offer: GPU Circular,
   $31,000 less $1,000 shipping = $30,000 (beats Compute Renewal's higher $32,000 bid).
5. Reconcile: four transactions, five receipts.
6. CFO outcome: contribution, cash, carbon, PRISM checks.

## Demo targets (asserted in `src/core/__tests__/demo-targets.test.ts`)
- $712,000 cash received = $280,000 customer + $200,000 warranty remittance + $200,000 lender
  draw + $2,000 referral fee + $30,000 GPU lot. $0 outstanding. Cash received is not profit.
- Four transactions: warranty credit $200,000, new sale $680,000, referral $2,000, GPU sale
  $30,000. Never add them together (that wrongly gives $912,000): the warranty credit is already
  inside the $680,000 sale. Warranty credit and lender funding pay the invoice; neither is revenue.
- Contribution: $130,000 baseline (standard module, $10,000 GPU recovery) vs $234,000 selected:
  +$104,000, +80.0% (+$40,000 upgrade, +$42,000 service plan, +$20,000 GPU recovery, +$2,000
  referral). Loan principal is never contribution. 80% is an improvement over the baseline, not
  a margin: contribution is about a third of cash received.
- The CFO slide stays on one screen: headline, one before/after, four numbers. Detail goes in
  "View details & evidence".
- The CFO view also shows avoided CO2e in kg with weight, treatment route, baseline, factor
  source, and method. Missing evidence means pending, not verified.

## Carbon methodology (from Soventify)
Every carbon number follows these rules:
1. Name the activity family: refurbishing failed GPUs is waste (e-waste); manufacturing new GPUs
   is materials.
2. Use the jurisdiction's authority: US figures come from the EPA, fetched at calculation time.
   Never copy a factor from memory. A factor from the wrong country is worse than none.
3. Multiply only when the units match: weight in kg times a factor in kg CO2e per kg. If units do
   not match, stop. Record the lot weight in kg at intake (16 kg, simulated).
4. Avoided CO2e = carbon of manufacturing new GPUs minus carbon of refurbishing the old ones.
   Show both sides separately, then the difference. Both sides calculated the same way.
5. Every carbon figure carries its source: authority, edition, link. No source, no number.
   Carbon here is a sourced estimate, not ESG compliance certification.
6. Energy bonus: meter the replacement against a baseline and show avoided energy cost next to
   avoided carbon.
- The GPU lot is sold as-is for refurbishment or parts, so the avoided-carbon figure is shown with
  the condition that it holds only if the buyer refurbishes the modules for reuse.

## Sponsor tools (judging checks usage via an AI agent)
- ElevenLabs: live voice support line (step 1). Scripted browser playback is the backup.
- Nicrron x Ninoo: model gateway for all LLM calls: the agent autopilot and the plain-language
  coverage explanation (step 2).
- PRISM by Block Convey: traces, spans, trajectories, and checks for every finished case; every
  guardrail hold, refusal, and approval; voice transcripts.
- Agora: reseller market, simulated in-app (`src/agora/market.ts`, page `/agora`). Accepts only
  the best net offer.

## Architecture
- `src/core`: pure, tested money and carbon logic. `scenario.ts` holds all story data; change the
  story there, not in logic. `coverage.ts`, `credit.ts` (approval rule), `ledger.ts` (receipts,
  transactions), `contribution.ts`, `carbon.ts`, `energy.ts`, `report.ts` (CFO view).
- `src/agent/case.ts`: one shared case record (server memory). The presenter's buttons
  (`/api/case/action`), the voice call, and the agent autopilot (`/api/agent`) all change it
  through the same tools in `src/agent/tools.ts`, so every screen shows the same truth.
  `/api/case/approve` is the human approval. `/api/case/reset` resets case and market.
- Tools refuse to run out of order. The LLM decides steps; every figure comes from `src/core`.
- `src/agent/checks.ts`: coverage, calculation, settlement, guardrail, carbon-claim, and
  house-rule checks, sent to PRISM with each finished case (`src/lib/case-context.ts`).
- UI: `src/app/demo/*` ports the team's six-step design; its CSS is `src/app/demo.css` and its
  images are in `public/demo/`.

## Guardrails
- Credit transfer (step 3): credit never moves between accounts automatically. A person must
  approve that exact amount, source, and destination. Any destination other than the customer's
  replacement order RO-014 is refused outright (the page has a "send the credit to a new account"
  test). Enforced in `src/core/credit.ts`; every event is recorded in PRISM.
- Live call (step 1): every caller sentence is checked (`src/core/guardrail.ts`). A request to
  send money to a new account, or bank details read out, is blocked and the voice agent gives a
  fixed reply.
- PRISM's own guardrail API (`evaluateGuardrail`) checks the autopilot summary. The project's Free
  plan is not entitled, so it reports "not evaluated", never "passed". PRISM cannot veto tool
  calls; our tools do that.

## Agent
- Autopilot: `src/agent/run.ts`. LLM calls go through Nicrron (`src/lib/nicrron.ts`, OpenAI SDK,
  `https://api.nicrron.ai/v1`), pinned to `anthropic/claude-sonnet-5-5` with `openai/gpt-6-sol`
  as fallback. Avoid DeepSeek and Kimi: they may train on API data. The autopilot waits for the
  human approval in step 3 and continues from wherever the presenter left off.
- The summary is checked for dollar, percent, and kg figures that no tool returned.
- Keys live in `.env.local` (gitignored). `.env.example` lists the variables.

## ElevenLabs voice support line
- Agent "Helix Data Center Support Line" (`ELEVENLABS_AGENT_ID`) is set up by
  `scripts/setup-elevenlabs-agent.mjs`, which updates that agent in place. Rerun it after
  changing the call script. The "Netbalance CFO" agent on the account is unrelated; leave it.
- Greeting: "Helix Data Center Support. How can I help?" Then the safety question, then the
  `log_incident` client tool (same case tool, actor "voice"), then the technician time from
  `scenario.dispatch`, never from the model.
- The browser gets a signed URL from `/api/voice/session`; the key never reaches the client.
  The transcript goes to PRISM `/api/voice/turns` when the call ends.
- The key needs ElevenLabs Agents read and write permissions.

## PRISM (Block Convey)
- Auth header is `X-PRISMtrace-Key`, not Bearer. Start any investigation with
  `GET /api/setup-doctor?project_id=...`. Full route list: `/openapi.json` (needs the header).
- Reads and ingestion are free. Analysis, backfill, narrative, and generate-fix spend credits:
  never call them without stating the cost and getting a yes. Check
  `GET /api/credits/balance?org_id=...` first. A 402 means out of credits; stop, do not retry.

## Build decisions
- Next.js + TypeScript, run locally for the demo. No Vercel or other hosting.
- Tests: `npm test` (Vitest).
- Next.js 16 here has Cache Components on: use `await connection()` for per-request pages, not
  `export const dynamic`. Read `node_modules/next/dist/docs/` before Next APIs.
- If the dev server serves an old copy of a changed file (a route says a function "is not a
  function"), restart it.

## EPA data (fetched live by `src/lib/epa.ts`, read by label, never by row number)
- Manufacturing side (materials): WARM v16, sheet `Summary Data`, `Mixed Electronics`, column
  `Source Reduction`. WARM shows it as negative (avoided); its size is used.
- Refurbishing side (waste): Emission Factors Hub 2025, Table 9, `Mixed Electronics`, `Recycled`
  (no avoided-emission credit). EPA has no refurbishment pathway; this is the closest proxy and
  the page says so. Do not use WARM's net recycling factor (double counts).
- Both are MTCO2E per short ton, converted exactly to kg CO2e per kg.
- Grid: zip to subregion via EPA Power Profiler (site zip 20147), then eGRID2023 rev2 Table 1
  non-baseload CO2e in lb/MWh.
- If a fetch or label lookup fails, that figure stays pending and the error is shown.

## House rules
- Plain language in anything user-facing. Never use em-dashes.
- Never present an estimate as a verified figure. Pending stays pending.
- Approvals, bids, pickup, financing, and payments in the demo are simulated; label them as such.
  AWS and J.P. Morgan are illustrative, not claimed customers or partners.
