# JanLekha role workspaces (StreetSync)

Six role workspaces plus demo login, ported from JanLekha 2.0 (`~/workspace/janlekha/src/pages/roles/*`) into the StreetSync Next.js 14 App Router app. All pages are dark themed: midnight navy `#080F1C` background, surface `#111D2E`, cyan `#22D3EE`, verified green `#34D399`.

## Routes

- `/janlekha/login` - demo sign in, six role cards, reset demo data button.
- `/janlekha/roles/admin` - Government Administrator.
- `/janlekha/roles/finance` - Finance Officer.
- `/janlekha/roles/procurement` - Procurement Officer.
- `/janlekha/roles/contractor` - Project Manager / Contractor.
- `/janlekha/roles/auditor` - Independent Auditor.
- `/janlekha/roles/citizen` - Citizen / Taxpayer.

Every workspace has a role guard (access denied card with a switch role button), a role sidebar, overview KPIs, search and filters, data tables with detail links, notifications, and an activity timeline. Every button does something, and every link points to a route in the JanLekha section: `/janlekha`, `/janlekha/projects`, `/janlekha/projects/[id]`, `/janlekha/tenders`, `/janlekha/verify`, `/janlekha/documents`, `/janlekha/audits`, `/janlekha/complaints`, `/janlekha/roles/*`, `/janlekha/login`.

Shared code lives in `app/src/components/janlekha/RoleShared.tsx` (dark cards, KPI cards, tables, forms, guards, activity timeline, notifications panel, risk flag card, workspace layout with sidebar) and in `app/src/lib/janlekha/*` plus `app/src/components/janlekha/ui.tsx` (created by the scaffold agent in parallel from the same JanLekha sources).

## What each workspace does

- **Admin**: add departments, register projects, assign officials (recorded in the demo activity log), view the role permission matrix, review approval requests (open audit flags, payments pending authorisation, submitted milestones), monitor platform activity, reset demo data.
- **Finance**: approve allocations, initiate simulated USDC payments for Verified milestones only, see the pending authorisation queue, review the payments table with search and status filter, and see USDC transaction references (all `SIM-ARC-*`, simulated, never real transaction hashes).
- **Procurement**: publish tenders, evaluate bids (cheapest first for comparison) and select a winning bid, view awarded contract details, record tender amendment notes (demo session log only, not a system record).
- **Contractor**: pick a company, submit bids on open tenders, submit milestones, upload invoices and evidence (hashed in the browser with SHA-256 and registered as a document record), track payment requests. No verify button exists here by design.
- **Auditor**: live risk scan computed from current records, stored risk flags with filters and a detail panel, flag resolution with a note added to the resolution history, milestone verification queue, publish audit findings (added to the public audit reports), read only scope for original financial records.
- **Citizen**: read only. Follow projects, save and apply searches, verify a document hash against the demo register (shortcut to `/janlekha/verify`), file complaints and track their status.

## Permission matrix

| Role | Permissions |
| --- | --- |
| Government Administrator | manage_departments, create_project, approve_budget, view_public |
| Finance Officer | approve_budget, release_funds, initiate_payment, view_public |
| Procurement Officer | publish_tender, evaluate_bids, view_public |
| Project Manager / Contractor | submit_bid, submit_milestone, view_public |
| Independent Auditor | verify_milestone, publish_audit, view_public |
| Citizen / Taxpayer | view_public |

Separation rules enforced in the demo: a Finance Officer cannot authorise a payment they initiated (`canAuthorisePayment` returns false for a self authorisation); a contractor cannot verify their own milestones (`can(role, "verify_milestone")` is false for the Contractor role); an auditor cannot edit original financial records (no edit controls exist in that workspace).

## Demo auth limits

- Sign in is **DEMO ONLY**: pick a role card, no password, no real account, role stored in `localStorage` only (`janlekha-role`), demo data in `localStorage` under `janlekha-demo-v1`.
- Role checks are enforced in the app layer only. **Production must enforce role based access control server side, on every request**, not only by hiding pages or buttons. This is stated in the login page UI, in each access denied card, and in the admin permission matrix card.
- All figures are **DEMO DATA**: realistic synthetic data, not actual government expenditure. Every workspace labels this in the UI.
- **Honest payment limit**: new payments initiated in the Finance workspace currently mark Settled immediately instead of waiting for a second authoriser. The pending authorisation queue shows the seeded pending payment (Rs 40 Cr to Meridian Infrastructure Ltd). A production backend must hold every payment until a second authoriser approves it. This limit is stated in the Finance workspace UI and in the shared context file.
- No private keys or transaction hashes are hardcoded anywhere. All payment references are `SIM-ARC-*` demo references.
