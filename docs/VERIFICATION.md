# Verifying JanLekha records without trusting the StreetSync backend

JanLekha financial records live on Arc Testnet, not in the StreetSync
backend. The backend indexer and the API at `/api/janlekha/*` exist to
make records searchable and fast. They are a convenience layer, not the
source of truth. This document shows how any citizen verifies a record
directly from public blockchain data, with no StreetSync account, no
wallet, and no trust in the backend.

Status: the JanLekha registries have NOT been deployed to Arc Testnet
yet. The contract addresses in `contracts/deployments/arcTestnet.json`
under `janlekha` are zero addresses, clearly marked NOT_DEPLOYED. Until
a deployment happens, there are no on-chain JanLekha records to verify,
and the steps below will return nothing. That is the honest state. Do
not treat demo data in the app as on-chain verified data.

## Network facts

- Network: Arc Testnet
- Chain ID: 5042002
- RPC: https://rpc.testnet.arc.io
- Explorer: https://explorer.testnet.arc.io
- Settlement token: ERC-20 USDC, 6 decimals (1 USDC = 1,000,000 base
  units). Native gas on Arc is also USDC, but with 18 decimals. Never
  mix the two.
- Deployment file after a real deployment:
  `contracts/deployments/arcTestnet-janlekha.json`. It lists each
  registry address, its deployment transaction hash, and its ABI. The
  backend indexer reads this same file, or the `JANLEKHA_*_REGISTRY_ADDRESS`
  environment variables, so the backend and the public verification
  path agree on the addresses.

## Contracts

All eight registries are in `contracts/src`, Solidity 0.8.24, Hardhat:

- `JanLekhaRoleRegistry` (roles: ADMIN, FINANCE, PROCUREMENT,
  CONTRACTOR, AUDITOR, CITIZEN)
- `JanLekhaBudgetRegistry` (allocations, releases, corrections)
- `JanLekhaProjectRegistry` (project registration and status)
- `JanLekhaProcurementRegistry` (tenders, bids, awards)
- `JanLekhaMilestoneRegistry` (milestone submission and verification)
- `JanLekhaPaymentRegistry` (payments, invoice hashes, limits)
- `JanLekhaDocumentRegistry` (evidence hashes)
- `JanLekhaAuditRegistry` (flags, resolutions, reports)

## The lifecycle event

Every financial action emits `JanLekhaLifecycleRecorded` from
`JanLekhaTypes.sol`, with these fields:

- `recordId` (bytes32, indexed): unique id of this record
- `projectId` (bytes32, indexed)
- `departmentId` (bytes32, indexed)
- `actionType` (string): for example `AllocationApproved`,
  `AllocationReleased`, `MilestoneVerified`, `PaymentRecorded`
- `stage` (FundStage): Budget, Approval, Allocation, Release,
  Execution, Expenditure, Verification, Audit, Completion
- `amountInr` (uint256, whole rupees, reporting only)
- `amountUsdcBaseUnits` (uint256, 6-decimal USDC base units)
- `actor` (address): the authorized account that acted
- `evidenceHash` (bytes32): SHA-256 of the supporting evidence, or
  zero when the action has no evidence
- `previousRecordId` (bytes32): the record this one corrects or
  follows, or zero for a first record

Each registry also emits its own specific event, for example
`AllocationApproved`, `PaymentRecorded`, `MilestoneVerified`,
`DocumentRegistered`, `FlagRaised`. The lifecycle event is the
common trail; the specific events carry the full detail.

## Verifying a project by hand

1. Find the project id. On-chain ids are bytes32, the keccak256 of
   the JanLekha string id. The backend API returns the same bytes32
   id for each project at `GET /api/janlekha/projects`, and the
   frontend shows it on the project page.
2. Open the explorer at https://explorer.testnet.arc.io and search
   for the BudgetRegistry, PaymentRegistry, and DocumentRegistry
   addresses from `contracts/deployments/arcTestnet-janlekha.json`.
3. On each contract page, open the Events or Logs tab and filter by
   `JanLekhaLifecycleRecorded` with `projectId` equal to the project
   id. The events arrive in block order, which is the audit timeline.
4. For each event, check: the stage follows the lifecycle order
   (Budget, Approval, Allocation, Release, Execution, Expenditure,
   Verification, Audit, Completion), the actor held the role the
   action requires (check `RoleGranted` events on the RoleRegistry),
   the amount never exceeds the authorised limit for the project
   (sum of `AllocationApproved` amounts for that project, minus any
   correction deltas), and a payment event always follows a
   `MilestoneVerified` event for the same milestone.
5. Corrections: a correction never edits the original. It is a new
   event whose `previousRecordId` points at the original record id.
   If an event claims to correct a record, the original event must
   still be present on chain with its original values.

## Verifying with an Arc RPC call

No wallet is needed. Any public Arc Testnet RPC endpoint works. Use
`cast` (Foundry) or `curl` with JSON-RPC. The lifecycle event
signature is:

```
JanLekhaLifecycleRecorded(bytes32,bytes32,bytes32,string,uint8,uint256,uint256,address,bytes32,bytes32)
```

With `cast`, for a deployed BudgetRegistry at
`<BUDGET_REGISTRY_ADDRESS>`, from the deployment block:

```bash
cast logs --rpc-url https://rpc.testnet.arc.io \
  --from-block <DEPLOYMENT_BLOCK> \
  --to-block latest \
  --address <BUDGET_REGISTRY_ADDRESS> \
  "JanLekhaLifecycleRecorded(bytes32,bytes32,bytes32,string,uint8,uint256,uint256,address,bytes32,bytes32)"
```

Replace `<BUDGET_REGISTRY_ADDRESS>` and `<DEPLOYMENT_BLOCK>` with the
values from `contracts/deployments/arcTestnet-janlekha.json`
(`deploymentBlock` field). Repeat for the other registries. The raw
logs are the authoritative record; compare them field by field with
what the backend API and the frontend show. Any mismatch means the
backend is wrong or stale, and the chain wins.

## Verifying evidence

Evidence is stored on Arkiv, not on chain. The chain holds only the
SHA-256 content hash, in `DocumentRegistered` events and in the
`evidenceHash` field of lifecycle events.

1. Get the content hash from the on-chain event.
2. Get the Arkiv reference from the backend at
   `GET /api/janlekha/documents/<contentHash>` or from the document
   page in the app. The reference is an Arkiv entity id, never a
   transaction hash.
3. Retrieve the entity from Arkiv with the client in
   `packages/arkiv-client/src/janlekha.ts`. Decompress the Zstd
   payload with the pipeline in `packages/evidence/src/janlekha.ts`.
4. Compute SHA-256 of the decompressed bytes and compare it with the
   on-chain content hash. They must match exactly. A mismatch means
   the evidence was tampered with or is not the evidence the record
   cites, and the record must not be trusted.
5. For large files, the evidence is split into chunks with a manifest.
   The manifest lists each chunk in order with its own SHA-256. Verify
   every chunk hash and the manifest hash before trusting the
   reassembled file. See `packages/evidence/src/janlekha.ts` for the
   exact envelope format.

What is NOT verified by this process: the chain proves that a given
account recorded a given hash at a given time. It does not prove the
original government submission was truthful. A real invoice hash can
still be attached to a false invoice. Independent verification means
checking the evidence itself, the auditor's verification, and the
audit flags, not just the hash.

## Verifying World ID participation

World ID is used only for citizen participation: one feedback,
complaint, or community review per verified human per item. It proves
uniqueness, not official role. No personal identity is on chain. The
backend stores only the nullifier hash in SQLite, scoped per action
(`janlekha-feedback-<projectId>`, `janlekha-complaint-<projectId>`,
`janlekha-community-review-<milestoneId>`). A citizen can check that
their own nullifier was recorded once by calling
`GET /api/janlekha/status`, which reports whether World ID is
configured, and by the 409 response the API returns on a duplicate.
There is no on-chain World ID record to verify for JanLekha, and
none is claimed.

## If the indexer is unavailable

The backend is not needed for any of the checks above. Use the Arc
explorer or a direct RPC call as shown. The deployment file
`contracts/deployments/arcTestnet-janlekha.json` is committed to the
repository, so the contract addresses and ABIs are available even if
the backend is down. The frontend also reads the same addresses from
its public environment variables and links each record to its Arc
explorer page.

## What the backend adds

The backend indexer (`backend/src/indexer.ts`) polls each registry,
stores decoded events in SQLite tables (`janlekha_events`,
`janlekha_projects`, `janlekha_allocations`, `janlekha_payments`,
`janlekha_documents`, `janlekha_flags`), and serves them at
`GET /api/janlekha/projects`, `/transactions`, `/departments`,
`/documents`, and `/projects/:id/timeline`. It adds search, filtering,
and aggregates. It never creates, edits, or deletes a financial
record. If the indexer is behind the chain, its `/api/janlekha/status`
endpoint reports the last indexed block per registry, so staleness is
visible.
