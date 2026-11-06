# StreetSync

> **Neighbors fund it, a verified human fixes it, other verified humans confirm it, and USDC releases only when the community agrees.**

---

## 1. Project Overview & Sponsor Stack

StreetSync is a decentralized physical infrastructure and public-works platform that allows local communities to crowdfund real-world civic repairs in USDC, cryptographically bind work to verified humans using World ID v4, compress high-resolution photographic and sensor evidence into a single atomic decentralized storage entity on Arkiv, and trustlessly settle escrow payouts on Arc Testnet via commit-reveal community consensus.

### Core Sponsor Integrations

1. **World ID v4 (Worldcoin):**
   - Sybil-resistant "one human, one identity" verification for Workers and Reviewers.
   - Enforces unique nullifier tracking in SQLite per action (`register-worker`, `register-reviewer`, `review-bounty-<id>`).
   - Issues single-use EIP-712 cryptographic attestations (`Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)`), verified on-chain by `AttestationVerifier.sol`.

2. **Arc Testnet (Circle - Chain ID `5042002`):**
   - EVM settlement layer with gas paid natively in USDC.
   - All bounty escrows, top-up pledges, reviewer stakes (10.00 USDC), and settlement payouts strictly use **6-decimal ERC-20 USDC** (`1e6` base units) via OpenZeppelin `SafeERC20`.

3. **Arkiv Verifiable Entity Store:**
   - Single atomic entity writes (`<= 128,000 bytes`, target `< 120,000 bytes`).
   - Guaranteed immutable storage with minimum 7-day TTL (`604,800 seconds`), surviving all review, audit, and rework periods.
   - Converts Arkiv entity identifiers into EVM `bytes32` for transparent on-chain storage and auditability.

4. **Ethereum Swarm (BZZ) Video Walkthrough Streaming:**
   - High-throughput chunked distributed blob storage for 10-second on-site video walkthroughs.
   - Uses 4 KiB Merkle chunk trees for zero-lag browser streaming without pre-downloading.
   - **Dual-Tier Model**: The 64-char Swarm Bzz reference and video SHA-256 are cryptographically sealed inside the Arkiv bundle, anchoring heavy video blobs into Arc Layer 1 with zero on-chain gas overhead.
   - Resilient multi-tier client with 4-second timeout and offline local fallback.

5. **Hybrid Zstandard (Zstd) + WebP Compression Pipeline:**
   - Compresses 4 MB of raw dual-camera photos (before + after repair), GPS accuracy telemetry, compass heading, Swarm video reference, and EIP-191 worker signature into a single **~81 KiB** binary package (**97.8% reduction**).

---

## 2. Real-World Evidence Compression Benchmark

*Measured in production benchmark tests (`@streetsync/evidence` pipeline test & `scripts/e2e-verify.ts`)*:

| Metric | Raw Uncompressed | Compressed Output | Reduction / Limit |
| :--- | :--- | :--- | :--- |
| **Before Photo (WebP)** | ~2,000,000 bytes (2 MB) | **40.31 KiB** (41,277 B) | Quality: `0.55` (Cap: `<= 48 KiB`) |
| **After Photo (WebP)** | ~2,000,000 bytes (2 MB) | **40.46 KiB** (41,431 B) | Quality: `0.55` (Cap: `<= 48 KiB`) |
| **Video Walkthrough (Swarm)** | ~2.5 MB (10s 720p WebM) | **64-char Bzz ref + SHA-256** | Stored on Swarm; hash anchored in Arkiv |
| **Telemetry & GPS Metadata** | 578 bytes (JSON) | **310 – 429 bytes** | CBOR (531 B) → Zstd Dictionary WASM |
| **Worker Signature** | — | **65 bytes** | EIP-191 ECDSA `(r, s, v)` |
| **Total Signed Bundle** | **3.72 MB** (3,896,551 B) | **81.27 KiB** (83,222 B) | **97.86% Savings** (**46.8x ratio**) |
| **Arkiv Atomic Limit** | 128,000 bytes | **83,222 bytes** | **Fits in 1 Atomic Arkiv Write** |
| **On-Chain Evidence Hash** | SHA-256 | `0xcc04fa47...` | Verified `bytes32` in `StreetSyncEscrow` |

---

## 3. Seven Critical Security Mitigations (Zero Loopholes)

1. **Rule 1: The USDC Decimal Trap (6 Decimals vs 18 Decimals)**
   - On Arc Testnet (`5042002`), native gas uses 18 decimals, but ERC-20 USDC uses strictly 6 decimals (`1 USDC = 1_000_000`).
   - `msg.value` is strictly prohibited. All escrow transfers, stakes, and payouts use `IERC20(USDC_ADDRESS)` and `SafeERC20`.

2. **Rule 2: Anti-Wash Trading & Self-Dealing Prevention**
   - `claim()` reverts with `CreatorCannotClaim` if `msg.sender == bounty.creator`, and reverts with `PledgerCannotClaim` if `pledges[bountyId][msg.sender] > 0`.
   - `assignPanel()` strictly excludes the creator, the worker, and any pledgers from being selected as reviewers.
   - A 5% reviewer fee is deducted on settlement and awarded to majority reviewers, ensuring that wash-trading results in an immediate net financial loss.

3. **Rule 3: Commit-Reveal Deadlock Recovery (`pokeOrReplace`)**
   - If selected reviewers fail to reveal their votes before `revealDeadline`, the bounty is never locked forever.
   - Any caller can trigger `pokeOrReplace(bountyId)` after `revealDeadline`. It immediately slashes the 10 USDC stake of non-revealers, increments `reviewRound`, draws replacement reviewers, and restarts the commit/reveal timers without requiring the worker to re-upload evidence.

4. **Rule 4: Two-Step Future Block Randomness**
   - Decouples submission from panel selection:
     1. `submitEvidence()` records `selectionBlock = block.number + 2` and sets status to `Submitted`.
     2. `assignPanel(bountyId)` can only be called once `block.number > selectionBlock`, deriving pseudo-randomness from `keccak256(blockhash(selectionBlock), bountyId, reviewRound)`.
     3. If > 250 blocks pass without an assignment, `selectionBlock` safely rolls forward by 2 blocks to prevent blockhash zeroing.

5. **Rule 5: Replay-Proof EIP-712 World ID Attestations**
   - World ID v4 zero-knowledge proofs are verified off-chain by the backend attester.
   - `claim()` and `registerReviewer()` verify an EIP-712 typed signature over `Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)`.
   - The contract marks `usedNonces[wallet][nonce] = true` to prevent signature reuse across bounties or transactions.

6. **Rule 6: Anti-Spoofing Visual Challenge Code & Sensor Telemetry**
   - Calling `claim(bountyId)` computes a deterministic 4-digit code (`1000`–`9999`):
     `uint16(uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), bountyId, msg.sender))) % 9000 + 1000)`
   - The mobile camera view burns this 4-digit challenge code onto the canvas, captures live compass orientation (`DeviceOrientationEvent` heading) and GPS accuracy meters, and encodes them into the signed CBOR metadata.

7. **Rule 7: Single-Entity Atomic Arkiv Budget (`<= 120 KiB`)**
   - Client-side WebP downsampling (longest edge 1280px, quality 0.55–0.72) and trained Zstd dictionary compression guarantee the entire evidence bundle stays under 100 KiB, eliminating multi-entity fragmentation.

---

## 4. Repository Monorepo Architecture

```text
streetsync/
├── contracts/                  # Hardhat project (Solidity 0.8.24, viaIR: true, optimizer: 200)
│   ├── src/
│   │   ├── StreetSyncTypes.sol     # Enums, structs, custom errors, events
│   │   ├── AttestationVerifier.sol # EIP-712 World ID signature verifier
│   │   ├── ReviewerPool.sol        # Reviewer staking, regional pool, Fisher-Yates panel selection
│   │   ├── VotingModule.sol        # Hashed commit-reveal voting & pokeOrReplace recovery
│   │   ├── StreetSyncEscrow.sol    # Central entry point: create, pledge, claim, evidence, settle
│   │   └── MockUSDC.sol            # 6-decimal ERC-20 token for local dev and testnet seeding
│   ├── test/
│   │   └── StreetSync.test.ts      # 14 Mocha/Chai tests covering all rules and edge cases
│   ├── deployments/
│   │   ├── localhost.json          # Deployment artifact for Chain ID 31337
│   │   └── arcTestnet.json         # Deployment artifact for Chain ID 5042002
│   └── scripts/
│       └── deploy.ts               # Hardhat deployment script
├── packages/
│   ├── evidence/               # WebP + CBOR + Zstd WASM compression pipeline & binary packager
│   ├── arkiv-client/           # Arkiv SDK wrapper, bytes32 conversion, and cryptographic audit verifier
│   └── swarm-client/           # Ethereum Swarm Bee wrapper, video upload, streaming, and fallback
├── backend/                    # Fastify + TypeScript service
│   ├── src/
│   │   ├── db.ts               # SQLite schema for nullifiers, nonces, bounties, and assignments
│   │   ├── signer.ts           # EIP-712 attestation signer using viem
│   │   ├── indexer.ts          # Viem event indexer watching Arc Testnet / Hardhat
│   │   └── server.ts           # REST API: /api/worldid/verify, /api/bounties, /api/reviewers
├── app/                        # Next.js 14 Mobile-First PWA (App Router)
│   ├── src/
│   │   ├── app/                # Pages: /, /bounty/[id], /bounty/[id]/work, /review, /audit/[id]
│   │   ├── components/         # MapView, CameraCapture, BeforeAfterSlider, CommitRevealCard, AuditVerifier
│   │   └── config/             # Wagmi, Viem, and dynamic contract deployments
└── scripts/
    └── e2e-verify.ts           # Full 42-step end-to-end integration test (Swarm + Arkiv + Arc)
```

---

## 5. Quickstart & Local Testing

### Prerequisites
- Node.js `>= 18` (v20+ recommended)
- `npm`

### Installation
From the root directory:
```bash
npm install
npm run build
```

### Run Tests
```bash
# 1. Smart Contract tests (14/14 passing)
npm run test:contracts

# 2. Evidence compression, Swarm client, and Arkiv pipeline tests (11/11 passing)
npm run test:pipeline

# 3. Backend API and EIP-712 attestation tests (4/4 passing)
npm run test --workspace=streetsync-backend

# 4. Full End-to-End lifecycle verification (42/42 passing)
npm run test:e2e
```

### Run Local Development Server
```bash
npm run dev
```
- **Frontend App**: `http://localhost:3000`
- **Backend API**: `http://localhost:3001`
- **Health Check**: `http://localhost:3001/api/health`

---

## 6. Demo Day Checklist & Tips

1. **Camera & Geolocation Permissions**:
   - Modern browsers require **HTTPS** (or `http://localhost`) to grant `navigator.mediaDevices.getUserMedia` and `navigator.geolocation`.
   - **For laptop demos**: Open `http://localhost:3000` in Chrome/Brave and use DevTools mobile emulation with your laptop webcam.
   - **For physical mobile phone demos**: Run `npx ngrok http 3000` to get a secure `https://` tunnel URL for your phone camera.

2. **World ID Staging Verification**:
   - In staging mode, test using the **[World ID Simulator](https://simulator.worldcoin.org)** without needing a physical Orb.

3. **Deploying to Arc Testnet**:
   1. Place your funded deployer private key in `.env`: `DEPLOYER_PRIVATE_KEY=0x...`
   2. Run `npm run deploy:arc`
   3. The script automatically updates `contracts/deployments/arcTestnet.json`, instantly configuring the frontend and backend.

---

## JanLekha (separate project)

`janlekha/` is a self-contained Next.js + Hardhat + Prisma app with its own lockfile; it is not part of the npm workspaces above. Setup:

```bash
cd janlekha && npm ci && cp .env.example .env
npm run dev            # http://localhost:3000/health
npm run contracts:test
```

See `janlekha/README.md` for all commands.
