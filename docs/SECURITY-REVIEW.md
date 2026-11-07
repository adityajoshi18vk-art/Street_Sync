# Security Review: StreetSync plus JanLekha 2.0

Scope: StreetSync clone at commit `6600b9b`, all six StreetSync contracts, deploy script, Hardhat config, `arcTestnet.json`, backend `server.ts`, `signer.ts`, `db.ts`, `indexer.ts`, `abi.ts`, `stickers.ts`, app `wagmi.ts`, `contracts.ts`, `arkiv.ts`, `evidence.ts`, `api.ts`, `tx.ts`, `packages/arkiv-client`, `packages/evidence`, `packages/swarm-client`, plus review and work pages and `CommitRevealCard.tsx` where they bear on the in-scope files. JanLekha 2.0 reviewed at `~/workspace/janlekha`, commit `0da05fe`: README, `src/lib/permissions.ts`, `src/lib/risk.ts`, `src/context/AppContext.tsx`, `src/lib/arc.ts`, `src/lib/contracts.ts`, all eight `contracts/src/*.sol`, and `contracts/script/Deploy.s.sol`. The old `janlekha/` inside StreetSync was treated as retired context only. No live chain calls were made. No transaction hashes or test results are claimed here. No product code was changed for this review.

Note on truth: blockchain immutability proves integrity and ordering only. It does not prove the original government submission was truthful. A false invoice hash, a staged photograph, or a wrong amount can be recorded immutably. Truth of the repair or the submission rests on evidence checks and human audit, not on the chain alone.

## Critical

### C1. StreetSync Rule 2 (anti-wash-trading) is enforced per wallet, not per human, and is bypassable with a second wallet
Severity: Critical. Files: `contracts/src/StreetSyncEscrow.sol:173-200` (`claim`), `contracts/src/StreetSyncEscrow.sol:244-276` (`assignPanel`), `contracts/src/ReviewerPool.sol:82-110` (`_selectPanel`), `backend/src/server.ts:145-160`.
Proof: `claim()` only checks `if (msg.sender == b.creator) revert CreatorCannotClaim();` and `if (pledges[bountyId][msg.sender] > 0) revert PledgerCannotClaim();`. `assignPanel` excludes only `b.creator`, `b.worker`, and addresses in the `_pledgers` list. The World ID nullifier is scoped per action (`claim-bounty-<id>` vs `register-reviewer` are different actions with different nullifiers), and the proof signal is just a wallet string the prover supplies; nothing proves the prover owns that wallet and nothing links wallets belonging to one human across actions. So a creator can claim their own bounty from a fresh wallet, and the same human can hold a worker attestation on wallet B and a reviewer attestation on wallet C and sit on the panel judging their own work (only wallet B is excluded). The 5 percent reviewer cut does not stop this: a creator-worker keeps 95 percent of their own pool.
Fix: add a one-time identity-binding step with a single fixed World ID action that maps one human to exactly one wallet, recorded in the backend, and refuse any role attestation for a different wallet from that human. Do not rely on per-action nullifiers for cross-role linkage, since they differ per action by design.

### C2. Shipped World ID dev-bypass path: backend flag plus live UI buttons that mint attestations from synthetic proofs
Severity: Critical if the flag is ever on in a deployed backend; the code path is real. Files: `backend/src/server.ts:65-70,188-191`, `backend/.env.example:17`, `app/src/app/bounty/[id]/work/page.tsx:164,403`, `app/src/app/review/page.tsx:128,248`.
Proof: server: `const DEV_BYPASS_ENABLED = process.env.ALLOW_DEV_WORLD_ID_BYPASS === "true";` and `if (DEV_BYPASS_ENABLED && request.body.dev_bypass) { ... verified = { success: true }; }`. The example env file ships `ALLOW_DEV_WORLD_ID_BYPASS=true`. Both the work page and the review page render buttons wired to `handleDevBypassVerify` / `handleDevBypassReviewer`, which send a random nullifier, `merkle_root` and `proof` of all zeros, and `dev_bypass: true`. When the flag is on, anyone mints a valid EIP-712 attestation with no World ID proof at all.
Fix: delete the bypass from server and UI entirely, or gate it behind a build-time dev-only flag that cannot be enabled by environment in a deployed build; never ship `ALLOW_DEV_WORLD_ID_BYPASS=true` in any example file. Add a startup check that refuses to boot a non-local chain with the bypass enabled, mirroring the existing Hardhat-key guard in `signer.ts`.

## High

### H1. A claimed bounty that never submits evidence locks pledgers funds forever; the claim deadline is never enforced
Severity: High. Files: `contracts/src/StreetSyncEscrow.sol:200,209-227,467-500`.
Proof: `claim()` resets `b.claimDeadline = uint64(block.timestamp + claimDuration);` but `submitEvidence()` contains no timestamp check at all, so the deadline is unenforced even for late submission. Worse, `withdrawPledge()` only permits `Status.Open`, `Status.Refunded`, or `Status.Rejected` with `reworkCount >= MAX_REWORK`. There is no `unclaim`, `expireClaim`, or cancel path out of `Status.Claimed` or `Status.Submitted`. If a worker abandons a claim, the escrow is permanently locked.
Fix: enforce `block.timestamp <= b.claimDeadline` in `submitEvidence()`, and add an `expireClaim()` callable by anyone after the deadline that returns the bounty to `Open` (or `Refunded`) so pledgers can withdraw.

### H2. A bounty bricks permanently when fewer than 3 eligible reviewers exist; there is no refund path from `Submitted`
Severity: High. Files: `contracts/src/ReviewerPool.sol:110`, `contracts/src/StreetSyncEscrow.sol:244-276,467-500`.
Proof: `_selectPanel` does `if (eligibleCount < PANEL_SIZE) revert InsufficientReviewers();`. `assignPanel` leaves the bounty in `Status.Submitted` on revert, and `withdrawPledge` cannot run from `Submitted`. `pokeOrReplace` only works from `InReview` and slashes reviewers, shrinking the pool further, so a poked bounty can fall into the same trap on the next round. This is likely in early deployment when a region pool is small.
Fix: add a cancel/refund path from `Submitted` (for example after a timeout, anyone can trigger a refund to pledgers), and surface pool depth in the UI before evidence submission.

### H3. The live Arc Testnet deployment uses a publicly mintable MockUSDC, so all escrow economics are valueless
Severity: High for any real-value framing; disclosed as demo. Files: `contracts/src/MockUSDC.sol:23`, `contracts/deployments/arcTestnet.json` (`MockUSDC` at `0xAdC3bd879bB63329Ad1490af2845851C23215057`), `README.md` section 6.
Proof: `function mint(address to, uint256 amount) external { _mint(to, amount); }` has no access control. The deployment artifact confirms MockUSDC is the live token on Arc Testnet, and the app shows a "Get 100 test USDC" button. Anyone can mint unlimited stake, pledges, and bounties.
Fix: use real Arc USDC before any non-demo use; keep MockUSDC local-chain only and never deploy it to a shared testnet that is presented as the live system.

### H4. JanLekha `recordPayment` does not bind the payment to the milestone amount or payee, and Finance can mark milestones Paid with no payment at all
Severity: High. Files: `~/workspace/janlekha/contracts/src/PaymentRegistry.sol:78-117`, `~/workspace/janlekha/contracts/src/MilestoneRegistry.sol:133-142`.
Proof: `recordPayment` checks the authorised project limit (`if (amountUsdcBaseUnits > limit - paid) revert ExceedsAuthorisedLimit(...)`) and the milestone is Verified, but never compares `amountUsdcBaseUnits` to `milestone.amountUsdcBaseUnits` and never checks `payee` against the milestone submitter. Finance can record one payment up to the whole project limit to any address for a small milestone. Separately, `markPaid` allows `isFinance` as well as the PaymentRegistry, so Finance alone can flip any Verified milestone to Paid with no payment record, bypassing the limit and duplicate-invoice checks entirely.
Fix: cap each payment (and cumulative payments per milestone) at the milestone amount, require `payee == milestone.submitter` (or the registered project contractor), and remove the Finance branch from `markPaid` so only the PaymentRegistry can mark Paid.

### H5. JanLekha separation of duties is UI-only, and the second-authoriser control is dead code
Severity: High as a product claim; demo-only impact today because state is localStorage and payments are simulated. Files: `~/workspace/janlekha/src/lib/permissions.ts:18-30`, `~/workspace/janlekha/src/context/AppContext.tsx:66`, `~/workspace/janlekha/src/pages/roles/FinanceDashboard.tsx:57,115`, `~/workspace/janlekha/src/pages/Login.tsx:49`.
Proof: no role in `PERMISSIONS` holds `authorise_payment`, so `can(role, "authorise_payment")` is false for everyone. `canAuthorisePayment(role, initiatorRole)` returns `role === "FINANCE_OFFICER" && initiatorRole !== role`; the dashboard calls it as `canAuthorisePayment(role, "FINANCE_OFFICER")`, which is false whenever the caller is Finance, that is always in the only path that initiates payments. It compares role strings, not identities, so two different finance officers are indistinguishable. Meanwhile no `AppContext` action calls `can()` at all, and `Login.tsx` lets anyone pick any role with `setRole(r)` and no password. `initiatePayment` then marks the payment `status: "Settled"` immediately.
Fix: enforce permission checks inside every `AppContext` action, not just in dashboard rendering; model authorisation by officer identity (a second, distinct finance officer), hold payments `Pending` until authorised, and treat the current localStorage role picker as demo-only with a real auth boundary before any production use. Note the README does disclose the Settled-immediately limitation honestly.

### H6. The backend records the World ID nullifier before signing the attestation, so a signing failure permanently burns the user's one verification for that action
Severity: High. Files: `backend/src/server.ts:222,234`, `backend/src/signer.ts:157-200`, `backend/src/db.ts:413-419`.
Proof: the verify handler runs `dbAccess.insertNullifier(...)` (step 3) and only then `await signAttestation(...)` (step 4). If signing throws (bad wallet format, DB unique violation, verifying-contract resolution failure), the request fails but the nullifier is already consumed, and the next attempt returns 409 "already been attested". Separately, `nextNonce` computes `MAX(nonce)+1` per wallet, so two concurrent signings for one wallet can sign the same nonce; the second `recordNonce` then violates `UNIQUE(wallet, nonce)` and fails after the nullifier is already recorded.
Fix: sign first, then insert the nullifier and nonce record in one transaction, or allocate nonces atomically (counter row with an atomic increment). Validate the wallet address format before touching the nullifier table.

### H7. On-chain evidence references are unresolvable by anyone except the uploader's browser, and `submitEvidence` accepts any hash with no existence check
Severity: High. Files: `packages/arkiv-client/src/index.ts:94-130,189,349-430`, `app/src/lib/arkiv.ts` (`readEntity` fallback), `contracts/src/StreetSyncEscrow.sol:209-227`.
Proof: `entityKeyToBytes32` hashes any non-bytes32 Arkiv key with SHA-256, a one-way mapping; `bytes32ToEntityKey` only reverses it from an in-memory `Map` or, in the app, from `localStorage` (`lookupStoredEntityKey`, `rememberEntityMapping`). A reviewer on a different device cannot resolve the on-chain `arkivEntityKey` to the real Arkiv key, and the review page confirms this by trying localStorage candidates first. `submitEvidence` stores whatever `arkivEntityKey` and `evidenceHash` the worker passes, including zeros, with no check the entity exists. `verifyEvidenceBundle` then only checks hash match plus signature recovery; it never checks `metadata.bountyId` against the bounty, `visualChallengeCode` against the on-chain code, GPS against the bounty coordinates, or timestamps against the claim window.
Fix: store a resolvable reference (full Arkiv key or gateway URL) in the backend index keyed by bounty, have the indexer confirm the entity exists and its hash matches before the bounty is reviewable, and extend the verifier to check bountyId, challenge code, GPS proximity, and timestamp window.

### H8. The false "blockchain immutability proves truth" claim is present in StreetSync's framing, and the underlying design cannot support it
Severity: High (product claim). Files: `README.md:24`, `app/src/app/manifest.ts:8`, `contracts/src/StreetSyncEscrow.sol:209-227`, `packages/arkiv-client/src/index.ts:349-430`.
Proof: README: "Guaranteed immutable storage with minimum 7-day TTL (604,800 seconds), surviving all review, audit, and rework periods." Manifest: "Community-funded civic repair bounties with World ID verification and tamper-proof evidence on Arc Testnet." Neither is true as stated. The chain stores only a hash and an Arkiv key; photos, GPS, compass heading, timestamps, and the challenge code are all self-asserted by the worker inside a bundle they assemble, and `submitEvidence` performs no validation. A hash proves a file existed unchanged since registration, not that the repair happened, that the photo is of the claimed location, or that the submitter is who they claim to be. Arkiv evidence also expires after a 7-day TTL, so it is not immutable in any durable sense; after expiry the on-chain hash becomes unverifiable. No explicit "immutability guarantees truth" sentence was found in JanLekha 2.0 docs; the same conceptual gap applies there (see M9), but the false wording found is StreetSync's.
Fix: reword to tamper-evident, not tamper-proof; state explicitly that on-chain records prove integrity and ordering only, and that truth of the repair rests on reviewer inspection of photos; extend Arkiv TTL or pin evidence permanently for audit.

## Medium

### M1. World ID `verification_level` is never enforced server-side, and the frontend uses Device level
Severity: Medium. Files: `backend/src/server.ts:153` (only requires presence), `app/src/app/bounty/[id]/work/page.tsx:384`, `app/src/app/review/page.tsx:206` (`verification_level={VerificationLevel.Device}`).
Proof: the server forwards `verification_level` to the World API as an identifier but never requires a minimum level, so a weaker device-level proof is accepted exactly like an Orb proof.
Fix: require `verification_level === "orb"` (or a configured minimum) in the backend before issuing an attestation.

### M2. CORS allows all origins and there is no rate limiting or authentication on any backend endpoint
Severity: Medium. File: `backend/src/server.ts:46` (`origin: true, // Allow all origins in dev; restrict in production`).
Proof: any website can call `/api/worldid/verify` from a visitor's browser, and there is no rate limit on attestation issuance or on the read endpoints.
Fix: allowlist the app origin in production, add rate limiting (especially on the verify endpoint), and log abuse.

### M3. Owner centralisation: attester and voting windows are single-owner controlled with no timelock, bounds, or multisig
Severity: Medium. File: `contracts/src/StreetSyncEscrow.sol:81-99`.
Proof: `setAttester`, `setCommitWindow`, `setRevealWindow`, `setClaimDuration` are `onlyOwner` with no validation. A compromised owner or attester key means unlimited fake World ID attestations; windows set to 0 or huge values can break commit/reveal liveness. `Ownable` also allows `transferOwnership`/`renounceOwnership` with no two-step process.
Fix: move ownership to a multisig with a timelock, bound the windows (for example minimum 60s, maximum 7 days), and use two-step attester rotation.

### M4. `settle()` strands slashed stakes from earlier `pokeOrReplace` rounds, with no way to recover them
Severity: Medium. Files: `contracts/src/StreetSyncEscrow.sol:311-410`, `contracts/src/StreetSyncEscrow.sol:438-463`.
Proof: `pokeOrReplace` slashes non-revealers and the stakes stay in the contract, but `settle()` only adds current-round slashes (`slashedFromMinority`) to the reviewer pool. Round-1 slashed funds are never distributed to anyone and there is no sweep function, so they accumulate in escrow forever. Integer-division remainders in `perReviewer` are also stranded as dust each settlement.
Fix: track cumulative slashed balance per bounty and distribute it at final settlement; add a dust sweep callable only after settlement.

### M5. Swarm video upload silently falls back to a fabricated reference
Severity: Medium. File: `packages/swarm-client/src/index.ts:269-282`.
Proof: on upload failure or when no postage batch is configured, `uploadVideo` returns `mode: "mock"` with `swarmReference` equal to the video SHA-256 (`videoSha256.slice(2)`), a gateway URL for that reference that will 404, and the video stored only in the uploader's in-memory `localVideoStorage`. The README still claims the video is "cryptographically sealed inside the Arkiv bundle, anchoring heavy video blobs into Arc Layer 1". A reviewer on another device gets a dead video.
Fix: fail loudly when Swarm upload fails, or clearly label mock references in metadata and UI and never present them as Swarm references or gateway URLs.

### M6. Vote salts live only in localStorage; losing them means losing the 10 USDC stake
Severity: Medium. Files: `app/src/components/CommitRevealCard.tsx:108,120`, `app/src/lib/evidence.ts:109-117`.
Proof: the salt is saved with `saveVote` only after the commit transaction confirms, keyed by bounty, round, and wallet in localStorage. The reveal path errors "No saved salt found for this bounty + round + wallet on this device. Commit votes are device-bound." A reviewer who clears storage or switches device cannot reveal and is slashed.
Fix: let reviewers export/back up the salt (encrypted), or store it in a form the user can recover; warn before commit that the salt is device-bound.

### M7. JanLekha bids are public on-chain and awards can happen before the deadline with no evaluation rule
Severity: Medium. File: `~/workspace/janlekha/contracts/src/ProcurementRegistry.sol` (`submitBid`, `selectBid`).
Proof: bid amounts are stored in plaintext and readable via `getBids`, so later bidders can shadow earlier bids; `selectBid` has no deadline check and no rule (lowest bid, scoring) constraining which bid is selected, only that the bidder submitted one.
Fix: if sealed bidding is intended, commit bid hashes first and reveal later; at minimum enforce award only after the deadline and record the selection rationale.

### M8. JanLekha `DocumentRegistry` proves registration, not provenance, and its global duplicate-hash rule blocks legitimate reuse
Severity: Medium. File: `~/workspace/janlekha/contracts/src/DocumentRegistry.sol` (`registerDocument`, `_hashRegistered`).
Proof: any role holder can register any `contentHash` for any project with no check they are related to the project or that the content is a genuine government document; a matching hash later proves only that the same bytes were registered, not who issued them. Separately, `_hashRegistered` is global, so the same standard form legitimately used by two projects is rejected as `DuplicateContentHash` on the second registration.
Fix: scope duplicate detection per project (or per project plus docType), and label verification as "hash matches a registered record", never as proof of government origin.

### M9. JanLekha `RoleRegistry` lets an admin grant any role bytes32, including ADMIN, with no allowlist or two-step process
Severity: Medium. File: `~/workspace/janlekha/contracts/src/RoleRegistry.sol` (`grantRole`, `revokeRole`).
Proof: `grantRole(bytes32 role, address account)` accepts any role identifier; an admin can grant themselves or others ADMIN, and the deployer remains admin indefinitely unless they revoke themselves. There is no grant expiry or two-step acceptance.
Fix: allowlist the five known roles in `grantRole`, consider two-step grants for ADMIN, and document the post-deployment step of revoking the deployer's admin role (the deploy script already suggests considering this).

### M10. Indexer state can desync from the chain in small ways
Severity: Medium. File: `backend/src/indexer.ts` (`handleBountySettled`, `handleVoteCommitted`, `handlePokeOrReplace`).
Proof: `handleBountySettled` maps every rejection to status 5, but the contract sets `Refunded` (6) when `reworkCount >= MAX_REWORK`. `handleVoteCommitted` infers the review round from the cached bounty row rather than the event, so a commit processed before its panel event (or after a round change) is recorded under the wrong round. `handlePokeOrReplace` approximates `selectionBlock` as `log.blockNumber + 2` rather than reading it.
Fix: read status, round, and selectionBlock from the contract or from the event args instead of inferring them; add a periodic reconciliation pass against `getBounty`.

### M11. EIP-712 signature malleability: no low-`s` check in `ecrecover` recovery
Severity: Medium (low practical impact because nonces are consumed). File: `contracts/src/AttestationVerifier.sol:125-137`.
Proof: `_recoverSigner` checks `v` is 27 or 28 and `recovered != address(0)` but does not require `s <= secp256k1n/2`, so a malleated signature is a second valid signature for the same attestation digest.
Fix: use OpenZeppelin `ECDSA.recover` (which enforces low-`s`) instead of raw `ecrecover`.

### M12. JanLekha risk engine checks INR amounts while contracts enforce USDC limits, and it runs only on client-side demo state
Severity: Medium (detection gap, not a fund risk). Files: `~/workspace/janlekha/src/lib/risk.ts` (`checkPaymentsOverLimit`, `checkBudgetVariance`), `~/workspace/janlekha/src/context/AppContext.tsx`.
Proof: `checkPaymentsOverLimit` compares `pay.amountInr > ms.amountInr`, while the on-chain invariant is in 6-decimal USDC base units against the authorised limit; an over-limit USDC payment need not show as an INR over-limit and vice versa. All flags are computed from localStorage demo state, so anyone can edit localStorage to clear flags.
Fix: run the same checks against the USDC figures the contracts enforce, and run the risk engine server-side or on indexed chain data in production.

## Low / Informational

### L1. Spec and code disagree on reviewer economics
Spec section 4.1 says reviewer stake is 2.00 USDC and the reviewer cut is 10 percent; code has `REVIEWER_STAKE = 10_000_000` (10.00 USDC, `ReviewerPool.sol:25`) and `REVIEWER_CUT_BPS = 500` (5 percent, `StreetSyncEscrow.sol`). README section 3 says 5 percent. Fix: correct the spec to 10 USDC and 5 percent.

### L2. Hardhat public test key is present in the repo
`backend/src/signer.ts:28` and `backend/.env.example:11` contain `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Hardhat account 0). This key is public knowledge, but the signer refuses it on non-local chains, and the example file labels it as the local-dev default. No live key was found. Fix: keep the guard, and remove the literal key from the example file in favour of a placeholder.

### L3. JanLekha `PaymentRegistry.recordPayment` moves no tokens
The registries only record; no USDC is transferred by any JanLekha contract, so the authorised limit is a record-keeping invariant, not a spending control. The name `recordPayment` and the README's simulated-settlement framing are consistent with this, but do not present the limit as preventing real overspend.

### L4. JanLekha `MilestoneRegistry.setPaymentRegistry` must be called by an admin or `recordPayment` always reverts
`MilestoneRegistry.sol:79` plus `PaymentRegistry.recordPayment` calling `markPaid`. The shipped `Deploy.s.sol` does call it, so the deployment path is correct; it is a footgun for any manual redeploy. Fix: set the payment registry in the constructor or make the deploy script assert it.

### L5. `pokeOrReplace` reverts with a misleading error name
`StreetSyncEscrow.sol:438-463`: when quorum is already met it reverts `QuorumNotReached()`, which reads backwards. Cosmetic; rename to a dedicated error.

### L6. No input validation on bounty coordinates
`createBounty` accepts any `int32 latE5/lngE5` with no range check, so out-of-range coordinates can be stored. Fix: validate lat in [-90,90] and lng in [-180,180] (scaled by 1e5).

### L7. JanLekha `AuditRegistry` accepts any `uint8 risk` value (0-255) with no range check, and `BudgetRegistry.approveAllocation` does not validate `amountInr` or that the department/project exists
Low; trusted-role inputs, but a typo creates nonsense records. Fix: validate ranges and existence.

## What was checked and found clean

- No `msg.value` escrow, 6-decimal USDC handled consistently. All StreetSync functions are `nonpayable`; transfers use `SafeERC20`; frontend amounts go through `parseUsdc`/`formatUsdc` with `parseUnits(amount, 6)` (`app/src/config/contracts.ts`, `app/src/lib/tx.ts` exact-approve only, never infinite allowance). JanLekha contracts document and enforce the 6-decimal ERC-20 vs 18-decimal native gas distinction (`BudgetRegistry.sol`, `PaymentRegistry.sol: USDC_DECIMALS = 6`).
- No duplicate fund release via double `settle`. `settle()` sets `b.status` to `Approved`/`Rejected`/`Refunded` before any transfer (`StreetSyncEscrow.sol:363,393,395`), and a second call reverts `WrongStatus`. Rewards are pull-based with balance zeroed before transfer (`ReviewerPool.sol: _withdrawReward`).
- Reentrancy posture is sound for the deployed token. Status is set before external calls in `settle`, and `withdrawPledge`/`withdrawReward` zero balances before `safeTransfer`. Residual risk is limited to a malicious USDC token, which is fixed at deploy time.
- EIP-712 attestation binding is correct. Domain includes name, version, chainId, and verifyingContract (`AttestationVerifier.sol`); struct hash binds wallet, role, bountyId, nonce, expiry; nonces are consumed on use (`usedNonces[wallet][nonce]`, line 115) and expiry is checked. The backend signer matches byte-for-byte (`backend/src/signer.ts`, `ATTESTATION_TYPES`), and the chainId/verifyingContract come from the deployment artifact.
- Commit-reveal vote binding is correct. `voteHash = keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter))` on-chain (`VotingModule.sol`) matches the frontend `computeVoteHash` (`app/src/lib/evidence.ts`); reveal verifies the preimage and rejects double reveal; quorum is 2 of 3.
- No private keys or live credentials found. The only key material in the repo is the public Hardhat test key (L2). JanLekha's deploy script reads `PRIVATE_KEY` only from the environment (`contracts/script/Deploy.s.sol`) and never hardcodes one. No mainnet configuration is present.
- Backend failure handling fails closed on World ID. A World API error returns 502, a failed proof returns 401 (409 only on the already-used patterns), and the action is derived server-side, never trusted from the client (`server.ts: expectedAction`).
- JanLekha contract role checks are present on all state-changing functions. Every registry gates writes by role via `RoleRegistry`; `DocumentRegistry` has no edit path (append-only by construction); `AuditRegistry.resolveFlag` never rewrites the original reason, risk, or raiser; registries are not upgradeable and hold no funds.
- JanLekha disclosure is honest where it matters. The README states demo data is synthetic, payments are simulated with `SIM-ARC-...` references that are not transaction hashes, the Settled-immediately limitation, and that server-side permission enforcement is a production requirement. The risk engine labels flags "Requires Investigation" / "Potential Discrepancy" and states detection does not prove fraud (`src/lib/risk.ts`).
- No sensitive data leakage observed. The backend health endpoint exposes only the attester address, chainId, and app id (public by design); read endpoints expose data that is already public on-chain. No PII is written on-chain in either project.

## Top priorities before any real use

1. Fix C1 (one human, one wallet binding) and remove C2 (dev bypass) entirely; these defeat the identity premise.
2. Add the H1/H2 fund-recovery paths (claim expiry and Submitted refund) so user funds cannot lock forever.
3. Replace MockUSDC with real Arc USDC (H3) and resolve the H7 evidence resolvability gap before reviewers are asked to trust the audit flow.
4. For JanLekha, enforce H4 (payment bound to milestone amount and payee) and H5 (real second-authoriser control with identity, not role strings) before presenting it as a financial control system rather than a demo.
5. Reword the StreetSync "tamper-proof" / "guaranteed immutable" claims (H8) to tamper-evident integrity only, and extend evidence retention beyond the 7-day TTL.
