# Arc migration notes: JanLekha registries, Foundry to Hardhat

## What was ported

JanLekha 2.0 (`~/workspace/janlekha`, commit 0da05fe, also
`adityajoshi18vk-art/JanLekha` main 8a4c814) shipped eight Solidity
registries written for Foundry, with 18 Foundry tests. Those eight
registries are now ported into StreetSync `contracts/src` as Hardhat
Solidity 0.8.24:

- `JanLekhaRoleRegistry.sol` from `RoleRegistry.sol`
- `JanLekhaBudgetRegistry.sol` from `BudgetRegistry.sol`
- `JanLekhaProjectRegistry.sol` from `ProjectRegistry.sol`
- `JanLekhaProcurementRegistry.sol` from `ProcurementRegistry.sol`
- `JanLekhaMilestoneRegistry.sol` from `MilestoneRegistry.sol`
- `JanLekhaPaymentRegistry.sol` from `PaymentRegistry.sol`
- `JanLekhaDocumentRegistry.sol` from `DocumentRegistry.sol`
- `JanLekhaAuditRegistry.sol` from `AuditRegistry.sol`
- `JanLekhaTypes.sol` is new, shared by all eight. It holds the
  `FundStage` enum and the `JanLekhaLifecycleRecorded` event, which
  the Foundry originals did not have as a common event.

The old `janlekha/` sub-app inside Street_Sync is Hedera based
(`JanLekha.sol`, Prisma, Hedera testnet deployment). Nothing from it
was ported. It is being retired by the frontend coordinator. Do not
copy it.

## What changed in the port

- Toolchain: Foundry (`forge test`, `foundry.toml`) to Hardhat
  (`npx hardhat test`, `contracts/hardhat.config.ts`). The JanLekha
  Foundry tests in `~/workspace/janlekha/contracts/test/JanLekha.t.sol`
  are ported to `contracts/test/JanLekha.test.ts` in Hardhat Mocha and
  Chai style, matching the existing `StreetSync.test.ts`.
- Shared lifecycle event: every financial action now also emits
  `JanLekhaLifecycleRecorded` with record id, project id, department
  id, action type, stage, INR amount, USDC base units, actor,
  evidence hash, and previous record id. This is the common trail the
  backend indexer and the verification doc rely on.
- Corrections: the Foundry originals already used new records for
  corrections in most places. The port makes it uniform: no registry
  rewrites a stored record. `correctAllocation` and payment
  corrections create a new record referencing the original, and the
  authorised limit moves by the difference only.
- USDC handling: unchanged in intent, made explicit. All USDC amounts
  are ERC-20 base units with 6 decimals. The PaymentRegistry exposes
  `USDC_DECIMALS()` returning 6, and the deploy script asserts it.
  No function accepts `msg.value`. Native gas on Arc is also USDC,
  with 18 decimals, and must never be confused with the 6-decimal
  settlement token.
- Role model: unchanged. Roles are ADMIN, FINANCE, PROCUREMENT,
  CONTRACTOR, AUDITOR, CITIZEN. The last admin cannot be revoked, so
  the registry is never orphaned. Role changes emit events.
- Wiring: the registries reference each other by address, set at
  deployment. The deploy script checks the milestone to payment
  registry wiring and the USDC decimals before writing the deployment
  file.

## What stayed the same

- Business rules: only Finance approves allocations and records
  payments, payments cannot exceed the authorised limit, payments
  require a verified milestone, contractors cannot verify their own
  milestone, auditors cannot edit original records, duplicate invoice
  hashes are rejected, one bid per contractor, tender bid and award
  flow.
- Fund lifecycle order: Budget, Approval, Allocation, Release,
  Execution, Expenditure, Verification, Audit, Completion.
- INR and USDC are separate concepts. INR figures are whole rupees
  for reporting. USDC settlement figures are 6-decimal base units.
- Demo data only. No real government expenditure is recorded.

## Deployment status

NOT_DEPLOYED. No JanLekha registry has been deployed to Arc Testnet.
`contracts/deployments/arcTestnet.json` under `janlekha` lists all
eight contracts with the zero address and status NOT_DEPLOYED. The
real deployment file, once deployed, is
`contracts/deployments/arcTestnet-janlekha.json`, written by
`contracts/scripts/deploy-janlekha.ts` with addresses, deployment
transaction hashes, and ABIs. The backend indexer reads that file
(or the `JANLEKHA_*_REGISTRY_ADDRESS` env vars). Until then, the
indexer reports JanLekha indexing as disabled at
`GET /api/janlekha/status`, and the frontend uses its simulated
settlement path and says so.

Deploy, testnet only, never mainnet:

```bash
cd contracts
npx hardhat run scripts/deploy-janlekha.ts --network arcTestnet
```

`PRIVATE_KEY` comes from the environment only. Never hardcode it.
The deploy script also accepts optional demo role addresses
(`JANLEKHA_FINANCE_ADDRESS`, `JANLEKHA_PROCUREMENT_ADDRESS`,
`JANLEKHA_CONTRACTOR_ADDRESS`, `JANLEKHA_AUDITOR_ADDRESS`). If none
are set, only the deployer holds ADMIN_ROLE.

## Tests

Run from `contracts/`:

```bash
npx hardhat test
```

Verified in this workspace: 38 passing, 0 failing. That is 24
JanLekha tests and 14 pre-existing StreetSync tests, all still
passing. See the coordinator report for the exact list.

## Known integration fix

The indexer originally looked for a deployment file named
`janlekhaArcTestnet.json` with artifact keys `RoleRegistry`,
`BudgetRegistry`, and so on, while the deploy script writes
`arcTestnet-janlekha.json` with keys `JanLekhaRoleRegistry`,
`JanLekhaBudgetRegistry`, and so on. The indexer, the deploy script
output, and the `.env.example` files are now aligned on
`arcTestnet-janlekha.json` and the `JanLekha*Registry` keys. If you
deploy with an older script, update the file name and keys to match,
or the indexer will report JanLekha as not deployed even though the
contracts exist.
