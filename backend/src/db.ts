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
    const params: unknown[] = [];
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

export type DbAccess = typeof dbAccess;
export default dbAccess;

