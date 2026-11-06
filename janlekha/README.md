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
npm run contracts:deploy:hedera   # needs HEDERA_TESTNET_RPC_URL + HEDERA_TESTNET_PRIVATE_KEY
```
