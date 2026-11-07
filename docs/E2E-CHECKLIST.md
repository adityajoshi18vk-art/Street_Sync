# End to End Test Checklist: JanLekha 2.0 and StreetSync

Status: DRAFT for review. This checklist is for a real test run, not a code read.

## How to use this checklist

- Run the steps in order. Workflows build on each other: a payment needs a verified milestone, which needs a submitted milestone, which needs an awarded contractor, which needs a tender, which needs a project, which needs an allocation, which needs a department.
- For every item, fill the Status column ONLY from a real run. Never mark an item PASS because the button exists in the UI, because the page renders, or because the code looks correct. A PASS needs the evidence named in the "How to verify" column: a transaction hash that resolves on the explorer, a hash that matches, a file that decompresses, a log line, or an observed error.
- Status values: TODO (not run), PASS (verified as described), FAIL (did not behave as described, note the actual behaviour), BLOCKED (cannot run, note the blocker), N/A (not applicable to this run, note why).
- Record for every on chain step: the transaction hash, the block number, the contract address, and the explorer URL. A checklist entry without those is incomplete.
- Testnet only. No mainnet. Use test USDC only. The StreetSync Arc deployment uses the publicly mintable MockUSDC test token; it has no monetary value.
- If a step fails, stop and record the failure. Do not skip ahead and mark later steps PASS on the assumption the failed step would have worked.

## 0. Test environment setup

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 0.1 | StreetSync clone is at commit `6600b9b` and JanLekha 2.0 is at commit `0da05fe` | Run `git rev-parse HEAD` in `~/workspace/street-sync-verify-docs` and in `~/workspace/janlekha`. Record both SHAs | TODO |
| 0.2 | Node.js version meets the requirement (Node 22+ for the combined run; JanLekha Hardhat 3 needs it, StreetSync alone works on 18+) | Run `node -v`. Record the version | TODO |
| 0.3 | Dependencies install cleanly | Run `npm install` from the repo root (it also installs `janlekha/` via postinstall). Record any error | TODO |
| 0.4 | Contract tests pass (JanLekha 2.0) | Run `npm run test:janlekha` or `forge test` in `~/workspace/janlekha/contracts`. Expected: 18 passed, 0 failed | TODO |
| 0.5 | Contract tests pass (StreetSync) | Run `npm run test:contracts` from the repo root. Expected: 14 tests passing per README | TODO |
| 0.6 | Pipeline tests pass (evidence, Arkiv client, Swarm client) | Run `npm run test:pipeline`. Expected: 11 passing per README | TODO |
| 0.7 | Backend tests pass | Run `npm run test --workspace=streetsync-backend`. Expected: 4 passing per README | TODO |
| 0.8 | No port conflicts before starting | Check ports 3000 (app), 3001 (backend), 3100 (JanLekha internal), 8547 (JanLekha demo chain), 8545 (local Hardhat). See section 5 for the port conflict checks | TODO |
| 0.9 | Chain and network confirmed as Arc Testnet, chain ID 5042002 | Wallet network shows Arc Testnet 5042002; RPC `https://rpc.testnet.arc.io` answers `eth_chainId` 0x4CF6AA; explorer is `https://explorer.testnet.arc.io` | TODO |
| 0.10 | JanLekha 2.0 deployment state recorded | Record whether the eight `VITE_ARC_*_ADDRESS` variables are set. If any is empty, the app is in simulated mode and every on chain JanLekha check in section 1 is BLOCKED, not failed. Record the mode explicitly | TODO |
| 0.11 | StreetSync deployment confirmed | Escrow `0xFEDA4e28E03681fb9fD02cdFD2847F352Ce1eDf9` and MockUSDC `0xAdC3bd879bB63329Ad1490af2845851C23215057` resolve on the Arc Testnet explorer; deployment block 71087064 | TODO |
| 0.12 | Test wallets funded with testnet USDC for gas and MockUSDC for escrow | Each role wallet holds testnet USDC for gas (Circle faucet) and MockUSDC (app "Get 100 test USDC" button). Record each wallet address and role | TODO |
| 0.13 | Roles granted on chain (JanLekha 2.0, only if deployed) | `RoleRegistry.hasRole` returns true for each role wallet: ADMIN_ROLE, FINANCE_ROLE, PROCUREMENT_ROLE, CONTRACTOR_ROLE, AUDITOR_ROLE. Record the `RoleGranted` transaction hashes | TODO |

## 1. JanLekha 2.0: the 10 end to end workflows

### Workflow 1: Government Administrator creates a department and a project

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 1.1 | Admin creates a department in the demo UI | Open `/app/admin` as GOVERNMENT_ADMIN, create a department with a name and budget. The department appears in the department list and in `/departments`. Record the department ID | TODO |
| 1.2 | Department creation is recorded only in demo state (known limitation) | Confirm there is no department registry contract and no transaction hash for this step. The department exists in localStorage key `janlekha-demo-v1` only. Record that this step has no on chain proof | TODO |
| 1.3 | Admin registers a project on chain (only if deployed) | Call `ProjectRegistry.registerProject` as ADMIN. Record the transaction hash. Open the explorer link and confirm the `ProjectRegistered` event with the correct project ID, department ID, contractor address, and budget in INR. Then read `getProject(id)` and confirm the same values | TODO |
| 1.4 | Duplicate project registration is rejected | Register the same project ID a second time. The transaction must revert with `ProjectExists`. Record the revert | TODO |
| 1.5 | Non admin cannot register a project | Attempt `registerProject` from a Finance wallet. The transaction must revert with `NotAdmin`. Record the revert | TODO |
| 1.6 | Project appears in the public portal | Open `/projects` and `/projects/:id` as a citizen with no wallet. The project, department, contractor, and budget are visible | TODO |

### Workflow 2: Finance Officer creates and approves a budget allocation

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 2.1 | Finance creates and approves an allocation in the demo UI | Open `/app/finance` as FINANCE_OFFICER, create an allocation for the project from 1.3 with an INR amount and a USDC amount. The allocation appears and the project allocated total increases. Record the allocation ID | TODO |
| 2.2 | Allocation approval is recorded on chain (only if deployed) | Call `BudgetRegistry.approveAllocation` as FINANCE. Record the transaction hash. Confirm the `AllocationApproved` event: INR amount and USDC base units are separate fields and match the inputs. Read `getAllocation(id)` and confirm `approvedBy` is the Finance wallet and `approvedAt` is the block timestamp | TODO |
| 2.3 | Authorised limit increases by exactly the approved USDC amount | Read `authorizedLimitUsdc(projectId)` before and after. The difference equals the approved `amountUsdcBaseUnits`. Divide by 1,000,000 to confirm the USDC value; do not use 18 decimals | TODO |
| 2.4 | Duplicate allocation ID is rejected | Approve the same allocation ID a second time. Must revert with `AllocationExists` | TODO |
| 2.5 | Zero USDC allocation is rejected | Approve an allocation with `amountUsdcBaseUnits` 0. Must revert with `ZeroAmount` | TODO |
| 2.6 | Admin cannot approve an allocation on chain (divergence check) | Attempt `approveAllocation` from an ADMIN wallet. Must revert with `NotFinance`, even though the frontend permission table lists `approve_budget` for GOVERNMENT_ADMIN. Record the revert and the divergence | TODO |
| 2.7 | Allocation release works and is single use | Call `BudgetRegistry.releaseAllocation(id)` as FINANCE. Confirm the `AllocationReleased` event. Call it a second time; must revert with `AlreadyReleased` | TODO |
| 2.8 | Release of a never approved allocation is rejected | Call `releaseAllocation` with a random ID. Must revert with `AllocationMissing` | TODO |

### Workflow 3: Procurement Officer publishes a tender

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 3.1 | Procurement publishes a tender in the demo UI | Open `/app/procurement` as PROCUREMENT_OFFICER, publish a tender for the project with a title, value in INR, and deadline. The tender appears in `/tenders` with status Open. Record the tender ID | TODO |
| 3.2 | Tender publication is recorded on chain (only if deployed) | Call `ProcurementRegistry.publishTender` as PROCUREMENT. Record the transaction hash. Confirm the `TenderPublished` event: project ID, title, value in INR, deadline as Unix time. Read `getTender(id)` and confirm the same values and `open` true | TODO |
| 3.3 | Duplicate tender ID is rejected | Publish the same tender ID a second time. Must revert with `TenderExists` | TODO |
| 3.4 | Zero value tender is rejected | Publish a tender with value 0. Must revert with `ZeroAmount` | TODO |
| 3.5 | Non procurement cannot publish a tender | Attempt `publishTender` from a Finance wallet. Must revert with `NotProcurement` | TODO |

### Workflow 4: Contractor bids and is selected

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 4.1 | Contractor submits a bid in the demo UI | Open `/app/contractor` as CONTRACTOR, submit a bid on the tender with an INR amount. The bid appears on the tender with status pending. Record the bid ID and amount | TODO |
| 4.2 | Bid is recorded on chain (only if deployed) | Call `ProcurementRegistry.submitBid(tenderId, amountInr)` as CONTRACTOR. Record the transaction hash. Confirm the `BidSubmitted` event: tender ID, contractor address, amount in INR. Read `getBids(tenderId)` and confirm the bid is listed | TODO |
| 4.3 | One bid per contractor is enforced | Submit a second bid on the same tender from the same contractor wallet. Must revert with `DuplicateBid` | TODO |
| 4.4 | A second contractor can bid | Submit a bid on the same tender from a different CONTRACTOR_ROLE wallet with a different amount. Must succeed. Read `getBids` and confirm two bids | TODO |
| 4.5 | Bid after the deadline is rejected | After the tender deadline passes, attempt a bid. Must revert with `TenderPastDeadline` | TODO |
| 4.6 | Non contractor cannot bid | Attempt `submitBid` from a Procurement wallet without CONTRACTOR_ROLE. Must revert with `NotContractor` | TODO |
| 4.7 | Procurement selects a bid | Call `ProcurementRegistry.selectBid(tenderId, contractor)` as PROCUREMENT for one of the bidders. Record the transaction hash. Confirm the `BidSelected` event with the contractor address and amount. Read `getTender` and confirm `open` is false, `awardedTo` is the selected contractor, and `awardedAmountInr` matches the bid | TODO |
| 4.8 | Selecting a non bidder is rejected | Attempt `selectBid` for an address that never bid. Must revert with `BidMissing` | TODO |
| 4.9 | Selecting on a closed tender is rejected | Attempt `selectBid` a second time on the awarded tender. Must revert with `TenderClosed` | TODO |
| 4.10 | Award appears in the public portal | Open `/tenders/:id` as a citizen. The awarded contractor and amount are visible | TODO |

### Workflow 5: Contractor submits milestones and evidence

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 5.1 | Contractor submits a milestone in the demo UI | Open `/app/contractor`, submit a milestone for the project with a title, INR amount, USDC amount, and due date. The milestone appears with status Submitted. Record the milestone ID | TODO |
| 5.2 | Milestone submission is recorded on chain (only if deployed) | Call `MilestoneRegistry.submitMilestone(id, projectId, amountInr, amountUsdcBaseUnits, evidenceHash)` as CONTRACTOR with a real SHA-256 evidence hash (compute it with `sha256sum`, section 4). Record the transaction hash. Confirm the `MilestoneSubmitted` event with all fields. Read `getMilestone(id)` and confirm submitter, amounts, evidence hash, status Submitted, and `submittedAt` | TODO |
| 5.3 | Duplicate milestone ID is rejected | Submit the same milestone ID a second time. Must revert with `MilestoneExists` | TODO |
| 5.4 | Non contractor cannot submit a milestone | Attempt `submitMilestone` from an Auditor wallet. Must revert with `NotContractor` | TODO |
| 5.5 | Milestone with no evidence hash is flagged by the risk engine | Submit a milestone with an empty evidence hash in the demo. Open the auditor dashboard and confirm a missing document flag appears for it (risk engine `checkMissingDocuments` in `src/lib/risk.ts`). Record the flag ID | TODO |

### Workflow 6: Independent Auditor verifies the milestone

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 6.1 | Auditor verifies the milestone in the demo UI | Open `/app/auditor` as INDEPENDENT_AUDITOR, verify the milestone from 5.1. The milestone status becomes Verified and `verifiedBy` shows the auditor. Record the event | TODO |
| 6.2 | Milestone verification is recorded on chain (only if deployed) | Call `MilestoneRegistry.verifyMilestone(id)` as AUDITOR. Record the transaction hash. Confirm the `MilestoneVerified` event. Read `getMilestone(id)` and confirm status Verified, `verifiedBy` is the auditor wallet, and `verifiedAt` is after `submittedAt` | TODO |
| 6.3 | Contractor cannot verify their own milestone | Attempt `verifyMilestone` from the submitter wallet (even if it also holds AUDITOR_ROLE, the submitter check must still block it). Must revert with `SelfVerification` | TODO |
| 6.4 | Non auditor cannot verify a milestone | Attempt `verifyMilestone` from a Finance wallet. Must revert with `NotAuditor` | TODO |
| 6.5 | Double verification is rejected | Call `verifyMilestone` a second time on the same milestone. Must revert with `WrongStatus` | TODO |
| 6.6 | Auditor can reject instead of verifying | On a second milestone, call `MilestoneRegistry.rejectMilestone(id)` as AUDITOR. Confirm the `MilestoneRejected` event and status Rejected. Confirm the same self verification and non auditor reverts apply to rejection | TODO |
| 6.7 | Auditor raises a flag and publishes a report | Call `AuditRegistry.raiseFlag(id, projectId, reason, risk)` as AUDITOR, then `AuditRegistry.publishReport(id, projectId, title, findings)` as AUDITOR. Record both transaction hashes and confirm the `FlagRaised` and `ReportPublished` events. Resolve the flag with `resolveFlag` and confirm the `FlagResolved` event | TODO |
| 6.8 | Auditor cannot change the original record | Confirm there is no contract function that lets an auditor edit the milestone amount, the allocation, or the payment. Attempting to call a non existent edit function must fail at the ABI level, not silently succeed. Record the check | TODO |

### Workflow 7: Finance initiates and completes the simulated USDC payment

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 7.1 | Finance initiates a payment in the demo UI | Open `/app/finance`, initiate a payment for the verified milestone with INR amount, USDC amount, and payee. Record the returned reference | TODO |
| 7.2 | Demo payment is marked Settled immediately (known limitation) | Confirm the new payment has status Settled at once and the milestone becomes Paid. Record that this is the documented demo limitation: the payment did NOT wait for a second authoriser (`README.md`, Permissions section). Do not mark this as a real authorisation flow | TODO |
| 7.3 | Demo payment reference is a SIM-ARC reference, not a transaction hash | Confirm the reference starts with `SIM-ARC-`. Open `https://explorer.testnet.arc.io/tx/<reference>` and confirm it does NOT resolve. Record that the payment is simulated | TODO |
| 7.4 | Payment recording is enforced on chain (only if deployed) | Call `PaymentRegistry.recordPayment(id, projectId, milestoneId, payee, amountUsdcBaseUnits, invoiceHash)` as FINANCE for the verified milestone. Record the transaction hash. Confirm the `PaymentRecorded` event: payee, amount in base units, invoice hash, recordedBy. Read `getPayment(id)` and confirm the same values | TODO |
| 7.5 | Payment for an unverified milestone is rejected on chain | Attempt `recordPayment` for a milestone that is still Submitted. Must revert with `MilestoneNotVerified` | TODO |
| 7.6 | Payment above the remaining authorised limit is rejected on chain | Attempt `recordPayment` with an amount larger than `remainingLimitUsdc(projectId)`. Must revert with `ExceedsAuthorisedLimit`. Read `authorizedLimitUsdc` and `totalPaidUsdc` before and after to confirm the limit math | TODO |
| 7.7 | Duplicate invoice hash is rejected on chain | Attempt `recordPayment` a second time with the same invoice hash but a different payment ID. Must revert with `DuplicateInvoiceHash`. Read `invoiceUsed(invoiceHash)` and confirm it returns true | TODO |
| 7.8 | Duplicate payment ID is rejected on chain | Attempt `recordPayment` with the same payment ID a second time. Must revert with `PaymentExists` | TODO |
| 7.9 | Milestone is marked Paid after payment | After 7.4, read `getMilestone(milestoneId)` and confirm status Paid and the `MilestonePaid` event exists | TODO |
| 7.10 | Non finance cannot record a payment | Attempt `recordPayment` from an Admin wallet. Must revert with `NotFinance` | TODO |
| 7.11 | Second authoriser gap is documented, not passed | Confirm that a single Finance Officer could complete 7.4 with no second approval, and that no role holds `authorise_payment` in `src/lib/permissions.ts`. Record this as a known gap (see `docs/ROLE-MATRIX.md` section 2), not as a PASS of the authorisation flow | TODO |

### Workflow 8: Events appear in the citizen dashboard

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 8.1 | Each workflow step appears in the citizen timeline | Open `/` and `/projects/:id` as a citizen with no wallet. Confirm events for department creation, project registration, allocation, tender publication, bid selection, milestone submission, milestone verification, and payment settlement are all present, in order, with actor, role, and date | TODO |
| 8.2 | Event references are labelled honestly | Confirm every seeded or demo event shows a `SIM-ARC-...` reference and is labelled simulated or demo data, and no demo event claims a real transaction hash | TODO |
| 8.3 | New demo actions append events immediately | Perform a new demo action (for example file a complaint) and confirm a new event appears in the timeline without a page reload beyond the app normal refresh | TODO |

### Workflow 9: Citizen traces the full financial history

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 9.1 | Citizen traces budget to payment for one project | Starting from `/projects/:id`, follow the chain: department budget, allocation, tender value, awarded bid, milestone amounts, payment amounts. Record each figure and confirm the arithmetic: allocated is at most the budget, paid is at most the authorised limit, and the milestone amount matches the payment amount | TODO |
| 9.2 | Money flow Sankey is consistent with the project figures | Open `/money-flow`, find the same project, and confirm the Sankey amounts match the project page figures for budget, allocated, released, and spent | TODO |
| 9.3 | Payment history page lists the payment | Open `/payments`. Confirm the payment from 7.1 appears with project, payee, INR amount, USDC amount, date, and status, and that INR and USDC are shown separately with no implied exchange rate | TODO |
| 9.4 | Full history can be traced from on chain events (only if deployed) | Using the project ID, collect the events from section 4 of `docs/VERIFICATION.md` (ProjectRegistered, AllocationApproved, TenderPublished, BidSelected, MilestoneSubmitted, MilestoneVerified, PaymentRecorded) from the explorer or RPC logs, in block order. Confirm the sequence matches the app timeline | TODO |
| 9.5 | No previous record hash exists to check | Confirm that none of the eight registries stores a previous record hash, and record that history is traced by shared project ID and block order, not by a hash chain (see `docs/VERIFICATION.md` section 4.6) | TODO |

### Workflow 10: Citizen verifies a document hash

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 10.1 | Citizen uploads a registered document and gets MATCH | Open `/verify`, upload a file from `janlekha/public/demo-documents/` (for example the drain tender notice PDF named in the StreetSync README). Confirm the verdict is MATCH and the matched document title is shown | TODO |
| 10.2 | Citizen uploads an edited copy and gets MISMATCH | Copy the same file, change one character, upload the copy. Confirm the verdict is MISMATCH. Record both hashes to show they differ completely | TODO |
| 10.3 | Citizen pastes a hash directly | Paste a known registered hash (64 hex characters) into the hash field. Confirm MATCH. Paste a random 64 hex hash. Confirm NO MATCH | TODO |
| 10.4 | Invalid hash input is rejected cleanly | Paste a short string and a `SIM-ARC-...` reference as a hash. Confirm the page reports an error ("That does not look like a SHA-256 hash") instead of a false MATCH | TODO |
| 10.5 | Document registration is enforced on chain (only if deployed) | Call `DocumentRegistry.registerDocument(id, projectId, contentHash, docType)` from a role holding wallet. Record the transaction hash and confirm the `DocumentRegistered` event. Read `getDocument(id)` and `hashRegistered(contentHash)` and confirm both return the registered values | TODO |
| 10.6 | Duplicate content hash is rejected on chain | Register the same content hash a second time under a different document ID. Must revert with `DuplicateContentHash` | TODO |
| 10.7 | Citizen cannot register a document on chain | Attempt `registerDocument` from a wallet with no role. Must revert with `NoRole` | TODO |
| 10.8 | Auditor verifies a document on chain | Call `DocumentRegistry.verifyDocument(id)` as AUDITOR. Confirm the `DocumentVerified` event and `getDocument` shows verified true. A second verify must revert with `AlreadyVerified` | TODO |

## 2. StreetSync bounty flow: create, pledge, claim, submit evidence, review, settle

Precondition: escrow `0xFEDA4e28E03681fb9fD02cdFD2847F352Ce1eDf9` on Arc Testnet, MockUSDC `0xAdC3bd879bB63329Ad1490af2845851C23215057`, attester `0xf5274266C5205Ea462D232B3D4016b3A9D887D3F`. All amounts are 6 decimal USDC unless stated.

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 2.1 | Create a bounty | Call `createBounty` with a description hash, coordinates, region cell, initial amount, and a future claim deadline. Record the bounty ID and transaction hash. Confirm the `BountyCreated` event. Read `getBounty(id)` and confirm creator, totalPledged, and status Open | TODO |
| 2.2 | Create with zero amount is rejected | Call `createBounty` with initial amount 0. Must revert with `ZeroAmount` | TODO |
| 2.3 | Create with a past deadline is rejected | Call `createBounty` with a deadline in the past. Must revert with `InvalidDeadline` | TODO |
| 2.4 | Pledge to the bounty | Call `pledge(bountyId, amount)` from a second wallet after approving the MockUSDC spend. Record the transaction hash. Confirm the `Pledged` event and `newTotal`. Read `getBounty` and confirm `totalPledged` increased by exactly the pledged amount | TODO |
| 2.5 | Pledge uses 6 decimal USDC, not 18 | Confirm the pledged amount in the event equals `amount * 1,000,000` base units for an `amount` in whole USDC. Confirm no `msg.value` was sent (native value 0 in the transaction) | TODO |
| 2.6 | Creator cannot claim their own bounty | Attempt `claim` from the creator wallet. Must revert with `CreatorCannotClaim` | TODO |
| 2.7 | Pledger cannot claim a bounty they funded | Attempt `claim` from the pledger wallet. Must revert with `PledgerCannotClaim` | TODO |
| 2.8 | Worker claims with a World ID attestation | Obtain an attestation from the backend (`POST /api/worldid/verify` with a World ID proof, or the World ID Simulator in staging) for the worker wallet, bounty ID, and role Worker. Call `claim(bountyId, nonce, expiry, attestationSig)`. Record the transaction hash. Confirm the `BountyClaimed` event and note the 4 digit `visualChallengeCode` (1000 to 9999). Read `getBounty` and confirm worker address and status Claimed | TODO |
| 2.9 | Claim with an expired attestation is rejected | Call `claim` with an expiry in the past. Must revert with `AttestationExpired` | TODO |
| 2.10 | Claim with a reused nonce is rejected | Call `claim` a second time with the same nonce. Must revert with `NonceAlreadyUsed` | TODO |
| 2.11 | Worker submits evidence | Build the evidence bundle (section 3), upload it to Arkiv, then call `submitEvidence(bountyId, arkivEntityKey, evidenceHash)`. Record the transaction hash. Confirm the `EvidenceSubmitted` event: `arkivEntityKey` and `evidenceHash` match the upload, and `selectionBlock` equals the submission block number plus 2. Read `getBounty` and confirm status Submitted | TODO |
| 2.12 | Non worker cannot submit evidence | Attempt `submitEvidence` from a different wallet. Must revert with `NotWorker` | TODO |
| 2.13 | Panel assignment waits for the selection block | Call `assignPanel` in the same block or before `selectionBlock`. Must revert with `SelectionBlockNotReached`. Wait until `block.number > selectionBlock`, call again, and confirm the `PanelAssigned` event with 3 reviewer addresses and the review round | TODO |
| 2.14 | Panel excludes creator, worker, and pledgers | Read the panel from the `PanelAssigned` event and confirm none of the 3 addresses is the creator, the worker, or any pledger | TODO |
| 2.15 | Reviewers commit votes | Each of the 3 panel reviewers calls `commitVote(bountyId, voteHash)` with `voteHash = keccak256(bountyId, reviewRound, approve, salt, voter)`. Confirm 3 `VoteCommitted` events. Record the salts privately; they are needed for reveal | TODO |
| 2.16 | Non panel member cannot commit | Attempt `commitVote` from a wallet that is not on the panel. Must revert with `NotPanelMember` | TODO |
| 2.17 | Double commit is rejected | A reviewer commits a second time. Must revert with `AlreadyCommitted` | TODO |
| 2.18 | Reviewers reveal votes | Each reviewer calls `revealVote(bountyId, approve, salt)` with the same approve value and salt used in 2.15. Confirm 3 `VoteRevealed` events with the correct approve values. Read `getTally(bountyId)` and confirm revealed 3 and the approval count | TODO |
| 2.19 | Reveal with the wrong salt is rejected | A reviewer reveals with a different salt from the commitment. Must revert with `VoteHashMismatch` | TODO |
| 2.20 | Settlement pays the worker 95 percent on approval | With at least 2 approvals, call `settle(bountyId)`. Record the transaction hash. Confirm the `BountySettled` event: approved true, `workerPayout` equals 95 percent of `totalPledged`, `reviewerCut` equals the per reviewer share of the remaining 5 percent plus slashed stakes. Confirm the worker MockUSDC balance increased by `workerPayout` and the bounty status is Approved | TODO |
| 2.21 | Settlement on rejection pays the worker nothing | On a separate bounty where at least 2 reviewers reveal reject, call `settle`. Confirm `BountySettled` approved false, worker payout 0, status Rejected (or Refunded if the rework was already used). Confirm pledgers can then call `withdrawPledge` | TODO |
| 2.22 | Settle before the reveal deadline with fewer than 3 revealed is rejected | Attempt `settle` while the reveal window is still open and not all 3 have revealed. Must revert with `RevealWindowOpen` | TODO |
| 2.23 | Settle below quorum is rejected | If fewer than 2 reviewers reveal, attempt `settle`. Must revert with `QuorumNotReached` | TODO |
| 2.24 | Rework works once and only once | After a rejection, the worker calls `rework(bountyId)`. Confirm the `BountyReworked` event, status back to Claimed, `reworkCount` 1, and `reviewRound` incremented. A second `rework` must revert with `ReworkLimitReached` | TODO |
| 2.25 | Pledge withdrawal works after expiry or refund | After a bounty expires unclaimed or becomes Refunded, a pledger calls `withdrawPledge(bountyId)`. Confirm the `PledgeWithdrawn` event and the pledger balance increase. A second withdrawal must revert with `NothingToWithdraw` | TODO |
| 2.26 | Majority reviewers can withdraw rewards | After a settlement, a majority reviewer calls `withdrawReward()`. Confirm the `RewardWithdrawn` event and the balance increase | TODO |
| 2.27 | Full lifecycle smoke test passes | Run `npm run smoke:arc` (about 6 minutes because the commit window is real time, per README section 6). Record the full output and confirm create, claim, review, settle, and indexing all succeed | TODO |

## 3. Arkiv storage and retrieval, Zstd compression and decompression, SHA-256 checksums

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 3.1 | Evidence bundle packs within the Arkiv budget | Build a bundle from two photos plus metadata with `packBundle` (`packages/evidence/src/bundle.ts`). Record the bundle size in bytes. Confirm it is at most 120,000 bytes (safe budget) and at most 128,000 bytes (hard Arkiv limit). Record the before and after WebP sizes (each at most 48,000 bytes per the spec, 45 KiB per `packages/evidence/src/resizer.ts`) | TODO |
| 3.2 | Bundle header is correct | Inspect the first 20 bytes: magic `SSYN`, version `0x01`, flags, dictionary ID `0x0001`, metadata length, before length, after length. Confirm the total length equals header plus metadata plus both images plus the 65 byte signature. `unpackBundle` must not throw | TODO |
| 3.3 | Zstd compresses the metadata and decompresses back exactly | Take the CBOR metadata bytes, run `compressMetadata`, then `decompressMetadata` on the result (`packages/evidence/src/compress.ts`). Confirm the decompressed bytes equal the original CBOR bytes exactly, and the decoded metadata fields are unchanged. Record the compressed size and the dictionary used flag | TODO |
| 3.4 | Zstd dictionary is the documented one | Confirm `DICT_ID` is `0x0001` and the dictionary is the pre trained dictionary in `packages/evidence/src/dictionary.ts`. Confirm the bundle flags bit 0 matches whether the dictionary was used | TODO |
| 3.5 | Photos are WebP, not Zstd | Confirm the before and after image bytes in the bundle are WebP encoded (resized to at most 1280 px longest edge, quality 0.55 to 0.72) and are stored raw in the bundle, not passed through Zstd. Only the metadata section is Zstd compressed | TODO |
| 3.6 | SHA-256 of the bundle matches the on chain evidence hash | Run `sha256sum` on the bundle file (see `docs/VERIFICATION.md` section 5.2). Compare with the on chain `evidenceHash` from `getBounty` or the `EvidenceSubmitted` event. Must match exactly, including the 65 byte signature bytes | TODO |
| 3.7 | One changed byte changes the hash | Flip one byte in a copy of the bundle, recompute SHA-256, and confirm the hash differs from the on chain hash. Confirm `verifyBundleIntegrity` reports the mismatch and does not return valid | TODO |
| 3.8 | Arkiv write returns an entity key and stores the documented attributes | Write the bundle with `writeEvidenceBundle` (`packages/arkiv-client/src/index.ts`). Record the returned entity key and bytes32 key. Fetch the entity and confirm the attributes: `project` streetsync, `entity_type` evidence, `bounty_id` matches, `worker` is the lowercase worker address, `sha256_prefix` is the first 18 characters of the evidence hash. Confirm the TTL is 604,800 seconds | TODO |
| 3.9 | Arkiv read returns the identical bytes | Read the entity back with `readEvidenceBundle` and confirm the returned bytes are byte for byte identical to the written bundle. Recompute SHA-256 and confirm it still matches the on chain hash | TODO |
| 3.10 | Full Arkiv verification passes | Run `verifyEvidenceBundle` with the Arkiv key, the on chain evidence hash, and the worker address. Confirm the result is valid with zero errors, `evidenceHashMatch` true, `signatureValid` true, and the recovered worker equals the on chain worker | TODO |
| 3.11 | Arkiv verification fails on a wrong worker address | Run `verifyEvidenceBundle` with a different expected worker address. Confirm it returns valid false with a worker address mismatch error | TODO |
| 3.12 | Chunked bundle round trips when over 120,000 bytes | Build a bundle over 120,000 bytes (or force the chunk path). Confirm `writeEvidenceBundle` returns `chunked` true with chunk keys, writes a JSON manifest entity, and `readEvidenceBundle` reassembles the exact original bytes. Confirm the reassembled SHA-256 matches the original hash | TODO |
| 3.13 | Arkiv entity expires after its TTL | Record the write time and TTL. After expiry (or by reading an entity written more than 7 days earlier), confirm the gateway no longer returns it, and record the result as content unavailable, not as evidence invalid. Do not mark this PASS or FAIL on content grounds; record it as an expiry observation | TODO |
| 3.14 | Local Arkiv mode is not presented as real Arkiv storage | Run the app with `NEXT_PUBLIC_ARKIV_MODE=local`. Confirm entities are stored only in browser localStorage, and that a second browser cannot retrieve them. Record that local mode evidence is unverifiable by a third party | TODO |
| 3.15 | Arkiv key mapping limitation is documented for the tested bounty | For the bounty tested in 2.11, record whether the original Arkiv entity key was published alongside the on chain bytes32 key. If only the bytes32 key exists and no mapping is available, record retrieval as BLOCKED with that reason (see `docs/VERIFICATION.md` section 6.2) | TODO |

## 4. Citizen read only access, transaction history, and audit timelines

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 4.1 | Citizen needs no wallet for any public page | Open `/`, `/projects`, `/projects/:id`, `/tenders`, `/payments`, `/documents`, `/verify`, `/audits`, `/map`, `/complaints`, `/money-flow` with no wallet connected and no login. Every page loads and shows data | TODO |
| 4.2 | Citizen cannot perform any write from the UI | Log in as CITIZEN and confirm no admin, finance, procurement, contractor, or auditor action button is available or succeeds. Attempting a write as a citizen must fail in the UI and, if attempted on chain, revert for lack of role | TODO |
| 4.3 | Citizen can verify a document without a wallet | With no wallet, upload a file on `/verify` and get a MATCH or MISMATCH verdict computed in the browser (see 10.1 to 10.4) | TODO |
| 4.4 | Transaction history is complete for one project | For the project tested in section 1, list every transaction hash from the app and confirm each resolves on the explorer with the expected event, sender, and amount (see `docs/VERIFICATION.md` section 9) | TODO |
| 4.5 | Audit timeline is ordered and complete | Open `/audits` and the project audit timeline. Confirm flags and reports appear in block order with actor, reason, risk, and resolution note where resolved. Confirm a resolved flag shows its resolution note | TODO |
| 4.6 | Risk flags are labelled as investigation prompts, not fraud findings | Open a risk flag in the auditor dashboard and confirm it is labelled "Requires Investigation" or "Potential Discrepancy" only, with the note that detection does not prove fraud (`src/lib/risk.ts`) | TODO |
| 4.7 | StreetSync audit page verifies a bounty independently | Open `/audit/[id]` in the StreetSync app for the bounty tested in section 2. Confirm the page fetches the Arkiv entity, recomputes the hash, recovers the worker signature, and shows the result. Record whether it matches the manual check in 3.10 | TODO |

## 5. Port conflicts

The combined run uses ports 3000 (StreetSync app), 3001 (StreetSync backend), 3100 (JanLekha internal), 8547 (JanLekha demo chain), and 8545 (local Hardhat). The root `predev` script runs `scripts/clean-ports.mjs`, which kills processes on ports 3000, 3001, and 3100. JanLekha 2.0 standalone runs on Vite port 5173 (`README.md` in `~/workspace/janlekha`).

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 5.1 | All five ports are free before starting | Run `lsof -ti :3000; lsof -ti :3001; lsof -ti :3100; lsof -ti :8547; lsof -ti :8545` (Linux) or `netstat -ano | findstr :<port>` (Windows). Record which ports are in use and by what, if any | TODO |
| 5.2 | `npm run dev` starts all three processes | Run `npm run dev` from the repo root. Confirm the backend listens on 3001, the StreetSync app on 3000, and JanLekha is reachable at `http://localhost:3000/janlekha`. Record the startup log lines for each | TODO |
| 5.3 | Port 3000 conflict is detected and reported | With the app running, attempt to start a second process on port 3000. Confirm it fails with an address in use error and does not silently take over the first process | TODO |
| 5.4 | Port 3001 conflict is detected and reported | Same as 5.3 for the backend on port 3001. Confirm `GET /api/health` still answers from the original process, not the second one | TODO |
| 5.5 | Port 3100 conflict is detected and reported | Same as 5.3 for JanLekha internal on port 3100. Confirm `http://localhost:3000/janlekha` still serves from the original process | TODO |
| 5.6 | Port 8547 conflict is handled | With a JanLekha demo chain running on 8547, attempt to start a second one. Confirm the documented behaviour: either an error, or a start on a different port with `JANLEKHA_CHAIN_PORT=8548` (README troubleshooting). Record which happened | TODO |
| 5.7 | `clean-ports` frees the ports | Run `node scripts/clean-ports.mjs` and confirm ports 3000, 3001, and 3100 are free afterwards. Confirm it does not kill unrelated processes | TODO |
| 5.8 | Stale process auto kill on `predev` works | Leave a stale process on port 3000, run `npm run dev`, and confirm the stale process is killed and the fresh app starts. Record the `[clean-ports]` log lines | TODO |
| 5.9 | Each service is reachable on its own port after a restart | After stopping everything with Ctrl+C once and restarting, confirm `http://localhost:3000`, `http://localhost:3001/api/health`, and `http://localhost:3000/janlekha` all answer. Record any service that does not come back | TODO |

## 6. Failure scenarios

| # | Item | How to verify | Status |
| --- | --- | --- | --- |
| 6.1 | Failed transaction changes nothing | Submit a transaction that reverts (for example a duplicate bid, 4.3). Confirm the explorer shows status failed, the contract state is unchanged (read `getBids` before and after), and the app does not show the failed action as completed | TODO |
| 6.2 | Failed transaction is reported honestly in the UI | After a reverted transaction, confirm the UI shows an error naming the revert (for example `DuplicateBid`, `NotFinance`) and does not show a success message or a fake transaction hash | TODO |
| 6.3 | Invalid evidence hash is rejected | Call `submitEvidence` with an `evidenceHash` that does not match any Arkiv bundle. Confirm the transaction succeeds on chain (the contract does not check Arkiv) BUT the verification in 3.10 then fails with a hash mismatch. Record this as the expected gap: the chain records the claimed hash, Arkiv verification catches the lie | TODO |
| 6.4 | Tampered Arkiv bundle is detected | Take a valid bundle, change one byte, upload it as a new entity, and run `verifyEvidenceBundle` against the original on chain hash. Confirm it returns valid false with a hash mismatch error | TODO |
| 6.5 | Wrong worker signature is detected | Run `verifyEvidenceBundle` with a bundle signed by a different wallet from the on chain worker. Confirm it returns valid false with a worker address mismatch error | TODO |
| 6.6 | Duplicate payment is rejected on chain | See 7.7. Confirm the second `recordPayment` with the same invoice hash reverts with `DuplicateInvoiceHash` and `totalPaidUsdc` is unchanged | TODO |
| 6.7 | Duplicate payment is flagged in the demo risk engine | In the demo, record two payments against the same milestone (or use seeded data) and confirm `checkRepeatedPayments` in `src/lib/risk.ts` raises a "Potential Discrepancy" flag for the milestone | TODO |
| 6.8 | Payment over the authorised limit is rejected on chain | See 7.6. Confirm the revert is `ExceedsAuthorisedLimit` and the limit values are unchanged | TODO |
| 6.9 | Unauthorised action is rejected on chain | Attempt each of: non admin `registerProject`, non finance `approveAllocation` and `recordPayment`, non procurement `publishTender`, non contractor `submitBid`, non auditor `verifyMilestone`, citizen `registerDocument`. Confirm every one reverts with the correct `Not*` error and no state changes | TODO |
| 6.10 | Unauthorised action is blocked in the demo UI | Log in as each role in turn and confirm the other roles action buttons are absent or disabled, and that a direct call from the wrong role fails as in 6.9 rather than succeeding through the UI | TODO |
| 6.11 | Indexer down: app shows stale data, chain stays correct | Stop the backend indexer (or the whole backend on port 3001). Create a new bounty or record a new JanLekha event on chain. Confirm the app and `/api/bounties` do NOT show the new record, while the explorer and a direct `getBounty` read DO show it. Restart the indexer and confirm it catches up from its stored cursor and the app then shows the record | TODO |
| 6.12 | Backend down: verification still works without it | Stop the backend on port 3001. Confirm `GET /api/health` fails, then verify a bounty using only the explorer, direct RPC, and Arkiv fetch (see `docs/VERIFICATION.md` section 8). Record the transaction hash, block, and Arkiv result obtained with no backend running | TODO |
| 6.13 | RPC down: verification is reported as unverifiable, not as failed | Point the read path at an unreachable RPC (or stop network access to `https://rpc.testnet.arc.io` in a test environment). Confirm the app reports the chain as unavailable (see `ReadFailure` kind `rpc-unavailable` in the retired `janlekha/src/lib/janlekha/chain.ts` for the pattern) and does not display cached contract state as if it were live. Record the exact message shown | TODO |
| 6.14 | Arkiv down or entity expired: evidence is unverifiable, not invalid | Use an expired entity or an unreachable Arkiv gateway. Confirm the verification reports retrieval failure and does not claim the evidence is false. Record the exact error | TODO |
| 6.15 | World ID attestation expired | See 2.9. Confirm `claim` reverts with `AttestationExpired` and no bounty state changes | TODO |
| 6.16 | Reviewer fails to reveal, deadlock recovery works | Assign a panel, have only 1 of 3 reviewers reveal, wait past `revealDeadline`, then call `pokeOrReplace(bountyId)` from any wallet. Confirm the `PokeOrReplace` event, the non revealers stakes are slashed, `reviewRound` increments, status returns to Submitted, and a new panel can be assigned without re uploading evidence | TODO |
| 6.17 | Wrong network: wallet on the wrong chain is rejected | Connect a wallet on a different chain (for example Hardhat local 31337 or Ethereum mainnet) and attempt a write. Confirm the app or `contracts.ts` `getSigner` rejects it with a chain mismatch error ("Switch to Arc Testnet (5042002) first") and no transaction is sent | TODO |
| 6.18 | Simulated payment is never presented as real | In the demo, initiate a payment and confirm the UI labels it simulated, the reference starts with `SIM-ARC-`, and no explorer link is shown that resolves. Confirm no `SIM-ARC-...` reference is stored as if it were a transaction hash | TODO |
| 6.19 | Demo reset does not delete on chain records | In JanLekha 2.0, click reset demo on the login page. Confirm localStorage demo state returns to the seed data, and confirm separately that any on chain records created during the test still exist on the explorer. Record that reset is local only | TODO |
| 6.20 | No private key is ever written to a file, log, or screenshot | Grep the test run logs, screenshots, and notes for any private key, mnemonic, or `ATTESTER_PRIVATE_KEY` value. Confirm none appears. Confirm the deployer key was supplied only through the environment (`PRIVATE_KEY` for forge, `ATTESTER_PRIVATE_KEY` for the backend) and never committed | TODO |

## 7. Sign off

| Field | Value |
| --- | --- |
| Test runner name | TODO |
| Date of run (IST) | TODO |
| StreetSync commit tested | TODO |
| JanLekha 2.0 commit tested | TODO |
| Network and chain ID | Arc Testnet, 5042002 |
| JanLekha 2.0 mode (live or simulated) | TODO |
| StreetSync escrow address tested | TODO |
| Total items | TODO |
| PASS count | TODO |
| FAIL count (with item numbers) | TODO |
| BLOCKED count (with item numbers and blockers) | TODO |
| Known gaps confirmed during the run | TODO (second payment authoriser not enforced on chain; department creation has no on chain record; Arkiv bytes32 key reverse mapping; reviewer stake and cut figures in the master spec are stale, code says 10.00 USDC and 5 percent) |

## 8. Sources

- JanLekha 2.0 repo `~/workspace/janlekha` commit `0da05fe`: `README.md`, `docs/ARC-MIGRATION.md`, `src/lib/arc.ts`, `src/lib/contracts.ts`, `src/lib/permissions.ts`, `src/lib/risk.ts`, `src/context/AppContext.tsx`, `src/data/demoData.ts`, `src/pages/Verify.tsx`, `src/pages/roles/FinanceDashboard.tsx`, `contracts/src/*.sol`.
- StreetSync clone `~/workspace/street-sync-verify-docs` commit `6600b9b`: `README.md`, `streetsync_master_context_technical_specification.md`, `contracts/deployments/arcTestnet.json`, `contracts/src/*.sol`, `app/src/config/contracts.ts`, `app/src/config/wagmi.ts`, `app/src/lib/arkiv.ts`, `app/src/lib/evidence.ts`, `packages/arkiv-client/src/index.ts`, `packages/evidence/src/*.ts`, `backend/src/indexer.ts`, `backend/src/server.ts`, `backend/src/signer.ts`, `janlekha/src/lib/janlekha/chain.ts`, `janlekha/src/lib/documents/storage.ts`, `scripts/clean-ports.mjs`, `package.json`.
