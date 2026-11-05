# StreetSync: Master Context & Technical Specification

> **AI AGENT INSTRUCTION:** Treat this document as your single source of truth for **StreetSync** (formerly CivicFix). Every architectural choice, data structure, decimal precision rule, and security constraint below is mandatory. Do not deviate from these specifications or invent mock stubs where real sponsor integrations are specified.

---

## 1. Project Identity & Core Loop

- **Project Name:** StreetSync
- **Tagline:** *Neighbors fund it, a verified human fixes it, other verified humans confirm it, and USDC releases only when the community agrees.*
- **Core Sponsor Stack:**
  1. **World ID v4:** Sybil-resistant "one human, one identity" for Workers and Reviewers via off-chain verification + EIP-712 on-chain attestations.
  2. **Arc Testnet (Circle):** EVM settlement layer (Chain ID: `5042002`) where gas is paid natively in USDC and all bounty escrows, reviewer stakes, and payouts settle in ERC-20 USDC.
  3. **Arkiv:** Decentralized verifiable entity store holding the compressed binary evidence bundle (`<= 128,000 bytes`).
  4. **Zstandard (Zstd) + WebP:** Client-side hybrid compression pipeline ensuring 2 photos + CBOR telemetry + cryptographic signature fit inside a single atomic Arkiv entity write.

---

## 2. Critical Security Fixes & Closed Loopholes (MANDATORY)

Every agent must enforce these 7 architectural rules to ensure zero loopholes:

### Rule 1: The USDC Decimal Trap (6 Decimals vs 18 Decimals)
- On Arc Testnet (`5042002`), the native gas view uses 18 decimals, while the **ERC-20 USDC interface uses strictly 6 decimals** (`1 USDC = 1_000_000`).
- **Mandate:** NEVER use `msg.value` for bounty escrows or reviewer stakes. All smart contract functions and frontend `viem` calls MUST use `IERC20(USDC_ADDRESS)` and `parseUnits(amount, 6)` / `formatUnits(amount, 6)`.

### Rule 2: Anti-Wash Trading & Self-Dealing Prevention
- A user cannot fund a bounty and claim it themselves or review it themselves.
- **Mandate:**
  - `claim()` reverts if `msg.sender == bounty.creator` or if `pledges[bountyId][msg.sender] > 0`.
  - `assignPanel()` explicitly excludes `bounty.creator`, `bounty.worker`, and any address with `pledges[bountyId][addr] > 0`.
  - A protocol/reviewer reward cut (`10%` of bounty pool) is deducted upon approval and distributed to majority reviewers, ensuring wash-trading results in a net economic loss.

### Rule 3: Commit-Reveal Deadlock Recovery (`pokeOrReplace`)
- If assigned reviewers commit or get selected but fail to reveal their votes before `revealDeadline`, the bounty must not lock forever.
- **Mandate:** Implement `pokeOrReplace(uint256 bountyId)`. Once `block.timestamp > revealDeadline`, if `revealedVotes < QUORUM (2)`, any caller can trigger `pokeOrReplace`. It immediately slashes the USDC stake of non-revealing reviewers, increments `reviewRound`, draws replacement reviewers, and resets the commit/reveal timers without forcing the worker to re-upload evidence.

### Rule 4: Two-Step Future Block Randomness
- Selecting reviewers in the same transaction as `submitEvidence()` allows a worker to simulate the block and abort if their friends aren't chosen.
- **Mandate:** Decouple submission from selection:
  1. `submitEvidence()` sets `bounty.status = Status.Submitted` and records `bounty.selectionBlock = block.number + 2`.
  2. `assignPanel(bountyId)` can only be called when `block.number > bounty.selectionBlock`. It derives the random seed via `keccak256(abi.encodePacked(blockhash(bounty.selectionBlock), bountyId, reviewRound))`. (If `block.number - bounty.selectionBlock > 250`, roll `selectionBlock = block.number + 2`).

### Rule 5: Replay-Proof EIP-712 World ID Attestations
- Because World ID v4 verifies off-chain in our backend, the backend acts as an EIP-712 signer (`attester`).
- **Mandate:** All role gates (`claim`, `registerReviewer`) verify an EIP-712 signature over:
  `Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)`
  bound to `chainId = 5042002` and `verifyingContract`. The contract marks `usedNonces[wallet][nonce] = true`.

### Rule 6: Anti-Spoofing Visual Challenge Code & Telemetry
- To prevent workers from uploading old photos or spoofing GPS on a rooted phone:
- **Mandate:** When a worker calls `claim(bountyId)`, the contract generates a deterministic 4-digit visual challenge code: `uint16(uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), bountyId, msg.sender))) % 9000 + 1000)`.
- The UI displays this 4-digit code on the camera overlay and requires live camera capture (`capture="environment"`, no file picker gallery) along with capturing device compass heading (`DeviceOrientationEvent`) and GPS accuracy inside the signed CBOR metadata.

### Rule 7: Single-Entity Atomic Arkiv Budget (`<= 120 KiB` Target)
- Arkiv limits a single entity payload to `128 KiB` (`131,072 bytes`, safe budget `120,000 bytes` after framing/attributes).
- **Mandate:** Client-side image encoding resizes `before` and `after` images to max `1280px` longest edge and encodes as WebP (quality `0.72`, strict cap `<= 48,000 bytes` per image). Combined with Zstd-compressed CBOR metadata (`~1-2 KiB`) and a 65-byte EIP-191 signature, the entire bundle stays under `100 KiB`—guaranteeing a **single atomic Arkiv entity write** every time.

---

## 3. Repository Monorepo Structure

```text
streetsync/
├── contracts/                  # Foundry project (Solidity 0.8.24)
│   ├── src/
│   │   ├── StreetSyncTypes.sol
│   │   ├── AttestationVerifier.sol
│   │   ├── ReviewerPool.sol
│   │   ├── VotingModule.sol
│   │   └── StreetSyncEscrow.sol
│   ├── test/
│   │   └── StreetSync.t.sol
│   └── script/
│       └── Deploy.s.sol
├── packages/
│   ├── evidence/               # Browser/Node TS package: WebP + CBOR + Zstd + Binary Packager
│   │   ├── src/
│   │   │   ├── compress.ts
│   │   │   ├── bundle.ts
│   │   │   ├── dictionary.ts
│   │   │   └── index.ts
│   └── arkiv-client/           # Arkiv SDK wrapper for writing/fetching/verifying bundles
│       └── src/
│           └── index.ts
├── backend/                    # Fastify + TypeScript service (or Next.js API routes)
│   └── src/
│       ├── worldid.ts          # World ID v4 verification + Nullifier DB
│       ├── signer.ts           # EIP-712 Attestation Signer
│       └── indexer.ts          # Arc event indexer + SQLite/Postgres cache
└── app/                        # Next.js 14+ (App Router) Mobile-First PWA
    └── src/
        ├── app/                # Routes: /, /bounty/[id], /verify, /reviewer
        ├── components/         # MapView, CameraCapture, CompressionStats, AuditPanel
        └── lib/                # wagmi/viem config, contract ABIs
```

---

## 4. Smart Contract Specification (Arc Testnet - `5042002`)

### 4.1 Constants & Parameters
- **USDC Token:** Configurable ERC-20 address in constructor (6 decimals). Includes a `MockUSDC` (6 decimals) for local Foundry testing and fallback demo minting.
- **Panel Size:** `3` reviewers per bounty.
- **Quorum / Approval Threshold:** `2` revealed votes minimum; `>= 2` approvals required to pass.
- **Reviewer Stake:** `2_000_000` (`2.00 USDC`, 6 decimals).
- **Protocol Reviewer Cut:** `1000 bps` (`10%` of `totalPledged` goes to majority reviewers; `90%` goes to the worker upon approval).
- **Demo Timeouts (Configurable by Owner for Live Demo vs Prod):**
  - `commitWindow`: `300 seconds` (5 mins for demo)
  - `revealWindow`: `300 seconds` (5 mins for demo)
  - `claimDuration`: `3600 seconds` (1 hour to submit repair after claiming)

### 4.2 Core Data Structures (`StreetSyncTypes.sol`)
```solidity
enum Status {
    Open,           // Created and accepting USDC pledges
    Claimed,        // Claimed by a World ID verified worker
    Submitted,      // Evidence uploaded to Arkiv, waiting for 2-block randomness
    InReview,       // 3 reviewers assigned, commit-reveal in progress
    Approved,       // Majority approved, worker & reviewers paid
    Rejected,       // Majority rejected, worker can rework once or bounty reopens
    Refunded        // Expired unclaimed or cancelled, funders withdraw pledges
}

enum Role {
    None,
    Worker,
    Reviewer
}

struct Bounty {
    uint256 id;
    address creator;
    bytes32 descriptionHash;
    int32 latE5;
    int32 lngE5;
    uint16 regionCell;
    uint256 totalPledged;       // 6 decimals USDC
    uint64 createdAt;
    uint64 claimDeadline;       // Expiry if no one completes it
    address worker;
    uint16 visualChallengeCode; // 4-digit code (1000-9999) emitted on claim
    bytes32 arkivEntityKey;     // 32-byte Arkiv entity identifier
    bytes32 evidenceHash;       // SHA-256 hash of the binary bundle
    uint256 selectionBlock;     // block.number + 2 for randomness
    uint8 reviewRound;          // Increments on pokeOrReplace or rework
    uint8 reworkCount;          // Max 1 rework allowed on rejection
    Status status;
}
```

### 4.3 Required Contract Functions & Signatures
1. `createBounty(bytes32 descHash, int32 latE5, int32 lngE5, uint16 regionCell, uint256 initialAmount, uint64 claimDeadline) external returns (uint256 bountyId)`
2. `pledge(uint256 bountyId, uint256 amount) external`
3. `claim(uint256 bountyId, uint256 nonce, uint64 expiry, bytes calldata attestationSig) external`
4. `submitEvidence(uint256 bountyId, bytes32 arkivEntityKey, bytes32 evidenceHash) external`
5. `registerReviewer(uint16 regionCell, uint256 nonce, uint64 expiry, bytes calldata attestationSig) external` (Transfers `2 USDC` stake into pool).
6. `assignPanel(uint256 bountyId) external` (Callable once `block.number > selectionBlock`).
7. `commitVote(uint256 bountyId, bytes32 voteHash) external` (`voteHash = keccak256(abi.encodePacked(bountyId, reviewRound, approveBool, salt, msg.sender))`).
8. `revealVote(uint256 bountyId, bool approve, bytes32 salt) external`
9. `settle(uint256 bountyId) external` (Tallies revealed votes after `revealDeadline` or immediately once all 3 reveal. Pays worker 90%, splits 10% + slashed minority stakes among majority reviewers, and returns majority stakes).
10. `pokeOrReplace(uint256 bountyId) external` (Slashes non-revealers after `revealDeadline` if `< 2` revealed, increments `reviewRound`, draws new panel).
11. `withdrawPledge(uint256 bountyId) external` (Pull-based refund if `block.timestamp > claimDeadline` and status is `Open` or `Rejected`).

---

## 5. Binary Evidence Bundle Specification (`packages/evidence`)

Every evidence bundle stored on Arkiv is a single deterministic byte array with the following exact binary layout:

```text
Offset   Size (Bytes)   Field             Description
------------------------------------------------------------------------------------
0        4              MAGIC             ASCII "SSYN" (0x53, 0x53, 0x59, 0x4E)
4        1              VERSION           0x01
5        1              FLAGS             Bit 0: Zstd Dict Used (1), Bit 1: WebP (1)
6        2              DICT_ID           uint16 BE (e.g., 0x0001)
8        4              META_LEN          uint32 BE (Length of Zstd-compressed CBOR metadata)
12       4              BEFORE_IMG_LEN    uint32 BE (Length of Before WebP image bytes)
16       4              AFTER_IMG_LEN     uint32 BE (Length of After WebP image bytes)
20       META_LEN       META_BYTES        Zstd(CBOR(EvidenceMetadata))
20+M     BEFORE_LEN     BEFORE_BYTES      WebP image bytes (<= 48,000 bytes)
20+M+B   AFTER_LEN      AFTER_BYTES       WebP image bytes (<= 48,000 bytes)
End-65   65             WORKER_SIG        EIP-191 signature by worker over SHA-256(bytes[0 .. End-65])
```

- **On-chain `evidenceHash`:** `SHA-256(full_bundle_bytes)` (including `WORKER_SIG`).
- **`EvidenceMetadata` Schema (CBOR before Zstd compression):**
  ```typescript
  export interface EvidenceMetadata {
    v: 1;
    bountyId: string;
    workerAddress: `0x${string}`;
    challengeCode: number;         // 4-digit code from contract
    beforeTimestampMs: number;
    afterTimestampMs: number;
    gps: {
      lat: number;
      lng: number;
      accuracyMeters: number;
    };
    orientation: {
      alpha: number | null;        // Compass heading
      beta: number | null;
      gamma: number | null;
    };
    beforeSha256: string;          // Hex SHA-256 of raw before WebP
    afterSha256: string;           // Hex SHA-256 of raw after WebP
    userAgent: string;
    notes: string;
  }
  ```

---

## 6. Arkiv Storage Specification (`packages/arkiv-client`)

- **Entity Payload:** Raw `Uint8Array` of the complete binary bundle (`<= 120,000 bytes`).
- **Entity Attributes (all strings `<= 128 bytes`):**
  - `project`: `"streetsync"`
  - `entity_type`: `"evidence"`
  - `bounty_id`: `String(bountyId)`
  - `worker`: `workerAddress.toLowerCase()`
  - `sha256_prefix`: `evidenceHashHex.slice(0, 32)`
- **Entity Expiration:** Set TTL to at least `7 days` (`604800` seconds) so evidence outlives the review and audit window.

---

## 7. World ID v4 & EIP-712 Backend Specification (`backend/`)

### 7.1 Endpoints
1. `POST /api/attest`
   - **Input:** `{ wallet, role, bountyId, worldIdProof: { merkle_root, nullifier_hash, proof, verification_level } }`
   - **Logic:**
     - Verifies proof against World ID v4 API (`https://developer.worldcoin.org/api/v2/verify/{app_id}`).
     - Checks local DB that `(nullifier_hash, actionId)` has not been used by a different wallet.
     - Generates a unique `nonce` and `expiry = Math.floor(Date.now() / 1000) + 3600`.
     - Signs EIP-712 `Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)` using `ATTESTER_PRIVATE_KEY`.
   - **Output:** `{ nonce, expiry, signature, attester }`
2. `GET /api/bounties` & `GET /api/bounties/:id`
   - Returns indexed bounty list + cached coordinates/descriptions so the map loads instantaneously.