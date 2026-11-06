import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DERIVED_TABLES, SCHEMA_VERSION, ensureDeploymentScope, initSchema } from "../src/schema.js";

const ESCROW_A = "0x3Fd53ce0728BfBDbc5559C4a573f54294FfEa356";
const ESCROW_B = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

/** The shape a v1 database file has on disk: no meta table, no v2 bounty columns. */
function v1Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE nullifiers (id INTEGER PRIMARY KEY AUTOINCREMENT, nullifier_hash TEXT NOT NULL, action TEXT NOT NULL,
      wallet TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(nullifier_hash, action));
    CREATE TABLE nonces (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, nonce TEXT NOT NULL, role INTEGER NOT NULL,
      bounty_id TEXT NOT NULL DEFAULT '0', expiry INTEGER NOT NULL, issued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      used INTEGER NOT NULL DEFAULT 0, UNIQUE(wallet, nonce));
    CREATE TABLE bounties (bounty_id TEXT PRIMARY KEY, creator TEXT NOT NULL, description_hash TEXT NOT NULL,
      lat_e5 INTEGER NOT NULL, lng_e5 INTEGER NOT NULL, region_cell INTEGER NOT NULL, total_pledged TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL, claim_deadline INTEGER NOT NULL, worker TEXT, visual_challenge_code INTEGER,
      arkiv_entity_key TEXT, evidence_hash TEXT, selection_block TEXT, review_round INTEGER NOT NULL DEFAULT 0,
      rework_count INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE pledges (id INTEGER PRIMARY KEY AUTOINCREMENT, bounty_id TEXT NOT NULL, pledger TEXT NOT NULL, amount TEXT NOT NULL,
      new_total TEXT NOT NULL, block_number TEXT, tx_hash TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(bounty_id, pledger, tx_hash));
    CREATE TABLE events_cursor (chain_id INTEGER PRIMARY KEY, last_block TEXT NOT NULL DEFAULT '0', updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    INSERT INTO nullifiers (nullifier_hash, action, wallet) VALUES ('0xaa', 'claim-bounty', '0x1111');
    INSERT INTO nonces (wallet, nonce, role, expiry) VALUES ('0x1111', '7', 1, 99);
    INSERT INTO bounties (bounty_id, creator, description_hash, lat_e5, lng_e5, region_cell, created_at, claim_deadline)
      VALUES ('1', '0x2222', '0xbb', 1, 2, 3, 4, 5);
    INSERT INTO pledges (bounty_id, pledger, amount, new_total) VALUES ('1', '0x2222', '5', '5');
    INSERT INTO events_cursor (chain_id, last_block) VALUES (5042002, '1234');
  `);
  return db;
}

const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("schema v2 migration", () => {
  it("upgrades a v1 database: v2 columns/tables exist, derived rows are cleared, nullifiers and nonces survive", () => {
    const db = v1Database();
    initSchema(db);

    for (const col of ["report_hash", "validation_deadline", "work_deadline", "confirmations", "disputes"]) {
      assert.ok(columns(db, "bounties").includes(col), `bounties.${col}`);
    }
    for (const table of [...DERIVED_TABLES, "meta"]) assert.ok(columns(db, table).length > 0, table);
    assert.deepEqual(columns(db, "problem_votes"), ["id", "bounty_id", "voter", "is_real", "block_number", "tx_hash", "created_at"]);
    assert.ok(columns(db, "reports").includes("photo"));

    assert.equal(count(db, "bounties"), 0);
    assert.equal(count(db, "pledges"), 0);
    assert.equal(count(db, "events_cursor"), 0, "cursor must restart so the indexer re-syncs");
    assert.equal(count(db, "nullifiers"), 1);
    assert.equal(count(db, "nonces"), 1);
    assert.equal((db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value, String(SCHEMA_VERSION));
  });

  it("is idempotent once at the current version", () => {
    const db = v1Database();
    initSchema(db);
    db.prepare("INSERT INTO events_cursor (chain_id, last_block) VALUES (1, '9')").run();
    initSchema(db);
    assert.equal(count(db, "events_cursor"), 1);
  });

  it("clears derived tables when the chain or escrow changes, keeping nullifiers and nonces", () => {
    const db = v1Database();
    initSchema(db);
    assert.equal(ensureDeploymentScope(db, 5042002, ESCROW_A), true, "first binding");

    const seed = () => {
      db.prepare(`INSERT INTO bounties (bounty_id, creator, description_hash, lat_e5, lng_e5, region_cell, created_at, claim_deadline)
        VALUES ('9', '0x1', '0x2', 1, 2, 3, 4, 5)`).run();
      db.prepare("INSERT INTO problem_votes (bounty_id, voter, is_real) VALUES ('9', '0x3', 1)").run();
      db.prepare("INSERT INTO reports (bounty_id, entity_key, report_hash, creator, description, lat_e5, lng_e5, captured_at_ms, photo) VALUES ('9','0xk','0xh','0xc','d',1,2,3,x'00')").run();
      db.prepare("INSERT INTO events_cursor (chain_id, last_block) VALUES (5042002, '77')").run();
    };
    seed();

    assert.equal(ensureDeploymentScope(db, 5042002, ESCROW_A.toLowerCase()), false, "same scope (case-insensitive) keeps data");
    for (const t of ["bounties", "problem_votes", "reports", "events_cursor"]) assert.equal(count(db, t), 1, t);

    assert.equal(ensureDeploymentScope(db, 5042002, ESCROW_B), true, "escrow changed");
    for (const t of DERIVED_TABLES) assert.equal(count(db, t), 0, t);
    assert.equal(count(db, "nullifiers"), 1);
    assert.equal(count(db, "nonces"), 1);

    seed();
    assert.equal(ensureDeploymentScope(db, 31337, ESCROW_B), true, "chain changed");
    for (const t of DERIVED_TABLES) assert.equal(count(db, t), 0, t);
    assert.equal(count(db, "nullifiers"), 1);
    assert.equal(count(db, "nonces"), 1);
  });

  it("enforces one problem vote per wallet per bounty", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    db.prepare("INSERT INTO problem_votes (bounty_id, voter, is_real) VALUES ('1', '0xa', 1)").run();
    assert.throws(() => db.prepare("INSERT INTO problem_votes (bounty_id, voter, is_real) VALUES ('1', '0xa', 0)").run());
  });
});
