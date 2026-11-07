import type { AuditFlag, DocRecord, Milestone, Payment, Project } from "./data";
import { formatINR } from "./format";

/**
 * JanLekha risk engine (Agent D).
 *
 * Computes risk flags from live records. Detection is a prompt for human
 * review, never a conclusion of wrongdoing. Every flag uses one of two
 * labels only: "Requires Investigation" or "Potential Discrepancy".
 * All figures come from demo data, so every flag is demo data too.
 */

export type RiskCheckKind =
  | "budget-variance"
  | "duplicate-hash"
  | "over-limit"
  | "repeated-payment"
  | "delayed-milestone"
  | "missing-document";

export interface RiskEngineInput {
  projects: Project[];
  milestones: Milestone[];
  payments: Payment[];
  documents: DocRecord[];
  /** Reference date as YYYY-MM-DD. Defaults to today. */
  asOf?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysOverdue(dueDate: string, asOf: string): number {
  const ms = new Date(asOf).getTime() - new Date(dueDate).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function baseFlag(partial: Omit<AuditFlag, "history"> & { history?: string[] }): AuditFlag {
  return {
    ...partial,
    history: partial.history ?? [todayStr() + ": Flag raised by risk monitor (live scan)."],
  };
}

function projectDepartment(projects: Project[], projectId: string): string {
  return projects.find((p) => p.id === projectId)?.department ?? "";
}

/** 1. Budget variance: recorded spending above the allocated or approved amount. */
export function checkBudgetVariance(projects: Project[]): AuditFlag[] {
  const out: AuditFlag[] = [];
  for (const p of projects) {
    if (p.spentInr > p.budgetInr) {
      out.push(
        baseFlag({
          id: "risk-budget-" + p.id,
          projectId: p.id,
          project: p.name,
          department: p.department,
          amountInr: p.spentInr - p.budgetInr,
          reason:
            "Requires Investigation: recorded spending of " +
            formatINR(p.spentInr) +
            " is above the approved budget of " +
            formatINR(p.budgetInr) +
            " by " +
            formatINR(p.spentInr - p.budgetInr) +
            ". A variance alone does not prove an irregularity.",
          evidence:
            "Project budget " + formatINR(p.budgetInr) + ", allocated " + formatINR(p.allocatedInr) + ", spent " + formatINR(p.spentInr) + ".",
          risk: "Critical",
          status: "Open",
          notes: "Requires investigation. Check whether a revised approval exists.",
        }),
      );
    } else if (p.spentInr > p.allocatedInr) {
      out.push(
        baseFlag({
          id: "risk-budget-" + p.id,
          projectId: p.id,
          project: p.name,
          department: p.department,
          amountInr: p.spentInr - p.allocatedInr,
          reason:
            "Requires Investigation: recorded spending of " +
            formatINR(p.spentInr) +
            " is above the allocated amount of " +
            formatINR(p.allocatedInr) +
            " by " +
            formatINR(p.spentInr - p.allocatedInr) +
            ". A variance alone does not prove an irregularity.",
          evidence:
            "Project allocated " + formatINR(p.allocatedInr) + ", released " + formatINR(p.releasedInr) + ", spent " + formatINR(p.spentInr) + ".",
          risk: "High",
          status: "Open",
          notes: "Requires investigation. Check whether a revised allocation exists.",
        }),
      );
    }
  }
  return out;
}

/** 2. Duplicate invoice hash detection: the same document hash registered more than once. */
export function checkDuplicateHashes(documents: DocRecord[], milestones: Milestone[], projects: Project[]): AuditFlag[] {
  const out: AuditFlag[] = [];
  const byHash = new Map<string, DocRecord[]>();
  for (const d of documents) {
    if (!d.hash) continue;
    const list = byHash.get(d.hash) ?? [];
    list.push(d);
    byHash.set(d.hash, list);
  }
  for (const [hash, docs] of byHash) {
    if (docs.length < 2) continue;
    const first = docs[0];
    out.push(
      baseFlag({
        id: "risk-duplicate-doc-" + hash.slice(0, 8),
        projectId: first.projectId,
        project: first.project,
        department: projectDepartment(projects, first.projectId),
        amountInr: 0,
        reason:
          "Potential Discrepancy: the same document hash appears in " +
          docs.length +
          " registered document records. A repeated hash can be a duplicate submission, or the same file registered twice, and needs a human check.",
        evidence:
          "Hash " +
          hash.slice(0, 12) +
          " appears for: " +
          docs.map((d) => d.title + " (" + d.id + ")").join("; ") +
          ".",
        risk: "High",
        status: "Open",
        notes: "Requires investigation. Compare the underlying files before any payment is released.",
      }),
    );
  }
  const evidenceByHash = new Map<string, Milestone[]>();
  for (const m of milestones) {
    if (!m.evidenceHash) continue;
    const list = evidenceByHash.get(m.evidenceHash) ?? [];
    list.push(m);
    evidenceByHash.set(m.evidenceHash, list);
  }
  for (const [hash, ms] of evidenceByHash) {
    if (ms.length < 2) continue;
    const first = ms[0];
    out.push(
      baseFlag({
        id: "risk-duplicate-evidence-" + hash.slice(0, 8),
        projectId: first.projectId,
        project: first.project,
        department: projectDepartment(projects, first.projectId),
        amountInr: first.amountInr,
        reason:
          "Potential Discrepancy: the same evidence hash is attached to " +
          ms.length +
          " milestones. One evidence file should support one milestone unless the record explains the reuse.",
        evidence:
          "Hash " +
          hash.slice(0, 12) +
          " attached to: " +
          ms.map((m) => m.title + " (" + m.id + ")").join("; ") +
          ".",
        risk: "High",
        status: "Open",
        notes: "Requires investigation. Confirm each milestone has its own evidence.",
      }),
    );
  }
  return out;
}

/** 3. Payments over authorised limits: a payment above its milestone amount. */
export function checkPaymentsOverLimit(payments: Payment[], milestones: Milestone[], projects: Project[]): AuditFlag[] {
  const out: AuditFlag[] = [];
  for (const pay of payments) {
    const ms = milestones.find((m) => m.id === pay.milestoneId);
    if (!ms) {
      out.push(
        baseFlag({
          id: "risk-over-limit-" + pay.id,
          projectId: pay.projectId,
          project: pay.project,
          department: projectDepartment(projects, pay.projectId),
          amountInr: pay.amountInr,
          reason:
            "Requires Investigation: payment " +
            pay.id +
            " of " +
            formatINR(pay.amountInr) +
            " has no matching milestone record, so no authorised limit can be confirmed for it.",
          evidence: "Payment references milestone " + pay.milestoneId + ", which is not in the milestone records.",
          risk: "High",
          status: "Open",
          notes: "Requires investigation. Hold further releases until the milestone is identified.",
        }),
      );
      continue;
    }
    if (pay.amountInr > ms.amountInr) {
      const excess = pay.amountInr - ms.amountInr;
      out.push(
        baseFlag({
          id: "risk-over-limit-" + pay.id,
          projectId: pay.projectId,
          project: pay.project,
          department: projectDepartment(projects, pay.projectId),
          amountInr: excess,
          reason:
            "Requires Investigation: payment of " +
            formatINR(pay.amountInr) +
            " exceeds the authorised milestone amount of " +
            formatINR(ms.amountInr) +
            " by " +
            formatINR(excess) +
            ".",
          evidence:
            "Milestone " + ms.title + " (" + ms.id + ") authorised " + formatINR(ms.amountInr) + ", payment " + pay.id + " recorded " + formatINR(pay.amountInr) + ".",
          risk: excess > ms.amountInr * 0.1 ? "Critical" : "High",
          status: "Open",
          notes: "Requires investigation before any further release on this project.",
        }),
      );
    }
  }
  return out;
}

/** 4. Repeated payments to the same milestone. */
export function checkRepeatedPayments(payments: Payment[], milestones: Milestone[], projects: Project[]): AuditFlag[] {
  const out: AuditFlag[] = [];
  const byMilestone = new Map<string, Payment[]>();
  for (const pay of payments) {
    const list = byMilestone.get(pay.milestoneId) ?? [];
    list.push(pay);
    byMilestone.set(pay.milestoneId, list);
  }
  for (const [milestoneId, pays] of byMilestone) {
    if (pays.length < 2) continue;
    const total = pays.reduce((s, p) => s + p.amountInr, 0);
    const ms = milestones.find((m) => m.id === milestoneId);
    out.push(
      baseFlag({
        id: "risk-repeated-" + milestoneId,
        projectId: pays[0].projectId,
        project: pays[0].project,
        department: projectDepartment(projects, pays[0].projectId),
        amountInr: total,
        reason:
          "Potential Discrepancy: " +
          pays.length +
          " payments totalling " +
          formatINR(total) +
          " were recorded against the single milestone " +
          (ms ? ms.title : milestoneId) +
          ". Repeated payments can be legitimate instalments, or a duplicate payment, and need a human check.",
        evidence: "Payments: " + pays.map((p) => p.id + " (" + formatINR(p.amountInr) + ", " + p.date + ")").join("; ") + ".",
        risk: "Medium",
        status: "Open",
        notes: "Requires investigation. Confirm whether instalments were authorised.",
      }),
    );
  }
  return out;
}

/** 5. Delayed milestones: due date passed and not Verified or Paid. */
export function checkDelayedMilestones(milestones: Milestone[], projects: Project[], asOf?: string): AuditFlag[] {
  const ref = asOf ?? todayStr();
  const out: AuditFlag[] = [];
  for (const m of milestones) {
    if (m.status === "Verified" || m.status === "Paid") continue;
    if (m.dueDate >= ref) continue;
    const overdue = daysOverdue(m.dueDate, ref);
    out.push(
      baseFlag({
        id: "risk-delayed-" + m.id,
        projectId: m.projectId,
        project: m.project,
        department: projectDepartment(projects, m.projectId),
        amountInr: m.amountInr,
        reason:
          "Requires Investigation: milestone " +
          m.title +
          " was due on " +
          m.dueDate +
          " and is " +
          overdue +
          " days overdue, with status " +
          m.status +
          ".",
        evidence: "Milestone " + m.id + " due " + m.dueDate + ", status " + m.status + ", no verified completion on record.",
        risk: overdue > 60 ? "High" : "Medium",
        status: "Open",
        notes: "Requires investigation. Ask for a revised completion date or an approved extension.",
      }),
    );
  }
  return out;
}

/** 6. Missing supporting documents: a milestone with no evidence hash, or an evidence hash with no registered document. */
export function checkMissingDocuments(milestones: Milestone[], documents: DocRecord[], projects: Project[]): AuditFlag[] {
  const out: AuditFlag[] = [];
  const registered = new Set(documents.map((d) => d.hash));
  for (const m of milestones) {
    if (m.status !== "Submitted" && m.status !== "Verified" && m.status !== "Paid") continue;
    if (!m.evidenceHash) {
      out.push(
        baseFlag({
          id: "risk-missing-doc-" + m.id,
          projectId: m.projectId,
          project: m.project,
          department: projectDepartment(projects, m.projectId),
          amountInr: m.amountInr,
          reason:
            "Requires Investigation: milestone " +
            m.title +
            " has status " +
            m.status +
            " but no supporting evidence document is attached.",
          evidence: "Milestone " + m.id + " has an empty evidence hash.",
          risk: "Medium",
          status: "Open",
          notes: "Requires investigation. Payment should stay held until evidence is uploaded.",
        }),
      );
    } else if (!registered.has(m.evidenceHash)) {
      out.push(
        baseFlag({
          id: "risk-missing-doc-" + m.id,
          projectId: m.projectId,
          project: m.project,
          department: projectDepartment(projects, m.projectId),
          amountInr: m.amountInr,
          reason:
            "Potential Discrepancy: milestone " +
            m.title +
            " cites an evidence hash that matches no document in the registry, so the evidence cannot be checked.",
          evidence: "Milestone " + m.id + " cites hash " + m.evidenceHash.slice(0, 12) + ", which is not in the document registry.",
          risk: "Medium",
          status: "Open",
          notes: "Requires investigation. Ask for the evidence file to be registered.",
        }),
      );
    }
  }
  return out;
}

/** Run every check and return the combined flags, deduplicated by id. */
export function computeRiskFlags(input: RiskEngineInput): AuditFlag[] {
  const asOf = input.asOf ?? todayStr();
  const all = [
    ...checkBudgetVariance(input.projects),
    ...checkDuplicateHashes(input.documents, input.milestones, input.projects),
    ...checkPaymentsOverLimit(input.payments, input.milestones, input.projects),
    ...checkRepeatedPayments(input.payments, input.milestones, input.projects),
    ...checkDelayedMilestones(input.milestones, input.projects, asOf),
    ...checkMissingDocuments(input.milestones, input.documents, input.projects),
  ];
  const seen = new Set<string>();
  return all.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

export function countByRisk(flags: AuditFlag[]): Record<string, number> {
  const counts: Record<string, number> = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  for (const f of flags) counts[f.risk] = (counts[f.risk] ?? 0) + 1;
  return counts;
}
