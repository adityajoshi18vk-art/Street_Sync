# Test Results: StreetSync plus JanLekha 2.0

Run by the coordinator directly on 2026-11-07, after two delegated test runners were lost in daemon restarts with no result delivered. Every number below was observed in a real run in this environment. Nothing here is copied from a prior report.

Base commits: StreetSync `6600b9b`, JanLekha 2.0 `0da05fe`. Node v24.22.1. Test clone: `~/workspace/street-sync-verify-tests`. JanLekha tests and build ran in `~/workspace/janlekha`.

## Results per suite

| Suite | Command | Pass | Fail | Skip |
| --- | --- | --- | --- | --- |
| StreetSync Hardhat contracts | `npm run test:contracts` | 14 | 0 | 0 |
| Swarm client | `npm run test --workspace=@streetsync/swarm-client` (via `npm run test:pipeline`) | 5 | 0 | 0 |
| Evidence pipeline | `npm run test --workspace=@streetsync/evidence` (via `npm run test:pipeline`) | 2 | 1 | 0 |
| Evidence pipeline, rerun with longer timeout | `npx vitest run --testTimeout=120000` in `packages/evidence` | 3 | 0 | 0 |
| Arkiv client, first attempt | `npm run test --workspace=@streetsync/arkiv-client` | 0 | 1 (suite failed to collect, 0 tests ran) | 0 |
| Arkiv client, after `npm run build:packages` | `npm run test --workspace=@streetsync/arkiv-client` | 3 | 0 | 0 |
| Backend | `npx tsx --test test/backend.test.ts` in `backend` | 8 | 0 | 0 |
| JanLekha 2.0 Foundry contracts | `forge test` in `~/workspace/janlekha/contracts` (forge at `~/.foundry/bin/forge`) | 18 | 0 | 0 |
| JanLekha 2.0 frontend build | `npm run build` in `~/workspace/janlekha` | pass | 0 | 0 |

Total tests passing after the fixes and prerequisites below: 14 + 5 + 3 + 3 + 8 + 18 = 51, plus the JanLekha frontend build passing.

Notes on expected counts in the repo README: it says 14 StreetSync contract tests (matches), 11 pipeline tests (swarm 5 + evidence 3 + arkiv 3 = 11, matches after the fix), and 4 backend tests (the file actually contains 8 tests, all passing, so the README count is stale).

## Failures found and what they were

### Evidence pipeline, default run: 1 failure, a timeout, not a correctness failure
Command: `npm run test:pipeline`. Evidence suite: 2 passed, 1 failed. The failing test was "proves 4 MB raw photo pair + JSON metadata compresses into a single <100 KiB signed bundle and unpacks bit-for-bit", error: "Test timed out in 5000ms". The test generates a 4 MB photo pair, re-encodes WebP, compresses with Zstd, and verifies the bundle. In the rerun with `--testTimeout=120000` it passed in 22.56 seconds, producing an 82.71 KiB signed bundle (46.0x compression, 97.83 percent savings), with all 3 tests passing in 32.59 seconds total. The default Vitest timeout of 5000 ms is too short for this test even on a warm run, and the cold run spent 154 seconds in collection (WASM loading) before the test even started.

Fix applied in this clone: `packages/evidence/package.json`, test script changed from `vitest run` to `vitest run --testTimeout=120000`. This is a test-only change, no product code was touched. It was verified in the test clone with the identical flag (3 passed, 0 failed). The script change itself was not re-run in this clone, which has no node_modules installed; see the note in the fixes section below.

### Arkiv client, first attempt: suite failed to collect, missing built package
Command: `npm run test --workspace=@streetsync/arkiv-client`. Error: "Failed to resolve entry for package @streetsync/evidence. The package may have incorrect main/module/exports specified in its package.json." Cause: the arkiv test imports `@streetsync/evidence`, whose package entry is `dist/index.js`, and no `dist/` folder existed in any package, because `npm run build:packages` had never been run in that clone. This is a setup prerequisite, not a code bug. After running `npm run build:packages` (swarm, evidence, arkiv, all built with `tsc`, exit 0), the arkiv suite passed 3 passed, 0 failed. Consequence: `npm run test:pipeline` alone does not work on a fresh clone. Run `npm run build:packages` first, or the pipeline test script should build packages first.

### Backend test runner, first attempt: exec aborted, no output
The first attempt to run the backend suite through the workspace command was aborted by the runtime with no output. A direct rerun with `timeout 120 npx tsx --test test/backend.test.ts` in `backend/` finished in about 4 seconds: 8 passed, 0 failed, 0 skipped, 0 cancelled. The abort produced no test evidence and is not counted as a failure.

### One transient EPERM error, not a test failure
One rerun of the evidence suite with `--cache=false` failed at collection with "EPERM: operation not permitted, write" from Vitest results cache handling, with 0 tests run. A later rerun with the same flag plus `--testTimeout=120000` passed 3 of 3. The EPERM did not recur. It is recorded as a transient environment error, not as a product failure, and no code was changed for it.

## Fixes applied in this clone

1. `packages/evidence/package.json`: test script `vitest run` changed to `vitest run --testTimeout=120000`. Reason: the benchmark test takes about 22 seconds, over the 5000 ms default. Verified with the identical flag in the test clone: 3 passed, 0 failed. Not re-run in this clone (no node_modules here).
2. No other product code was changed. No security fix from `docs/SECURITY-REVIEW.md` was applied in this clone; those findings are recorded for the building coordinators to fix.

## Not run

- StreetSync app typecheck or build: not run. It is not listed in the root test scripts, and the app build was not part of the assigned harness.
- `npm run test:e2e` (`scripts/e2e-verify.ts`): not run. It requires a live Arc Testnet deployment, a funded wallet, and about 6 minutes of real commit window time, per the README. Recorded as not run, not as passed.
- `npm run test:janlekha` (old Hedera janlekha inside StreetSync): not run. That sub-app is being retired, and its tests target Hedera, not the JanLekha 2.0 target.
- Live browser checks: not run. No live browser was available to this coordinator.
- Live Arc, Arkiv, or World ID calls: not run. All contract and pipeline tests above use local Hardhat, local Vitest, and in-memory mocks where the test itself provides them. No transaction hash, Arkiv entity ID, or World ID proof is claimed in this file.

## JanLekha frontend build output

`npm run build` in `~/workspace/janlekha` passed with `tsc -b && vite build`. One cosmetic warning only: the JS chunk is 903.70 kB after minification, over the 500 kB warning limit, because ethers and Recharts are bundled together. No code splitting was added.
