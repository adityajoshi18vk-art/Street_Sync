# JanLekha 2.0 into StreetSync: Integration Plan

Status: Phase 1 inspection and planning only. No code was changed to produce this plan.
Date: 2026-11-07.
Sources inspected at the commits named below. If a later commit changes any file cited here, re-check that citation before building on it.

- Primary repo: `~/workspace/street-sync`, main commit `6600b9b`, owner `adityajoshi18vk-art`.
- Integration source: `~/workspace/janlekha`, commit `0da05fe`.
- Source of truth for StreetSync: `README.md` and `streetsync_master_context_technical_specification.md` in the primary repo, including its 7 mandatory security rules. Where the specification document disagrees with the code, the code governs and the disagreement is flagged in this plan. It is not silently resolved.
- JanLekha 2.0 source of truth: its `README.md` and `docs/ARC-MIGRATION.md`, which state its limits honestly.

## 0. What this plan is, and what it is not

This plan integrates JanLekha 2.0, the Vite plus React plus TypeScript plus Tailwind Arc Testnet transparency portal, into StreetSync as a first class section under `/janlekha`, inside the existing Next.js 14 app. It retires the old Hedera based `janlekha/` sub-app that already lives in the StreetSync repo. It does not ship a production government system, it does not move real funds, and it does not invent a transaction hash, a payment, or an audit result anywhere.

Non-goals for this integration:

- No change to StreetSync bounty escrow economics, reviewer staking, commit-reveal voting, or the 7 security rules.
- No mainnet deployment of anything.
- No real USDC movement until the settlement decision in C-14 is made by the owner and implemented as a separate, reviewed step.
- No personal data on chain, ever. See C-20.
- No silent migration of demo data into real records. Demo data stays labelled DEMO DATA until it is replaced by indexed on-chain records, and the label only comes off a record when that record is verifiably on chain.

Reading note: "JanLekha 2.0" always means `~/workspace/janlekha` at `0da05fe`. "Old JanLekha" always means `janlekha/` inside `~/workspace/street-sync`. They are different codebases with different chains, frameworks, and data models. Confusing them is the single easiest way to break this integration.

## 1. Current state, verified from the code

### 1.1 StreetSync as it stands

- Monorepo, npm workspaces: `contracts`, `packages/*`, `backend`, `app`. Root `package.json` workspaces are exactly those four. `janlekha/` is NOT in workspaces. It is installed only by the root `postinstall` script (`npm --prefix janlekha install --no-audit --no-fund`) and started only by the root `dev` script.
- Frontend: `app/`, Next.js 14.2.28, React 18.3.1, App Router, mobile-first PWA, Tailwind CSS 3.4.7 with `app/tailwind.config.ts`, `next/font` (Inter plus Bricolage Grotesque), dark theme, near-black ink palette (`#050506`), signal lime brand (`#bef264`, `#a3e635`), violet accent. Global styles in `app/src/app/globals.css` with shadcn style HSL tokens. Layout, desktop nav, and mobile tab bar in `app/src/app/layout.tsx` and `app/src/components/layout/SiteNav.tsx`.
- Routes in `app/src/app`: `/`, `/bounty/[id]`, `/bounty/[id]/work`, `/review`, `/worker`, `/audit/[id]`, `/stickers`. There is no `/janlekha` route inside `app/` today. `/janlekha` only exists as a rewrite proxy in `app/next.config.mjs` to the old JanLekha service on port 3100.
- Wallet and chain: wagmi 2.12.0 plus viem 2.21.0, injected connector only, `ssr: true`, in `app/src/config/wagmi.ts`. Chains are Arc Testnet 5042002 and Hardhat local 31337, defined in `app/src/config/contracts.ts`. Contract addresses come from `contracts/deployments/arcTestnet.json` or `localhost.json`, with optional `NEXT_PUBLIC_ESCROW_ADDRESS` and `NEXT_PUBLIC_USDC_ADDRESS` overrides. USDC is strictly 6 decimals everywhere, via `parseUsdc` and `formatUsdc` (`parseUnits(amount, 6)` and `formatUnits(amount, 6)`). Native gas on Arc is USDC with an 18 decimal view. `msg.value` is prohibited by Rule 1.
- Contracts: `contracts/`, Hardhat 2.22.0, Solidity 0.8.24, `viaIR: true`, optimizer runs 200. Five contracts plus MockUSDC: `StreetSyncEscrow.sol`, `ReviewerPool.sol`, `VotingModule.sol`, `AttestationVerifier.sol`, `StreetSyncTypes.sol`, `MockUSDC.sol` (6 decimals, publicly mintable on testnet). Deployed on Arc Testnet 5042002: StreetSyncEscrow `0xFEDA4e28E03681fb9fD02cdFD2847F352Ce1eDf9`, MockUSDC `0xAdC3bd879bB63329Ad1490af2845851C23215057`, per `contracts/deployments/arcTestnet.json`. Tests: 16 `it(` blocks in `contracts/test/StreetSync.test.ts` (README says 14, the file has 16; trust the file, see section 10).
- Backend: `backend/`, Fastify 5.2.0 plus TypeScript, port 3001 (`BACKEND_PORT`), `backend/src/server.ts`, `db.ts`, `signer.ts`, `indexer.ts`, `abi.ts`, `stickers.ts`. SQLite via `node:sqlite` (`DatabaseSync`), file at `DB_PATH` (default `data/streetsync.db`), WAL mode, `busy_timeout 5000`, foreign keys on. Tables: `nullifiers`, `nonces`, `bounties`, `pledges`, `panel_assignments`, `vote_commits`, `reviewer_slashes`, `settlements`, `events_cursor`, `stickers`. Endpoints: `POST /api/worldid/verify`, `GET /api/bounties`, `GET /api/bounties/:id`, `GET /api/reviewers/:address/assignments`, `GET /api/stickers/:address`, `GET /api/health`. No JanLekha endpoint exists yet.
- Indexer: `backend/src/indexer.ts`, viem public client, polls Arc Testnet (8 second interval, 5 block confirmation lag) or local Hardhat (2 second interval, 0 lag), resumable `events_cursor`, handlers for BountyCreated, Pledge, BountyClaimed, EvidenceSubmitted, panel assignment, VoteCommitted, VoteRevealed, BountySettled, poke, and rework.
- World ID: `backend/src/signer.ts` and `server.ts`. World ID v4 verify API at `https://developer.world.org/api/v4/verify/<RP ID>`, protocol version `3.0`. Backend is the EIP-712 attester. Domain is `{ name: "StreetSync", version: "1", chainId, verifyingContract }`, type `Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)`. Nullifiers are stored per action in SQLite with `UNIQUE(nullifier_hash, action)`. Actions are derived server side, never trusted from the client: worker `claim-bounty-<bountyId>`, reviewer `register-reviewer`. A dev bypass exists only when `ALLOW_DEV_WORLD_ID_BYPASS=true` AND the request sends `dev_bypass=true`. The backend refuses Hardhat account 0 private key on any non-local chain. World app id in code and env examples is `app_401e8c235a6b3bbd1bc62df14d5c021d`.
- Arkiv: `packages/arkiv-client/`, real SDK wrapper plus `IArkivClient` interface (`writeEntity`, `readEntity`). Constants: `MAX_SAFE_BUNDLE_BYTES = 120000`, `MAX_CHUNK_PAYLOAD = 115000`, `CHUNK_HEADER_SIZE = 4`, `ENTITY_TTL_SECONDS = 604800` (7 days). `entityKeyToBytes32` normalises any Arkiv key to bytes32 (exact 64 hex chars used as is, other hex right padded, anything else SHA-256 hashed). Reverse mapping lives only in an in-memory `Map`, so it does not survive a restart. See C-18.
- Evidence: `packages/evidence/`, WebP plus CBOR plus Zstd WASM pipeline. Binary bundle layout is `SSYN` magic, version `0x01`, flags, dict id, Zstd compressed CBOR metadata, before WebP, after WebP, 65 byte EIP-191 worker signature. Each photo is capped at 45 KiB in code (`MAX_IMAGE_BYTES`, resizer), longest edge 1280px. On-chain `evidenceHash` is SHA-256 of the complete bundle including the signature. `chunkBundle` exists in `bundle.ts` and `chunkAndWriteBundle` exists in `packages/arkiv-client/src/index.ts`, with a 4 byte `SC` chunk header (`0x53, 0x43, index, total`) and a JSON manifest entity. Max 255 chunks.
- Swarm: `packages/swarm-client/`, Bee gateway wrapper, 4 second upload timeout, local fallback, 64 char Bzz reference plus video SHA-256 sealed inside the Arkiv bundle.
- Dev runner: root `dev` runs three processes concurrently (backend 3001, StreetSync app 3000, old JanLekha 3100). `predev` runs `scripts/clean-ports.mjs`, which kills listeners on ports 3000, 3001, and 3100. `app/next.config.mjs` rewrites `/backend/:path*` to port 3001, `/janlekha` and `/janlekha/:path*` to port 3100, and also top level `/projects`, `/verify`, `/demo-documents/:path*`, and `/api/documents*` to the old JanLekha service. Those top level rewrites are a collision hazard for the new integration. See C-09 and C-11.
- Node: root and app require Node 18 plus. Old JanLekha requires Node 22 plus. The VM used for inspection runs Node v24.22.1.

### 1.2 JanLekha 2.0 as it stands

- Standalone Vite app, NOT a workspace member anywhere. `~/workspace/janlekha/package.json`: Vite 8.3.6, React 19.3.1, React DOM 19.3.1, react-router-dom 7.18.5, ethers 6.17.0, Recharts 3.10.1, Tailwind CSS 4.3.5 via `@tailwindcss/vite`, TypeScript about 7.0.2, oxlint. Scripts are only `dev` (`vite`, port 5173), `build` (`tsc -b && vite build`), `lint`, `preview`. No backend, no test script in `package.json` (Foundry tests live under `contracts/`).
- Routing: `src/App.tsx` with `BrowserRouter`. Public routes: `/`, `/departments`, `/departments/:id`, `/projects`, `/projects/:id`, `/tenders`, `/tenders/:id`, `/payments`, `/documents`, `/verify`, `/audits`, `/map`, `/money-flow`, `/complaints`, `/login`, `/app` (redirects by role). Role workspaces: `/app/admin`, `/app/finance`, `/app/procurement`, `/app/contractor`, `/app/auditor`, `/app/citizen`. There are NO separate routes for budgets, allocations, releases, expenditure, or audit trail. Those are sections inside the Finance and Admin dashboards. See the routing table in section 4.
- State: `src/context/AppContext.tsx` (77 lines of provider plus all workflow actions in one `useMemo`). All state lives in React state, persisted wholesale to browser localStorage under key `janlekha-demo-v1`, plus role under `janlekha-role`. Role is also read from localStorage in a `useState` initializer, which is a server side rendering hazard in Next.js. See C-03. There is no server, no database, no API, no indexer, no pagination, no optimistic concurrency, and no multi-user behaviour. Two browsers never see each other changes.
- Seed data: `src/data/demoData.ts` (113 lines). 6 departments, 8 projects, 8 tenders, 8 milestones, 5 payments, 5 documents, 5 audit flags, 3 audit reports, 2 complaints, 5 timeline events, 6 notifications, 5 contractors. Every figure is realistic synthetic demo data. The file exports `DEMO_NOTICE = "DEMO DATA: realistic synthetic demonstration data. This is not actual government expenditure."` Amounts are plain JavaScript numbers in INR, with `CR = 10000000` as the crore multiplier. Project ids are human strings such as `proj-1`, `dept-health`, `ten-1`. There is no stable mapping from these ids to chain ids yet. See C-13.
- Financial model: INR budgets and USDC settlement are separate concepts and are never mixed in the code. INR amounts are whole rupees for reporting. USDC amounts are ERC-20 base units with 6 decimals. The demo payments carry `simulated: true` and refs like `SIM-ARC-2026-06-30-1842`. `src/lib/arc.ts` has `simulateArcPayment`, which builds a `SIM-ARC-...` ref from the timestamp and a random number. It is labelled simulated everywhere it is used. `initiatePayment` in AppContext marks a new payment `Settled` immediately. The README states this honestly as a known limitation: the second authoriser queue is only shown for the seeded pending payment (`pay-5`, Rs 40 Cr to Meridian Infrastructure Ltd, status `Pending authorisation`).
- Permissions: `src/lib/permissions.ts` (30 lines). Six roles, a `PERMISSIONS` map, a `can(role, perm)` helper, and `canAuthorisePayment`, which returns true only for a Finance Officer who is not the initiator. Enforcement is client side only. The README says server side enforcement is a production requirement. `Login.tsx` is a demo role picker: no password, no account, nothing leaves the browser. Picking a role is the entire sign in.
- Contracts: `contracts/`, Foundry, Solidity 0.8.24, optimizer on, runs 200, `forge-std` in `contracts/lib`. Eight registries in `contracts/src`: `RoleRegistry`, `BudgetRegistry`, `ProjectRegistry`, `ProcurementRegistry`, `MilestoneRegistry`, `PaymentRegistry`, `DocumentRegistry`, `AuditRegistry`. Deploy script `contracts/script/Deploy.s.sol` deploys RoleRegistry first, then the other seven, then calls `MilestoneRegistry.setPaymentRegistry`. The deployer key comes only from the `PRIVATE_KEY` environment variable. No contract addresses are configured by default. Frontend addresses come from `VITE_ARC_*_ADDRESS` variables in `src/lib/arc.ts`, all empty by default, in which case `areContractsDeployed()` is false and `src/lib/contracts.ts` returns labelled SIMULATED results and never invents a transaction hash. Tests: 18 tests in `contracts/test/JanLekha.t.sol`, reported passing by the JanLekha README with Forge 1.9.0. Not re-run in this inspection.
- Contract facts that matter for the plan:
  - `RoleRegistry` is the single source of truth for roles. Roles are `keccak256("ADMIN_ROLE")` and similar bytes32 values. Only ADMIN grants and revokes. There is no expiry, no multi-signature, and no timelock.
  - `BudgetRegistry.approveAllocation` (Finance only) and `releaseAllocation` (Finance only). It tracks `authorizedLimitUsdc` and `totalAllocatedUsdc` per project in 6 decimal base units.
  - `ProjectRegistry.registerProject` (Admin only), `updateStatus` (Admin only), `projectCount` and `projectIdAt` for enumeration.
  - `ProcurementRegistry`: `publishTender`, `submitBid` (Contractor only, one bid per contractor is enforced in the contract per its docs, plain amount in INR, no sealed commit-reveal), `selectBid` (Procurement only). Bids are public amounts on chain as soon as they are submitted. This is a deliberate simplification relative to the old JanLekha sealed-bid flow. See C-15.
  - `MilestoneRegistry`: `submitMilestone` (Contractor, takes a `bytes32 evidenceHash`), `verifyMilestone` and `rejectMilestone` (Auditor only, and the contract enforces the verifier is not the submitter), `markPaid` (called by PaymentRegistry). `evidenceHash` is a bare bytes32. Nothing in the contract says what was hashed, where the bytes live, or how to fetch them. See C-18.
  - `PaymentRegistry`: `recordPayment` (Finance only). It checks the milestone is Verified, the project stays within its authorised limit, and the invoice hash has not been used before. It records a payment. It does NOT transfer any token. There is no `IERC20`, no `SafeERC20`, no `transfer`, and no `payable` function in any of the eight registries (verified by grep). Settlement in JanLekha 2.0 is a record, not a movement of funds. See C-14.
  - `DocumentRegistry`: append only. `registerDocument` (any role holder, citizens cannot), `verifyDocument` (Auditor only, flips only the verified flag and `verifiedBy`, never edits the record). A content hash can only be registered once. There is no edit function by design.
  - `AuditRegistry`: `raiseFlag` and `resolveFlag` (Auditor only), `publishReport` (Auditor only). Append only.
  - IDs on chain are bytes32. The frontend maps string ids with `idToBytes32`, which is `keccak256(toUtf8Bytes(id))`, and maps hashes with `hashToBytes32`, which passes a 64 hex char hash through and otherwise keccak hashes the input. Note that `keccak256("proj-1")` is NOT the same value as a SHA-256 document hash, and the two must never be confused. See C-13.
- Wallet: `src/lib/arc.ts` plus `src/components/WalletConnect.tsx`. Raw `window.ethereum` plus ethers `BrowserProvider`, `eth_requestAccounts`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` for Arc Testnet 5042002 (hex `0x4CF6AA`), RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`. Native currency is declared as USDC 18 decimals for gas. No wagmi, no WalletConnect, no session persistence beyond component state. If the user reloads, the wallet state is lost.
- Document verification: `src/pages/Verify.tsx` (206 lines) plus `src/lib/format.ts` `sha256Hex`, which uses `crypto.subtle.digest("SHA-256", ...)`. The file is never uploaded. The computed hash is compared only against the localStorage document list. A MATCH means the hash is in the local demo registry. It does not mean the document is on chain, and it does not mean the document is genuine. The `?hash=` query param pre-fills a check. `src/pages/Documents.tsx` is the registry list.
- Risk engine: `src/lib/risk.ts` (378 lines). Six checks: budget variance, duplicate invoice hash, payments over authorised limits, repeated payments to the same milestone, delayed milestones, missing supporting documents. Flags carry project, department, amount, reason, evidence, risk level, investigation status, auditor notes, and resolution history. Labels are only `Requires Investigation` or `Potential Discrepancy`. Detection does not prove fraud. The engine runs over whatever records are in state, so on demo data every flag is demo data too.
- Visualisations: `src/components/Sankey.tsx` (223 lines, hand-built SVG, no library), `src/components/IndiaMap.tsx` (66 lines, hand-built SVG outline with only 6 states positioned: Gujarat, Maharashtra, Karnataka, Tamil Nadu, Uttar Pradesh, Odisha), `src/components/Charts.tsx` (Recharts Bar, Line, and Pie charts). The Sankey and the India map are schematic, not geographic or accounting grade. The India map is not a real map. It must be labelled schematic and must not be presented as a Leaflet or MapLibre map.
- Design system: Tailwind 4 via `@import "tailwindcss"` plus `@theme` tokens in `src/index.css`: navy `#080F1C`, `#0B1626`, `#111D2E`, `#1A2B44`, `#24365A`, cyan accent `#22D3EE`, verified green `#34D399`, Inter font. Hybrid theme: light citizen portal (`#F6F8FB` background, slate text), dark internal dashboards (navy background). Shared UI in `src/components/ui.tsx` (`Card`, `Badge`, `StatCard`, `DemoBadge`, `DemoNotice`, `EmptyState`) and `src/components/Layout.tsx` (`PublicLayout`, role workspace layout with sidebar). `DemoBadge` renders a `DEMO DATA` pill.
- Dependencies that do NOT exist in JanLekha 2.0, verified: no backend, no Arkiv, no World ID, no Prisma, no Hedera, no `0.0.x` account id, no HashScan link. Its `docs/ARC-MIGRATION.md` states there was no prior JanLekha repo and no Hedera code to remove in that codebase. That statement is true for `~/workspace/janlekha` and false for the StreetSync repo, which does contain an old Hedera JanLekha. Do not copy that migration report claim into StreetSync docs.

### 1.3 Old JanLekha inside StreetSync, to be retired

- Location `janlekha/`, 89 tracked files. Next.js 16.4.5, React 19.3.0, Hardhat 3.21.2, Tailwind 4, Prisma 7.10.1 with a PostgreSQL datasource (`prisma/schema.prisma`, client output `src/generated/prisma`), viem 2.57.16, wagmi 3.7.11, zod 4.6.7. Its own `package-lock.json`. It is a separate app, not a workspace member.
- Chain: Hedera Testnet, chain id 296, RPC `https://testnet.hashio.io/api`, mirror node `https://testnet.mirrornode.hedera.com`. Single contract `contracts/JanLekha.sol` (Solidity 0.8.34, AccessControl, amounts in paise, sealed commit-reveal bids, milestones Defined to EvidenceSubmitted to Approved to Paid, budget invariant reserved plus paid less than or equal to allocation). Deployed at `0xb2e4942feac916fa6b8a94d9bd51adf73789fdab`, Hedera contract id `0.0.11346873`, deployment block 42757755, per `janlekha/deployments/hederaTestnet.json`.
- Routes: `/` (health), `/projects`, `/projects/[id]`, `/verify`, `/health`, plus API routes `/api/documents`, `/api/documents/[hash]`, `/api/health`. `next.config.ts` sets `basePath: "/janlekha"`, `cacheComponents: true`, `partialPrefetching: true`, Turbopack CSS rules, and an env guard (`assertNoPublicSecrets`) that fails dev and build on misconfigured or leaked variables.
- Data: Prisma is Postgres only for off-chain metadata. The contract is authoritative. Documents are PDF only, 2 MB maximum, SHA-256 computed in the browser and re-checked by the server, stored under their hash in `DOCUMENT_STORAGE_DIR` (default `.data/documents`), total cap `DOCUMENT_STORAGE_MAX_BYTES` (default 268435456). A stored file is not official until an authorised role references its hash on chain. Demo documents are deterministic synthetic PDFs in `public/demo-documents/`, regenerated by `scripts/demo-documents.ts`.
- Dev demo: `scripts/dev-demo.mjs` boots a fresh Hardhat chain on port 8547, deploys, seeds, writes `.env.development.local`, and serves the app on port 3100. Root `npm run dev` runs this as the third concurrent process. Root `dev:janlekha` runs it alone.
- Env: `HEDERA_TESTNET_PRIVATE_KEY` (ECDSA only, faucet funded), `DATABASE_URL`, `JANLEKHA_DEMO_*` addresses, `NEXT_PUBLIC_HEDERA_CHAIN_ID`, `NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS`, `NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK`, `DOCUMENT_STORAGE_DIR`, `DOCUMENT_STORAGE_MAX_BYTES`. The Hedera private key path is a live secret handling path that must be removed, not left dormant.

## 2. Target architecture

One repo, one dev command, one port for the user, two chains of custody kept separate.

- `app/` remains the only frontend. JanLekha 2.0 lives under `app/src/app/janlekha/`, as Next.js App Router pages. There is no second dev server, no Vite server, and no port 3100 proxy. `npm run dev` starts exactly two processes: backend on 3001 and app on 3000.
- `contracts/` remains Hardhat 2, Solidity 0.8.24. The eight JanLekha registries move into `contracts/src/janlekha/` (or `contracts/src/` with a `JanLekha` prefix, see C-02 for the decision), compiled by the same Hardhat config, deployed by an extended `contracts/scripts/deploy.ts`, and recorded in `contracts/deployments/arcTestnet.json` alongside StreetSyncEscrow and MockUSDC. One deployment file, two contract families, one chain.
- `backend/` remains Fastify plus SQLite. It gains JanLekha tables and JanLekha API routes under `/api/janlekha/*`, plus a JanLekha event indexer that watches the eight registries. The backend becomes the single source of truth for reads. The browser never trusts localStorage for shared state again.
- `packages/arkiv-client` and `packages/evidence` become shared infrastructure. JanLekha milestone evidence and JanLekha documents go through the same raw, hash, compress, size check, store, and verify path as StreetSync bounty evidence, with JanLekha specific attributes and bundle layout kept distinct. See section 5.
- Wallet stays wagmi plus viem, injected connector, Arc Testnet 5042002. The JanLekha ethers code is deleted, not shimmed.
- Auth stays split by design: World ID proves a citizen is a unique human, RoleRegistry proves an address holds an official role, and the backend enforces both. Neither one substitutes for the other. See section 6.
- Demo data stays in the repo as seed data for local development only, clearly labelled, and never served as if it were indexed on-chain data. Production reads come from the backend and the indexer. See C-03.

## 3. Conflict register

Each conflict lists what collides, the evidence, the resolution, and what must not be done. Builders work through these in the phase order in section 8. Nothing in this register authorises changing StreetSync escrow economics or any of the 7 security rules.

### C-01. Vite plus React Router versus Next.js 14 App Router

What collides: JanLekha 2.0 is a Vite SPA. `src/main.tsx` mounts React with `createRoot` into a `#root` div. `src/App.tsx` uses `BrowserRouter`, `Routes`, `Route`, `Navigate`, `Link` and `useSearchParams` from `react-router-dom`. StreetSync is Next.js 14 App Router. Pages are folders with `page.tsx`, navigation is `next/link` and `next/navigation`, layouts are nested `layout.tsx` files, and rendering is server side by default with explicit `"use client"` boundaries.

Evidence: `~/workspace/janlekha/src/App.tsx`, `src/main.tsx`, `vite.config.ts`, `index.html`. StreetSync `app/src/app/layout.tsx`, `app/src/app/page.tsx`, `app/next.config.mjs`.

Resolution:

1. Do not embed the Vite app. Do not iframe it, do not serve its `dist/` output, and do not keep a Vite dev server behind a rewrite. The rewrite proxy is the old pattern and it dies with the old JanLekha. See C-11.
2. Port each JanLekha page to a Next.js route under `app/src/app/janlekha/`. See the full mapping in section 4. Each ported page is a Server Component by default, with a `"use client"` leaf only where interactivity needs it (forms, wallet, file hashing, charts).
3. Replace every `react-router-dom` import: `Link` becomes `next/link`, `useNavigate` becomes `useRouter` from `next/navigation`, `useSearchParams` becomes the Next.js version (with a Suspense boundary, since it is client only), `Navigate` becomes `redirect` or a client side router push, route params become folder params such as `[id]`.
4. Replace `BrowserRouter` with the Next.js root layout. There is no router provider to port. `AppProvider` (the JanLekha context) becomes a client component provider mounted inside the JanLekha layout, not at the app root, so StreetSync pages do not pay for JanLekha state.
5. `index.html`, `src/main.tsx`, and `vite.config.ts` are not ported. Delete them with the Vite app. The PWA manifest and metadata stay in the StreetSync root layout and `app/src/app/manifest.ts`.
6. `NotFound.tsx` becomes `app/src/app/janlekha/not-found.tsx` plus a JanLekha scoped `not-found` handling, not a catch-all route that swallows StreetSync 404s.

Must not: keep `react-router-dom` as a dependency of `app/`, or run two routers on one page.

### C-02. Foundry versus Hardhat contracts

What collides: JanLekha 2.0 contracts are Foundry. `contracts/foundry.toml` (solc 0.8.24, optimizer on, runs 200), `contracts/script/Deploy.s.sol` (a `forge script`), `contracts/test/JanLekha.t.sol` (18 tests), `contracts/lib/forge-std`. StreetSync contracts are Hardhat 2.22.0 with `@nomicfoundation/hardhat-toolbox` 5.0.0, `@openzeppelin/contracts` 5.1.0, `hardhat.config.ts` (Solidity 0.8.24, `viaIR: true`, optimizer runs 200), Mocha and Chai tests in `contracts/test/StreetSync.test.ts`, deploy script `contracts/scripts/deploy.ts`.

Evidence: both `contracts/` directories, both `foundry.toml` and `hardhat.config.ts`, both deploy scripts.

Resolution:

1. Hardhat wins. It is the deployed toolchain for the repo, it owns `contracts/deployments/arcTestnet.json`, and the backend indexer already reads Hardhat artifacts. Do not add Foundry to the StreetSync repo, and do not run two toolchains for one chain.
2. Move the eight JanLekha registry sources verbatim into the StreetSync contracts project, in `contracts/src/janlekha/` (preferred, keeps the two families visibly separate), preserving SPDX headers and NatSpec. Keep Solidity 0.8.24. The JanLekha sources already target 0.8.24, so no pragma change is needed.
3. Port the deploy script: extend `contracts/scripts/deploy.ts` to deploy RoleRegistry first, then the other seven, then call `MilestoneRegistry.setPaymentRegistry`, in the same order as `Deploy.s.sol`. Write all eight addresses plus ABIs into `contracts/deployments/arcTestnet.json` under a `janlekha` key, alongside the existing `StreetSyncEscrow` and `MockUSDC` entries. Do not create a second deployment file. Keep the deployer key handling exactly as the existing script does it (`DEPLOYER_PRIVATE_KEY` from env, never hardcoded).
4. Port the tests: rewrite the 18 Foundry tests as Hardhat Mocha and Chai tests in `contracts/test/JanLekha.test.ts`, covering the same invariants (role gating, authorised limit, duplicate invoice hash, milestone verify by non-submitter auditor, append only document registry, duplicate content hash rejection, audit flag lifecycle). Do not keep a Foundry test file that nothing runs. The Foundry test file is a reference during the port, then it is deleted with the Vite repo copy.
5. Check the OpenZeppelin version skew before compiling: StreetSync uses `@openzeppelin/contracts` 5.1.0, old JanLekha used 5.6.1, JanLekha 2.0 registries import only `./RoleRegistry.sol` and each other, plus no OpenZeppelin import in the eight files inspected, so no OpenZeppelin bump is expected. If a registry does import OpenZeppelin after a fuller read, pin the resolution to the StreetSync 5.1.0 version and record any behavioural difference. Do not bump StreetSync to 5.6.1 as a side effect of this integration.
6. `viaIR: true` stays on for the whole project. Verify the eight registries compile under it and record the bytecode size. If any registry exceeds the deployment size limit under `viaIR`, that is a builder finding to report, not a reason to turn `viaIR` off for the escrow contracts.

Must not: commit `contracts/lib/forge-std`, `contracts/out`, or `contracts/cache` from JanLekha 2.0 into StreetSync, or leave a `foundry.toml` in the repo.

### C-03. JanLekha 2.0 synthetic localStorage state versus StreetSync backend SQLite plus Arc indexer

What collides: JanLekha 2.0 state is a single localStorage key, `janlekha-demo-v1`, holding departments, projects, tenders, milestones, payments, documents, flags, complaints, events, notifications, and reports as one JSON blob, written on every state change by a `useEffect`. Role is a second key, `janlekha-role`. StreetSync state is SQLite tables plus a viem event indexer with a resumable block cursor, served over Fastify. The two models disagree on every property that matters: shared versus per-browser, durable versus ephemeral, server enforced versus client asserted, indexed versus hand-written, auditable versus mutable by anyone with DevTools.

Evidence: `~/workspace/janlekha/src/context/AppContext.tsx`, `src/data/demoData.ts`. StreetSync `backend/src/db.ts`, `backend/src/indexer.ts`, `backend/src/server.ts`.

Resolution:

1. The backend becomes the source of truth. Port the JanLekha data model to SQLite tables in `backend/src/db.ts`, mirroring the existing table style (explicit `CREATE TABLE IF NOT EXISTS`, `TEXT` ids, integer timestamps, unique constraints that encode the invariants). Minimum tables: `jl_departments`, `jl_projects`, `jl_tenders`, `jl_bids`, `jl_milestones`, `jl_payments`, `jl_documents`, `jl_audit_flags`, `jl_audit_reports`, `jl_complaints`, `jl_events`, `jl_notifications`. Use a `jl_` prefix so a query can never confuse a JanLekha project with a StreetSync bounty. Keep the StreetSync tables untouched.
2. Port the indexer pattern, do not port the localStorage pattern. Add `backend/src/janlekha-indexer.ts` (or extend `indexer.ts` with a clearly separated JanLekha section, builder choice, recorded in the implementation PR) that watches the eight registries, parses their events with viem `parseEventLogs`, and upserts into the `jl_*` tables. It reuses the existing `events_cursor` pattern with a separate cursor row per contract family, so a JanLekha re-index never rewinds the StreetSync bounty cursor. Poll interval and confirmation lag follow the existing Arc values (8 seconds, 5 blocks) unless load testing shows otherwise.
3. Add Fastify routes under `/api/janlekha/*`, following the existing route style in `server.ts`: read routes for departments, projects, tenders, payments, documents, audits, complaints, money flow aggregates, and map aggregates; write routes only for actions the backend is authorised to perform, with role checks done server side against RoleRegistry reads, not against a client supplied role string. Every write route validates its input, checks the on-chain state first (for example, milestone Verified before a payment is recorded), and returns the transaction hash or a precise error. No write route ever accepts a `SIM-ARC-` ref as input.
4. The frontend reads from `/api/janlekha/*` through the existing same-origin proxy (`/backend/:path*` in `app/next.config.mjs`, already wired to port 3001) or through `NEXT_PUBLIC_API_URL`, following the existing `app/src/lib/api.ts` pattern. It does not read localStorage for shared state, and it does not call the Arc RPC directly for lists. Direct RPC reads are kept only for the single-record verification path where the user is checking a specific on-chain hash. See C-17.
5. `AppContext` is replaced, not ported. Its action functions (`addDepartment`, `createAllocation`, `publishTender`, `submitBid`, `selectBid`, `submitMilestone`, `verifyMilestone`, `initiatePayment`, `addComplaint`, `resolveFlag`, `addDocument`, `addReport`) become backend calls plus React Query mutations in the JanLekha layout. The `uid` helper (`prefix + Date.now().toString(36) + random`) is deleted. Ids become either deterministic bytes32 values derived the same way as the contracts (`keccak256` of the canonical string id) or server generated ids recorded in SQLite, and the choice is recorded per entity in the implementation PR. The `resetDemo` function becomes a dev-only seed reset endpoint that is disabled unless an explicit dev flag is set, and it never runs in a production build.
6. Demo seed data moves to `backend/src/janlekha-seed.ts` (or an equivalent seed file) and is used only to populate a fresh local database for development and demos. It keeps the `DEMO DATA` label in every API response that serves seeded rows, and in every UI surface that renders them, until those rows are replaced by indexed on-chain rows. A seeded row and an indexed row must be distinguishable in the database (a `source` column with values `seed` or `chain`, plus `tx_hash` null for seed rows). The frontend renders the `DEMO DATA` badge from that column, not from a hardcoded flag.
7. The `useState` initializer that reads `localStorage` at render time must not survive the port. It breaks server side rendering and it leaks per-browser state into a shared page. Any remaining browser-only persistence is limited to UI preferences (followed projects and saved searches in the Citizen workspace), stored under namespaced keys, read only inside `useEffect` after hydration, and never used as the source of truth for a financial figure.

Must not: keep `janlekha-demo-v1` as a key, keep `simulateArcPayment` as the payment path, or let the frontend write a payment, allocation, or audit record without a backend round trip and an on-chain check.

### C-04. Two different Arc contract sets on the same chain

What collides: StreetSync has 5 contracts plus MockUSDC on Arc Testnet 5042002. JanLekha 2.0 has 8 registries, also targeting Arc Testnet 5042002, with no deployment yet and no addresses configured. Both sets use the same RPC (`https://rpc.testnet.arc.io`), the same explorer, the same native gas token (USDC, 18 decimal view), and the same ERC-20 USDC 6 decimal rule, but they share no contract, no role system, and no event.

Evidence: StreetSync `contracts/deployments/arcTestnet.json`, JanLekha 2.0 `contracts/src/*.sol`, `contracts/script/Deploy.s.sol`, `src/lib/arc.ts` `CONTRACT_ADDRESSES`.

Resolution:

1. Deploy both families to the same chain, in one deployment run, and record them in one deployment file. The deploy order is: StreetSync contracts first (unchanged), then RoleRegistry, then the other seven JanLekha registries, then `MilestoneRegistry.setPaymentRegistry`. The deployer becomes the first JanLekha ADMIN, exactly as `Deploy.s.sol` does it, and the deployment run prints every address for the record.
2. Keep the two families separate on chain. Do not merge StreetSyncEscrow and the JanLekha registries into one contract, do not share a role registry between them, and do not let a JanLekha role grant confer a StreetSync worker or reviewer right. Cross-family rules are enforced in the backend, not by a shared on-chain role. See section 7.
3. Frontend config: extend `app/src/config/contracts.ts` with a `JANLEKHA_ADDRESSES` object and a `JANLEKHA_ABIS` object, loaded from the same `contracts/deployments/arcTestnet.json` file the StreetSync addresses already come from, with the same optional `NEXT_PUBLIC_JANLEKHA_*_ADDRESS` env overrides. Delete the `VITE_ARC_*_ADDRESS` variables. The `areContractsDeployed` equivalent for JanLekha is true only when all eight addresses are present and non-zero. When any address is missing, the JanLekha section renders an explicit "contracts not deployed" state and offers only seeded demo reads. It never renders a simulated write as if it were live.
4. ID namespaces stay separate. StreetSync bounties are `uint256` ids. JanLekha entities are bytes32 ids derived from string ids. A JanLekha project id and a StreetSync bounty id must never be compared, joined, or displayed in the same list without a type prefix.
5. The existing `MockUSDC` stays the testnet USDC for StreetSync. JanLekha 2.0 does not deploy its own USDC and does not need one, because its PaymentRegistry moves no tokens. If the settlement decision in C-14 later requires a real token transfer, it uses the same MockUSDC address on testnet, not a second mock.

Must not: deploy JanLekha registries to a different chain, or reuse a StreetSync contract address as a JanLekha registry address.

### C-05. Two different wallet configs

What collides: JanLekha 2.0 uses raw `window.ethereum` plus ethers 6 `BrowserProvider`, with wallet state held in a single component (`WalletConnect.tsx`), lost on reload, and no shared session. StreetSync uses wagmi 2 plus viem 2, injected connector, `ssr: true`, a shared `WagmiProvider` plus React Query `QueryClientProvider` in `app/src/app/providers.tsx`, and contract addresses from deployment files.

Evidence: `~/workspace/janlekha/src/lib/arc.ts` (`connectWallet`, `switchToArcTestnet`), `src/components/WalletConnect.tsx`. StreetSync `app/src/config/wagmi.ts`, `app/src/config/contracts.ts`, `app/src/app/providers.tsx`.

Resolution:

1. Wagmi plus viem wins. Delete the ethers wallet code. Port `src/lib/contracts.ts` to viem: replace `BrowserProvider` and `Contract` with wagmi `useWriteContract`, `useReadContract`, and `usePublicClient`, and replace the inline ABI string arrays with ABIs imported from the deployment file, the same way `ESCROW_ABI` is already loaded in `app/src/config/contracts.ts`.
2. Keep the JanLekha chain guard, ported to wagmi: every JanLekha write checks `chain.id === 5042002` (or 31337 for local dev) and refuses otherwise, with the same error wording the JanLekha code already uses. Keep the Arc Testnet add and switch behaviour, implemented through wagmi chain switching rather than raw `wallet_switchEthereumChain` calls.
3. Remove ethers 6 from the dependency tree. Check for transitive ethers usage before deleting it: wagmi 2 and viem 2 do not need ethers, but verify with `npm ls ethers` after the port. If a StreetSync dependency pulls ethers transitively, that is acceptable, but no application code imports it.
4. The JanLekha `WalletConnect` component becomes a thin wrapper around the existing StreetSync `ConnectButton`, showing the same address, the same chain badge, and the same disconnect behaviour, plus a JanLekha specific line stating how many of the eight registries are deployed. One connected wallet, one address, shared across StreetSync and JanLekha. A user who connects on a bounty page stays connected on a JanLekha page.
5. `NEXT_PUBLIC_WC_PROJECT_ID` is already in the root env example but the current wagmi config does not use a WalletConnect connector. That is a pre-existing gap, not a JanLekha conflict. Do not add WalletConnect as part of this integration unless the owner asks for it. Record it as an open item in section 10.

Must not: keep two connect buttons, two addresses, or two chain states on one page.

### C-06. Two design systems

What collides: StreetSync is Tailwind 3.4.7, dark only, near-black ink, signal lime brand, violet accent, Bricolage Grotesque display font plus Inter, shadcn style HSL tokens, `.card`, `.btn`, and `.btn-primary` component classes in `globals.css`, mobile-first PWA with a bottom tab bar on phones. JanLekha 2.0 is Tailwind 4.3.5 via `@tailwindcss/vite`, `@import "tailwindcss"` plus `@theme` tokens, hybrid theme (light citizen portal on `#F6F8FB`, dark internal dashboards on navy `#080F1C`), cyan accent `#22D3EE`, verified green `#34D399`, Inter only, no display font, and its own `Card`, `Badge`, `StatCard`, and `DemoBadge` components with different radii, padding, and tone scales.

Evidence: StreetSync `app/tailwind.config.ts`, `app/src/app/globals.css`, `app/package.json`. JanLekha 2.0 `src/index.css`, `src/components/ui.tsx`, `src/components/Layout.tsx`, `package.json`.

Resolution:

1. Tailwind 3 wins, because it is the StreetSync app toolchain and the PWA already ships it. Do not upgrade StreetSync to Tailwind 4 as part of this integration. That is a separate migration with its own regression risk.
2. Translate the JanLekha tokens into the Tailwind 3 config as a scoped extension: add a `janlekha` colour scale (navy 950 to 600, cyan accent, verified green) to `app/tailwind.config.ts`, and add the JanLekha font stack (Inter, already loaded) as an alias. Do not change the StreetSync ink, brand, or accent tokens. Do not rename the StreetSync tokens to match JanLekha.
3. Keep the hybrid theme, scoped to JanLekha routes. The JanLekha layout sets a `janlekha` class (or a `data-theme` attribute) on its section wrapper, and JanLekha styles are written under that scope so the light citizen portal does not leak into the dark StreetSync map, and the dark StreetSync chrome does not leak into the JanLekha portal. The dark internal dashboards reuse the navy tokens inside the same scope. Global `body` background stays owned by the StreetSync root layout.
4. Unify the shared primitives, do not keep two `Card` components. Map JanLekha `Card`, `Badge`, `StatCard`, `DemoBadge`, `DemoNotice`, and `EmptyState` onto the StreetSync equivalents where they exist, and add the missing ones to `app/src/components/ui/` with the JanLekha visual treatment preserved inside the JanLekha scope. `DemoBadge` keeps its amber pill treatment and its exact wording. One component, one import path, two visual scopes.
5. Navigation: the StreetSync header and mobile tab bar gain a JanLekha entry (already present as a nav item pointing at `/janlekha`). Inside `/janlekha`, the JanLekha `PublicLayout` header and the role workspace sidebar are ported as JanLekha scoped components, not as a second global header. A JanLekha page has one header (the StreetSync header) plus one JanLekha sub-navigation, not two stacked global headers.
6. Charts: Recharts 3.10.1 is the JanLekha chart library and is not currently a StreetSync dependency. Add Recharts to `app/package.json` only if the ported charts need it, and pin the version that JanLekha 2.0 verified. The hand-built Sankey and India map SVG components are ported as plain SVG React components with no new dependency. Check Recharts against React 18 before adding it: JanLekha 2.0 verified it against React 19, so the builder must verify it renders under React 18 and record the result. If it does not, the charts are rebuilt with the existing stack or the Recharts version is pinned to one that supports React 18.

Must not: ship two Tailwind versions, two `globals.css` files, or two `Card` components with the same name.

### C-07. Duplicate document verification

What collides: StreetSync already verifies documents in the cryptographic sense. `app/src/app/audit/[id]/page.tsx` plus `app/src/components/AuditVerifier.tsx` fetch the raw SSYN bundle from Arkiv, recompute its SHA-256 in the browser, and check the worker EIP-191 signature against the hash the escrow stored on Arc. JanLekha 2.0 has `src/pages/Verify.tsx` plus `src/pages/Documents.tsx`: compute a file SHA-256 in the browser with `crypto.subtle`, compare it against a localStorage registry, and report MATCH or NO MATCH. The two verifiers answer different questions, with different trust roots, and they share the words "verify" and "document".

Evidence: StreetSync `app/src/components/AuditVerifier.tsx`, `app/src/app/audit/[id]/page.tsx`. JanLekha 2.0 `src/pages/Verify.tsx`, `src/lib/format.ts` `sha256Hex`, `src/pages/Documents.tsx`.

Resolution:

1. Keep both, with distinct names, distinct routes, and distinct result wording. They are not duplicates once the trust root is named.
   - StreetSync audit verification stays at `/audit/[id]`. It verifies a bounty evidence bundle against Arkiv and Arc. Its result wording stays as it is.
   - JanLekha document verification moves to `/janlekha/verify`. It verifies a file hash against the JanLekha DocumentRegistry, backed by the backend and the chain, not by localStorage. See C-17 for the registry change.
2. Share the hashing primitive. Both paths use SHA-256 over the exact file bytes, computed in the browser with `crypto.subtle` where available, with the same normalisation as JanLekha `Verify.tsx` already does (trim, lowercase, strip a leading `0x`, require exactly 64 hex characters). The StreetSync evidence helper `sha256Bytes32` in `packages/evidence/src/bundle.ts` and the JanLekha `sha256Hex` in `src/lib/format.ts` are consolidated into one helper in `app/src/lib/` (or kept in `packages/evidence` and imported by both, builder choice). One helper, one normalisation, one error message for a malformed hash.
3. The JanLekha verifier result must state all three facts separately, so a MATCH is never misread:
   - Whether the hash is registered in DocumentRegistry, with the registration transaction hash and explorer link.
   - Whether the document is verified by an Auditor, with the verifier address and time.
   - Whether the file bytes are stored retrievably (Arkiv entity key, or a backend document store reference), and whether the retrieved bytes re-hash to the same value. See section 5.
   A hash that is registered but unverified, or verified but unretrievable, is shown as such. It is never shown as a plain green MATCH.
4. The `?hash=` deep link is preserved. `/janlekha/verify?hash=<64 hex>` pre-fills the check, exactly as JanLekha 2.0 does.
5. The old JanLekha `/verify` top level rewrite is deleted. See C-11. After the integration, `/verify` is not a route. Anyone who bookmarked it is redirected to `/janlekha/verify`.

Must not: merge the two verifiers into one page, or let a JanLekha MATCH imply Arkiv storage or Arc escrow settlement.

### C-08. Duplicate audit pages

What collides: StreetSync has a public audit page per bounty at `/audit/[id]`, driven by the escrow and Arkiv. JanLekha 2.0 has `/audits` (a list of audit reports, downloadable as text or JSON), an Auditor workspace at `/app/auditor` with risk flags and findings, and an `AuditRegistry` on chain. The word "audit" therefore already means three different things, and a single merged audit page would conflate them.

Evidence: StreetSync `app/src/app/audit/[id]/page.tsx`. JanLekha 2.0 `src/pages/Audits.tsx`, `src/pages/roles/AuditorDashboard.tsx`, `contracts/src/AuditRegistry.sol`, `src/lib/risk.ts`.

Resolution:

1. Keep three distinct audit surfaces with distinct routes and distinct headings:
   - `/audit/[id]` stays the StreetSync bounty audit. No JanLekha content is added to it.
   - `/janlekha/audits` is the JanLekha public audit report list, ported from `Audits.tsx`, with text and JSON download preserved.
   - `/janlekha/audit-trail` is a NEW page that does not exist in JanLekha 2.0. It is the chronological, event sourced trail for a project or for the whole platform, built from the backend `jl_events` table and from `AuditRegistry` events, with each entry linked to its transaction hash and explorer URL. See section 4.
   - `/janlekha/auditor` is the Auditor workspace, ported from `AuditorDashboard.tsx`, with risk flags, milestone verification, and report publishing. It is not a public page.
2. The risk engine (`src/lib/risk.ts`) is ported to the backend as a scheduled scan over the `jl_*` tables, not run in the browser on every render. Its six checks are preserved verbatim, including the rule that detection is a prompt for human review and never a conclusion of wrongdoing, and that flags are labelled only `Requires Investigation` or `Potential Discrepancy`. Flags raised by the scan are stored in `jl_audit_flags` with the same fields JanLekha 2.0 already uses (project, department, amount, reason, evidence, risk level, investigation status, auditor notes, resolution history). The auditor resolves a flag through the backend, which writes the resolution to `AuditRegistry.resolveFlag` on chain and to SQLite. Resolving a flag in the UI without the on-chain write is a bug.
3. Audit report download (text and JSON) is preserved, and the download includes the report id, the auditor, the date, the project, the findings count, and the on-chain report id or transaction hash when the report is published on chain. A seeded demo report is labelled DEMO DATA in the download as well as on screen.

Must not: rename `/audit/[id]`, or show StreetSync bounty audit data on a JanLekha audit page.

### C-09. Routing mapping

This is the authoritative route map. "New" means the route does not exist in JanLekha 2.0 and must be built from existing data and backend queries. "Port" means the JanLekha 2.0 page is moved with its behaviour preserved. "Redirect" means the old URL keeps working by redirecting to the new URL.

| JanLekha 2.0 route | StreetSync route | Action |
|---|---|---|
| `/` (CitizenPortal) | `/janlekha` | Port. Citizen portal, national totals, department spend, top projects, latest payments and audits. |
| `/money-flow` | `/janlekha/money-flow` | Port. Hand-built SVG Sankey, budget to departments to projects to contractors to payments. Data source becomes the backend aggregate query, not localStorage. |
| `/departments` | `/janlekha/departments` | Port. |
| `/departments/:id` | `/janlekha/departments/[id]` | Port. |
| `/projects` | `/janlekha/projects` | Port. Note the old top level `/projects` rewrite is deleted. See below. |
| `/projects/:id` | `/janlekha/projects/[id]` | Port. |
| `/tenders` | `/janlekha/tenders` | Port. |
| `/tenders/:id` | `/janlekha/tenders/[id]` | Port. |
| `/payments` | `/janlekha/payments` | Port. INR and USDC shown separately, simulated payments labelled. |
| `/documents` | `/janlekha/documents` | Port. Registry list, backed by DocumentRegistry and the backend. |
| `/verify` | `/janlekha/verify` | Port. See C-07. Old top level `/verify` redirects to `/janlekha/verify`. |
| `/audits` | `/janlekha/audits` | Port. See C-08. |
| `/map` | `/janlekha/map` | Port. Schematic India SVG with 6 states. Labelled schematic. See section 4 notes. |
| `/complaints` | `/janlekha/complaints` | Port. Citizen complaints with status tracking. |
| `/login` | `/janlekha/login` | Replace. See C-12. The demo role picker is deleted. |
| `/app` | `/janlekha` | Redirect to the role home for the connected wallet, or to `/janlekha/login` when no role is established. |
| `/app/admin` | `/janlekha/admin` | Port. Government Administrator workspace. |
| `/app/finance` | `/janlekha/finance` | Port. Finance Officer workspace. |
| `/app/procurement` | `/janlekha/procurement` | Port. Procurement Officer workspace. |
| `/app/contractor` | `/janlekha/contractor` | Port. Contractor workspace. |
| `/app/auditor` | `/janlekha/auditor` | Port. Independent Auditor workspace. |
| `/app/citizen` | `/janlekha/citizen` | Port. Citizen workspace, followed projects, saved searches, complaints. |
| No route | `/janlekha/budgets` | New. Budget list and detail, sliced from departments and projects. Finance and Admin see approval actions here. Citizens see read only totals. |
| No route | `/janlekha/allocations` | New. Allocation list per project, from BudgetRegistry events, with approved amount, released amount, approver, and time. |
| No route | `/janlekha/releases` | New. Release events per project, from `AllocationReleased` events, with releaser and time. |
| No route | `/janlekha/expenditure` | New. Expenditure view, spent versus allocated versus released per department and per project, with the risk engine variance flags surfaced inline. |
| No route | `/janlekha/audit-trail` | New. See C-08. Chronological event trail with transaction links. |

Notes on the new routes:

- Budgets, allocations, releases, and expenditure are not new data. They are new slices of data that already exists in `BudgetRegistry` events, `PaymentRegistry` records, and the demo seed. The builder creates them by adding backend aggregate queries and four thin pages, not by inventing a new data model. Each of the four pages states its source (chain, backend, or seed) in its header.
- The `/janlekha/*` prefix is enforced by the folder structure. No JanLekha page lives outside `app/src/app/janlekha/`. No JanLekha API route lives outside `/api/janlekha/*`.
- The old top level rewrites in `app/next.config.mjs` for `/projects`, `/verify`, `/demo-documents/:path*`, and `/api/documents*` are deleted in the same PR that removes the old JanLekha service. `/projects` and `/verify` as top level paths stop existing. `/demo-documents` is replaced by the JanLekha document store path in section 5, or deleted if the demo documents are retired with the seed. `/api/documents` is replaced by `/api/janlekha/documents`.
- `SiteNav.tsx` `isActive` currently treats `/projects` and `/verify` as JanLekha paths. After the rewrite removal, it must match only `/janlekha*`. Update it in the routing PR.
- The JanLekha `PublicLayout` navigation links (`/verify`, `/audits`, `/login`, `/departments`, `/projects`, and so on) are all repointed to their `/janlekha/*` equivalents during the port. A link audit is part of the acceptance criteria: no ported JanLekha page may link to a root path that no longer exists.
- The India map on `/janlekha/map` keeps its 6 state schematic. It is not replaced by the StreetSync Leaflet or MapLibre map in this integration. The two maps answer different questions (StreetSync shows bounty locations with GPS, JanLekha shows schematic state level project counts), and merging them would misrepresent the JanLekha data as precise geography. If a real geographic JanLekha map is wanted later, it is a separate feature with real coordinates per project, which the current data model does not have.

### C-10. Old Hedera JanLekha retirement

Decision: remove, do not deprecate. The old `janlekha/` directory is deleted from the repo in Phase 0, after the extraction step below. Marking it deprecated and leaving it in place is rejected for the following reasons, each verified from the code:

1. It is a live second app, not dead code. Root `postinstall` installs it on every `npm install`, root `dev` starts it on every `npm run dev`, and `scripts/clean-ports.mjs` kills port 3100 for it. "Deprecated but still running by default" is not deprecated, it is still the default.
2. It owns live secret handling. `HEDERA_TESTNET_PRIVATE_KEY` is read by its Hardhat deploy scripts, and `DATABASE_URL` points at a Postgres database. Leaving those paths in the repo while building a new JanLekha invites the wrong key to be used for the wrong chain.
3. It hijacks top level routes. Its `basePath: "/janlekha"` plus the root rewrites for `/projects`, `/verify`, `/demo-documents`, and `/api/documents` collide with the new `/janlekha/*` routes in section 4. Two apps cannot own `/projects` and `/verify`.
4. It forces a toolchain split. It needs Node 22 plus, Next.js 16, React 19, Hardhat 3, Tailwind 4, and Prisma 7, while StreetSync needs Node 18 plus, Next.js 14, React 18, Hardhat 2, and Tailwind 3. Keeping both means every install, build, and upgrade is tested twice, and the root `postinstall` already couples them.
5. It is a different product on a different chain. Hedera Testnet chain id 296, contract `0xb2e4942feac916fa6b8a94d9bd51adf73789fdab`, Hedera id `0.0.11346873`, amounts in paise, sealed commit-reveal bids, mirror node reads. None of that is JanLekha 2.0, and none of it is StreetSync. Keeping it invites a future agent to "fix" JanLekha by editing the Hedera contract.
6. Its history is preserved by git. Deleting the directory does not delete the history. The deployment artifact `janlekha/deployments/hederaTestnet.json` and the contract `janlekha/contracts/JanLekha.sol` remain reachable at the pre-removal commit. If the Hedera deployment ever needs to be referenced, it is referenced by commit hash, not by a live directory.

What happens before deletion (extraction step, Phase 0):

- Copy the reusable ideas, not the code, into this plan and into the implementation notes: the sealed-bid commit-reveal pattern (see C-15, product decision, not an automatic carry-over), the document upload rules (PDF only, 2 MB maximum, browser SHA-256 re-checked server side, stored under hash, total cap, not official until an authorised role references the hash on chain), and the env guard idea (`assertNoPublicSecrets`, failing fast on a leaked or misconfigured variable).
- Record the Hedera deployment in this plan (section 1.3) and in the removal commit message, with the contract address, Hedera id, and deployment block, so the record survives the deletion.
- Check for any other live reference to `janlekha/` outside the files already found (root `package.json`, `app/next.config.mjs`, `README.md`, `janlekha/AGENTS.md`). The builder greps the repo for `janlekha`, `3100`, `8547`, `hedera`, and `HEDERA_` after removal and reports any remaining reference.

What the removal PR deletes:

- The entire `janlekha/` directory.
- Root `postinstall` (`npm --prefix janlekha install --no-audit --no-fund`).
- Root `dev:janlekha`, `test:janlekha`, and `deploy:janlekha:hedera` scripts, and the `janlekha` process from root `dev`.
- Port 3100 from `scripts/clean-ports.mjs` and from every doc that mentions it.
- The `/janlekha`, `/projects`, `/verify`, `/demo-documents`, and `/api/documents` rewrites in `app/next.config.mjs`, replaced by the new `/janlekha/*` routes and the `/backend` proxy only.
- The "Running the whole project (StreetSync plus JanLekha)" section of `README.md`, replaced by the new single-app instructions.
- The `NEXT_PUBLIC_JANLEKHA_URL` and `NEXT_PUBLIC_STREETSYNC_URL` cross-links that pointed at the two-server setup, replaced by the in-app `/janlekha` link that already exists in `SiteNav.tsx`.

What the removal PR does not delete: the git history, this plan, or the JanLekha 2.0 source in `~/workspace/janlekha`, which is a separate repo and is not touched by this removal.

### C-11. Dev scripts, ports, and the rewrite proxy

What collides: root `dev` runs three processes, `predev` kills three ports, `app/next.config.mjs` proxies two services, and the old JanLekha demo chain runs on port 8547. The new integration needs one app server and one backend server, and no proxy to a second frontend.

Resolution:

1. After Phase 0, root `dev` runs exactly two processes: `streetsync-backend` on 3001 and `streetsync-app` on 3000. `dev:streetsync` becomes the same as `dev`. `dev:janlekha` is deleted.
2. `scripts/clean-ports.mjs` kills only ports 3000 and 3001. Port 3100 and port 8547 are removed from it. The local Hardhat node for JanLekha contract tests, if needed, runs on the StreetSync local port 8545, not on 8547, so there is one local chain for the whole repo.
3. `app/next.config.mjs` keeps only the `/backend/:path*` rewrite to port 3001. All JanLekha rewrites are deleted. The `webpack` customisation for the evidence and Arkiv packages (async WebAssembly, `node:` scheme handling, x402 stubs, `@aliimam` ESM entry) is kept and re-verified, because the JanLekha port adds browser WASM and `crypto.subtle` usage that must not break that config. If the JanLekha port needs a new webpack rule, it is added in the port PR with a comment citing the rule it extends.
4. `npm run build` at root builds the workspace packages and the backend, as today. The app build is `npm run build --workspace=streetsync-app`. There is no separate JanLekha build. The JanLekha pages are built as part of the app build, and a failure in a JanLekha page fails the app build.
5. `npm install` at root installs only the workspaces. There is no `postinstall` that installs a second app. The JanLekha 2.0 standalone repo keeps its own install for reference until the port is complete, then it is no longer needed for the build.

### C-12. Authentication and authorisation

What collides: JanLekha 2.0 has no authentication. `Login.tsx` lets anyone pick any of the six roles with no password and no account. `permissions.ts` enforces roles only in the browser. StreetSync has World ID for human uniqueness and an EIP-712 attester for role gated actions, but it has no concept of a Government Administrator, Finance Officer, or Auditor. The JanLekha contracts have a RoleRegistry, but the JanLekha frontend never checks it before letting a user act. All three mechanisms are real, and none of them alone is sufficient.

Resolution:

1. Delete the demo role picker. `/janlekha/login` becomes a page that explains the two requirements (connect a wallet on Arc Testnet, and hold a role granted on chain by an ADMIN), shows the connected wallet and its roles as read from RoleRegistry, and links to the workspace the wallet is entitled to. It does not let the user choose a role. Choosing a role in the UI is the vulnerability, not a feature.
2. Role is determined server side and on chain, never from localStorage. The backend reads `RoleRegistry.hasRole` for the connected address, caches the result in SQLite with a short TTL, and returns it to the frontend. The frontend shows or hides workspace navigation based on that response, but the enforcement point is the backend write route and the contract function, both of which re-check the role. A user who edits the frontend to show a workspace they do not hold still cannot write, because the contract reverts and the backend refuses.
3. The six roles map to RoleRegistry exactly as `docs/ARC-MIGRATION.md` already specifies: GOVERNMENT_ADMIN to ADMIN_ROLE, FINANCE_OFFICER to FINANCE_ROLE, PROCUREMENT_OFFICER to PROCUREMENT_ROLE, CONTRACTOR to CONTRACTOR_ROLE, INDEPENDENT_AUDITOR to AUDITOR_ROLE. CITIZEN is not a RoleRegistry role. It is the default read only state for any connected or unconnected visitor. Do not create a CITIZEN_ROLE on chain.
4. Separation of duties is enforced in three places, and the plan requires all three:
   - Contract: `PaymentRegistry` requires Finance, `MilestoneRegistry.verifyMilestone` requires Auditor and not the submitter, `DocumentRegistry.verifyDocument` requires Auditor, `BudgetRegistry` requires Finance, `ProjectRegistry` requires Admin, `ProcurementRegistry.selectBid` requires Procurement.
   - Backend: every write route re-checks the caller role against RoleRegistry, checks the on-chain state (for example, milestone Verified), and checks the caller is not the same address as the party being checked where the rule requires it.
   - Frontend: the `can(role, perm)` helper from `permissions.ts` is ported and used only to hide actions the user cannot perform. It is never the enforcement point. The ported helper reads the role from the backend, not from localStorage.
5. The second authoriser rule is a backend and contract rule, not a UI label. See C-14. The `canAuthorisePayment` helper (Finance Officer who is not the initiator) is ported to the backend and enforced there. The frontend shows the pending authorisation queue from the backend, not from a seeded payment.
6. Role grants are an ADMIN action on chain (`grantRole` and `revokeRole`), with events. The backend indexes those events. There is no backend endpoint that grants a role without an on-chain transaction. The deployer is the first ADMIN and should grant the real Finance, Procurement, Contractor, and Auditor roles to real accounts after deployment, then consider revoking its own ADMIN role, exactly as `Deploy.s.sol` already advises. That revocation is an owner decision, recorded in the deployment run, not an automatic step.

Must not: ship the demo role picker, store a role in localStorage, or accept a role string from the client as proof of authority.

### C-13. Data model and identifiers

What collides: JanLekha 2.0 ids are human strings (`proj-1`, `dept-health`, `ten-1`, `ms-1`, `pay-1`, `doc-1`, `flag-1`). On chain they become bytes32 via `keccak256(toUtf8Bytes(id))`. StreetSync bounty ids are `uint256`. INR amounts are JavaScript numbers in whole rupees. USDC amounts are base units with 6 decimals. Dates are `YYYY-MM-DD` strings. Milestone status is a string union (`Pending`, `Submitted`, `Verified`, `Paid`, `Delayed`). Project status is a free string (`In Progress`, `Delayed`, `New`). None of these are the contract types.

Resolution:

1. Canonical ids: keep the human string ids as the display and URL ids (`/janlekha/projects/proj-1`), and derive the on-chain bytes32 id with the existing `idToBytes32` function, ported to viem (`keccak256(toUtf8Bytes(id))`). Record the derivation in the backend and in the frontend helper, with a test that asserts the same string produces the same bytes32 in both places. Never display a bytes32 id as the primary identifier. Never accept a bytes32 id from a URL without validating it maps to a known entity.
2. Money: INR amounts stay whole rupees in the database (integer column, never a float), formatted with the existing `formatINR` and `formatINRCompact` helpers. USDC amounts stay integer base units with 6 decimals in the database (stored as TEXT, following the existing StreetSync pattern for `total_pledged`, to avoid JavaScript number precision loss), formatted only at display time with `formatUnits(amount, 6)`. The two are never added, never converted at an implied exchange rate, and never displayed in the same total. Every money display states its currency. The demo seed uses an implied rate in its figures (for example, Rs 84 Cr against 960000 USDC), and that rate is not a real rate. Do not present it as one.
3. Status: map the JanLekha string statuses to the contract enums at the backend boundary, and store both the contract status and the display status in SQLite. The contract is authoritative for status transitions. A status that appears in the UI but has no contract transition behind it is labelled as a UI state, not a chain state.
4. Timestamps: store Unix seconds in SQLite (following the existing `created_at INTEGER` pattern), display as dates with `formatDate`. Do not store display strings as the canonical time.
5. The `DEMO_NOTICE` string is preserved verbatim in the seed and in the UI. The `source` column in section C-03 is what drives it.

### C-14. Financial transaction and budget model, and the settlement gap

What collides: JanLekha 2.0 has a complete budget workflow on paper (department budget, allocation, release, expenditure, milestone, payment) and an incomplete settlement on chain (a record, not a transfer). StreetSync has a complete settlement on chain (escrow, pledge, stake, settle with SafeERC20 transfers) and no budget workflow. The integration must not pretend the JanLekha payment is a StreetSync settlement, and must not break the StreetSync settlement by grafting a budget onto it.

Evidence: JanLekha 2.0 `PaymentRegistry.recordPayment` (no token transfer, verified by grep across all eight registries), `src/context/AppContext.tsx` `initiatePayment` (marks Settled immediately), `src/lib/arc.ts` `simulateArcPayment`. StreetSync `StreetSyncEscrow.settle` (SafeERC20 transfers, 90 percent to worker per code, reviewer cut per code, see the discrepancy note below), `ReviewerPool.REVIEWER_STAKE = 10_000_000` (10.00 USDC).

Resolution:

1. Name the gap in the UI and in the docs, in the same words everywhere: "JanLekha records a USDC settlement on Arc. It does not move USDC. The payment record is the on-chain attestation that a settlement was authorised and recorded. The movement of funds, if any, happens off chain or in a future settlement contract." Do not show a JanLekha payment with an explorer transaction link that implies a token transfer happened, unless the transaction actually transferred tokens.
2. Fix the immediate Settled bug as part of the port, not as a later polish. `initiatePayment` becomes a two-step backend flow: Finance Officer A initiates (creates a payment in status `Pending authorisation`, writes nothing to `PaymentRegistry` yet, notifies Finance), a different Finance Officer B authorises (backend checks B is Finance, B is not A, the milestone is Verified, the project is within its authorised limit, and the invoice hash is unused), and only then does the backend call `PaymentRegistry.recordPayment` and mark the milestone Paid via the contract path. The seeded pending payment `pay-5` becomes the reference case for the queue UI. The `authorise_payment` permission, which exists in `permissions.ts` but is granted to no role in the `PERMISSIONS` map, is granted to FINANCE_OFFICER in the ported map and enforced with the not-the-initiator check.
3. Keep the three PaymentRegistry invariants, and add the backend checks that mirror them before the on-chain call, so a user gets a clear error instead of a reverted transaction: milestone Verified, within authorised limit, invoice hash unused. A duplicate invoice hash is rejected by the contract and by the backend, and the risk engine flags it as well. All three layers must agree.
4. Do not reuse StreetSync escrow for JanLekha payments. StreetSync escrow is per bounty, with pledgers, a worker, a reviewer panel, commit-reveal voting, and slashing. JanLekha payments are per milestone, authorised by Finance, verified by an Auditor, with no reviewer panel and no voting. Forcing one into the other would break both. If a future phase needs JanLekha payments to actually move USDC on chain, that is a new contract (a JanLekha settlement contract that holds USDC and releases it on `recordPayment`, or a `recordPayment` that calls `SafeERC20.transfer`), designed, reviewed, and tested separately, with the 7 security rules applied to it. It is not part of this integration.
5. Budget invariants are enforced on chain where the contracts already enforce them (authorised limit, total allocated, total paid, remaining limit), and in the backend where they do not (INR budget versus released versus spent, which is a reporting invariant, not a contract invariant). The `/janlekha/expenditure` page shows both, labelled separately.
6. Pre-existing StreetSync discrepancy to resolve before any JanLekha payment work touches shared money helpers: the specification document says the reviewer cut is 10 percent and the reviewer stake is 2.00 USDC, the README says the reviewer fee is 5 percent and the stake is 10.00 USDC, and the code says `REVIEWER_STAKE = 10_000_000` (10.00 USDC) and the settle code comment says the worker gets 95 percent if approved. The code governs. The builder must confirm the actual split from `StreetSyncEscrow.settle` and `VotingModule` before writing any shared money helper, and must not copy a percentage from the specification document into JanLekha code. This discrepancy is flagged here, it is not resolved by this plan, and it does not block the JanLekha port, because JanLekha payments do not use the escrow split.

Must not: mark a payment Settled before the second authoriser approves, show a `SIM-ARC-` ref as a transaction hash, or mix INR and USDC in a total.

### C-15. Procurement: open bids versus sealed bids

What collides: JanLekha 2.0 procurement is open bids. `submitBid` takes a plain INR amount, visible on chain as soon as it is submitted. Old JanLekha procurement is sealed commit-reveal bids, with a salt from `crypto.getRandomValues`, a bid backup JSON the vendor must download before committing is enabled, and a reveal phase. The old flow is more private and more complex. The new flow is simpler and leaks bid amounts.

Evidence: JanLekha 2.0 `contracts/src/ProcurementRegistry.sol` (`submitBid(bytes32 tenderId, uint256 amountInr)`), `src/context/AppContext.tsx` `submitBid`. Old JanLekha `janlekha/contracts/JanLekha.sol` (commit and reveal phases, `commitment = keccak256(abi.encode(projectId, vendor, amountPaise, quotationDocumentHash, salt))`), `janlekha/src/lib/wallet/bid-backup.ts`.

Resolution:

1. Port the JanLekha 2.0 open-bid flow as it is. Do not reintroduce sealed bids as a silent change. The open-bid flow is what the JanLekha 2.0 contracts enforce, and changing it means changing the contracts, the tests, and the UI together.
2. Record the trade-off in the Procurement workspace and in the README: bid amounts are public on chain once submitted. If the owner wants sealed bids, that is a product decision for a later phase, and the old JanLekha commit-reveal design is the reference for it. The builder must not implement sealed bids in this integration without that decision.
3. Preserve the old JanLekha rule that a quotation document hash is part of the bid, even though JanLekha 2.0 `submitBid` does not take one. The ported UI requires a document hash (from the DocumentRegistry flow in section 5) before a bid can be submitted, and the backend records it alongside the bid. The contract does not enforce it, so the backend must. If the owner decides the document hash is optional, that decision is recorded and the requirement is removed in one place.

### C-16. Dependencies and package configuration

What collides: the two apps share almost no dependency versions. JanLekha 2.0 needs React 19, Vite 8, Tailwind 4, ethers 6, react-router-dom 7, Recharts 3, TypeScript 7. StreetSync app needs React 18, Next.js 14, Tailwind 3, wagmi 2, viem 2, React Query 5, Leaflet and MapLibre. The root workspaces are `contracts`, `packages/*`, `backend`, `app`. JanLekha 2.0 is not in workspaces. Old JanLekha is not in workspaces either, and has its own lockfile.

Resolution:

1. `app/package.json` is the only frontend dependency file after the integration. JanLekha 2.0 `package.json` is not copied, and its lockfile is not merged. The builder adds to `app/package.json` only what the ported code actually imports: Recharts (if the charts need it, version verified against React 18, see C-06), and nothing else. `react-router-dom`, `ethers`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, and `oxlint` are not added.
2. React stays 18. JanLekha 2.0 components are ported to React 18. The builder checks each ported file for React 19 only APIs and records the check. No React 19 only API was found in the files inspected, but that is a spot check, not a guarantee. The full port is the verification.
3. TypeScript stays at the StreetSync app version (5.5.4). JanLekha 2.0 uses TypeScript about 7.0.2, which is a major version ahead and is not adopted for this repo. The builder fixes any type errors the port introduces under 5.5.4, and does not upgrade TypeScript as a side effect.
4. Node stays 18 plus for the repo. The old JanLekha Node 22 requirement dies with it. The JanLekha 2.0 Node 20 requirement is satisfied by Node 18 plus for the ported code, because the ported code runs under Next.js 14, not under Vite 8.
5. `packages/*` are unchanged in structure. JanLekha code imports `@streetsync/evidence` and `@streetsync/arkiv-client` as workspace packages, the same way `app/` already does. No new workspace package is created for JanLekha unless the Arkiv work in section 5 shows a clean seam that deserves one, and that decision is recorded in the implementation PR.
6. The root `package.json` scripts are updated as in C-10 and C-11. No script references `janlekha/` or `VITE_` after the removal PR.

### C-17. Environment variables

What collides: JanLekha 2.0 uses Vite `import.meta.env.VITE_ARC_*_ADDRESS` variables, read in the browser. StreetSync uses `NEXT_PUBLIC_*` variables, read in the browser, plus server only variables read by the backend and the deploy scripts. Old JanLekha uses `NEXT_PUBLIC_HEDERA_*`, `HEDERA_TESTNET_PRIVATE_KEY`, `DATABASE_URL`, and `DOCUMENT_STORAGE_*`. The three sets overlap in name shape but not in meaning, and a stale `VITE_` or `HEDERA_` variable in a `.env` file would silently do nothing after the port.

Full mapping:

| JanLekha 2.0 / old variable | StreetSync equivalent | Action |
|---|---|---|
| `VITE_ARC_ROLE_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_ROLE_REGISTRY_ADDRESS` | Rename, move to `app/.env.example` and root `.env.example`. |
| `VITE_ARC_BUDGET_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_BUDGET_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_PROJECT_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_PROJECT_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_PROCUREMENT_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_PROCUREMENT_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_MILESTONE_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_MILESTONE_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_PAYMENT_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_PAYMENT_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_DOCUMENT_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_DOCUMENT_REGISTRY_ADDRESS` | Rename. |
| `VITE_ARC_AUDIT_REGISTRY_ADDRESS` | `NEXT_PUBLIC_JANLEKHA_AUDIT_REGISTRY_ADDRESS` | Rename. |
| `PRIVATE_KEY` (Foundry deploy) | `DEPLOYER_PRIVATE_KEY` (existing Hardhat deploy) | Use the existing variable. Do not introduce `PRIVATE_KEY`. |
| `HEDERA_TESTNET_PRIVATE_KEY` | None | Delete with old JanLekha. |
| `HEDERA_TESTNET_RPC_URL`, `NEXT_PUBLIC_HEDERA_*` | None | Delete with old JanLekha. |
| `DATABASE_URL` (old JanLekha Postgres) | `DB_PATH` (existing StreetSync SQLite) | Delete. JanLekha uses the same SQLite file as StreetSync, with `jl_*` tables. |
| `DOCUMENT_STORAGE_DIR`, `DOCUMENT_STORAGE_MAX_BYTES` | See section 5 | Do not reintroduce as server filesystem storage without a decision. JanLekha documents go to Arkiv. See C-18. |
| `NEXT_PUBLIC_JANLEKHA_URL` (`/janlekha`) | Keep as is | It already points at `/janlekha`. Keep it. |
| `NEXT_PUBLIC_STREETSYNC_URL` (old JanLekha) | None | Delete. It pointed at the two-server setup. |
| `WORLD_APP_ID`, `WORLD_ACTION_*`, `ATTESTER_PRIVATE_KEY` | Keep as is | Shared by StreetSync and JanLekha. See section 6. |

Rules:

- No `VITE_` variable is read anywhere after the port. The builder greps for `VITE_` and `import.meta.env` after the port and reports zero hits.
- No secret gets a `NEXT_PUBLIC_` prefix. The existing env guard idea from old JanLekha (fail fast on a public secret) is ported as a check in the app build or in `app/next.config.mjs`, and recorded in the implementation PR.
- Contract addresses are loaded from `contracts/deployments/arcTestnet.json` first, with env overrides second, following the existing `app/src/config/contracts.ts` pattern. Env overrides are for local development only, not for production.
- The backend reads JanLekha contract addresses from the same deployment file, following the existing `signer.ts` pattern (`DEPLOYMENTS_PATH`, default `../contracts/deployments/arcTestnet.json`).

### C-18. Arkiv evidence pipeline for JanLekha

What collides: StreetSync has a complete Arkiv pipeline for bounty evidence, with a binary bundle, a 120000 byte safe budget, a 128000 byte hard limit, chunking with a manifest, and a cryptographic verifier. JanLekha 2.0 has no Arkiv integration at all. Its milestone `evidenceHash` is a bare bytes32 with no bytes behind it, and its documents are hashes in a localStorage list with no stored file. The task requires JanLekha evidence to go through the Arkiv pipeline, so this is new work, not a port.

The pipeline, step by step, for JanLekha milestone evidence and for JanLekha documents:

1. Raw. The user uploads a file in the browser (milestone evidence photo or document, or a supporting document for a tender, bid, or audit report). The file bytes are read in the browser with `File.arrayBuffer`. The file is never uploaded to a server as the storage step. The browser is the upload point, Arkiv is the store.
2. SHA-256. The browser computes SHA-256 over the exact file bytes with `crypto.subtle.digest`, using the shared helper from C-07. The resulting 64 hex character hash is the content hash. It is displayed to the user before anything is stored, so the user can compare it with a hash they already have.
3. Zstd. For milestone evidence that is photographic (the JanLekha equivalent of a before and after photo), the file is first downsampled to WebP with the existing `packages/evidence` resizer (longest edge 1280px, quality 0.55 to 0.72, strict cap 45 KiB per image in code, 48 KiB in the specification document; the code cap governs, see the note below), then packed with CBOR metadata and Zstd compressed with the existing dictionary, using `packBundle` from `packages/evidence/src/bundle.ts`. For documents (PDFs and other files that are not photos), Zstd compression is applied to the raw bytes directly where it helps, and skipped where the file is already compressed. The choice is recorded per file in the metadata, not assumed.
4. Size validation. The packed bundle is validated against `MAX_SAFE_BUNDLE_BYTES = 120000` and `MAX_ARKIV_PAYLOAD = 128000`. A bundle at or under 120000 bytes goes to a single entity write. A bundle over 120000 bytes goes to the chunking path. A bundle that would need more than 255 chunks is rejected with a clear error before any write is attempted. The validation happens in the browser before the first Arkiv call, so a too-large file fails fast and does not leave a partial write behind.
5. Arkiv storage. The write uses `writeEvidenceBundle` from `packages/arkiv-client/src/index.ts`, with JanLekha attributes, not StreetSync attributes. JanLekha attributes are: `project: "janlekha"`, `entity_type: "milestone-evidence"` or `"document"`, `project_id` (the JanLekha string id), `milestone_id` or `document_id`, `uploader` (lowercase address), `sha256_prefix` (first 18 hex characters of the evidence hash, following the existing StreetSync convention), `kind: "bundle"` or `"chunk"`. TTL is `ENTITY_TTL_SECONDS = 604800` (7 days minimum), following the existing constant. The write returns an entity key and a bytes32 key.
6. Evidence ref and checksum on Arc. The on-chain record stores both values, and they are different values that must not be confused:
   - `evidenceHash` (bytes32): SHA-256 of the complete packed bundle, including the signature where a signature is present. This is what `MilestoneRegistry.submitMilestone` takes as its `evidenceHash` parameter, and what `DocumentRegistry.registerDocument` takes as its `contentHash` parameter.
   - `arkivEntityKey` (bytes32): the Arkiv entity key normalised with `entityKeyToBytes32`. This is the ref that lets a later reader fetch the bytes.
   - The JanLekha registries as written have no field for an Arkiv entity key. `MilestoneRegistry` stores only `evidenceHash`, and `DocumentRegistry` stores only `contentHash`. The builder must decide, and record the decision, between two options: (a) extend the registries with an `arkivEntityKey` field and a corresponding event, which is a contract change requiring new tests and a new deployment, or (b) store the Arkiv entity key in the backend SQLite `jl_milestones` and `jl_documents` tables, linked to the on-chain hash, and serve it from the backend API. Option (b) is the smaller change and is recommended for the first integration, with option (a) recorded as a follow-up. Whichever option is chosen, the evidence hash on chain and the Arkiv key in the record must be written in the same backend transaction, so a record never exists with one and not the other.
7. Retrieval with decompression and verification. The reader path is `readEvidenceBundle` from `packages/arkiv-client`, which reassembles chunked entities from the manifest, then `unpackBundle` from `packages/evidence`, which verifies the magic, version, and lengths, decompresses the Zstd metadata, and returns the metadata and the images. The verifier then recomputes SHA-256 over the retrieved bundle and compares it to the on-chain `evidenceHash`, and verifies the signature where one is present. The JanLekha audit page and the JanLekha verify page both use this path, and both show the same three-part result as C-07: hash registered, hash matches retrieved bytes, signature valid where applicable. A mismatch is shown as a failure, not as a warning.
8. Chunking and manifests for large files over the 128000 byte limit. The existing `chunkAndWriteBundle` splits the bundle into 115000 byte payloads, each with a 4 byte `SC` header (`0x53, 0x43, index, total`), writes each chunk as its own entity with `kind: "chunk"`, `chunk_index`, and `total_chunks`, then writes a JSON manifest entity with `manifestVersion: 1`, `evidenceHash`, `totalChunks`, `chunkKeys`, and `totalBytes`. The manifest entity key is the primary key stored on chain or in the backend. The reader detects a manifest by parsing the payload as JSON and finding `chunkKeys`, then fetches each chunk in order, validates each 4 byte header, strips it, and concatenates. If any chunk is missing or has a bad header, the read fails with the chunk index in the error. The manifest itself is a small JSON entity and counts toward the TTL of the chunks. All chunks and the manifest are written with the same TTL, so they expire together.
9. What is NOT in the JanLekha Arkiv bundle, at least in the first integration: the StreetSync visual challenge code, the compass heading, the GPS accuracy, and the EIP-191 worker signature are StreetSync bounty concepts. JanLekha milestone evidence does not have a challenge code. The JanLekha bundle metadata is a new CBOR schema, defined in the implementation PR, with the fields JanLekha needs (project id, milestone id, uploader address, upload time, file name, file type, content hash, Arkiv entity key, and a free text note). It reuses the SSYN binary framing (magic, version, flags, lengths) only if the builder decides the two bundle types should share a parser. If they share a parser, the magic must differ, so a JanLekha bundle can never be mistaken for a StreetSync bundle. The recommended magic is `JLK1` or equivalent, recorded in the implementation PR. If they do not share a parser, the JanLekha bundle is a simpler format (Zstd compressed CBOR metadata plus the file bytes, with no signature field), and the difference is documented.
10. Swarm is not used for JanLekha in the first integration. The Swarm video walkthrough is a StreetSync bounty concept. JanLekha video evidence, if wanted later, is a separate decision. Do not seal a Swarm reference into a JanLekha bundle in this integration.

Pre-existing discrepancies the builder must not copy into JanLekha code:

- The specification document says WebP quality 0.72 and a 48 KiB cap per image. The code says quality 0.55 in the README benchmark and a 45 KiB cap (`MAX_IMAGE_BYTES`) in `packages/evidence/src/resizer.ts` and `bundle.ts`. The code governs. The JanLekha port uses the code values.
- The specification document says the Arkiv limit is 128 KiB (131072 bytes). The code says `MAX_ARKIV_PAYLOAD = 128000` bytes and `MAX_SAFE_BUNDLE_BYTES = 120000` bytes. The code governs. The JanLekha port uses 120000 as the safe budget and 128000 as the hard limit.
- The in-memory `keyMappingRegistry` in `packages/arkiv-client` does not survive a restart. For JanLekha, the Arkiv entity key to bytes32 mapping must be stored in SQLite (`jl_documents` and `jl_milestones`), not in memory, so a reader can resolve a bytes32 key after a backend restart. Fixing the StreetSync in-memory mapping is out of scope for this integration, but the JanLekha path must not depend on it.

### C-19. World ID reuse for citizen uniqueness only

What collides: StreetSync uses World ID v4 for workers and reviewers, with a backend attester and EIP-712 attestations that gate `claim` and `registerReviewer`. JanLekha 2.0 has no World ID at all. The task requires World ID reuse for citizen uniqueness only, never as proof of official role. The two uses must not be conflated, and a World ID proof must never grant a government role.

Resolution:

1. Scope: World ID is used in JanLekha for exactly two purposes, and no others:
   - Citizen uniqueness for complaints: one human, one complaint thread per project, or one human, one vote or endorsement where the product later adds one. The nullifier is stored per action, following the existing `nullifiers` table pattern, with a JanLekha action namespace.
   - Citizen uniqueness for the Citizen workspace: a citizen who connects a wallet and verifies with World ID gets a uniqueness marker on their workspace, which lets the backend rate limit and deduplicate their complaints without storing who they are.
   World ID is NOT used to prove someone is a Government Administrator, Finance Officer, Procurement Officer, Contractor, or Auditor. Those roles come only from RoleRegistry. A World ID verified citizen who has no RoleRegistry role is still a citizen, with read only access.
2. Actions: new World ID actions under the same World app, with the JanLekha namespace, derived server side exactly as StreetSync does it. Recommended actions: `janlekha-complaint-<projectId>` for a complaint on a project, and `janlekha-citizen` for the Citizen workspace uniqueness check. The exact action names are confirmed against the World Developer Portal during implementation, and recorded in the backend env example. The backend derives the action, never trusts a client supplied action string.
3. Fail closed if not configured. If `WORLD_APP_ID`, `WORLD_RP_ID`, or the World verify URL is missing, or the World ID API is unreachable, or the proof does not verify, the backend refuses the uniqueness-gated action with a clear error. It does not fall back to a dev bypass, it does not issue an attestation, and it does not mark the citizen as unique. The existing `ALLOW_DEV_WORLD_ID_BYPASS` flag is a StreetSync development flag. It must not be enabled for JanLekha actions, and the JanLekha code path must not read it. If a JanLekha demo needs a bypass for local development, that is a separate, explicitly named flag, default off, and it is never enabled in a shared deployment.
4. No personal data on chain. A World ID nullifier hash is stored in the backend SQLite `nullifiers` table (or a `jl_nullifiers` table, builder choice, following the same unique constraint), and never written to a contract, never put in an Arkiv entity attribute, and never included in an event. The nullifier is a hash, not an identity, and it is treated as sensitive data in the backend. The frontend never displays a nullifier.
5. The EIP-712 attestation pattern is NOT reused for JanLekha citizens. StreetSync attestations bind a wallet, a role, a bounty id, a nonce, and an expiry, and are verified by `AttestationVerifier` on chain. JanLekha has no attestation verifier contract and no `claim` function to gate. Reusing the attestation for JanLekha would imply a role the citizen does not hold. The backend records the World ID verification result in SQLite and returns a session scoped uniqueness marker to the frontend. That marker is not a credential and is not accepted by any contract.
6. Verification level: the backend records the verification level returned by the World ID API (`orb` or `device`) alongside the nullifier, and the product decides which level a given action requires. The default is to require the same level StreetSync requires for its actions, and to record the level so a later audit can tell which actions were orb verified. Do not accept a lower level silently.

Must not: use a World ID proof as a role grant, store a nullifier on chain, or let a World ID verified user act as an official without a RoleRegistry grant.

### C-20. Governance and least privilege

What collides: JanLekha 2.0 has a single deployer who is the first ADMIN, with no expiry, no multi-signature, and no timelock. StreetSync has an `Ownable` escrow with an owner who can set the attester and the commit and reveal windows. The backend holds an attester private key that can sign attestations for any wallet. The combination is powerful, and the integration must not widen it.

Resolution:

1. Least privilege per role, enforced on chain first. The `PERMISSIONS` map in `permissions.ts` is the starting point, and the contract modifiers are the enforcement. No role gains a permission it does not have in the map, and no backend route grants a permission the contract does not grant. The `edit_records` permission exists in the JanLekha permission type but is granted to no role in the map. It stays ungranted. Auditors cannot change original financial records, because `DocumentRegistry` has no edit function and `PaymentRegistry` has no edit function. That is enforced by the absence of code, and the absence is tested.
2. Separation of duties, restated as rules the backend enforces and the tests assert:
   - A contractor cannot verify their own milestone. Enforced by `MilestoneRegistry.verifyMilestone` and by the backend.
   - A Finance Officer cannot authorise a payment they initiated. Enforced by the backend `canAuthorisePayment` check.
   - An auditor cannot change an original record. Enforced by the absence of an edit function.
   - A citizen is read only. Enforced by the backend refusing all JanLekha writes from an address with no RoleRegistry role.
   - A deployer who is ADMIN can grant roles, but cannot approve an allocation, verify a milestone, or record a payment unless they also hold the Finance or Auditor role. ADMIN is not a superuser for operational actions.
3. Key handling: the backend attester key (`ATTESTER_PRIVATE_KEY`) signs StreetSync attestations only. It does not sign JanLekha role grants, JanLekha payments, or JanLekha audit records. JanLekha writes are signed by the user wallet in the browser, through wagmi, with the user confirming each transaction. The backend never holds a JanLekha operational private key. The deployer key (`DEPLOYER_PRIVATE_KEY`) is used only for deployment, and is not stored in the backend env.
4. Admin revocation: after deployment, the deployer grants the real roles and then considers revoking its own ADMIN role, as `Deploy.s.sol` advises. That decision is recorded in the deployment run, with the date and the addresses granted. If ADMIN is revoked, there must be at least one other ADMIN still holding the role, or the system cannot grant future roles. The deployment script must check that before revoking, and refuse to revoke the last ADMIN.
5. Auditability: every role grant and revocation, every allocation approval and release, every tender publication and bid selection, every milestone verification, every payment record, and every audit flag and report is an on-chain event, indexed by the backend, and shown in `/janlekha/audit-trail` with a transaction hash and explorer link. An action with no event is not an action. It is a UI state.
6. Demo and test accounts: the JanLekha 2.0 demo uses no real accounts. The old JanLekha demo used Hardhat test accounts and `JANLEKHA_DEMO_*` addresses. The new integration uses the StreetSync local Hardhat accounts for local development only, and never uses a Hardhat test key on Arc Testnet. The backend already refuses the Hardhat account 0 key on non-local chains. That check stays.

## 4. Routing, money flow, map, verify, documents, complaints, audits, and roles, in one place

This section is the functional checklist for the builders. It restates section 3 in product order, so a builder can check off each surface.

- Citizen portal (`/janlekha`): national totals, department spend, top projects, latest payments and audits. Data from the backend aggregates. Demo rows labelled. No wallet required.
- Money flow (`/janlekha/money-flow`): Sankey from budget to departments to projects to contractors to payments. Hand-built SVG, ported as is. Data from the backend. INR and USDC shown as separate flows, never merged into one width. The Sankey width encodes INR. USDC is shown as a separate annotation, not as a width, because the two are different units.
- Map (`/janlekha/map`): schematic India SVG, 6 states, project counts per state. Labelled schematic. No wallet required. Not a Leaflet map.
- Verify (`/janlekha/verify`): browser SHA-256, registry check, Arkiv retrieval check, three-part result. See C-07 and section 5.
- Documents (`/janlekha/documents`): registry list, backed by DocumentRegistry and the backend. Each document shows title, project, hash, type, uploader, date, verified flag, Arkiv entity key where stored, and explorer link where registered on chain.
- Complaints (`/janlekha/complaints`): citizen complaints with status tracking. Filing a complaint requires World ID uniqueness for the project (see C-19) when World ID is configured, and fails closed when it is not. Complaint status updates are backend writes, indexed, and shown in the audit trail.
- Audits (`/janlekha/audits`): public audit report list, text and JSON download. Auditor workspace (`/janlekha/auditor`): risk flags, milestone verification, audit findings, report publishing. Audit trail (`/janlekha/audit-trail`): chronological events with transaction links. See C-08.
- Budgets (`/janlekha/budgets`), allocations (`/janlekha/allocations`), releases (`/janlekha/releases`), expenditure (`/janlekha/expenditure`): new pages, built from existing data. See section 3, C-09.
- Projects (`/janlekha/projects`, `/janlekha/projects/[id]`): project detail shows budget, tender, bids, award, milestones, evidence, payments, documents, and event timeline, in that order. The timeline is built from the backend events table, not from a hardcoded list.
- Tenders (`/janlekha/tenders`, `/janlekha/tenders/[id]`): tender detail shows bids, award, and the document hash requirement from C-15.
- Payments (`/janlekha/payments`): payment history, INR and USDC shown separately, simulated payments labelled, pending authorisation queue shown separately from settled payments.
- Departments (`/janlekha/departments`, `/janlekha/departments/[id]`): department detail shows budget, allocated, released, spent, projects, and head.
- Six role workspaces (`/janlekha/admin`, `/janlekha/finance`, `/janlekha/procurement`, `/janlekha/contractor`, `/janlekha/auditor`, `/janlekha/citizen`): ported from the JanLekha 2.0 role dashboards (283, 270, 263, 273, 339, and 314 lines respectively). Each workspace shows only the actions its role can perform, enforced server side. Each workspace shows its notifications filtered by role, from the backend. The Citizen workspace keeps followed projects and saved searches in browser storage only, as UI preferences.

## 5. Arkiv evidence pipeline, consolidated

This section is the single reference for the pipeline. It repeats section C-18 in checklist form so a builder can implement it without re-reading the conflict register.

1. Raw: read file bytes in the browser. Never upload the file to a server as the storage step.
2. SHA-256: compute over exact bytes with `crypto.subtle`, using the shared helper. Display the hash before storing.
3. Zstd: downsample photos to WebP (longest edge 1280px, quality 0.55 to 0.72, cap 45 KiB per image in code), pack CBOR metadata, compress with Zstd and the existing dictionary. Compress documents with Zstd where it helps, skip where it does not, and record the choice.
4. Size validation: validate against 120000 safe and 128000 hard before any Arkiv call. Reject over 255 chunks before writing.
5. Arkiv storage: write with `writeEvidenceBundle`, JanLekha attributes (`project: "janlekha"`, entity type, project id, milestone or document id, uploader, SHA-256 prefix, kind), TTL 604800.
6. Evidence ref and checksum on Arc: store `evidenceHash` (SHA-256 of the complete bundle) on chain via `submitMilestone` or `registerDocument`, and store the Arkiv entity key (bytes32) in the backend SQLite record in the same transaction. Decide in the implementation PR whether to also add an on-chain Arkiv key field. Record the decision.
7. Retrieval: `readEvidenceBundle` reassembles chunks from the manifest, `unpackBundle` decompresses and verifies structure, recompute SHA-256 and compare to the on-chain hash, verify signature where present. Show the three-part result.
8. Chunking and manifests: 115000 byte payloads, 4 byte `SC` header, chunk entities with `kind: "chunk"`, manifest JSON entity with version, evidence hash, total chunks, chunk keys, and total bytes. Reader validates each chunk header and fails with the chunk index on error.
9. Do not use Swarm for JanLekha in the first integration. Do not use the StreetSync challenge code, compass, or GPS fields in a JanLekha bundle. Use a distinct bundle magic or a distinct format, recorded in the implementation PR.

## 6. World ID reuse, consolidated

1. Citizen uniqueness only. Complaints and Citizen workspace uniqueness.
2. New actions under the JanLekha namespace, derived server side. Recommended: `janlekha-complaint-<projectId>`, `janlekha-citizen`.
3. Fail closed if not configured, if the API is unreachable, or if the proof does not verify. No dev bypass for JanLekha actions.
4. No personal data on chain. Nullifier hashes live in backend SQLite only, never in a contract, never in an Arkiv attribute, never in an event, never displayed.
5. No EIP-712 attestation reuse for JanLekha citizens. No attestation verifier contract for JanLekha.
6. Record the verification level. Require the same level StreetSync requires by default.

## 7. Governance and least privilege, consolidated

1. Contract first, backend second, frontend third. The frontend hides, the backend refuses, the contract reverts.
2. Separation of duties as listed in C-20. Tested, not just documented.
3. Backend attester key signs StreetSync attestations only. JanLekha writes are signed by the user wallet.
4. Deployer is first ADMIN, grants real roles, considers revoking its own ADMIN only if another ADMIN remains.
5. Every action is an on-chain event, indexed, and shown in the audit trail with a transaction hash.
6. No Hardhat test key on Arc Testnet. The existing backend check stays.

## 8. Phased implementation order

Builders follow this order. Do not start a later phase before the earlier phase acceptance criteria pass. Each phase is a separate PR or a separate set of PRs, with tests.

### Phase 0. Retire old JanLekha and freeze the baseline

- Extract the reusable ideas listed in C-10. Record the Hedera deployment in the removal commit message.
- Delete `janlekha/`, root `postinstall`, `dev:janlekha`, `test:janlekha`, `deploy:janlekha:hedera`, the `janlekha` process from root `dev`, port 3100 from `clean-ports.mjs`, and the JanLekha rewrites from `app/next.config.mjs` (keeping only `/backend/:path*`).
- Update `README.md` to describe the single-app setup. Update `SiteNav.tsx` `isActive` to match only `/janlekha*`.
- Grep for `janlekha`, `3100`, `8547`, `hedera`, `HEDERA_`, and `VITE_` and report zero hits outside this plan and the git history.
- Acceptance: `npm install` installs only workspaces, `npm run dev` starts exactly two processes (backend 3001, app 3000), `npm run test:contracts`, `npm run test:pipeline`, and `npm run test --workspace=streetsync-backend` pass, and `/janlekha` returns 404 until Phase 1 lands. The StreetSync app is fully working at the end of this phase.

### Phase 1. Contracts on Hardhat

- Move the eight registries into `contracts/src/janlekha/`, preserving SPDX and NatSpec.
- Extend `contracts/scripts/deploy.ts` to deploy them in order, call `setPaymentRegistry`, and write all eight addresses and ABIs into `contracts/deployments/arcTestnet.json`.
- Port the 18 Foundry tests to `contracts/test/JanLekha.test.ts` in Hardhat Mocha and Chai. Add a test that asserts the JanLekha registries compile under `viaIR: true`.
- Deploy to Arc Testnet, record the addresses, and confirm the deployer is the first ADMIN.
- Acceptance: `npm run test:contracts` passes with the new tests included, the deployment file contains all eight JanLekha addresses, and the deployer key handling is unchanged.

### Phase 2. Backend data, indexer, and API

- Add the `jl_*` tables to `backend/src/db.ts`, with a `source` column (`seed` or `chain`) and a `tx_hash` column on every record that can come from chain.
- Add the JanLekha indexer, with a separate cursor row, watching the eight registries and upserting into the `jl_*` tables.
- Add the `/api/janlekha/*` read routes and the write routes, with server side role checks against RoleRegistry, on-chain state checks, and the second authoriser check for payments.
- Port the risk engine to a backend scheduled scan over the `jl_*` tables, writing flags to `jl_audit_flags`.
- Move the demo seed to a backend seed file, used only for fresh local databases, with DEMO DATA labels preserved.
- Acceptance: backend tests pass, the indexer indexes a JanLekha deployment from its deployment block to tip without error, the API returns seeded data labelled DEMO DATA on a fresh database and indexed data without the label after indexing, and a write from an address without the required role is refused by the backend and by the contract.

### Phase 3. Frontend port, routing, and design system

- Port the JanLekha pages to `app/src/app/janlekha/` per the routing table in section 4, including the four new pages (budgets, allocations, releases, expenditure) and the new audit trail page.
- Port `AppContext` actions to backend calls with React Query. Delete localStorage shared state. Keep browser storage only for Citizen UI preferences, read after hydration.
- Port the wallet to wagmi plus viem. Delete ethers and `react-router-dom` from the app. Replace the role picker with the `/janlekha/login` page from C-12.
- Translate the JanLekha design tokens into the Tailwind 3 config, scope the hybrid theme to JanLekha routes, and unify the shared UI primitives.
- Port the Sankey, the schematic India map, and the Recharts charts. Verify Recharts under React 18 and record the result.
- Acceptance: `npm run build --workspace=streetsync-app` passes, every route in section 4 renders, every link on a JanLekha page points to a route that exists, the StreetSync pages are visually unchanged, and no `VITE_`, `import.meta.env`, `react-router-dom`, or `ethers` import remains in `app/`.

### Phase 4. Arkiv evidence pipeline for JanLekha

- Implement the pipeline in section 5: raw, SHA-256, Zstd, size validation, Arkiv storage with JanLekha attributes, evidence ref and checksum on Arc, retrieval with decompression and verification, chunking and manifests.
- Define the JanLekha bundle metadata schema and the bundle magic, and record both in the implementation PR.
- Wire milestone evidence and document registration through the pipeline. Update the verify page to show the three-part result.
- Store the Arkiv entity key to bytes32 mapping in SQLite, not in memory.
- Acceptance: a milestone evidence file under 120000 bytes round trips through Arkiv and verifies against the on-chain hash, a file over 120000 bytes round trips through chunking and the manifest and verifies, a tampered byte fails verification, and a document registered on chain shows its Arkiv key, its hash, and its explorer link on the document page.

### Phase 5. World ID for citizens, and governance hardening

- Add the JanLekha World ID actions to the backend, with server side derivation, nullifier storage, and fail closed behaviour. Wire complaints and the Citizen workspace to it.
- Harden the role checks: backend re-checks, contract reverts, frontend hiding, and the tests that assert each separation of duties rule.
- Record the role grants from the deployment, and record the decision on revoking the deployer ADMIN role.
- Acceptance: a complaint from a World ID verified citizen succeeds once per project and is refused on a second attempt with the same nullifier, a complaint without World ID fails closed when World ID is configured, a payment initiated by Finance Officer A cannot be authorised by Finance Officer A, a contractor cannot verify their own milestone, and an auditor cannot edit an original record (no code path exists to do so).

### Phase 6. Demo, docs, and acceptance

- Update `README.md` with the new single-app instructions, the JanLekha routes, the settlement gap wording from C-14, and the World ID scope from C-19.
- Add an end to end test that walks the full JanLekha lifecycle (department, project, allocation, tender, bid, milestone, verification, payment initiation, second authorisation, payment record, audit flag, audit report) against a local chain and the backend, and asserts each step is indexed and visible in the UI data.
- Run the full test suites: contracts, pipeline, backend, app build, and the new end to end test.
- Acceptance: all suites pass, every route in section 4 is reachable, every demo row is labelled, no simulated payment is shown as settled without a second authoriser, no `SIM-ARC-` ref is shown as a transaction hash, and this plan is updated with any deviation found during implementation, with the deviation and its reason recorded.

## 9. Acceptance criteria for the whole integration

- One repo, one frontend, one dev command, two processes. No Vite server, no port 3100, no port 8547, no second lockfile.
- All eight JanLekha registries deployed on Arc Testnet 5042002, recorded in the same deployment file as StreetSyncEscrow, with tests passing under Hardhat.
- All JanLekha reads served by the backend from SQLite, indexed from chain, with seed rows labelled DEMO DATA and indexed rows not labelled.
- No payment marked Settled without a second authoriser. No simulated ref shown as a transaction hash. INR and USDC never mixed in a total.
- Milestone evidence and documents stored on Arkiv, retrievable, decompressible, and verifiable against the on-chain hash, including the chunked path.
- World ID used for citizen uniqueness only, failing closed, with no nullifier and no personal data on chain.
- The 7 StreetSync security rules intact. The reviewer stake and reviewer cut discrepancy noted in C-14 is confirmed from code before any shared money helper is written.
- No em dash characters in any user-facing document produced by this integration. This plan contains none.

## 10. What could not be verified from the code

These are open items. They are not assumptions. A builder must verify each one before relying on it.

1. Contract test counts: the StreetSync README says 14 contract tests, the test file contains 16 `it(` blocks. The JanLekha README says 18 Foundry tests pass with Forge 1.9.0. Neither suite was re-run in this inspection. The builder runs both suites in Phase 0 and Phase 1 and records the actual counts.
2. Recharts under React 18: JanLekha 2.0 verified Recharts 3.10.1 against React 19. StreetSync uses React 18. Whether Recharts 3.10.1 renders correctly under React 18 was not verified. The builder verifies it in Phase 3 and records the version used.
3. TypeScript 7 in JanLekha 2.0 versus TypeScript 5.5.4 in the StreetSync app: whether any JanLekha 2.0 type syntax fails under 5.5.4 was not checked file by file. The builder finds out during the port and records any syntax that had to change.
4. The actual reviewer split in `StreetSyncEscrow.settle`: the specification document, the README, and the code comment disagree on the reviewer cut (10 percent, 5 percent, and 95 percent to the worker respectively), and on the reviewer stake (2.00 USDC in the specification, 10.00 USDC in the README and the code). The code was read only for the stake constant and the settle comment. The exact split was not traced through `VotingModule` and `settle` in this inspection. The builder traces it before writing any shared money helper.
5. Arkiv live behaviour: the Arkiv client, the 128000 byte limit, the 120000 byte safe budget, and the chunking path were verified from code and from the README benchmark (83,222 bytes for a 3.72 MB bundle, 97.86 percent reduction). No live Arkiv write was performed in this inspection. The builder performs a live round trip in Phase 4 and records the actual entity key format returned, because `entityKeyToBytes32` handles UUID, hex, and base64 keys differently.
6. World ID app and actions: the StreetSync World app id (`app_401e8c235a6b3bbd1bc62df14d5c021d`) and the action names were verified from code and env examples. Whether the JanLekha action names proposed in C-19 exist in the World Developer Portal, and what verification level they require, was not verified. The builder confirms them in Phase 5.
7. Old JanLekha references outside the files found: the grep for live references to `janlekha/` covered the root `package.json`, `app/next.config.mjs`, `README.md`, and the `janlekha/` directory itself. A full repo grep for `janlekha`, `3100`, `8547`, `hedera`, and `HEDERA_` after removal is still required in Phase 0, because a reference could live in a script, a test, or a doc not read in this inspection.
8. JanLekha 2.0 `contracts.ts` read path: the file (596 lines) was read in part (ABIs for five registries and the simulated result helpers). The remaining read helpers (project, tender, milestone, payment, document, and audit reads, and `parseContractEvents`) were not read line by line. The builder reads them in full during the viem port in Phase 3 and records any read that has no backend equivalent.
9. The JanLekha 2.0 role dashboards (283, 270, 263, 273, 339, and 314 lines) and the public pages (50 to 213 lines each) were inventoried by size and by imports, not read line by line. The port in Phase 3 is the full read. Any behaviour in those files that contradicts this plan (for example, a write that bypasses AppContext, or a direct RPC call) must be reported in the implementation PR and the plan updated.
10. `NEXT_PUBLIC_WC_PROJECT_ID` is in the root env example but unused in the wagmi config. Whether WalletConnect was intended and dropped, or never wired, was not determined. It is recorded here as an open item, not as a decision to add WalletConnect.

## Appendix A. File inventory for builders

StreetSync files cited most often:

- `README.md`, `streetsync_master_context_technical_specification.md`, `package.json`, `scripts/clean-ports.mjs`
- `app/package.json`, `app/next.config.mjs`, `app/tailwind.config.ts`, `app/src/app/layout.tsx`, `app/src/app/globals.css`, `app/src/app/providers.tsx`, `app/src/app/manifest.ts`
- `app/src/config/contracts.ts`, `app/src/config/wagmi.ts`, `app/src/lib/api.ts`, `app/src/components/layout/SiteNav.tsx`, `app/src/components/AuditVerifier.tsx`, `app/src/app/audit/[id]/page.tsx`
- `backend/src/server.ts`, `backend/src/db.ts`, `backend/src/signer.ts`, `backend/src/indexer.ts`, `backend/src/abi.ts`
- `contracts/hardhat.config.ts`, `contracts/scripts/deploy.ts`, `contracts/src/*.sol`, `contracts/test/StreetSync.test.ts`, `contracts/deployments/arcTestnet.json`, `contracts/deployments/localhost.json`
- `packages/evidence/src/bundle.ts`, `packages/evidence/src/compress.ts`, `packages/evidence/src/resizer.ts`, `packages/arkiv-client/src/index.ts`, `packages/swarm-client/src/index.ts`

JanLekha 2.0 files cited most often:

- `README.md`, `docs/ARC-MIGRATION.md`, `package.json`, `vite.config.ts`, `src/App.tsx`, `src/main.tsx`, `src/index.css`
- `src/context/AppContext.tsx`, `src/data/demoData.ts`, `src/lib/arc.ts`, `src/lib/contracts.ts`, `src/lib/permissions.ts`, `src/lib/risk.ts`, `src/lib/format.ts`
- `src/pages/*.tsx`, `src/pages/roles/*.tsx`, `src/components/Layout.tsx`, `src/components/ui.tsx`, `src/components/Sankey.tsx`, `src/components/IndiaMap.tsx`, `src/components/Charts.tsx`, `src/components/WalletConnect.tsx`
- `contracts/src/*.sol`, `contracts/script/Deploy.s.sol`, `contracts/test/JanLekha.t.sol`, `contracts/foundry.toml`

Old JanLekha files cited most often:

- `janlekha/README.md`, `janlekha/package.json`, `janlekha/next.config.ts`, `janlekha/prisma/schema.prisma`, `janlekha/contracts/JanLekha.sol`, `janlekha/deployments/hederaTestnet.json`, `janlekha/scripts/dev-demo.mjs`, `janlekha/.env.example`

## Appendix B. Glossary

- Arkiv entity key: the identifier returned when a payload is written to Arkiv. Normalised to bytes32 with `entityKeyToBytes32` for on-chain storage.
- Evidence hash: SHA-256 of the complete packed bundle, including the signature where present. Stored on chain. Compared on retrieval.
- SIM-ARC ref: a simulated payment reference, starting with `SIM-ARC-`. A demo reference, never a transaction hash.
- Seed row: a database row populated from demo seed data for local development. Labelled DEMO DATA. An indexed row is populated from chain events and is not labelled.
- Second authoriser: a Finance Officer who did not initiate a payment, who approves it before it is recorded on chain. Required for every JanLekha payment.
- RoleRegistry: the JanLekha on-chain source of truth for official roles. ADMIN, FINANCE, PROCUREMENT, CONTRACTOR, AUDITOR. Citizens hold no RoleRegistry role.
