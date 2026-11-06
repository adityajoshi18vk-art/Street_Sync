/**
 * db.ts
 * SQLite schema and data-access layer for StreetSync backend.
 *
 * Tables:
 *   nullifiers      – World ID one-human-per-action enforcement
 *   nonces          – Issued EIP-712 attestation nonces (single-use)
 *   bounties        – Indexed on-chain bounty state cache
 *   pledges         – Per-bounty pledger amounts
 *   panel_assignments – Reviewer panel selections per bounty×round
 *   vote_commits    – Commit hashes and revealed votes
 *   reviewer_slashes – Slash records
 *   events_cursor   – Indexer block cursor for resumable polling
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.DB_PATH ?? "data/streetsync.db";

// Ensure parent directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Give concurrent/restarting processes time to release locks
db.exec("PRAGMA busy_timeout = 5000;");

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ═══════════════════════════════════════════════════════════════════════════════
//  Schema
// ═══════════════════════════════════════════════════════════════════════════════

db.exec(`
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

  -- Bounty cache (indexed from on-chain events)
  CREATE TABLE IF NOT EXISTS bounties (
    bounty_id           TEXT    PRIMARY KEY,
    creator             TEXT    NOT NULL,
    description_hash    TEXT    NOT NULL,
    lat_e5              INTEGER NOT NULL,
    lng_e5              INTEGER NOT NULL,
    region_cell         INTEGER NOT NULL,
    total_pledged       TEXT    NOT NULL DEFAULT '0',
    created_at          INTEGER NOT NULL,
    claim_deadline      INTEGER NOT NULL,
    worker              TEXT,
    visual_challenge_code INTEGER,
    arkiv_entity_key    TEXT,
    evidence_hash       TEXT,
    selection_block     TEXT,
    review_round        INTEGER NOT NULL DEFAULT 0,
    rework_count        INTEGER NOT NULL DEFAULT 0,
    status              INTEGER NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Pledge records
  CREATE TABLE IF NOT EXISTS pledges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id   TEXT    NOT NULL,
    pledger     TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    new_total   TEXT    NOT NULL,
    block_number TEXT,
    tx_hash     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, pledger, tx_hash)
  );

  -- Panel assignments per bounty×round
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

  -- Vote commits and reveals
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

  -- Reviewer slashes
  CREATE TABLE IF NOT EXISTS reviewer_slashes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id   TEXT    NOT NULL,
    reviewer    TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    block_number TEXT,
    tx_hash     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Settle records
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

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
  CREATE INDEX IF NOT EXISTS idx_bounties_region ON bounties(region_cell);
  CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator);
  CREATE INDEX IF NOT EXISTS idx_bounties_worker ON bounties(worker);
  CREATE INDEX IF NOT EXISTS idx_pledges_bounty ON pledges(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_panel_bounty ON panel_assignments(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_votes_bounty ON vote_commits(bounty_id);
  CREATE INDEX IF NOT EXISTS idx_nullifiers_hash ON nullifiers(nullifier_hash);
  CREATE INDEX IF NOT EXISTS idx_stickers_wallet ON stickers(wallet);
`);

// ═══════════════════════════════════════════════════════════════════════════════
//  Prepared Statements
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Nullifiers ──────────────────────────────────────────────────────────────

const insertNullifier = db.prepare(`
  INSERT INTO nullifiers (nullifier_hash, action, wallet) VALUES (?, ?, ?)
`);

const findNullifier = db.prepare(`
  SELECT * FROM nullifiers WHERE nullifier_hash = ? AND action = ?
`);

const findNullifierByWallet = db.prepare(`
  SELECT * FROM nullifiers WHERE nullifier_hash = ? AND action = ? AND wallet != ?
`);

// ─── Nonces ──────────────────────────────────────────────────────────────────

const insertNonce = db.prepare(`
  INSERT INTO nonces (wallet, nonce, role, bounty_id, expiry) VALUES (?, ?, ?, ?, ?)
`);

const getMaxNonce = db.prepare(`
  SELECT MAX(CAST(nonce AS INTEGER)) as max_nonce FROM nonces WHERE wallet = ?
`);

// ─── Bounties ────────────────────────────────────────────────────────────────

const upsertBounty = db.prepare(`
  INSERT INTO bounties (
    bounty_id, creator, description_hash, lat_e5, lng_e5, region_cell,
    total_pledged, created_at, claim_deadline, status, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch())
  ON CONFLICT(bounty_id) DO UPDATE SET
    total_pledged = excluded.total_pledged,
    updated_at = unixepoch()
`);

const updateBountyClaimed = db.prepare(`
  UPDATE bounties SET worker = ?, visual_challenge_code = ?, status = 1, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountyEvidence = db.prepare(`
  UPDATE bounties SET arkiv_entity_key = ?, evidence_hash = ?, selection_block = ?, status = 2, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountyInReview = db.prepare(`
  UPDATE bounties SET status = 3, review_round = ?, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountySettled = db.prepare(`
  UPDATE bounties SET status = ?, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountyPledge = db.prepare(`
  UPDATE bounties SET total_pledged = ?, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountyPoke = db.prepare(`
  UPDATE bounties SET status = 2, review_round = ?, selection_block = ?, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const updateBountyRework = db.prepare(`
  UPDATE bounties SET status = 1, review_round = ?, rework_count = ?, updated_at = unixepoch()
  WHERE bounty_id = ?
`);

const getBountyById = db.prepare(`
  SELECT * FROM bounties WHERE bounty_id = ?
`);

const listBounties = db.prepare(`
  SELECT * FROM bounties ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const listBountiesByStatus = db.prepare(`
  SELECT * FROM bounties WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const listBountiesInBBox = db.prepare(`
  SELECT * FROM bounties
  WHERE lat_e5 >= ? AND lat_e5 <= ? AND lng_e5 >= ? AND lng_e5 <= ?
  ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const listBountiesByWorker = db.prepare(`
  SELECT * FROM bounties WHERE worker = ? ORDER BY created_at DESC
`);

// ─── Pledges ─────────────────────────────────────────────────────────────────

const insertPledge = db.prepare(`
  INSERT OR IGNORE INTO pledges (bounty_id, pledger, amount, new_total, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getPledgesByBounty = db.prepare(`
  SELECT * FROM pledges WHERE bounty_id = ? ORDER BY created_at ASC
`);

// ─── Panel Assignments ──────────────────────────────────────────────────────

const insertPanel = db.prepare(`
  INSERT OR REPLACE INTO panel_assignments (bounty_id, review_round, reviewer_0, reviewer_1, reviewer_2, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getPanelByBounty = db.prepare(`
  SELECT * FROM panel_assignments WHERE bounty_id = ? ORDER BY review_round DESC LIMIT 1
`);

const getAssignmentsByReviewer = db.prepare(`
  SELECT pa.*, b.status as bounty_status, b.total_pledged, b.worker, b.creator
  FROM panel_assignments pa
  JOIN bounties b ON pa.bounty_id = b.bounty_id
  WHERE pa.reviewer_0 = ? OR pa.reviewer_1 = ? OR pa.reviewer_2 = ?
  ORDER BY pa.created_at DESC
`);

// ─── Vote Commits ────────────────────────────────────────────────────────────

const insertVoteCommit = db.prepare(`
  INSERT OR REPLACE INTO vote_commits (bounty_id, review_round, reviewer, commit_hash, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateVoteReveal = db.prepare(`
  UPDATE vote_commits SET revealed = 1, approve = ?, block_number = ?, tx_hash = ?
  WHERE bounty_id = ? AND reviewer = ?
`);

const getVotesByBounty = db.prepare(`
  SELECT * FROM vote_commits WHERE bounty_id = ? ORDER BY reviewer ASC
`);

// ─── Slashes ─────────────────────────────────────────────────────────────────

const insertSlash = db.prepare(`
  INSERT INTO reviewer_slashes (bounty_id, reviewer, amount, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?)
`);

// ─── Settlements ─────────────────────────────────────────────────────────────

const insertSettlement = db.prepare(`
  INSERT OR REPLACE INTO settlements (bounty_id, approved, worker_payout, reviewer_cut, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getSettlementByBounty = db.prepare(`
  SELECT * FROM settlements WHERE bounty_id = ?
`);

// ─── Stickers & wallet activity stats ────────────────────────────────────────

const insertSticker = db.prepare(`
  INSERT OR IGNORE INTO stickers (wallet, sticker_id) VALUES (?, ?)
`);

const getStickersByWallet = db.prepare(`
  SELECT sticker_id, awarded_at FROM stickers WHERE wallet = ? ORDER BY awarded_at ASC
`);

const countBountiesCreated = db.prepare(`
  SELECT COUNT(*) AS c FROM bounties WHERE creator = ?
`);

const pledgeStatsByWallet = db.prepare(`
  SELECT COUNT(DISTINCT bounty_id) AS bounties,
         COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total
  FROM pledges WHERE pledger = ?
`);

const workerStatsByWallet = db.prepare(`
  SELECT COUNT(*) AS claimed,
         SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN evidence_hash IS NOT NULL THEN 1 ELSE 0 END) AS evidence
  FROM bounties WHERE worker = ?
`);

const countRevealsByReviewer = db.prepare(`
  SELECT COUNT(*) AS c FROM vote_commits WHERE reviewer = ? AND revealed = 1
`);

const countSlashesByReviewer = db.prepare(`
  SELECT COUNT(*) AS c FROM reviewer_slashes WHERE reviewer = ?
`);

// ─── Events Cursor ───────────────────────────────────────────────────────────

const getCursor = db.prepare(`
  SELECT last_block FROM events_cursor WHERE chain_id = ?
`);

const upsertCursor = db.prepare(`
  INSERT INTO events_cursor (chain_id, last_block, updated_at)
  VALUES (?, ?, unixepoch())
  ON CONFLICT(chain_id) DO UPDATE SET
    last_block = excluded.last_block,
    updated_at = unixepoch()
`);

// ═══════════════════════════════════════════════════════════════════════════════
//  Exported Data-Access Object
// ═══════════════════════════════════════════════════════════════════════════════

export const dbAccess = {
  raw: db,

  // ─── Nullifiers ───
  checkNullifier(nullifierHash: string, action: string) {
    return findNullifier.get(nullifierHash, action) as
      | { nullifier_hash: string; action: string; wallet: string }
      | undefined;
  },
  checkNullifierOtherWallet(nullifierHash: string, action: string, wallet: string) {
    return findNullifierByWallet.get(nullifierHash, action, wallet) as
      | { nullifier_hash: string; action: string; wallet: string }
      | undefined;
  },
  insertNullifier(nullifierHash: string, action: string, wallet: string) {
    return insertNullifier.run(nullifierHash, action, wallet);
  },

  // ─── Nonces ───
  nextNonce(wallet: string): bigint {
    const row = getMaxNonce.get(wallet) as { max_nonce: number | null } | undefined;
    return BigInt((row?.max_nonce ?? 0) + 1);
  },
  recordNonce(wallet: string, nonce: bigint, role: number, bountyId: string, expiry: number) {
    return insertNonce.run(wallet, nonce.toString(), role, bountyId, expiry);
  },

  // ─── Bounties ───
  upsertBounty(
    bountyId: string, creator: string, descHash: string,
    latE5: number, lngE5: number, regionCell: number,
    totalPledged: string, createdAt: number, claimDeadline: number,
  ) {
    return upsertBounty.run(
      bountyId, creator, descHash, latE5, lngE5, regionCell,
      totalPledged, createdAt, claimDeadline,
    );
  },
  updateBountyClaimed(bountyId: string, worker: string, code: number) {
    return updateBountyClaimed.run(worker, code, bountyId);
  },
  updateBountyEvidence(bountyId: string, arkivKey: string, evHash: string, selBlock: string) {
    return updateBountyEvidence.run(arkivKey, evHash, selBlock, bountyId);
  },
  updateBountyInReview(bountyId: string, reviewRound: number) {
    return updateBountyInReview.run(reviewRound, bountyId);
  },
  updateBountySettled(bountyId: string, status: number) {
    return updateBountySettled.run(status, bountyId);
  },
  updateBountyPledge(bountyId: string, newTotal: string) {
    return updateBountyPledge.run(newTotal, bountyId);
  },
  updateBountyPoke(bountyId: string, newRound: number, selBlock: string) {
    return updateBountyPoke.run(newRound, selBlock, bountyId);
  },
  updateBountyRework(bountyId: string, reviewRound: number, reworkCount: number) {
    return updateBountyRework.run(reviewRound, reworkCount, bountyId);
  },
  getBounty(bountyId: string) {
    return getBountyById.get(bountyId) as Record<string, unknown> | undefined;
  },
  listBounties(limit = 50, offset = 0) {
    return listBounties.all(limit, offset) as Record<string, unknown>[];
  },
  listBountiesByStatus(status: number, limit = 50, offset = 0) {
    return listBountiesByStatus.all(status, limit, offset) as Record<string, unknown>[];
  },
  listBountiesInBBox(
    minLat: number, maxLat: number, minLng: number, maxLng: number,
    limit = 50, offset = 0,
  ) {
    return listBountiesInBBox.all(minLat, maxLat, minLng, maxLng, limit, offset) as Record<string, unknown>[];
  },
  listBountiesByWorker(worker: string) {
    return listBountiesByWorker.all(worker) as Record<string, unknown>[];
  },

  // ─── Pledges ───
  insertPledge(
    bountyId: string, pledger: string, amount: string, newTotal: string,
    blockNumber: string, txHash: string,
  ) {
    return insertPledge.run(bountyId, pledger, amount, newTotal, blockNumber, txHash);
  },
  getPledges(bountyId: string) {
    return getPledgesByBounty.all(bountyId) as Record<string, unknown>[];
  },

  // ─── Panel Assignments ───
  insertPanel(
    bountyId: string, round: number,
    r0: string, r1: string, r2: string,
    blockNumber: string, txHash: string,
  ) {
    return insertPanel.run(bountyId, round, r0, r1, r2, blockNumber, txHash);
  },
  getPanel(bountyId: string) {
    return getPanelByBounty.get(bountyId) as Record<string, unknown> | undefined;
  },
  getAssignmentsByReviewer(reviewer: string) {
    return getAssignmentsByReviewer.all(reviewer, reviewer, reviewer) as Record<string, unknown>[];
  },

  // ─── Votes ───
  insertVoteCommit(
    bountyId: string, round: number, reviewer: string, commitHash: string,
    blockNumber: string, txHash: string,
  ) {
    return insertVoteCommit.run(bountyId, round, reviewer, commitHash, blockNumber, txHash);
  },
  updateVoteReveal(
    bountyId: string, reviewer: string, approve: boolean,
    blockNumber: string, txHash: string,
  ) {
    return updateVoteReveal.run(approve ? 1 : 0, blockNumber, txHash, bountyId, reviewer);
  },
  getVotes(bountyId: string) {
    return getVotesByBounty.all(bountyId) as Record<string, unknown>[];
  },

  // ─── Slashes ───
  insertSlash(
    bountyId: string, reviewer: string, amount: string,
    blockNumber: string, txHash: string,
  ) {
    return insertSlash.run(bountyId, reviewer, amount, blockNumber, txHash);
  },

  // ─── Settlements ───
  insertSettlement(
    bountyId: string, approved: boolean, workerPayout: string, reviewerCut: string,
    blockNumber: string, txHash: string,
  ) {
    return insertSettlement.run(bountyId, approved ? 1 : 0, workerPayout, reviewerCut, blockNumber, txHash);
  },
  getSettlement(bountyId: string) {
    return getSettlementByBounty.get(bountyId) as Record<string, unknown> | undefined;
  },

  // ─── Stickers & wallet activity stats ───
  awardSticker(wallet: string, stickerId: string) {
    return insertSticker.run(wallet, stickerId);
  },
  getEarnedStickers(wallet: string) {
    return getStickersByWallet.all(wallet) as { sticker_id: string; awarded_at: number }[];
  },
  getWalletStats(wallet: string) {
    const created = countBountiesCreated.get(wallet) as { c: number };
    const pledges = pledgeStatsByWallet.get(wallet) as { bounties: number; total: number };
    const work = workerStatsByWallet.get(wallet) as {
      claimed: number; approved: number | null; evidence: number | null;
    };
    const reveals = countRevealsByReviewer.get(wallet) as { c: number };
    const slashes = countSlashesByReviewer.get(wallet) as { c: number };
    return {
      bountiesCreated: created.c,
      pledgedBounties: pledges.bounties,
      pledgedTotal: String(pledges.total),
      bountiesClaimed: work.claimed,
      approvedFixes: work.approved ?? 0,
      evidenceSubmitted: work.evidence ?? 0,
      votesRevealed: reveals.c,
      slashes: slashes.c,
    };
  },

  // ─── Events Cursor ───
  getCursor(chainId: number): bigint {
    const row = getCursor.get(chainId) as { last_block: string } | undefined;
    return BigInt(row?.last_block ?? "0");
  },
  setCursor(chainId: number, blockNumber: bigint) {
    return upsertCursor.run(chainId, blockNumber.toString());
  },
};

export type DbAccess = typeof dbAccess;
export default dbAccess;

