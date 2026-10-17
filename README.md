# Revenue Growth Agent

**AI that protects margins, captures missed value, and reconciles every transaction for the CFO.**

## Market Problem

CFOs need to protect profitability and cash flow, but customer incidents create financial decisions across service, sales, and finance. Credits can go unused, asset value can be lost, and payments can remain unmatched. Finance is left chasing teams to understand the actual margin, cash collected, and outstanding balances.

## Use Case

A coolant leak hits Rack 12 at a customer's container datacenter: eight H100 80GB GPUs exposed. The CFO opens Netbalance and tells the agent:

> **CFO:** "AWS has a cooling leak in Rack 12. Take care of it."
>
> **Netbalance agent:** "I'll pursue warranty credits, recover value from affected GPUs, and reconcile every transaction. You approve transfers."

From there the agent runs the case end to end. The CFO steps in once, to approve the credit transfer.

## How It Works

**1. Call and dispatch.** The customer calls the Helix Data Center Support line (a live ElevenLabs voice agent). The incident is logged and a technician is on site by 2:00 PM.
**2. Inspect and cover.** The inspection photo starts the warranty check. Container and racks are covered: a **$200,000 warranty credit**. The GPUs are excluded because the leak came from the external cooling system. Nicrron explains the decision in plain language.
**3. Approve the credit.** The credit cannot move between accounts on its own. The agent holds the transfer until the CFO approves it, and refuses any destination other than the customer's replacement order.
**4. Choose the replacement.** The customer picks the new integrated module with unified cooling and a 3-year leak monitoring plan: **$680,000**, funded by the $200,000 credit, a $200,000 simulated GPU credit line, and $280,000 customer cash.
**5. Recover the GPUs.** The damaged lot is listed on Agora. The agent accepts the **best net offer**, $31,000 less $1,000 shipping = **$30,000**, which beats a higher $32,000 headline bid that loses more to shipping.
**6. Reconcile and report.** Four transactions are matched to their receipts. The CFO sees contribution, cash received, outstanding balance, and a sourced carbon record.

## Tools

- **ElevenLabs:** the live voice support line, with a guardrail that blocks any caller request to send money to a new account.
- **Nicrron:** the model gateway for the agent (Claude Sonnet 5.5) and the plain-language coverage explanation.
- **PRISM by Block Convey:** traces, spans, and trajectories for every case; checks on coverage, calculations, settlement, guardrails, and carbon claims; a record of every credit-transfer hold, refusal, and approval.
- **Agora:** competing GPU resale offers (simulated market).
- **US EPA data:** emission factors fetched live (WARM, GHG Emission Factors Hub, eGRID) for the carbon record.
- **Netbalance:** coordinates the case, enforces the approval rule, reconciles the money, and reports to the CFO.

## Business Value

Protect margins, improve cash visibility, and reduce the manual work required to financially close customer incidents. Handled by hand, a case like this takes an estimated 3 to 6 weeks and 8 to 10 people. With Netbalance, the agent runs it in under a minute, and people step in only as the caller, the technician, and the approver. (Illustrative estimate, not measured.)

## Demo KPIs

- **+$104,000 contribution (+80%)**: $234,000 vs a $130,000 baseline (standard module, $10,000 GPU recovery)
- **$712,000 cash received**: $280,000 customer + $200,000 warranty + $200,000 credit line + $2,000 referral fee + $30,000 GPU lot
- **$0 outstanding**, **4 of 4** transactions reconciled
- **$200,000** warranty credit applied, only after human approval
- **$30,000** net GPU recovery, best of 3 Agora offers after shipping
- **About 366 kg CO2e avoided**: a sourced EPA estimate that holds if the buyer refurbishes the modules for reuse
- **$1,008 per month** avoided energy cost on the metered baseline
- **10 of 10** PRISM checks passed on an autopilot run

## Outcome

The CFO sees **$712,000 in cash received** across 4 reconciled transactions, with supporting records for every one. The warranty credit and the credit-line draw pay the replacement invoice; neither is extra revenue. Adding the four transaction amounts together would wrongly give $912,000, so Netbalance never does. Cash received is not profit.

All companies, warranty terms, prices, bids, financing, and payments are simulated for the demo. AWS and J.P. Morgan are illustrative, not claimed customers or partners.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. API keys for Nicrron, ElevenLabs, and PRISM go in `.env.local` (see `.env.example`).

```bash
npm test
```
