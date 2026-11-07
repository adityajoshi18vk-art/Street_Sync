# JanLekha verification, complaints, and audit trail

Notes on the JanLekha pages inside StreetSync: the document verifier, risk
labels, complaints, and the audit trail. Everything here is DEMO DATA unless
a section says otherwise.

## Document verifier (`/janlekha/verify`)

The verifier is real, not a mock. When a file is uploaded, the page reads
the file into an `ArrayBuffer` and computes its SHA-256 hash in the browser
with the Web Crypto API (`crypto.subtle.digest("SHA-256", ...)`). The file
never leaves the device: no upload, no server call.

The computed hash is then compared, string for string, against the
`documents` registry in the shared JanLekha state (`@/lib/janlekha/context`).
The result is one of:

- MATCH: a document with this exact hash is registered. The page shows the
  registered record (title, project, type, uploader, date, verification
  status) and a link to the Arc Testnet explorer home.
- NO MATCH: no document in the registry has this hash. The file is not
  registered here, or it differs from the registered copy.
- Error: the pasted value is not a 64 character hexadecimal SHA-256 hash, or
  the browser could not compute a hash (Web Crypto needs a secure context:
  HTTPS or localhost).

A hash can also be pasted directly, or passed in the URL as
`/janlekha/verify?hash=<64 hex chars>`, which is how the document registry
links here. The hash can be copied to the clipboard from the result card.

What verification does and does not prove:

- It proves the checked file has exactly the same bytes as the file that was
  registered under this hash, at the date shown in the registry.
- It does not prove the contents are true, the uploader is who they claim
  to be, or the document is genuine outside this registry.
- It does not prove an unmatched file is fake. It only shows the file is not
  registered here, or that it differs from the registered copy.

Arc explorer links: the verifier links to the Arc Testnet explorer home
only. No record in the demo registry has a real transaction hash, so no
`/tx/<hash>` link is ever constructed and no hash is invented.

## Risk labels

Risk flags use exactly two labels, and nothing else:

- Requires Investigation
- Potential Discrepancy

The word "fraud" is never used. Detection is a prompt for human review, not
a conclusion of wrongdoing, and every flag card says so in the UI. The risk
engine (`@/lib/janlekha/risk`) computes flags from live records: budget
variance, duplicate document or evidence hashes, payments over the authorised
milestone limit, repeated payments to one milestone, delayed milestones, and
missing supporting documents. The `RiskFlagCard` component
(`app/src/components/janlekha/RiskFlagCard.tsx`) renders a flag with its
evidence, auditor notes, and resolution history.

## Complaints (`/janlekha/complaints`)

Citizens submit a complaint with a name, project, category (work quality,
delay, safety, corruption concern, access and facilities, other), subject,
and detail. New complaints start as Submitted and appear at the top of the
list. Each complaint has an expandable updates timeline that records its
status history.

Sybil resistance: World ID sybil resistance for complaints is handled by
the StreetSync World ID integration, not by this page. This demo does not
collect identity: the name entered is a display name only, and no identity
document, phone number, or wallet address is asked for or stored here.
Do not include sensitive personal information such as bank details or
identity numbers in a complaint.

## Audit trail (`/janlekha/audit-trail`)

The audit trail is the verifiable transaction and action history across the
full money lifecycle: budget, approval, allocation, release, expenditure,
verification, and audit. It is built from the live event log plus derived
entries for allocations (funds released), payments, milestones, and
documents that have no matching event record, so the trail covers every
record in the demo data.

Each entry shows:

- Record ID
- Action type and lifecycle stage
- Amount in INR, and USDC where the entry is a payment (USDC is simulated
  settlement, shown separately from INR budget records)
- Responsible account (actor and role)
- Timestamp
- Evidence reference, labelled by kind: SIM-ARC reference, document hash,
  or milestone evidence hash
- Previous record reference: the ID of the previous entry in the same
  project chain, or "Genesis record" for the first entry of a chain

The trail is searchable and filterable by lifecycle stage and project, and
can be downloaded as JSON. The "Verify chain" button really checks the
chain: it confirms record IDs are unique, every previous reference points
at an existing record, and every entry points at the immediately preceding
record in its own project chain. It reports the number of entries and
chains checked, and lists any breaks it finds.

## What is real versus simulated

Real:

- SHA-256 computation in the browser (Web Crypto API) and the hash
  comparison against the registry.
- Audit report downloads: the text and JSON files are generated in the
  browser from the selected report.
- Audit trail chain verification: the check runs over the live trail data.
- Complaint submission and status tracking: stored in local demo state
  (localStorage, key `janlekha-demo-v1`) and shared across the JanLekha
  pages in this browser.

Simulated (labelled SIM-ARC and DEMO DATA in the UI):

- All figures, projects, departments, tenders, payments, documents,
  complaints, and audit reports are realistic synthetic demo data, not
  actual government expenditure.
- All payments are simulated. A SIM-ARC reference is a demo reference, not
  a real transaction hash, and references link to the Arc Testnet explorer
  home, never to a transaction page. No contracts are deployed yet.
- INR budget records and USDC settlement are separate concepts. USDC
  amounts are simulated settlement on Arc Testnet.
- New payments created in the demo mark Settled immediately; the second
  authoriser rule is shown in the demo data (one seed payment is Pending
  authorisation) but is not enforced for new demo payments.
