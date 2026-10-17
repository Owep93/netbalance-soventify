# netbalance-soventify

Netbalance: container datacenter recovery, for the Money Talks 2 hackathon (Money Operations track).

A coolant leak hits Rack 12 of a container datacenter. Six steps take it from the support call
(live ElevenLabs voice) through a warranty check, a credit transfer that waits for human approval,
a replacement sale with financing, a GPU lot sale on a simulated Agora market, and an automatic
reconciliation, to the CFO outcome with a sourced EPA carbon record. A Nicrron agent can run the
whole case on autopilot, and every finished case is traced and checked in PRISM.

All demo data (companies, approvals, bids, pickup, meter readings, payments) is simulated.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Test it

```bash
npm test
```

Money and carbon math lives in `src/core` and is covered by tests. See `CLAUDE.md` for the
project rules and carbon methodology.
