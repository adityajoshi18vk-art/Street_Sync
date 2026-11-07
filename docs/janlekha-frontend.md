# JanLekha frontend in StreetSync

JanLekha 2.0 citizen portal and shared scaffold, ported from the standalone
JanLekha 2.0 Vite app in `~/workspace/janlekha` into the StreetSync Next.js 14
app under `app/src/app/janlekha/`. Light themed citizen pages inside the dark
StreetSync shell: white and slate cards, navy headings, cyan `#22D3EE` and
green `#34D399` accents, midnight navy `#080F1C` for dark sections.

## What was built

- Shared lib in `app/src/lib/janlekha/`: `data.ts` (JanLekha 2.0 demo data and
  types), `format.ts`, `permissions.ts` (role routes now point at
  `/janlekha/roles/...`), `risk.ts` (risk engine, ported as-is), `arc.ts`
  (Arc Testnet settings, simulated payment helper, no ethers dependency,
  contract addresses read from `NEXT_PUBLIC_ARC_*` env vars), `context.tsx`
  (`JanLekhaProvider`, client side, localStorage persistence with SSR safe
  hydration, plus an `allocations` collection).
- Shared components in `app/src/components/janlekha/`: `ui.tsx` (cards,
  badges, stat cards, page header, demo badge, verification labels),
  `Charts.tsx` (hand built SVG grouped bars, donut, and line chart, no
  recharts), `Sankey.tsx` (hand built SVG flow, ported), `IndiaMap.tsx`
  (SVG map with approximate state markers, ported).
- Module layout `app/src/app/janlekha/layout.tsx`: wraps the module in
  `JanLekhaProvider`, shows the DEMO DATA banner and the "citizens need no
  wallet" note, and renders the sub nav with Next Link.
- Citizen portal `app/src/app/janlekha/page.tsx`: national totals, department
  spend chart, top projects, latest payments and audits.
- Money tables: `budgets`, `allocations`, `releases`, `expenditure`. Each is a
  searchable, filterable table with totals. Every figure carries a label:
  on chain verified, reported but unverified, or demonstration data, with a
  legend on the page. Allocations also has a working approve and create
  allocation form.
- `projects` and `projects/[id]`, `departments` and `departments/[id]`: list
  plus detail with timeline, milestones, payments, evidence, and audit status.
- `money-flow`: interactive Sankey plus the step by step project journey.
- `map`: geographic project explorer using the IndiaMap component.

## Routes (this agent)

- `/janlekha` Overview
- `/janlekha/budgets`, `/janlekha/allocations`, `/janlekha/releases`, `/janlekha/expenditure`
- `/janlekha/projects`, `/janlekha/projects/[id]`
- `/janlekha/departments`, `/janlekha/departments/[id]`
- `/janlekha/money-flow`, `/janlekha/map`

## Routes linked to, built by parallel agents

- `/janlekha/verify`, `/janlekha/documents`, `/janlekha/complaints`,
  `/janlekha/audits`, `/janlekha/audit-trail`, `/janlekha/tenders`,
  `/janlekha/payments`, `/janlekha/roles/admin`, `/janlekha/roles/finance`,
  `/janlekha/roles/procurement`, `/janlekha/roles/contractor`,
  `/janlekha/roles/auditor`, `/janlekha/roles/citizen`, `/janlekha/login`
- The sub nav Roles entry points at `/janlekha/roles/citizen`, the citizen
  role workspace, since there is no `/janlekha/roles` index page. It stays
  highlighted on every `/janlekha/roles/*` page.

## Demo limits, stated in the UI

- All data is DEMO DATA: realistic synthetic data, not actual government
  expenditure.
- Payments are simulated. A payment creates a `SIM-ARC-...` demo reference,
  never a real transaction hash. No contracts are deployed yet, so no figure
  is a real on chain record. The "on chain verified" label means a verified
  hash is recorded in the demo registry only.
- The second authoriser rule is shown in the demo (one seed payment is
  Pending authorisation, over limit payments are flagged), but new payments
  created through the provider currently mark Settled immediately.
- No private keys or transaction hashes are hardcoded anywhere.

## Notes

- Next.js 14 App Router, React 18, Tailwind 3. No new dependencies were
  added. Charts are hand built SVG, no recharts, no ethers.
- Every interactive page starts with `"use client"`. The provider hydrates
  from localStorage after mount so server rendering never reads it.
- No em dash characters are used in UI copy, docs, or code comments.
- Not run here: `npm install` and `npm run build` were out of scope for this
  task, so run the app typecheck and build before shipping.
