/**
 * schema.ts
 * SQLite DDL and versioned migration.
 *
 * Tables are either PRESERVED (World ID nullifiers, issued nonces, meta) or DERIVED
 * (everything rebuilt from chain events). Derived tables are dropped and recreated whenever
 * the schema version or the deployment scope (chain id + escrow address) changes, so a
 * redeployed contract can never leave rows from the previous deployment behind.
 */

import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

const VERSION_KEY = "schema_version";
const CHAIN_KEY = "chain_id";
const ESCROW_KEY = "escrow_address";

const PRESERVED_DDL = `
  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- World ID nullifier tracking: one human per action
  CREATE TABLE IF NOT EXISTS nullifiers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nullifier_hash   TEXT    NOT NULL,
    action           TEXT    NOT NULL,
    wallet           TEXT    NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(nullifier_hash, action)
  );

  -- Issued EIP-712 nonces (track which nonces we've issued so we don't reuse)
  CREATE TABLE IF NOT EXISTS nonces (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet           TEXT    NOT NULL,
    nonce            TEXT    NOT NULL,
    role             INTEGER NOT NULL,
    bounty_id        TEXT    NOT NULL DEFAULT '0',
    expiry           INTEGER NOT NULL,
    issued_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    used             INTEGER NOT NULL DEFAULT 0,
    UNIQUE(wallet, nonce)
  );

  CREATE INDEX IF NOT EXISTS idx_nullifiers_hash ON nullifiers(nullifier_hash);
`;

export const DERIVED_TABLES = [
  "bounties",
  "pledges",
  "panel_assignments",
  "vote_commits",
  "settlements",
  "reviewer_slashes",
  "problem_votes",
  "reports",
  "events_cursor",
] as const;

const DERIVED_DDL = `
  -- Canonical bounty state, refreshed from getBounty after every log batch
  CREATE TABLE IF NOT EXISTS bounties (
    bounty_id           TEXT    PRIMARY KEY,
    creator             TEXT    NOT NULL,
    description_hash    TEXT    NOT NULL,
    report_hash         TEXT,
    lat_e5              INTEGER NOT NULL,
    lng_e5              INTEGER NOT NULL,
    region_cell         INTEGER NOT NULL,
    total_pledged       TEXT    NOT NULL DEFAULT '0',
    created_at          INTEGER NOT NULL,
    validation_deadline INTEGER NOT NULL DEFAULT 0,
    claim_deadline      INTEGER NOT NULL,
    work_deadline       INTEGER NOT NULL DEFAULT 0,
    worker              TEXT,
    visual_challenge_code INTEGER,
    arkiv_entity_key    TEXT,
    evidence_hash       TEXT,
    selection_block     TEXT,
    review_round        INTEGER NOT NULL DEFAULT 0,
    rework_count        INTEGER NOT NULL DEFAULT 0,
    confirmations       INTEGER NOT NULL DEFAULT 0,
    disputes            INTEGER NOT NULL DEFAULT 0,
    status              INTEGER NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS pledges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id   TEXT    NOT NULL,
    pledger     TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    new_total   TEXT    NOT NULL,
    withdrawn   INTEGER NOT NULL DEFAULT 0,
    block_number TEXT,
    tx_hash     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, pledger, tx_hash)
  );

  CREATE TABLE IF NOT EXISTS panel_assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id     TEXT    NOT NULL,
    review_round  INTEGER NOT NULL,
    reviewer_0    TEXT    NOT NULL,
    reviewer_1    TEXT    NOT NULL,
    reviewer_2    TEXT    NOT NULL,
    block_number  TEXT,
    tx_hash       TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, review_round)
  );

  CREATE TABLE IF NOT EXISTS vote_commits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id     TEXT    NOT NULL,
    review_round  INTEGER NOT NULL DEFAULT 0,
    reviewer      TEXT    NOT NULL,
    commit_hash   TEXT,
    revealed      INTEGER NOT NULL DEFAULT 0,
    approve       INTEGER,
    block_number  TEXT,
    tx_hash       TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, review_round, reviewer)
  );

  CREATE TABLE IF NOT EXISTS reviewer_slashes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id   TEXT    NOT NULL,
    reviewer    TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    block_number TEXT,
    tx_hash     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, reviewer, tx_hash)
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id       TEXT    NOT NULL UNIQUE,
    approved        INTEGER NOT NULL,
    worker_payout   TEXT    NOT NULL,
    reviewer_cut    TEXT    NOT NULL,
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Neighbour validation votes (one per wallet per bounty, mirrors the contract)
  CREATE TABLE IF NOT EXISTS problem_votes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id     TEXT    NOT NULL,
    voter         TEXT    NOT NULL,
    is_real       INTEGER NOT NULL,
    block_number  TEXT,
    tx_hash       TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, voter)
  );

  -- Verified problem-report bundles (Arkiv copy cached locally)
  CREATE TABLE IF NOT EXISTS reports (
    bounty_id       TEXT    PRIMARY KEY,
    entity_key      TEXT    NOT NULL,
    report_hash     TEXT    NOT NULL,
    creator         TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    lat_e5          INTEGER NOT NULL,
    lng_e5          INTEGER NOT NULL,
    captured_at_ms  INTEGER NOT NULL,
    photo           BLOB    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Indexer cursor: tracks the last processed block for each chain
  CREATE TABLE IF NOT EXISTS events_cursor (
    chain_id    INTEGER PRIMARY KEY,
    last_block  TEXT    NOT NULL DEFAULT '0',
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Gamification stickers earned per wallet (awarded lazily from indexed activity)
  CREATE TABLE IF NOT EXISTS stickers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet      TEXT    NOT NULL,
    sticker_id  TEXT    NOT NULL,
    awarded_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(wallet, sticker_id)
  );

  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
  CREATE INDEX IF NOT EXISTS idx_bounties_region ON bounties(region_cell);
  CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator);
  CREATE INDEX IF NOT EXISTS idx_bounties_worker ON bounties(worker);
  CREATE INDEX IF NOT EXISTS idx_pledges_bounty ON pledges(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_panel_bounty ON panel_assignments(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_votes_bounty ON vote_commits(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_problem_votes_bounty ON problem_votes(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_stickers_wallet ON stickers(wallet);
`;

function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

function dropDerived(db: DatabaseSync): void {
  for (const table of DERIVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table};`);
}

function inTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Creates missing tables and upgrades older on-disk schemas. v1 databases (no meta table)
 * have their derived tables rebuilt; nullifiers and nonces are never touched.
 */
export function initSchema(db: DatabaseSync): void {
  inTransaction(db, () => {
    db.exec(PRESERVED_DDL);
    if (getMeta(db, VERSION_KEY) !== String(SCHEMA_VERSION)) {
      dropDerived(db);
      db.prepare("DELETE FROM meta WHERE key IN (?, ?)").run(CHAIN_KEY, ESCROW_KEY);
      setMeta(db, VERSION_KEY, String(SCHEMA_VERSION));
    }
    db.exec(DERIVED_DDL);
  });
}

/**
 * Binds the derived data to one (chain, escrow) deployment. When either differs from what the
 * database was built for, derived tables are rebuilt empty so the indexer re-syncs from scratch.
 * Returns true when a reset happened.
 */
export function ensureDeploymentScope(db: DatabaseSync, chainId: number, escrowAddress: string): boolean {
  const escrow = escrowAddress.toLowerCase();
  let reset = false;
  inTransaction(db, () => {
    if (getMeta(db, CHAIN_KEY) === String(chainId) && getMeta(db, ESCROW_KEY) === escrow) return;
    dropDerived(db);
    db.exec(DERIVED_DDL);
    setMeta(db, CHAIN_KEY, String(chainId));
    setMeta(db, ESCROW_KEY, escrow);
    reset = true;
  });
  return reset;
}
