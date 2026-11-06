# JanLekha

Public, verifiable audit trail for government budgets and procurement (Hedera EVM testnet).
All data and payment attestations are synthetic. This is a separate project from StreetSync
and has its own dependencies and lockfile.

## Setup

Requires Node.js 22+ and PostgreSQL (optional until features need it).

```bash
cd janlekha
npm ci                      # also runs `prisma generate`
cp .env.example .env        # fill in values; never commit .env
```

## Commands

```bash
npm run dev                       # Next.js dev server → http://localhost:3000 (/health, /api/health)
npm run build                     # production build
npm run typecheck                 # Next.js app + Hardhat/test TypeScript
npm run lint
npm run contracts:build           # compile Solidity (solc 0.8.34, EVM target cancun)
npm run contracts:test            # Hardhat tests on the in-process network
npm run db:migrate                # Prisma migrations (needs DATABASE_URL)
```

## Hedera Testnet deployment

Needs a faucet-funded **ECDSA** testnet account with at least ~10 HBAR (deployment estimates ~2.3M gas, about 3–4 HBAR; each role grant or smoke-test transaction costs far less). Set `HEDERA_TESTNET_PRIVATE_KEY` in `.env`, or run
`npx hardhat keystore set HEDERA_TESTNET_PRIVATE_KEY`. Optionally set the `JANLEKHA_DEMO_*` addresses.

```bash
npm run contracts:release:hedera   # deploy → grant roles → smoke test (each step is idempotent)
# or step by step:
npm run contracts:deploy:hedera
npm run contracts:roles:hedera
npm run contracts:smoke:hedera
```

The artifact `deployments/hederaTestnet.json` holds the address, chain ID, EVM tx hash, Hedera
transaction ID, ABI path (`deployments/abi/JanLekha.json`), timestamps, role grants and the smoke-test
readback. Copy the address into `NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS`.

Rehearse locally: `npm run contracts:node` in one terminal, then the `contracts:*:local` scripts.

## Public pages and local demo

Public pages read contract state directly over JSON-RPC, with no wallet and no database:
`/projects`, `/projects/[id]` (budget, tender, bids, award, milestones and event timeline) and `/verify`
(computes a PDF's SHA-256 in the browser and compares it with the on-chain hash). On Hedera, the timeline
comes from the mirror node, because the relay limits `eth_getLogs` ranges.

Synthetic local demo with three projects at different stages:

```bash
npm run contracts:node                                       # terminal 1
npm run contracts:deploy:local && npm run contracts:seed:local
# copy the printed NEXT_PUBLIC_* lines into .env.local, then:
npm run build && npm start
```

`npm run demo:documents` regenerates the deterministic synthetic PDFs in `public/demo-documents/`
and the off-chain catalog (titles and download links keyed by on-chain hash).
