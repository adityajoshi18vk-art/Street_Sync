/**
 * db.ts
 * SQLite schema and data-access layer for StreetSync backend.
 *
 * Tables:
 *   nullifiers      – World ID one-human-per-action enforcement
 *   nonces          – Issued EIP-712 attestation nonces (single-use)
 *   meta            – Schema version and deployment scope (chain + escrow)
 *   bounties        – Canonical on-chain bounty state cache
 *   pledges         – Per-bounty pledger amounts
 *   panel_assignments – Reviewer panel selections per bounty×round
 *   vote_commits    – Commit hashes and revealed votes
 *   reviewer_slashes – Slash records
 *   problem_votes   – Neighbour validation votes
 *   reports         – Verified problem-report bundles
 *   events_cursor   – Indexer block cursor for resumable polling
 * See schema.ts for DDL and the v1→v2 migration.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { ensureDeploymentScope as ensureScope, initSchema } from "./schema.js";

const DB_PATH =
  process.env.DB_PATH ??
  (process.env.NODE_ENV === "test" || process.argv.includes("--test") || process.execArgv.includes("--test")
    ? "data/test.db"
    : "data/streetsync.db");

// Ensure parent directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
// Test files and the server may open the same file concurrently.
db.exec("PRAGMA busy_timeout = 5000;");

// ═══════════════════════════════════════════════════════════════════════════════
//  Schema
// ═══════════════════════════════════════════════════════════════════════════════

initSchema(db);

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

const findVerifiedWallet = db.prepare(`
  SELECT * FROM nullifiers WHERE action = ? AND wallet = ? LIMIT 1
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

const BOUNTY_SELECT = `
  SELECT b.*, r.description AS description,
         CASE WHEN r.bounty_id IS NULL THEN 0 ELSE 1 END AS has_report
  FROM bounties b LEFT JOIN reports r ON r.bounty_id = b.bounty_id
`;

const getBountyById = db.prepare(`${BOUNTY_SELECT} WHERE b.bounty_id = ?`);

const listBounties = db.prepare(`${BOUNTY_SELECT} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`);

const listBountiesByStatus = db.prepare(`${BOUNTY_SELECT} WHERE b.status = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`);

const listBountiesInBBox = db.prepare(`
  ${BOUNTY_SELECT}
  WHERE b.lat_e5 >= ? AND b.lat_e5 <= ? AND b.lng_e5 >= ? AND b.lng_e5 <= ?
  ORDER BY b.created_at DESC LIMIT ? OFFSET ?
`);

const listBountiesByWorker = db.prepare(`${BOUNTY_SELECT} WHERE b.worker = ? ORDER BY b.created_at DESC`);

const upsertBountyRow = db.prepare(`
  INSERT INTO bounties (
    bounty_id, creator, description_hash, report_hash, lat_e5, lng_e5, region_cell,
    total_pledged, created_at, validation_deadline, claim_deadline, work_deadline,
    worker, visual_challenge_code, arkiv_entity_key, evidence_hash, selection_block,
    review_round, rework_count, confirmations, disputes, status, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(bounty_id) DO UPDATE SET
    creator = excluded.creator,
    description_hash = excluded.description_hash,
    report_hash = excluded.report_hash,
    lat_e5 = excluded.lat_e5,
    lng_e5 = excluded.lng_e5,
    region_cell = excluded.region_cell,
    total_pledged = excluded.total_pledged,
    created_at = excluded.created_at,
    validation_deadline = excluded.validation_deadline,
    claim_deadline = excluded.claim_deadline,
    work_deadline = excluded.work_deadline,
    worker = excluded.worker,
    visual_challenge_code = excluded.visual_challenge_code,
    arkiv_entity_key = excluded.arkiv_entity_key,
    evidence_hash = excluded.evidence_hash,
    selection_block = excluded.selection_block,
    review_round = excluded.review_round,
    rework_count = excluded.rework_count,
    confirmations = excluded.confirmations,
    disputes = excluded.disputes,
    status = excluded.status,
    updated_at = unixepoch()
`);

// ─── Reports ─────────────────────────────────────────────────────────────────

const upsertReport = db.prepare(`
  INSERT OR REPLACE INTO reports (
    bounty_id, entity_key, report_hash, creator, description, lat_e5, lng_e5, captured_at_ms, photo
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getReportById = db.prepare(`SELECT * FROM reports WHERE bounty_id = ?`);

// ─── Problem votes ───────────────────────────────────────────────────────────

const insertProblemVote = db.prepare(`
  INSERT OR IGNORE INTO problem_votes (bounty_id, voter, is_real, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?)
`);

const getProblemVotesByBounty = db.prepare(`
  SELECT * FROM problem_votes WHERE bounty_id = ? ORDER BY id ASC
`);

// ─── Pledges ─────────────────────────────────────────────────────────────────

const insertPledge = db.prepare(`
  INSERT OR IGNORE INTO pledges (bounty_id, pledger, amount, new_total, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const markPledgeWithdrawn = db.prepare(`
  UPDATE pledges SET withdrawn = 1 WHERE bounty_id = ? AND pledger = ?
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
    AND review_round = COALESCE(?, (SELECT MAX(review_round) FROM vote_commits WHERE bounty_id = ?))
`);

const getVotesByBounty = db.prepare(`
  SELECT * FROM vote_commits WHERE bounty_id = ? ORDER BY reviewer ASC
`);

// ─── Slashes ─────────────────────────────────────────────────────────────────

const insertSlash = db.prepare(`
  INSERT OR IGNORE INTO reviewer_slashes (bounty_id, reviewer, amount, block_number, tx_hash)
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

/** Canonical bounty row, mapped from getBounty (see chain.ts). */
export interface BountyRow {
  bounty_id: string;
  creator: string;
  description_hash: string;
  report_hash: string | null;
  lat_e5: number;
  lng_e5: number;
  region_cell: number;
  total_pledged: string;
  created_at: number;
  validation_deadline: number;
  claim_deadline: number;
  work_deadline: number;
  worker: string | null;
  visual_challenge_code: number | null;
  arkiv_entity_key: string | null;
  evidence_hash: string | null;
  selection_block: string | null;
  review_round: number;
  rework_count: number;
  confirmations: number;
  disputes: number;
  status: number;
}

export interface StoredReport {
  bounty_id: string;
  entity_key: string;
  report_hash: string;
  creator: string;
  description: string;
  lat_e5: number;
  lng_e5: number;
  captured_at_ms: number;
  photo: Uint8Array;
}

export const dbAccess = {
  raw: db,

  // ─── Nullifiers ───
  checkNullifier(nullifierHash: string, action: string) {
    return findNullifier.get(nullifierHash, action) as
      | { nullifier_hash: string; action: string; wallet: string }
      | undefined;
  },
  /** A wallet that already proved uniqueness for this action (World ID 4.0 nullifiers are per human + action). */
  findVerifiedWallet(action: string, wallet: string) {
    return findVerifiedWallet.get(action, wallet.toLowerCase()) as
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
  upsertBountyRow(row: BountyRow) {
    return upsertBountyRow.run(
      row.bounty_id, row.creator, row.description_hash, row.report_hash,
      row.lat_e5, row.lng_e5, row.region_cell, row.total_pledged, row.created_at,
      row.validation_deadline, row.claim_deadline, row.work_deadline,
      row.worker, row.visual_challenge_code, row.arkiv_entity_key, row.evidence_hash,
      row.selection_block, row.review_round, row.rework_count, row.confirmations,
      row.disputes, row.status,
    );
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
  markPledgeWithdrawn(bountyId: string, pledger: string) {
    return markPledgeWithdrawn.run(bountyId, pledger);
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
    blockNumber: string, txHash: string, round: number | null = null,
  ) {
    return updateVoteReveal.run(approve ? 1 : 0, blockNumber, txHash, bountyId, reviewer, round, bountyId);
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

  // ─── Problem votes ───
  insertProblemVote(
    bountyId: string, voter: string, isReal: boolean, blockNumber: string, txHash: string,
  ) {
    return insertProblemVote.run(bountyId, voter, isReal ? 1 : 0, blockNumber, txHash);
  },
  getProblemVotes(bountyId: string) {
    return getProblemVotesByBounty.all(bountyId) as Record<string, unknown>[];
  },

  // ─── Reports ───
  upsertReport(r: StoredReport) {
    return upsertReport.run(
      r.bounty_id, r.entity_key, r.report_hash, r.creator, r.description,
      r.lat_e5, r.lng_e5, r.captured_at_ms, r.photo,
    );
  },
  getReport(bountyId: string): StoredReport | undefined {
    return getReportById.get(bountyId) as StoredReport | undefined;
  },

  // ─── Deployment scope ───
  /** Rebuilds derived tables when the chain/escrow (or schema) changed; keeps nullifiers and nonces. */
  ensureDeploymentScope(chainId: number, escrowAddress: string): boolean {
    return ensureScope(db, chainId, escrowAddress);
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

  // ─── Events Cursor ───
  getCursor(chainId: number): bigint {
    const row = getCursor.get(chainId) as { last_block: string } | undefined;
    return BigInt(row?.last_block ?? "0");
  },
  setCursor(chainId: number, blockNumber: bigint) {
    return upsertCursor.run(chainId, blockNumber.toString());
  },
};

export const ensureDeploymentScope = dbAccess.ensureDeploymentScope;

export type DbAccess = typeof dbAccess;
export default dbAccess;

