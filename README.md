# netbalance-soventify

AI GPU Recovery Agent for the Money Talks 2 hackathon (Money Operations track).

A small AI company's data center GPU fails. The agent verifies the protection plan from
diagnostics, issues a warranty credit, sells a more power-efficient replacement, resells the
refurbished failed unit, and reconciles all three money flows plus a sourced carbon record.

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
