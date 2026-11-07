"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, Link2, ListOrdered, XCircle } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, DemoNotice, EmptyState, PageHeader } from "@/components/janlekha/ui";
import { formatDate, formatINR, formatUSDC, shortHash } from "@/lib/janlekha/format";
import { ROLE_LABELS } from "@/lib/janlekha/permissions";

type Stage = "Budget" | "Approval" | "Allocation" | "Release" | "Expenditure" | "Verification" | "Audit";

const STAGES: Stage[] = ["Budget", "Approval", "Allocation", "Release", "Expenditure", "Verification", "Audit"];

const STAGE_BY_TYPE: Record<string, Stage> = {
  "Department created": "Budget",
  "Project registered": "Budget",
  "Budget allocated": "Allocation",
  "Tender published": "Approval",
  "Bid selected": "Approval",
  "Milestone submitted": "Verification",
  "Milestone verified": "Verification",
  "Document registered": "Verification",
  "Payment settled": "Expenditure",
  "Audit report published": "Audit",
  "Audit flag resolved": "Audit",
  // A citizen complaint feeds the audit process, so it is filed under Audit.
  "Complaint submitted": "Audit",
};

const STAGE_TONE: Record<Stage, "slate" | "green" | "amber" | "red" | "cyan" | "blue"> = {
  Budget: "slate",
  Approval: "blue",
  Allocation: "cyan",
  Release: "cyan",
  Expenditure: "green",
  Verification: "amber",
  Audit: "red",
};

interface TrailEntry {
  id: string;
  date: string;
  type: string;
  stage: Stage;
  actor: string;
  role: string;
  description: string;
  projectId: string;
  project: string;
  amountInr: number | null;
  amountUsdc: number | null;
  evidenceRef: string;
  evidenceKind: string;
  prevRef: string | null;
}

function AuditTrailInner() {
  const { events, projects, payments, milestones, documents, allocations } = useApp();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [chainResult, setChainResult] = useState<string | null>(null);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? (id ? id : "No project");

  const entries = useMemo<TrailEntry[]>(() => {
    const raw: Omit<TrailEntry, "prevRef">[] = [];

    for (const e of events) {
      const pay = payments.find((p) => p.txRef === e.txRef);
      const ms =
        milestones.find((m) => e.description.includes(m.title)) ??
        (e.type === "Milestone verified"
          ? milestones.find((m) => m.projectId === e.projectId && (m.status === "Verified" || m.status === "Paid"))
          : undefined);
      const doc =
        e.type === "Document registered"
          ? documents.find((d) => d.projectId === e.projectId && d.date <= e.date) ??
            documents.find((d) => d.projectId === e.projectId)
          : undefined;
      raw.push({
        id: e.id,
        date: e.date,
        type: e.type,
        stage: STAGE_BY_TYPE[e.type] ?? "Audit",
        actor: e.actor,
        role: e.role,
        description: e.description,
        projectId: e.projectId,
        project: projectName(e.projectId),
        amountInr: pay ? pay.amountInr : ms ? ms.amountInr : null,
        amountUsdc: pay ? pay.amountUsdc : null,
        evidenceRef: doc ? doc.hash : e.txRef,
        evidenceKind: doc ? "Document hash" : "SIM-ARC reference",
      });
    }

    // Funds released, derived from the allocation records. This is the
    // Release stage of the lifecycle, separate from the allocation approval.
    for (const a of allocations) {
      raw.push({
        id: "trail-release-" + a.id,
        date: a.date,
        type: "Funds released",
        stage: "Release",
        actor: "Finance Officer",
        role: "FINANCE_OFFICER",
        description: "Funds released for " + a.project + ".",
        projectId: a.projectId,
        project: a.project,
        amountInr: a.amountInr,
        amountUsdc: null,
        evidenceRef: "SIM-ARC-" + a.date,
        evidenceKind: "SIM-ARC reference",
      });
    }

    // Payments with no matching event record get their own trail entry.
    for (const p of payments) {
      if (events.some((e) => e.txRef === p.txRef)) continue;
      raw.push({
        id: "trail-pay-" + p.id,
        date: p.date,
        type: "Payment settled",
        stage: "Expenditure",
        actor: "Finance Officer",
        role: "FINANCE_OFFICER",
        description: "Payment settled to " + p.payee + " for " + p.project + ".",
        projectId: p.projectId,
        project: p.project,
        amountInr: p.amountInr,
        amountUsdc: p.amountUsdc,
        evidenceRef: p.txRef,
        evidenceKind: "SIM-ARC reference",
      });
    }

    // Milestones with no matching event record get their own trail entry.
    for (const m of milestones) {
      if (m.status !== "Verified" && m.status !== "Paid" && m.status !== "Submitted") continue;
      if (events.some((e) => e.description.includes(m.title))) continue;
      raw.push({
        id: "trail-ms-" + m.id,
        date: m.dueDate,
        type: m.status === "Submitted" ? "Milestone submitted" : "Milestone verified",
        stage: "Verification",
        actor: m.status === "Submitted" ? "Contractor" : m.verifiedBy || "Independent Auditor",
        role: m.status === "Submitted" ? "CONTRACTOR" : "INDEPENDENT_AUDITOR",
        description: "Milestone " + m.title + " for " + m.project + ".",
        projectId: m.projectId,
        project: m.project,
        amountInr: m.amountInr,
        amountUsdc: null,
        evidenceRef: m.evidenceHash || "No evidence hash on record",
        evidenceKind: m.evidenceHash ? "Milestone evidence hash" : "None",
      });
    }

    // Documents with no matching event record get their own trail entry.
    for (const d of documents) {
      if (events.some((e) => e.type === "Document registered" && e.projectId === d.projectId)) continue;
      raw.push({
        id: "trail-doc-" + d.id,
        date: d.date,
        type: "Document registered",
        stage: "Verification",
        actor: d.uploadedBy,
        role: "PROCUREMENT_OFFICER",
        description: "Document registered: " + d.title + ".",
        projectId: d.projectId,
        project: d.project,
        amountInr: null,
        amountUsdc: null,
        evidenceRef: d.hash,
        evidenceKind: "Document hash",
      });
    }

    // Chain the entries per project, oldest first, so each entry points at
    // the previous record in its own project chain.
    const byProject = new Map<string, Omit<TrailEntry, "prevRef">[]>();
    for (const r of raw) {
      const list = byProject.get(r.projectId) ?? [];
      list.push(r);
      byProject.set(r.projectId, list);
    }
    const chained: TrailEntry[] = [];
    for (const list of byProject.values()) {
      const sorted = [...list].sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
      sorted.forEach((r, i) => chained.push({ ...r, prevRef: i === 0 ? null : sorted[i - 1].id }));
    }
    return chained.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, projects, payments, milestones, documents, allocations]);

  const filtered = entries.filter((e) => {
    if (stageFilter !== "All" && e.stage !== stageFilter) return false;
    if (projectFilter !== "All" && e.projectId !== projectFilter) return false;
    if (search && !(e.type + " " + e.description + " " + e.actor + " " + e.project + " " + e.id + " " + e.evidenceRef).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.stage] = (counts[e.stage] ?? 0) + 1;
    return counts;
  }, [entries]);

  function verifyChain() {
    const ids = new Set(entries.map((e) => e.id));
    const breaks: string[] = [];
    if (ids.size !== entries.length) breaks.push("Duplicate record IDs found.");
    const chains = new Map<string, TrailEntry[]>();
    for (const e of entries) {
      const list = chains.get(e.projectId) ?? [];
      list.push(e);
      chains.set(e.projectId, list);
    }
    for (const [projectId, list] of chains) {
      const sorted = [...list].sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
      sorted.forEach((e, i) => {
        if (i === 0) {
          if (e.prevRef !== null) breaks.push(e.id + ": first record in its chain should have no previous reference.");
        } else if (e.prevRef !== sorted[i - 1].id) {
          breaks.push(e.id + ": previous reference does not match the prior record in its chain.");
        }
        if (e.prevRef && !ids.has(e.prevRef)) breaks.push(e.id + ": previous reference points to a missing record.");
      });
      void projectId;
    }
    if (breaks.length === 0) {
      setChainResult("Chain check passed: " + entries.length + " entries in " + chains.size + " project chains, 0 breaks. Every entry points at the previous record in its chain, or is the first record of its chain.");
    } else {
      setChainResult("Chain check failed: " + breaks.length + " problem(s). " + breaks.join(" "));
    }
  }

  function downloadTrail() {
    const blob = new Blob(
      [JSON.stringify({ demoData: true, notice: "Realistic synthetic demonstration data. Not actual government expenditure.", exported: new Date().toISOString(), entries: filtered }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "janlekha-audit-trail.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Audit Trail"
          subtitle="Verifiable transaction and action history across the full money lifecycle: budget, approval, allocation, release, expenditure, verification, and audit. Each entry carries its record ID, the previous record in its project chain, and its evidence reference."
          actions={
            <>
              <button type="button" onClick={verifyChain} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
                <Link2 className="h-4 w-4" aria-hidden /> Verify chain
              </button>
              <button type="button" onClick={downloadTrail} className="inline-flex items-center gap-1.5 rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                <Download className="h-4 w-4" aria-hidden /> Download JSON
              </button>
            </>
          }
        />
      </div>

      {chainResult ? (
        <Card className={"mb-6 p-4 " + (chainResult.startsWith("Chain check passed") ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
          <p className="flex items-start gap-2 text-sm font-medium text-slate-900">
            {chainResult.startsWith("Chain check passed") ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />}
            {chainResult}
          </p>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStageFilter(stageFilter === s ? "All" : s)}
            className={"rounded-full border px-3 py-1 text-xs font-semibold " + (stageFilter === s ? "border-cyan-600 bg-cyan-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-cyan-400")}
          >
            {s} ({stageCounts[s] ?? 0})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Action, actor, project, record ID, or reference" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Project</span>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="All">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-sm text-slate-600">
        <ListOrdered className="h-4 w-4" aria-hidden />
        {filtered.length} of {entries.length} trail entries shown, newest first. Amounts come from the matching payment or milestone record. SIM-ARC references are simulated demo references, not real transaction hashes.
      </p>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No trail entries match" body="Try clearing the search or a filter." link="/janlekha/audit-trail" linkLabel="Show the full trail" />
        </div>
      ) : (
        <ol className="mt-6 space-y-4">
          {filtered.map((e) => (
            <li key={e.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STAGE_TONE[e.stage]}>{e.stage}</Badge>
                      <span className="font-mono text-xs text-slate-500">Record {e.id}</span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-slate-900">{e.type}</h2>
                    <p className="mt-1 text-sm text-slate-700">{e.description}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="font-semibold text-slate-900">{e.amountInr !== null ? formatINR(e.amountInr) : "No amount"}</p>
                    {e.amountUsdc !== null ? <p className="text-slate-600">{formatUSDC(e.amountUsdc)} (simulated)</p> : null}
                    <p className="mt-1 text-xs text-slate-500">{formatDate(e.date)}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500">Project</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {e.projectId ? <Link href={"/janlekha/projects/" + e.projectId} className="text-cyan-700 hover:underline">{e.project}</Link> : e.project}
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500">Responsible account</dt>
                    <dd className="text-right text-slate-900">{e.actor} ({ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role})</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500">Evidence reference</dt>
                    <dd className="text-right font-mono text-xs text-slate-800" title={e.evidenceRef}>
                      {e.evidenceKind === "Document hash" || e.evidenceKind === "Milestone evidence hash" ? shortHash(e.evidenceRef) : e.evidenceRef}
                      <span className="ml-2 font-sans text-slate-500">({e.evidenceKind})</span>
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500">Previous record</dt>
                    <dd className="text-right font-mono text-xs text-slate-800">{e.prevRef ?? "Genesis record (first in its chain)"}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-6">
        <DemoNotice />
      </div>
    </div>
  );
}

export default function AuditTrailPage() {
  return (
    <JanLekhaProvider>
      <AuditTrailInner />
    </JanLekhaProvider>
  );
}
