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
//  JanLekha schema (Arc Testnet registries, indexed from on-chain events)
//  This SQLite copy is a convenience cache only. The chain is the source of
//  truth; every row here can be rebuilt from Arc Testnet event logs, and
//  docs/VERIFICATION.md shows how a citizen checks each record without
//  trusting this database. Amounts: INR figures are whole rupees for
//  reporting; USDC settlement figures are ERC-20 base units (6 decimals,
//  1 USDC = 1,000,000). Never mix the two, and never convert either with
//  18 decimals. Project status: 0 Registered, 1 Active, 2 Delayed,
//  3 Completed, 4 Cancelled. Milestone status: 0 Submitted, 1 Verified,
//  2 Paid, 3 Rejected. The contracts are append only: a correction is a
//  new event (FlagResolved, ProjectStatusUpdated, MilestoneRejected), the
//  original row is never rewritten, so history stays auditable.
// ═══════════════════════════════════════════════════════════════════════════════

db.exec(`
  -- JanLekha projects (ProjectRegistry.ProjectRegistered)
  CREATE TABLE IF NOT EXISTS janlekha_projects (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL DEFAULT '',
    department_id   TEXT    NOT NULL DEFAULT '',
    contractor      TEXT    NOT NULL DEFAULT '',
    budget_inr      TEXT    NOT NULL DEFAULT '0',
    status          INTEGER NOT NULL DEFAULT 0,
    registered_at   INTEGER NOT NULL DEFAULT 0,
    block_number    TEXT,
    tx_hash         TEXT,
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha budget allocations (BudgetRegistry.AllocationApproved/Released)
  CREATE TABLE IF NOT EXISTS janlekha_allocations (
    id                      TEXT    PRIMARY KEY,
    department_id           TEXT    NOT NULL DEFAULT '',
    project_id              TEXT    NOT NULL DEFAULT '',
    amount_inr              TEXT    NOT NULL DEFAULT '0',
    amount_usdc_base_units  TEXT    NOT NULL DEFAULT '0',
    approved_by             TEXT    NOT NULL DEFAULT '',
    approved_at             INTEGER NOT NULL DEFAULT 0,
    released                INTEGER NOT NULL DEFAULT 0,
    released_by             TEXT,
    block_number            TEXT,
    tx_hash                 TEXT,
    created_at              INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha milestones (MilestoneRegistry events)
  CREATE TABLE IF NOT EXISTS janlekha_milestones (
    id                      TEXT    PRIMARY KEY,
    project_id              TEXT    NOT NULL DEFAULT '',
    submitter               TEXT    NOT NULL DEFAULT '',
    amount_inr              TEXT    NOT NULL DEFAULT '0',
    amount_usdc_base_units  TEXT    NOT NULL DEFAULT '0',
    evidence_hash           TEXT    NOT NULL DEFAULT '',
    status                  INTEGER NOT NULL DEFAULT 0,
    verified_by             TEXT,
    submitted_at            INTEGER NOT NULL DEFAULT 0,
    verified_at             INTEGER,
    block_number            TEXT,
    tx_hash                 TEXT,
    updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha payments (PaymentRegistry.PaymentRecorded)
  CREATE TABLE IF NOT EXISTS janlekha_payments (
    id                      TEXT    PRIMARY KEY,
    project_id              TEXT    NOT NULL DEFAULT '',
    milestone_id            TEXT    NOT NULL DEFAULT '',
    payee                   TEXT    NOT NULL DEFAULT '',
    amount_usdc_base_units  TEXT    NOT NULL DEFAULT '0',
    invoice_hash            TEXT    NOT NULL DEFAULT '',
    recorded_by             TEXT    NOT NULL DEFAULT '',
    recorded_at             INTEGER NOT NULL DEFAULT 0,
    block_number            TEXT,
    tx_hash                 TEXT,
    created_at              INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha documents (DocumentRegistry events; content_hash is the raw
  -- SHA-256 of the file bytes, stored as a 32-byte hex string)
  CREATE TABLE IF NOT EXISTS janlekha_documents (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL DEFAULT '',
    content_hash    TEXT    NOT NULL DEFAULT '',
    doc_type        TEXT    NOT NULL DEFAULT '',
    uploaded_by     TEXT    NOT NULL DEFAULT '',
    uploaded_at     INTEGER NOT NULL DEFAULT 0,
    verified        INTEGER NOT NULL DEFAULT 0,
    verified_by     TEXT,
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha audit flags (AuditRegistry.FlagRaised/FlagResolved)
  CREATE TABLE IF NOT EXISTS janlekha_flags (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL DEFAULT '',
    reason          TEXT    NOT NULL DEFAULT '',
    risk            INTEGER NOT NULL DEFAULT 0,
    resolved        INTEGER NOT NULL DEFAULT 0,
    raised_by       TEXT    NOT NULL DEFAULT '',
    resolved_by     TEXT,
    raised_at       INTEGER NOT NULL DEFAULT 0,
    resolved_at     INTEGER,
    resolution_note TEXT    NOT NULL DEFAULT '',
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha audit reports (AuditRegistry.ReportPublished)
  CREATE TABLE IF NOT EXISTS janlekha_reports (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL DEFAULT '',
    title           TEXT    NOT NULL DEFAULT '',
    findings        INTEGER NOT NULL DEFAULT 0,
    published_at    INTEGER NOT NULL DEFAULT 0,
    auditor         TEXT    NOT NULL DEFAULT '',
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- JanLekha tenders and bids (ProcurementRegistry events)
  CREATE TABLE IF NOT EXISTS janlekha_tenders (
    id                  TEXT    PRIMARY KEY,
    project_id          TEXT    NOT NULL DEFAULT '',
    title               TEXT    NOT NULL DEFAULT '',
    value_inr           TEXT    NOT NULL DEFAULT '0',
    deadline            INTEGER NOT NULL DEFAULT 0,
    open                INTEGER NOT NULL DEFAULT 1,
    awarded_to          TEXT,
    awarded_amount_inr  TEXT,
    published_at        INTEGER NOT NULL DEFAULT 0,
    block_number        TEXT,
    tx_hash             TEXT,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS janlekha_bids (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tender_id       TEXT    NOT NULL,
    contractor      TEXT    NOT NULL,
    amount_inr      TEXT    NOT NULL DEFAULT '0',
    submitted_at    INTEGER NOT NULL DEFAULT 0,
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(tender_id, contractor)
  );

  -- JanLekha role grants (RoleRegistry.RoleGranted/RoleRevoked)
  CREATE TABLE IF NOT EXISTS janlekha_role_grants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    role            TEXT    NOT NULL,
    account         TEXT    NOT NULL,
    granted_by      TEXT    NOT NULL DEFAULT '',
    granted_at      INTEGER NOT NULL DEFAULT 0,
    revoked         INTEGER NOT NULL DEFAULT 0,
    revoked_by      TEXT,
    block_number    TEXT,
    tx_hash         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(role, account)
  );

  -- JanLekha raw event log: one row per decoded on-chain event, in chain
  -- order. This is the audit timeline backing store; record rows above
  -- are projections of these events.
  CREATE TABLE IF NOT EXISTS janlekha_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    registry        TEXT    NOT NULL,
    event_name      TEXT    NOT NULL,
    record_id       TEXT    NOT NULL DEFAULT '',
    project_id      TEXT    NOT NULL DEFAULT '',
    block_number    TEXT    NOT NULL DEFAULT '0',
    log_index       INTEGER NOT NULL DEFAULT 0,
    tx_hash         TEXT    NOT NULL DEFAULT '',
    raw_json        TEXT    NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(registry, tx_hash, log_index)
  );

  -- JanLekha citizen participation: one row per World ID verified human
  -- per action per reference (project or milestone). The World ID
  -- nullifier itself lives in the shared nullifiers table scoped by the
  -- same action string; this table only records that participation
  -- happened, never any personal identity.
  CREATE TABLE IF NOT EXISTS janlekha_citizen_participation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    action          TEXT    NOT NULL,
    wallet          TEXT    NOT NULL,
    ref_id          TEXT    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(action, wallet, ref_id)
  );

  -- JanLekha indexer cursor: last processed block per registry contract
  CREATE TABLE IF NOT EXISTS janlekha_cursor (
    registry        TEXT    PRIMARY KEY,
    last_block      TEXT    NOT NULL DEFAULT '0',
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_jl_projects_dept ON janlekha_projects(department_id);
  CREATE INDEX IF NOT EXISTS idx_jl_projects_status ON janlekha_projects(status);
  CREATE INDEX IF NOT EXISTS idx_jl_alloc_project ON janlekha_allocations(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_alloc_dept ON janlekha_allocations(department_id);
  CREATE INDEX IF NOT EXISTS idx_jl_mile_project ON janlekha_milestones(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_pay_project ON janlekha_payments(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_pay_payee ON janlekha_payments(payee);
  CREATE INDEX IF NOT EXISTS idx_jl_pay_invoice ON janlekha_payments(invoice_hash);
  CREATE INDEX IF NOT EXISTS idx_jl_doc_project ON janlekha_documents(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_doc_hash ON janlekha_documents(content_hash);
  CREATE INDEX IF NOT EXISTS idx_jl_flag_project ON janlekha_flags(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_events_project ON janlekha_events(project_id);
  CREATE INDEX IF NOT EXISTS idx_jl_events_record ON janlekha_events(record_id);
  CREATE INDEX IF NOT EXISTS idx_jl_events_name ON janlekha_events(event_name);
  CREATE INDEX IF NOT EXISTS idx_jl_events_block ON janlekha_events(block_number);
  CREATE INDEX IF NOT EXISTS idx_jl_participation_ref ON janlekha_citizen_participation(ref_id);
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
//  JanLekha prepared statements
// ═══════════════════════════════════════════════════════════════════════════════

const insertJanlekhaEvent = db.prepare(`
  INSERT OR IGNORE INTO janlekha_events
    (registry, event_name, record_id, project_id, block_number, log_index, tx_hash, raw_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertJanlekhaProject = db.prepare(`
  INSERT INTO janlekha_projects
    (id, name, department_id, contractor, budget_inr, status, registered_at, block_number, tx_hash, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    department_id = excluded.department_id,
    contractor = excluded.contractor,
    budget_inr = excluded.budget_inr,
    updated_at = unixepoch()
`);

const updateJanlekhaProjectStatus = db.prepare(`
  UPDATE janlekha_projects SET status = ?, block_number = ?, tx_hash = ?, updated_at = unixepoch()
  WHERE id = ?
`);

const getJanlekhaProjectById = db.prepare(`
  SELECT * FROM janlekha_projects WHERE id = ?
`);

const listJanlekhaProjectsAll = db.prepare(`
  SELECT * FROM janlekha_projects ORDER BY registered_at DESC, id ASC LIMIT ? OFFSET ?
`);

const listJanlekhaProjectsByDept = db.prepare(`
  SELECT * FROM janlekha_projects WHERE department_id = ? ORDER BY registered_at DESC, id ASC LIMIT ? OFFSET ?
`);

const listJanlekhaProjectsByStatus = db.prepare(`
  SELECT * FROM janlekha_projects WHERE status = ? ORDER BY registered_at DESC, id ASC LIMIT ? OFFSET ?
`);

const searchJanlekhaProjects = db.prepare(`
  SELECT * FROM janlekha_projects
  WHERE name LIKE ? OR id LIKE ? OR department_id LIKE ?
  ORDER BY registered_at DESC, id ASC LIMIT ? OFFSET ?
`);

const upsertJanlekhaAllocation = db.prepare(`
  INSERT INTO janlekha_allocations
    (id, department_id, project_id, amount_inr, amount_usdc_base_units, approved_by, approved_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const markJanlekhaAllocationReleased = db.prepare(`
  UPDATE janlekha_allocations SET released = 1, released_by = ?, block_number = ?, tx_hash = ?
  WHERE id = ?
`);

const getJanlekhaAllocationsByProject = db.prepare(`
  SELECT * FROM janlekha_allocations WHERE project_id = ? ORDER BY approved_at ASC, id ASC
`);

const getJanlekhaAllocationsByDept = db.prepare(`
  SELECT * FROM janlekha_allocations WHERE department_id = ? ORDER BY approved_at ASC, id ASC
`);

const upsertJanlekhaMilestone = db.prepare(`
  INSERT INTO janlekha_milestones
    (id, project_id, submitter, amount_inr, amount_usdc_base_units, evidence_hash, status, submitted_at, block_number, tx_hash, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, unixepoch())
  ON CONFLICT(id) DO NOTHING
`);

const updateJanlekhaMilestoneStatus = db.prepare(`
  UPDATE janlekha_milestones
  SET status = ?, verified_by = ?, verified_at = ?, block_number = ?, tx_hash = ?, updated_at = unixepoch()
  WHERE id = ?
`);

const getJanlekhaMilestoneById = db.prepare(`
  SELECT * FROM janlekha_milestones WHERE id = ?
`);

const getJanlekhaMilestonesByProject = db.prepare(`
  SELECT * FROM janlekha_milestones WHERE project_id = ? ORDER BY submitted_at ASC, id ASC
`);

const insertJanlekhaPayment = db.prepare(`
  INSERT OR IGNORE INTO janlekha_payments
    (id, project_id, milestone_id, payee, amount_usdc_base_units, invoice_hash, recorded_by, recorded_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getJanlekhaPaymentsByProject = db.prepare(`
  SELECT * FROM janlekha_payments WHERE project_id = ? ORDER BY recorded_at ASC, id ASC
`);

const getJanlekhaPaymentsByPayee = db.prepare(`
  SELECT * FROM janlekha_payments WHERE payee = ? ORDER BY recorded_at DESC, id ASC LIMIT ? OFFSET ?
`);

const getJanlekhaPaymentByInvoice = db.prepare(`
  SELECT * FROM janlekha_payments WHERE invoice_hash = ? LIMIT 1
`);

const upsertJanlekhaDocument = db.prepare(`
  INSERT INTO janlekha_documents
    (id, project_id, content_hash, doc_type, uploaded_by, uploaded_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const markJanlekhaDocumentVerified = db.prepare(`
  UPDATE janlekha_documents SET verified = 1, verified_by = ?, block_number = ?, tx_hash = ?
  WHERE id = ?
`);

const getJanlekhaDocumentById = db.prepare(`
  SELECT * FROM janlekha_documents WHERE id = ?
`);

const getJanlekhaDocumentsByProject = db.prepare(`
  SELECT * FROM janlekha_documents WHERE project_id = ? ORDER BY uploaded_at ASC, id ASC
`);

const getJanlekhaDocumentByHash = db.prepare(`
  SELECT * FROM janlekha_documents WHERE content_hash = ? LIMIT 1
`);

const upsertJanlekhaFlag = db.prepare(`
  INSERT INTO janlekha_flags
    (id, project_id, reason, risk, raised_by, raised_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const resolveJanlekhaFlag = db.prepare(`
  UPDATE janlekha_flags
  SET resolved = 1, resolved_by = ?, resolved_at = ?, resolution_note = ?, block_number = ?, tx_hash = ?
  WHERE id = ?
`);

const getJanlekhaFlagsByProject = db.prepare(`
  SELECT * FROM janlekha_flags WHERE project_id = ? ORDER BY raised_at ASC, id ASC
`);

const listJanlekhaFlagsOpen = db.prepare(`
  SELECT * FROM janlekha_flags WHERE resolved = 0 ORDER BY raised_at DESC, id ASC LIMIT ? OFFSET ?
`);

const insertJanlekhaReport = db.prepare(`
  INSERT OR IGNORE INTO janlekha_reports
    (id, project_id, title, findings, published_at, auditor, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getJanlekhaReportsByProject = db.prepare(`
  SELECT * FROM janlekha_reports WHERE project_id = ? ORDER BY published_at ASC, id ASC
`);

const upsertJanlekhaTender = db.prepare(`
  INSERT INTO janlekha_tenders
    (id, project_id, title, value_inr, deadline, published_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const updateJanlekhaTenderAward = db.prepare(`
  UPDATE janlekha_tenders SET open = 0, awarded_to = ?, awarded_amount_inr = ?, block_number = ?, tx_hash = ?
  WHERE id = ?
`);

const getJanlekhaTendersByProject = db.prepare(`
  SELECT * FROM janlekha_tenders WHERE project_id = ? ORDER BY published_at ASC, id ASC
`);

const insertJanlekhaBid = db.prepare(`
  INSERT OR IGNORE INTO janlekha_bids
    (tender_id, contractor, amount_inr, submitted_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getJanlekhaBidsByTender = db.prepare(`
  SELECT * FROM janlekha_bids WHERE tender_id = ? ORDER BY submitted_at ASC, id ASC
`);

const upsertJanlekhaRoleGrant = db.prepare(`
  INSERT INTO janlekha_role_grants (role, account, granted_by, granted_at, block_number, tx_hash)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(role, account) DO UPDATE SET
    revoked = 0, revoked_by = NULL, granted_by = excluded.granted_by,
    granted_at = excluded.granted_at, block_number = excluded.block_number, tx_hash = excluded.tx_hash
`);

const revokeJanlekhaRoleGrant = db.prepare(`
  UPDATE janlekha_role_grants SET revoked = 1, revoked_by = ?, block_number = ?, tx_hash = ?
  WHERE role = ? AND account = ?
`);

const getJanlekhaRolesByAccount = db.prepare(`
  SELECT * FROM janlekha_role_grants WHERE account = ? AND revoked = 0 ORDER BY role ASC
`);

const insertJanlekhaParticipation = db.prepare(`
  INSERT OR IGNORE INTO janlekha_citizen_participation (action, wallet, ref_id)
  VALUES (?, ?, ?)
`);

const getJanlekhaParticipation = db.prepare(`
  SELECT * FROM janlekha_citizen_participation WHERE action = ? AND wallet = ? AND ref_id = ?
`);

const listJanlekhaParticipationByRef = db.prepare(`
  SELECT * FROM janlekha_citizen_participation WHERE ref_id = ? ORDER BY created_at ASC
`);

const getJanlekhaCursor = db.prepare(`
  SELECT last_block FROM janlekha_cursor WHERE registry = ?
`);

const upsertJanlekhaCursor = db.prepare(`
  INSERT INTO janlekha_cursor (registry, last_block, updated_at)
  VALUES (?, ?, unixepoch())
  ON CONFLICT(registry) DO UPDATE SET
    last_block = excluded.last_block,
    updated_at = unixepoch()
`);

// Aggregate helpers (sums are computed in SQL; amounts stay as text so no
// precision is lost, callers convert with the 6-decimal USDC rule)
const sumJanlekhaAllocationsByProject = db.prepare(`
  SELECT COUNT(*) AS n,
         COALESCE(SUM(CAST(amount_inr AS INTEGER)), 0) AS sum_inr,
         COALESCE(SUM(CAST(amount_usdc_base_units AS INTEGER)), 0) AS sum_usdc,
         COALESCE(SUM(released), 0) AS released_n
  FROM janlekha_allocations WHERE project_id = ?
`);

const sumJanlekhaPaymentsByProject = db.prepare(`
  SELECT COUNT(*) AS n,
         COALESCE(SUM(CAST(amount_usdc_base_units AS INTEGER)), 0) AS sum_usdc
  FROM janlekha_payments WHERE project_id = ?
`);

const countJanlekhaMilestonesByProjectStatus = db.prepare(`
  SELECT status, COUNT(*) AS n FROM janlekha_milestones WHERE project_id = ? GROUP BY status
`);

const countJanlekhaFlagsByProject = db.prepare(`
  SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END), 0) AS open_n
  FROM janlekha_flags WHERE project_id = ?
`);

const countJanlekhaDocumentsByProject = db.prepare(`
  SELECT COUNT(*) AS n FROM janlekha_documents WHERE project_id = ?
`);

const listJanlekhaDepartments = db.prepare(`
  SELECT DISTINCT department_id FROM janlekha_projects WHERE department_id != '' ORDER BY department_id ASC
`);

const sumJanlekhaAllocationsByDept = db.prepare(`
  SELECT COUNT(*) AS n,
         COALESCE(SUM(CAST(amount_inr AS INTEGER)), 0) AS sum_inr,
         COALESCE(SUM(CAST(amount_usdc_base_units AS INTEGER)), 0) AS sum_usdc
  FROM janlekha_allocations WHERE department_id = ?
`);

const sumJanlekhaPaymentsByDept = db.prepare(`
  SELECT COUNT(*) AS n,
         COALESCE(SUM(CAST(amount_usdc_base_units AS INTEGER)), 0) AS sum_usdc
  FROM janlekha_payments p
  JOIN janlekha_projects pr ON pr.id = p.project_id
  WHERE pr.department_id = ?
`);

const countJanlekhaProjectsByDept = db.prepare(`
  SELECT COUNT(*) AS n FROM janlekha_projects WHERE department_id = ?
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

  // ─── JanLekha: raw event log ───
  insertJanlekhaEvent(
    registry: string, eventName: string, recordId: string, projectId: string,
    blockNumber: string, logIndex: number, txHash: string, rawJson: string,
  ) {
    return insertJanlekhaEvent.run(registry, eventName, recordId, projectId, blockNumber, logIndex, txHash, rawJson);
  },
  getJanlekhaEvents(opts: {
    projectId?: string; recordId?: string; eventName?: string; registry?: string;
    txHash?: string; q?: string; limit?: number; offset?: number;
  } = {}) {
    // Dynamic filter query: only the filters the caller passes are applied.
    // q matches a transaction hash, a record id, or text inside the raw event JSON.
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (opts.projectId) { conds.push("project_id = ?"); params.push(opts.projectId); }
    if (opts.recordId) { conds.push("record_id = ?"); params.push(opts.recordId); }
    if (opts.eventName) { conds.push("event_name = ?"); params.push(opts.eventName); }
    if (opts.registry) { conds.push("registry = ?"); params.push(opts.registry); }
    if (opts.txHash) { conds.push("tx_hash = ?"); params.push(opts.txHash); }
    if (opts.q) {
      conds.push("(tx_hash LIKE ? OR record_id LIKE ? OR raw_json LIKE ?)");
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return db.prepare(
      `SELECT * FROM janlekha_events ${where} ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Record<string, unknown>[];
  },
  getJanlekhaTimeline(projectId: string, limit = 200, offset = 0) {
    return db.prepare(
      `SELECT * FROM janlekha_events WHERE project_id = ?
       ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC LIMIT ? OFFSET ?`,
    ).all(projectId, Math.min(limit, 500), offset) as Record<string, unknown>[];
  },

  // ─── JanLekha: projects ───
  upsertJanlekhaProject(
    id: string, name: string, departmentId: string, contractor: string,
    budgetInr: string, status: number, registeredAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaProject.run(id, name, departmentId, contractor, budgetInr, status, registeredAt, blockNumber, txHash);
  },
  updateJanlekhaProjectStatus(id: string, status: number, blockNumber: string, txHash: string) {
    return updateJanlekhaProjectStatus.run(status, blockNumber, txHash, id);
  },
  getJanlekhaProject(id: string) {
    return getJanlekhaProjectById.get(id) as Record<string, unknown> | undefined;
  },
  listJanlekhaProjects(opts: { departmentId?: string; status?: number; search?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    if (opts.search) {
      const like = `%${opts.search}%`;
      return searchJanlekhaProjects.all(like, like, like, limit, offset) as Record<string, unknown>[];
    }
    if (opts.departmentId) {
      return listJanlekhaProjectsByDept.all(opts.departmentId, limit, offset) as Record<string, unknown>[];
    }
    if (opts.status !== undefined) {
      return listJanlekhaProjectsByStatus.all(opts.status, limit, offset) as Record<string, unknown>[];
    }
    return listJanlekhaProjectsAll.all(limit, offset) as Record<string, unknown>[];
  },

  // ─── JanLekha: allocations ───
  upsertJanlekhaAllocation(
    id: string, departmentId: string, projectId: string, amountInr: string,
    amountUsdcBaseUnits: string, approvedBy: string, approvedAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaAllocation.run(id, departmentId, projectId, amountInr, amountUsdcBaseUnits, approvedBy, approvedAt, blockNumber, txHash);
  },
  markJanlekhaAllocationReleased(id: string, releasedBy: string, blockNumber: string, txHash: string) {
    return markJanlekhaAllocationReleased.run(releasedBy, blockNumber, txHash, id);
  },
  getJanlekhaAllocationsByProject(projectId: string) {
    return getJanlekhaAllocationsByProject.all(projectId) as Record<string, unknown>[];
  },
  getJanlekhaAllocationsByDept(departmentId: string) {
    return getJanlekhaAllocationsByDept.all(departmentId) as Record<string, unknown>[];
  },

  // ─── JanLekha: milestones ───
  upsertJanlekhaMilestone(
    id: string, projectId: string, submitter: string, amountInr: string,
    amountUsdcBaseUnits: string, evidenceHash: string, submittedAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaMilestone.run(id, projectId, submitter, amountInr, amountUsdcBaseUnits, evidenceHash, submittedAt, blockNumber, txHash);
  },
  updateJanlekhaMilestoneStatus(
    id: string, status: number, verifiedBy: string | null, verifiedAt: number | null, blockNumber: string, txHash: string,
  ) {
    return updateJanlekhaMilestoneStatus.run(status, verifiedBy, verifiedAt, blockNumber, txHash, id);
  },
  getJanlekhaMilestone(id: string) {
    return getJanlekhaMilestoneById.get(id) as Record<string, unknown> | undefined;
  },
  getJanlekhaMilestonesByProject(projectId: string) {
    return getJanlekhaMilestonesByProject.all(projectId) as Record<string, unknown>[];
  },

  // ─── JanLekha: payments ───
  insertJanlekhaPayment(
    id: string, projectId: string, milestoneId: string, payee: string,
    amountUsdcBaseUnits: string, invoiceHash: string, recordedBy: string,
    recordedAt: number, blockNumber: string, txHash: string,
  ) {
    return insertJanlekhaPayment.run(id, projectId, milestoneId, payee, amountUsdcBaseUnits, invoiceHash, recordedBy, recordedAt, blockNumber, txHash);
  },
  getJanlekhaPaymentsByProject(projectId: string) {
    return getJanlekhaPaymentsByProject.all(projectId) as Record<string, unknown>[];
  },
  getJanlekhaPaymentsByPayee(payee: string, limit = 50, offset = 0) {
    return getJanlekhaPaymentsByPayee.all(payee, Math.min(limit, 200), offset) as Record<string, unknown>[];
  },
  getJanlekhaPaymentByInvoice(invoiceHash: string) {
    return getJanlekhaPaymentByInvoice.get(invoiceHash) as Record<string, unknown> | undefined;
  },

  // ─── JanLekha: documents and evidence ───
  upsertJanlekhaDocument(
    id: string, projectId: string, contentHash: string, docType: string,
    uploadedBy: string, uploadedAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaDocument.run(id, projectId, contentHash, docType, uploadedBy, uploadedAt, blockNumber, txHash);
  },
  markJanlekhaDocumentVerified(id: string, verifiedBy: string, blockNumber: string, txHash: string) {
    return markJanlekhaDocumentVerified.run(verifiedBy, blockNumber, txHash, id);
  },
  getJanlekhaDocument(id: string) {
    return getJanlekhaDocumentById.get(id) as Record<string, unknown> | undefined;
  },
  getJanlekhaDocumentsByProject(projectId: string) {
    return getJanlekhaDocumentsByProject.all(projectId) as Record<string, unknown>[];
  },
  getJanlekhaDocumentByContentHash(contentHash: string) {
    return getJanlekhaDocumentByHash.get(contentHash) as Record<string, unknown> | undefined;
  },

  // ─── JanLekha: audit flags and reports ───
  upsertJanlekhaFlag(
    id: string, projectId: string, reason: string, risk: number,
    raisedBy: string, raisedAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaFlag.run(id, projectId, reason, risk, raisedBy, raisedAt, blockNumber, txHash);
  },
  resolveJanlekhaFlag(
    id: string, resolvedBy: string, resolvedAt: number, resolutionNote: string, blockNumber: string, txHash: string,
  ) {
    return resolveJanlekhaFlag.run(resolvedBy, resolvedAt, resolutionNote, blockNumber, txHash, id);
  },
  getJanlekhaFlagsByProject(projectId: string) {
    return getJanlekhaFlagsByProject.all(projectId) as Record<string, unknown>[];
  },
  listJanlekhaOpenFlags(limit = 50, offset = 0) {
    return listJanlekhaFlagsOpen.all(Math.min(limit, 200), offset) as Record<string, unknown>[];
  },
  insertJanlekhaReport(
    id: string, projectId: string, title: string, findings: number,
    publishedAt: number, auditor: string, blockNumber: string, txHash: string,
  ) {
    return insertJanlekhaReport.run(id, projectId, title, findings, publishedAt, auditor, blockNumber, txHash);
  },
  getJanlekhaReportsByProject(projectId: string) {
    return getJanlekhaReportsByProject.all(projectId) as Record<string, unknown>[];
  },

  // ─── JanLekha: tenders and bids ───
  upsertJanlekhaTender(
    id: string, projectId: string, title: string, valueInr: string,
    deadline: number, publishedAt: number, blockNumber: string, txHash: string,
  ) {
    return upsertJanlekhaTender.run(id, projectId, title, valueInr, deadline, publishedAt, blockNumber, txHash);
  },
  updateJanlekhaTenderAward(id: string, awardedTo: string, awardedAmountInr: string, blockNumber: string, txHash: string) {
    return updateJanlekhaTenderAward.run(awardedTo, awardedAmountInr, blockNumber, txHash, id);
  },
  getJanlekhaTendersByProject(projectId: string) {
    return getJanlekhaTendersByProject.all(projectId) as Record<string, unknown>[];
  },
  insertJanlekhaBid(
    tenderId: string, contractor: string, amountInr: string, submittedAt: number, blockNumber: string, txHash: string,
  ) {
    return insertJanlekhaBid.run(tenderId, contractor, amountInr, submittedAt, blockNumber, txHash);
  },
  getJanlekhaBidsByTender(tenderId: string) {
    return getJanlekhaBidsByTender.all(tenderId) as Record<string, unknown>[];
  },

  // ─── JanLekha: roles ───
  upsertJanlekhaRoleGrant(role: string, account: string, grantedBy: string, grantedAt: number, blockNumber: string, txHash: string) {
    return upsertJanlekhaRoleGrant.run(role, account, grantedBy, grantedAt, blockNumber, txHash);
  },
  revokeJanlekhaRoleGrant(role: string, account: string, revokedBy: string, blockNumber: string, txHash: string) {
    return revokeJanlekhaRoleGrant.run(revokedBy, blockNumber, txHash, role, account);
  },
  getJanlekhaRolesByAccount(account: string) {
    return getJanlekhaRolesByAccount.all(account) as Record<string, unknown>[];
  },

  // ─── JanLekha: citizen participation ───
  insertJanlekhaParticipation(action: string, wallet: string, refId: string) {
    return insertJanlekhaParticipation.run(action, wallet, refId);
  },
  getJanlekhaParticipation(action: string, wallet: string, refId: string) {
    return getJanlekhaParticipation.get(action, wallet, refId) as Record<string, unknown> | undefined;
  },
  listJanlekhaParticipationByRef(refId: string) {
    return listJanlekhaParticipationByRef.all(refId) as Record<string, unknown>[];
  },

  // ─── JanLekha: per-registry cursor ───
  getJanlekhaCursor(registry: string): bigint {
    const row = getJanlekhaCursor.get(registry) as { last_block: string } | undefined;
    return BigInt(row?.last_block ?? "0");
  },
  setJanlekhaCursor(registry: string, blockNumber: bigint) {
    return upsertJanlekhaCursor.run(registry, blockNumber.toString());
  },

  // ─── JanLekha: aggregates ───
  getJanlekhaProjectAggregate(projectId: string) {
    const alloc = sumJanlekhaAllocationsByProject.get(projectId) as { n: number; sum_inr: number; sum_usdc: number; released_n: number };
    const pay = sumJanlekhaPaymentsByProject.get(projectId) as { n: number; sum_usdc: number };
    const mileRows = countJanlekhaMilestonesByProjectStatus.all(projectId) as { status: number; n: number }[];
    const milestones: Record<string, number> = { submitted: 0, verified: 0, paid: 0, rejected: 0 };
    for (const r of mileRows) {
      if (r.status === 0) milestones.submitted = r.n;
      if (r.status === 1) milestones.verified = r.n;
      if (r.status === 2) milestones.paid = r.n;
      if (r.status === 3) milestones.rejected = r.n;
    }
    const flags = countJanlekhaFlagsByProject.get(projectId) as { total: number; open_n: number };
    const docs = countJanlekhaDocumentsByProject.get(projectId) as { n: number };
    return {
      projectId,
      allocations: { count: alloc.n, totalInr: String(alloc.sum_inr), totalUsdcBaseUnits: String(alloc.sum_usdc), releasedCount: alloc.released_n },
      payments: { count: pay.n, totalUsdcBaseUnits: String(pay.sum_usdc) },
      milestones,
      flags: { total: flags.total, open: flags.open_n },
      documents: { count: docs.n },
    };
  },
  listJanlekhaDepartmentAggregates() {
    const departments = listJanlekhaDepartments.all() as { department_id: string }[];
    return departments.map((d) => {
      const alloc = sumJanlekhaAllocationsByDept.get(d.department_id) as { n: number; sum_inr: number; sum_usdc: number };
      const pay = sumJanlekhaPaymentsByDept.get(d.department_id) as { n: number; sum_usdc: number };
      const projects = countJanlekhaProjectsByDept.get(d.department_id) as { n: number };
      return {
        departmentId: d.department_id,
        projects: projects.n,
        allocations: { count: alloc.n, totalInr: String(alloc.sum_inr), totalUsdcBaseUnits: String(alloc.sum_usdc) },
        payments: { count: pay.n, totalUsdcBaseUnits: String(pay.sum_usdc) },
      };
    });
  },
};

export const ensureDeploymentScope = dbAccess.ensureDeploymentScope;

export type DbAccess = typeof dbAccess;
export default dbAccess;

