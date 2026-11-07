# Role and Permission Matrix: JanLekha 2.0 and StreetSync

Status: DRAFT for review. Sources are JanLekha 2.0 at commit `0da05fe` and the StreetSync clone at commit `6600b9b`. Two enforcement layers exist and they are not the same. Read the enforcement column carefully: "contract" means the transaction reverts on chain if the caller lacks the role; "frontend only" means the app hides the button but nothing on chain stops the call; "backend" means the backend server enforces it off chain.

## 0. How to read this document

- JanLekha 2.0 roles are defined twice: once in the demo frontend (`src/lib/permissions.ts`) and once on chain (`contracts/src/RoleRegistry.sol`). The two definitions DIVERGE in places. Both are listed, and divergences are flagged.
- The JanLekha 2.0 contracts are NOT deployed by default. `CONTRACT_ADDRESSES` in `src/lib/arc.ts` defaults all eight registry addresses to `""`, and `areContractsDeployed()` returns false. Until deployment, every "contract" enforcement below is code that exists and is tested (18 Foundry tests, `contracts/test/JanLekha.t.sol`) but is not live on chain. The demo enforces permissions in the app layer only (`src/lib/permissions.ts` and the README: "Server side enforcement is a production requirement").
- StreetSync roles are enforced on chain in `contracts/src/StreetSyncEscrow.sol` and its inherited modules, plus off chain by the backend attester. The StreetSync escrow IS deployed on Arc Testnet (`contracts/deployments/arcTestnet.json`, escrow `0xFEDA4e28E03681fb9fD02cdFD2847F352Ce1eDf9`).
- Role names: JanLekha 2.0 frontend roles are `GOVERNMENT_ADMIN`, `FINANCE_OFFICER`, `PROCUREMENT_OFFICER`, `CONTRACTOR`, `INDEPENDENT_AUDITOR`, `CITIZEN` (`src/lib/permissions.ts`, `ROLE_LABELS` and `ROLE_ROUTES`). On chain roles are `ADMIN_ROLE`, `FINANCE_ROLE`, `PROCUREMENT_ROLE`, `CONTRACTOR_ROLE`, `AUDITOR_ROLE` (`contracts/src/RoleRegistry.sol`). The mapping is in `docs/ARC-MIGRATION.md` section 5: GOVERNMENT_ADMIN maps to ADMIN_ROLE, FINANCE_OFFICER to FINANCE_ROLE, PROCUREMENT_OFFICER to PROCUREMENT_ROLE, CONTRACTOR to CONTRACTOR_ROLE, INDEPENDENT_AUDITOR to AUDITOR_ROLE, CITIZEN holds no role.

## 1. JanLekha 2.0: Government Administrator

Frontend route: `/app/admin`. On chain role: `ADMIN_ROLE` (`RoleRegistry.ADMIN_ROLE = keccak256("ADMIN_ROLE")`).

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Grant a role | Yes, `RoleRegistry.grantRole(role, account)` | Grant to the zero address (reverts `ZeroAddress`) | Contract: `grantRole` is `onlyAdmin` (`contracts/src/RoleRegistry.sol`) |
| Revoke a role | Yes, `RoleRegistry.revokeRole(role, account)` | Revoke a role they do not hold the admin right for (only ADMIN can call it) | Contract: `revokeRole` is `onlyAdmin` |
| Create a department | Yes, in the demo (`addDepartment` in `src/context/AppContext.tsx`) | There is no department registry contract; departments exist only in demo state | Frontend only. No on chain department creation function exists in the eight registries |
| Register a project | Yes, `ProjectRegistry.registerProject(id, name, departmentId, contractor, budgetInr)` | Register the same project ID twice (`ProjectExists`); register with a zero contractor address (`ZeroAddress`) | Contract: `registerProject` is `onlyAdmin` (`contracts/src/ProjectRegistry.sol`) |
| Change a project status | Yes, `ProjectRegistry.updateStatus(id, status)` | Change the status of a project that was never registered (`ProjectMissing`) | Contract: `updateStatus` is `onlyAdmin` |
| Approve a budget allocation | In the FRONTEND permission table, yes (`approve_budget` is listed for GOVERNMENT_ADMIN in `src/lib/permissions.ts`). On chain, NO | Approve an allocation on chain: `BudgetRegistry.approveAllocation` is Finance only and reverts `NotFinance` for an admin | DIVERGENCE. Contract wins once deployed: `approveAllocation` is `onlyFinance` (`contracts/src/BudgetRegistry.sol`). The frontend table is wrong on this point for the live path |
| Release funds | No | `BudgetRegistry.releaseAllocation` is Finance only | Contract: `onlyFinance` |
| Initiate or authorise a payment | No | Any payment function | Contract: `PaymentRegistry.recordPayment` is Finance only; frontend gives the admin no payment permission |
| Publish a tender, submit a bid, select a bid | No | Any procurement function | Contract: procurement functions require PROCUREMENT_ROLE or CONTRACTOR_ROLE |
| Submit or verify a milestone | No | Any milestone function | Contract: submit requires CONTRACTOR_ROLE, verify requires AUDITOR_ROLE |
| Publish an audit report or raise a flag | No | Any audit function | Contract: `AuditRegistry` functions are auditor only |
| Edit an original financial record | No | No registry has an edit function for a recorded allocation, payment, or milestone. Records are append only by design | Contract: there is no update function for allocations, payments, or milestones (only `ProjectRegistry.updateStatus` changes a project status, and only an admin) |
| View public data | Yes | Nothing is hidden from the admin in the public portal | Public reads need no role |

Note: the first ADMIN is the deployer account. `RoleRegistry` grants the deployer `ADMIN_ROLE` at construction (see `contracts/src/RoleRegistry.sol`). The migration report (`docs/ARC-MIGRATION.md` section 9) recommends revoking the deployer ADMIN role once a dedicated admin account holds it. Until that revocation happens, the deployer retains full admin power.

## 2. JanLekha 2.0: Finance Officer

Frontend route: `/app/finance`. On chain role: `FINANCE_ROLE`.

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Approve a budget allocation | Yes, `BudgetRegistry.approveAllocation(id, departmentId, projectId, amountInr, amountUsdcBaseUnits)` | Approve the same allocation ID twice (`AllocationExists`); approve a zero USDC amount (`ZeroAmount`) | Contract: `onlyFinance` (`contracts/src/BudgetRegistry.sol`) |
| Release an allocation | Yes, `BudgetRegistry.releaseAllocation(id)` | Release an allocation that was never approved (`AllocationMissing`); release twice (`AlreadyReleased`) | Contract: `onlyFinance` |
| Initiate a payment | Yes, in the demo `initiatePayment` (`src/context/AppContext.tsx`); on chain `PaymentRegistry.recordPayment(id, projectId, milestoneId, payee, amountUsdcBaseUnits, invoiceHash)` | Record a payment for an unverified milestone (`MilestoneNotVerified`); record a payment whose milestone belongs to a different project (`MilestoneProjectMismatch`); record a payment above the remaining authorised limit (`ExceedsAuthorisedLimit`); reuse an invoice hash (`DuplicateInvoiceHash`); record the same payment ID twice (`PaymentExists`); record a zero amount (`ZeroAmount`) | Contract: `recordPayment` is `onlyFinance` with all of the above checks (`contracts/src/PaymentRegistry.sol`). The checks are the real duplicate payment and over limit protection |
| Authorise a payment they initiated | NO, by design. A second authoriser must approve it | Self authorisation is blocked in the demo | Frontend only, and BROKEN in the demo as shipped. See the gap note below |
| Authorise a payment someone else initiated | In the demo design, yes, as the second authoriser | There is no on chain second authoriser check at all | GAP. `PaymentRegistry.recordPayment` does not check for a second authoriser. Once deployed, a single Finance Officer can record a payment on chain with no second approval. The separation of duties rule exists only in the demo frontend and is not enforced by any contract |
| Mark a milestone Paid | Yes, indirectly: `MilestoneRegistry.markPaid(id)` | Mark a milestone Paid unless it is Verified (`WrongStatus`); call it as a non Finance account unless the caller is the PaymentRegistry itself | Contract: `markPaid` allows Finance or the PaymentRegistry address (`contracts/src/MilestoneRegistry.sol`) |
| Create a department or project | No | `registerProject` and department creation are admin only / frontend only | Contract: `registerProject` is `onlyAdmin` |
| Publish a tender or select a bid | No | Any procurement function | Contract: procurement functions require PROCUREMENT_ROLE |
| Verify a milestone | No | `verifyMilestone` is auditor only | Contract: `onlyAuditor` plus `SelfVerification` |
| Publish an audit report | No | Any audit function | Contract: auditor only |
| Edit an original financial record | No | No edit function exists for a recorded payment or allocation | Contract: append only |

### Gap note: the second authoriser rule as shipped

- `src/lib/permissions.ts` gives FINANCE_OFFICER the permissions `approve_budget`, `release_funds`, `initiate_payment`, and `view_public`. NO role in the table holds `authorise_payment`. The helper `canAuthorisePayment(role, initiatorRole)` returns true only when `role === "FINANCE_OFFICER"` and `initiatorRole !== role`, but payments are only ever initiated by a Finance Officer, so the initiator role is always `FINANCE_OFFICER` and the check is false in practice. The Finance dashboard (`src/pages/roles/FinanceDashboard.tsx`) calls `canAuthorisePayment(role, "FINANCE_OFFICER")`, so a Finance Officer viewing their own initiated payment sees self authorisation as not allowed, and no other role can authorise either.
- The demo README states the known limitation honestly: a newly initiated payment is marked Settled immediately in `initiatePayment` (`src/context/AppContext.tsx` sets `status: "Settled"` and the milestone to Paid), so it never sits in the pending authorisation queue. The queue and the second authoriser rule are shown only for the seeded pending payment (`pay-5` in `src/data/demoData.ts`, status "Pending authorisation").
- Consequence for this matrix: "Finance cannot authorise their own payment" is true in the demo UI, but "a second authoriser must approve before settlement" is NOT enforced anywhere that matters: not in the demo state machine (it settles immediately), not in the frontend permission table (no role holds the permission), and not on chain (no check in `PaymentRegistry`). A production deployment must add a real two step flow before any payment is treated as authorised.

## 3. JanLekha 2.0: Procurement Officer

Frontend route: `/app/procurement`. On chain role: `PROCUREMENT_ROLE`.

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Publish a tender | Yes, `ProcurementRegistry.publishTender(id, projectId, title, valueInr, deadline)` | Publish the same tender ID twice (`TenderExists`); publish with a zero value (`ZeroAmount`) | Contract: `publishTender` is `onlyProcurement` (`contracts/src/ProcurementRegistry.sol`) |
| Evaluate bids | Yes, read `getBids(tenderId)` and `getTender(tenderId)` | Evaluate a bid that was never submitted; the contract does not score bids, evaluation is a human step | Contract: reads are public; selection is the enforced step below |
| Select a bid (award) | Yes, `ProcurementRegistry.selectBid(tenderId, contractor)` | Select a contractor who never bid (`BidMissing`); select on a closed tender (`TenderClosed`); select on a tender that was never published (`TenderMissing`) | Contract: `selectBid` is `onlyProcurement` |
| Submit a bid | No | A procurement officer cannot bid on their own tender | Contract: `submitBid` is `onlyContractor`; a procurement officer without CONTRACTOR_ROLE reverts `NotContractor` |
| Approve a budget or record a payment | No | Any finance function | Contract: Finance only |
| Verify a milestone or publish an audit | No | Any auditor function | Contract: auditor only |
| Register a project | No | Admin only | Contract: `onlyAdmin` |
| Edit a tender after publication | No | No edit function exists; a published tender can only be closed by award | Contract: no update function for tenders |
| View public data | Yes | Nothing hidden | Public reads |

Note: bid details are not published on chain in full. `submitBid` records contractor address, amount in INR, and submission time. The migration report and README state that confidential data and private bid details stay off chain; only information approved for public disclosure is recorded on chain.

## 4. JanLekha 2.0: Contractor

Frontend route: `/app/contractor` (labelled "Project Manager / Contractor"). On chain role: `CONTRACTOR_ROLE`.

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Submit a bid | Yes, `ProcurementRegistry.submitBid(tenderId, amountInr)` | Bid twice on the same tender (`DuplicateBid`); bid after the deadline (`TenderPastDeadline`); bid on a closed or missing tender (`TenderClosed`, `TenderMissing`); bid zero (`ZeroAmount`) | Contract: `submitBid` is `onlyContractor` (`contracts/src/ProcurementRegistry.sol`) |
| Submit a milestone | Yes, `MilestoneRegistry.submitMilestone(id, projectId, amountInr, amountUsdcBaseUnits, evidenceHash)` | Submit the same milestone ID twice (`MilestoneExists`) | Contract: `submitMilestone` is `onlyContractor` (`contracts/src/MilestoneRegistry.sol`) |
| Verify their own milestone | NO | `verifyMilestone` and `rejectMilestone` revert `SelfVerification` when the caller is the submitter | Contract: `onlyAuditor` plus an explicit submitter check (`contracts/src/MilestoneRegistry.sol`) |
| Verify anyone else milestone | No | Only auditors verify | Contract: `onlyAuditor` |
| Record a payment to themselves | No | `recordPayment` is Finance only | Contract: `onlyFinance` |
| Approve a budget or publish a tender | No | Finance and procurement functions respectively | Contract: role modifiers |
| Publish an audit report | No | Auditor only | Contract: auditor only |
| Register a document | Yes, any role holder can register a document hash | Register the same content hash twice (`DuplicateContentHash`); register the same document ID twice (`DocumentExists`) | Contract: `DocumentRegistry.registerDocument` requires `hasAnyRole(msg.sender)`; citizens cannot register (`contracts/src/DocumentRegistry.sol`) |
| Verify a document | No | `verifyDocument` is auditor only | Contract: `onlyAuditor` equivalent (`NotAuditor`) |
| View public data | Yes | Nothing hidden | Public reads |

Note: the contractor named in `ProjectRegistry.registerProject` is a stored address, not a permission. Being named as a project contractor does not by itself grant CONTRACTOR_ROLE; the role must be granted separately in `RoleRegistry` by an admin.

## 5. JanLekha 2.0: Independent Auditor

Frontend route: `/app/auditor`. On chain role: `AUDITOR_ROLE`.

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Verify a milestone | Yes, `MilestoneRegistry.verifyMilestone(id)` | Verify a milestone that was never submitted (`MilestoneMissing`); verify a milestone that is not in Submitted status (`WrongStatus`); verify their own submission (`SelfVerification`); verify the same milestone twice (second call fails the status check) | Contract: `onlyAuditor` plus submitter and status checks (`contracts/src/MilestoneRegistry.sol`) |
| Reject a milestone | Yes, `MilestoneRegistry.rejectMilestone(id)` | Reject their own submission (`SelfVerification`); reject a non Submitted milestone (`WrongStatus`) | Contract: `onlyAuditor` plus the same checks |
| Verify a document | Yes, `DocumentRegistry.verifyDocument(id)` | Verify a document that was never registered (`DocumentMissing`); verify twice (`AlreadyVerified`) | Contract: auditor only (`contracts/src/DocumentRegistry.sol`) |
| Raise an audit flag | Yes, `AuditRegistry.raiseFlag(id, projectId, reason, risk)` | Raise the same flag ID twice (`FlagExists`) | Contract: `raiseFlag` is `onlyAuditor` (`contracts/src/AuditRegistry.sol`) |
| Resolve an audit flag | Yes, `AuditRegistry.resolveFlag(id, resolutionNote)` | Resolve a flag that was never raised (`FlagMissing`); resolve twice (`FlagAlreadyResolved`) | Contract: `onlyAuditor` |
| Publish an audit report | Yes, `AuditRegistry.publishReport(id, projectId, title, findings)` | Publish the same report ID twice (`ReportExists`) | Contract: `publishReport` is `onlyAuditor` |
| Change an original financial record | NO | Auditors cannot edit allocations, payments, milestones, or tenders. No edit function exists for those records in any registry | Contract: append only. The README states this explicitly: "auditors cannot change original financial records" |
| Approve a budget, record a payment, publish a tender, submit a bid | No | All of those are other roles functions | Contract: role modifiers on each registry |
| Grant or revoke roles | No | Only ADMIN grants and revokes | Contract: `RoleRegistry` `onlyAdmin` |
| View public data | Yes | Nothing hidden | Public reads |

Note on risk flags: the risk engine in `src/lib/risk.ts` computes flags from demo data (budget variance, duplicate hashes, over limit payments, repeated payments, delayed milestones, missing documents). Detection is a prompt for human review, never a conclusion of wrongdoing. A flag raised by the risk engine in the demo is not the same as a flag raised on chain with `AuditRegistry.raiseFlag`; only the latter is an on chain audit record.

## 6. JanLekha 2.0: Citizen

Frontend route: `/app/citizen` plus the whole public portal (`/`, `/departments`, `/projects`, `/tenders`, `/payments`, `/documents`, `/verify`, `/audits`, `/map`, `/complaints`, `/money-flow`). On chain role: none.

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| View all public records | Yes, no wallet required for any citizen feature (`README.md`) | Nothing is hidden from citizens in the public portal | Public reads; `src/lib/permissions.ts` gives CITIZEN only `view_public` |
| Verify a document hash | Yes, `/verify` computes SHA-256 in the browser and compares it with the registry (`src/pages/Verify.tsx`, `src/lib/format.ts`) | In demo mode the comparison is against demo state, not the on chain `DocumentRegistry`. See `docs/VERIFICATION.md` section 5 | Frontend; on chain check is `DocumentRegistry.hashRegistered` after deployment |
| Trace a project financial history | Yes, project pages and the money flow Sankey (`/money-flow`) | Trace a record that has no transaction hash: `SIM-ARC-...` refs do not resolve on the explorer | Data limitation, not a permission |
| File a complaint | Yes, `/complaints` (`addComplaint` in `src/context/AppContext.tsx`) | A complaint does not change any financial record and is not an on chain action | Frontend only, demo state |
| Follow a project, save a search | Yes, citizen workspace | These are local preferences, not permissions | Frontend only |
| Create a department or project | No | No write permission at all | Frontend: `can(CITIZEN, ...)` is false for every write; contract: citizen holds no role, so every `only*` modifier reverts |
| Approve, release, pay, tender, bid, verify, audit | No | Every write function in every registry | Contract: each write requires a role the citizen does not hold. `DocumentRegistry.registerDocument` requires `hasAnyRole`, which a citizen fails (`NoRole`) |
| Edit any record | No | Nothing | Contract: append only |

## 7. JanLekha 2.0 roles that exist only in the demo frontend

These exist in `src/lib/permissions.ts` or the demo UI but have NO on chain enforcement in the JanLekha 2.0 contracts, or no on chain equivalent at all:

1. **Department management.** `manage_departments` is a frontend permission for GOVERNMENT_ADMIN, and `addDepartment` exists in `src/context/AppContext.tsx`. There is no department registry contract. Departments exist only in demo state. Nothing on chain enforces who can create a department.
2. **Payment authorisation (second authoriser).** `authorise_payment` appears in the `Permission` type but NO role holds it in the `PERMISSIONS` table, `canAuthorisePayment` cannot return true for a real Finance initiated payment (see section 2 gap note), and `PaymentRegistry` has no second authoriser check. The rule is described in the UI and not enforced anywhere.
3. **Role selection at login.** Sign in at `/login` is demo local only role selection with no password and no real account (`README.md`). Choosing a role in the login screen grants the demo UI for that role; it does not grant the on chain role. On chain, only `RoleRegistry.grantRole` by an ADMIN grants a role, and the wallet address must match. A user who picks FINANCE_OFFICER in the demo but whose wallet holds no FINANCE_ROLE will have every on chain write revert.
4. **Complaint handling and notifications.** Complaints, notifications, and followed projects are demo state only. No contract governs them.
5. **The `approve_budget` permission for GOVERNMENT_ADMIN.** The frontend table lists it for the admin, but the contract gives allocation approval to Finance only (section 1 divergence). After deployment the contract wins and the frontend table is misleading on this point.

## 8. StreetSync roles (separate short section)

StreetSync does not use the JanLekha role table. Its roles are defined in `contracts/src/StreetSyncTypes.sol` (`Role` enum: None, Worker, Reviewer) and enforced in `contracts/src/StreetSyncEscrow.sol` and its inherited modules. The escrow is deployed on Arc Testnet at `0xFEDA4e28E03681fb9fD02cdFD2847F352Ce1eDf9` (`contracts/deployments/arcTestnet.json`).

### 8.1 Neighbour / citizen (no role required)

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Create a bounty | Yes, `createBounty(descHash, latE5, lngE5, regionCell, initialAmount, claimDeadline)` | Create with a zero initial amount (`ZeroAmount`); create with a deadline in the past (`InvalidDeadline`) | Contract: no role or attestation required to create; anyone can create |
| Pledge USDC to a bounty | Yes, `pledge(bountyId, amount)` | Pledge zero; pledge to a non Open bounty (status check) | Contract: no role required; amounts are 6 decimal USDC via `SafeERC20` |
| Withdraw a pledge | Yes, `withdrawPledge(bountyId)` | Withdraw before the claim deadline passes or while the bounty is not Open or Refunded (`ClaimDeadlineNotPassed`, status check) | Contract: pull based refund |
| View bounties and evidence | Yes, public reads and the audit page | Nothing hidden | Public reads; the backend indexer only caches what is already public |
| Claim a bounty | NO | A creator cannot claim their own bounty (`CreatorCannotClaim`); a pledger cannot claim a bounty they funded (`PledgerCannotClaim`) | Contract: `claim()` checks, Rule 2 |

### 8.2 Worker (World ID verified human)

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Claim a bounty | Yes, `claim(bountyId, nonce, expiry, attestationSig)` | Claim without a valid World ID attestation (`InvalidAttestation`, `AttestationExpired`, `NonceAlreadyUsed`); claim as creator or pledger; claim twice (`AlreadyClaimed`) | Contract plus backend: the backend verifies the World ID v4 proof and signs the EIP-712 attestation (`backend/src/signer.ts`, `backend/src/server.ts` `POST /api/worldid/verify`); the contract verifies the signature against the attester and the used nonce |
| Submit evidence | Yes, `submitEvidence(bountyId, arkivEntityKey, evidenceHash)` | Submit as anyone other than the claimed worker (`NotWorker`); submit twice (`AlreadySubmitted`); submit after the claim deadline (`ClaimExpired`) | Contract: worker only, Claimed status only |
| Request rework | Yes, `rework(bountyId)` after a rejection | Request rework more than once (`ReworkLimitReached`, `MAX_REWORK = 1`); request it as anyone other than the worker (`NotWorker`); request it when not Rejected (`WrongStatus`) | Contract: worker only, at most once |
| Review a bounty | NO | A worker cannot be a reviewer on a bounty they worked on (`WorkerCannotReview`); `assignPanel` excludes the worker | Contract: panel selection exclusion, Rule 2 |
| Vote or settle | No | Only panel reviewers commit and reveal; `settle` is permissionless but only tallies revealed votes | Contract: `commitVote` / `revealVote` require panel membership (`NotPanelMember`) |

The worker role is per bounty, not global. A wallet becomes a worker for one bounty by claiming it with a valid attestation. The visual challenge code (4 digits, 1000 to 9999) is emitted in `BountyClaimed` and must appear in the photographic evidence (Rule 6).

### 8.3 Reviewer (World ID verified human, staked)

| Action | Can do | Cannot do | Enforcement |
| --- | --- | --- | --- |
| Register as a reviewer | Yes, `registerReviewer(regionCell, nonce, expiry, attestationSig)` | Register without a valid World ID attestation; register twice (`AlreadyRegistered`) | Contract plus backend attestation; registration transfers a 10.00 USDC stake (`REVIEWER_STAKE = 10_000_000`, `contracts/src/ReviewerPool.sol`) into the pool |
| Commit a vote | Yes, `commitVote(bountyId, voteHash)` where `voteHash = keccak256(bountyId, reviewRound, approve, salt, voter)` | Commit as a non panel member (`NotPanelMember`); commit twice (`AlreadyCommitted`); commit after the commit window (`CommitWindowClosed`) | Contract: panel membership and window checks (`contracts/src/VotingModule.sol`) |
| Reveal a vote | Yes, `revealVote(bountyId, approve, salt)` | Reveal before the reveal window (`RevealWindowNotOpen`); reveal twice (`AlreadyRevealed`); reveal a hash that does not match the commitment (`VoteHashMismatch`) | Contract: hash match enforced on reveal |
| Withdraw a reward | Yes, `withdrawReward()` | Withdraw a reward that was never credited (`NothingToWithdraw`) | Contract: pull based; only majority reviewers are credited in `settle()` |
| Review a bounty they created, funded, or worked on | NO | Creator, worker, and pledgers are excluded from the panel (`CreatorCannotReview`, `WorkerCannotReview`, `PledgerCannotReview`) | Contract: `assignPanel` exclusion, Rule 2 |
| Fail to reveal | The stake is slashed | Non revealers lose their 10.00 USDC stake on `pokeOrReplace` or `settle` | Contract: slashing in `pokeOrReplace` and `settle` (`contracts/src/StreetSyncEscrow.sol`, `contracts/src/ReviewerPool.sol`) |

Panel selection: 3 reviewers, quorum 2, drawn from the regional pool by `assignPanel` using a two step future block seed (`selectionBlock = block.number + 2`, Rule 4). Reviewers are routed by `regionCell`, a coarse grid derived from latitude and longitude (`app/src/config/contracts.ts`, `regionCellFromLatLng`).

### 8.4 Anyone (permissionless actions)

| Action | Enforcement |
| --- | --- |
| `assignPanel(bountyId)` once the selection block has passed | Contract: any caller; reverts `SelectionBlockNotReached` too early |
| `settle(bountyId)` once all 3 reveal or the reveal deadline passes | Contract: any caller; reverts `RevealWindowOpen` too early and `QuorumNotReached` below quorum |
| `pokeOrReplace(bountyId)` after the reveal deadline with fewer than 2 revealed | Contract: any caller; reverts if quorum was already met |

### 8.5 Contract owner (deployer)

| Action | Enforcement |
| --- | --- |
| `setAttester(address)` | `onlyOwner` (`contracts/src/StreetSyncEscrow.sol`). The attester is the backend EIP-712 signer; changing it changes who can issue World ID attestations |
| `setCommitWindow`, `setRevealWindow`, `setClaimDuration` | `onlyOwner`. Deployed values are 300 s, 300 s, 3600 s (`contracts/deployments/arcTestnet.json`) |
| Anything else (create, pledge, claim, settle) | The owner has no special power over bounties. Ownership is limited to the four admin setters above |

### 8.6 Backend attester (off chain, trusted)

The backend holds `ATTESTER_PRIVATE_KEY` and signs EIP-712 attestations after World ID verification (`backend/src/signer.ts`). The backend refuses to run on a non local chain with Hardhat public test key (`backend/src/signer.ts` guard). The attester address on Arc Testnet is `0xf5274266C5205Ea462D232B3D4016b3A9D887D3F` (`contracts/deployments/arcTestnet.json`). The attester is a trusted party: if its key leaks, an attacker can issue attestations for arbitrary wallets until the owner calls `setAttester`. There is no on chain check of the World ID proof itself; the proof is verified off chain by the backend against `https://developer.world.org/api/v4/verify/<app id>`.

### 8.7 World ID configuration: what is and is not configured

- App ID in the app config and backend example: `app_401e8c235a6b3bbd1bc62df14d5c021d` (`app/src/config/contracts.ts`, `backend/.env.example`). The root `.env.example` instead lists `app_staging_streetsync` as the frontend default. The backend server defaults to `app_streetsync_dev` when `WORLD_APP_ID` is unset (`backend/src/server.ts`). Confirm the live app ID from `GET /api/health` before relying on it.
- RP ID is NOT separately configured. The server uses `WORLD_RP_ID ?? WORLD_APP_ID` (`backend/src/server.ts`), so the RP ID defaults to the app ID unless `WORLD_RP_ID` is set in the environment. No RP ID value is recorded in the repo.
- World ID actions: worker action `claim-bounty` (per bounty action `claim-bounty-<bountyId>`, `workerActionFor` in `app/src/config/contracts.ts`) and reviewer action `register-reviewer`.

## 9. Cross cutting rules

1. **No role can edit history.** In JanLekha 2.0, no registry has an update function for a recorded allocation, payment, milestone, tender, bid, document, flag, or report. Only `ProjectRegistry.updateStatus` changes a project status, and only an admin. In StreetSync, no function edits a bounty record after creation except the defined lifecycle transitions (`claim`, `submitEvidence`, `settle`, `rework`, `pokeOrReplace`).
2. **The frontend permission table is not the contract.** Where they disagree (admin `approve_budget`, payment authorisation), the contract governs the live path and the frontend governs only the demo.
3. **A demo role is not a chain role.** Picking a role at `/login` in JanLekha 2.0 changes the demo UI. It does not grant the on chain role. On chain writes check the wallet address against `RoleRegistry`.
4. **Citizens are read only everywhere.** In JanLekha 2.0 the citizen holds no role and every write reverts. In StreetSync a citizen without World ID verification can create and fund bounties but cannot claim, work, or review.
5. **Separation of duties is partial.** Enforced on chain: a contractor cannot verify their own milestone (`SelfVerification`); a StreetSync creator or pledger cannot claim or review their own bounty; a majority vote of 2 of 3 reviewers is required to settle. NOT enforced on chain: the JanLekha second payment authoriser. That gap must be closed before any real payment is treated as authorised.

## 10. Sources

- JanLekha 2.0 repo `~/workspace/janlekha` commit `0da05fe`: `src/lib/permissions.ts`, `src/lib/arc.ts`, `src/lib/contracts.ts`, `src/context/AppContext.tsx`, `src/data/demoData.ts`, `src/pages/roles/FinanceDashboard.tsx`, `contracts/src/RoleRegistry.sol`, `contracts/src/BudgetRegistry.sol`, `contracts/src/ProjectRegistry.sol`, `contracts/src/ProcurementRegistry.sol`, `contracts/src/MilestoneRegistry.sol`, `contracts/src/PaymentRegistry.sol`, `contracts/src/DocumentRegistry.sol`, `contracts/src/AuditRegistry.sol`, `docs/ARC-MIGRATION.md`, `README.md`.
- StreetSync clone `~/workspace/street-sync-verify-docs` commit `6600b9b`: `contracts/deployments/arcTestnet.json`, `contracts/src/StreetSyncEscrow.sol`, `contracts/src/StreetSyncTypes.sol`, `contracts/src/ReviewerPool.sol`, `contracts/src/VotingModule.sol`, `contracts/src/AttestationVerifier.sol`, `app/src/config/contracts.ts`, `backend/src/server.ts`, `backend/src/signer.ts`, `backend/src/indexer.ts`, `backend/src/db.ts`, `.env.example`, `backend/.env.example`.
