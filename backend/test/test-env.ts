// Imported first by the test suite: db.ts opens an in-memory database instead of wiping
// the developer's data/streetsync.db, and the signer runs on the local chain with the
// Hardhat test key (it refuses that public key on real networks).
process.env.DB_PATH = ":memory:";
process.env.CHAIN_ID = "31337";
