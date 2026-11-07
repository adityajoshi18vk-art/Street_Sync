"use client";
// Independent Auditor workspace. Ported from
// ~/workspace/janlekha/src/pages/roles/AuditorDashboard.tsx, restyled dark
// to match the other role workspaces.
import { useMemo, useState } from "react";
import Link from "next/link";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { reports as seedReports, type AuditFlag } from "@/lib/janlekha/data";
import { formatDate, formatINR, shortHash } from "@/lib/janlekha/format";
import { can } from "@/lib/janlekha/permissions";
import { computeRiskFlags, countByRisk } from "@/lib/janlekha/risk";
import { statusTone } from "@/components/janlekha/ui";
import {
  AccessDenied, ActivityTimeline, DarkBadge, DarkCard, DarkCardTitle, DarkStat, DemoStrip, Field,
  NotificationsPanel, PrimaryButton, RiskFlagCard, SelectInput, TextAreaInput, TextInput, WorkspaceLayout,
} from "@/components/janlekha/RoleShared";

interface LocalFinding {
  title: string;
  project: string;
  findings: number;
  summary: string;
  date: string;
}

export default function AuditorRolePage() {
  return (
    <JanLekhaProvider>
      <AuditorInner />
    </JanLekhaProvider>
  );
}

function AuditorInner() {
  const { flags, milestones, projects, payments, documents, reports, events, notifications, role, verifyMilestone, resolveFlag, addReport, markNotificationRead } = useApp();
  const isAuditor = can(role, "verify_milestone");

  const [deptFilter, setDeptFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveMsg, setResolveMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [pubTitle, setPubTitle] = useState("");
  const [pubProjectId, setPubProjectId] = useState(projects[0]?.id ?? "");
  const [pubFindings, setPubFindings] = useState("1");
  const [pubSummary, setPubSummary] = useState("");
  const [pubMsg, setPubMsg] = useState("");
  const [localFindings, setLocalFindings] = useState<LocalFinding[]>([]);

  const openFlags = flags.filter((f) => f.status !== "Resolved");
  const criticalFlags = flags.filter((f) => f.risk === "Critical" && f.status !== "Resolved");
  const verifiedMilestones = milestones.filter((m) => m.status === "Verified" || m.status === "Paid");
  const publishedCount = seedReports.length + localFindings.length + Math.max(0, reports.length - seedReports.length);

  const computed = useMemo(
    () => computeRiskFlags({ projects, milestones, payments, documents }),
    [projects, milestones, payments, documents],
  );
  const computedByRisk = countByRisk(computed);

  const departments = useMemo(() => Array.from(new Set(flags.map((f) => f.department))), [flags]);

  const filteredFlags = flags.filter((f) => {
    if (deptFilter !== "All" && f.department !== deptFilter) return false;
    if (riskFilter !== "All" && f.risk !== riskFilter) return false;
    if (statusFilter !== "All" && f.status !== statusFilter) return false;
    if (search && !(f.project + " " + f.reason + " " + f.evidence).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedFlag: AuditFlag | undefined = flags.find((f) => f.id === selectedId);
  const queue = milestones.filter((m) => m.status === "Submitted");
  const auditorNotes = notifications.filter((n) => n.role === "INDEPENDENT_AUDITOR");
  const auditEvents = events.filter((e) => e.role === "INDEPENDENT_AUDITOR").slice(0, 5);

  if (role !== "INDEPENDENT_AUDITOR") {
    return (
      <WorkspaceLayout title="Independent Auditor" subtitle="Auditor workspace">
        <AccessDenied required="INDEPENDENT_AUDITOR" />
      </WorkspaceLayout>
    );
  }

  function handleResolve() {
    if (!selectedFlag) return;
    if (!isAuditor) {
      setResolveMsg("Only the Independent Auditor role can resolve a flag.");
      return;
    }
    if (!resolveNote.trim()) {
      setResolveMsg("Write a resolution note first, so the history shows what was checked.");
      return;
    }
    resolveFlag(selectedFlag.id, resolveNote.trim());
    setResolveMsg("Flag marked resolved. The note was added to its resolution history.");
    setResolveNote("");
  }

  function handleVerify(milestoneId: string, title: string) {
    if (!isAuditor) {
      setVerifyMsg("Only the Independent Auditor role can verify a milestone.");
      return;
    }
    verifyMilestone(milestoneId, "Independent Auditor");
    setVerifyMsg("Milestone verified: " + title + ". The verification now appears as an event in the citizen timeline.");
  }

  function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!isAuditor) {
      setPubMsg("Only the Independent Auditor role can publish findings.");
      return;
    }
    if (!pubTitle.trim() || !pubSummary.trim()) {
      setPubMsg("Give the finding a title and a summary.");
      return;
    }
    const project = projects.find((p) => p.id === pubProjectId);
    const today = new Date().toISOString().slice(0, 10);
    const count = Math.max(1, Number(pubFindings) || 1);
    addReport({ title: pubTitle.trim(), auditor: "Independent Auditor", projectId: pubProjectId, project: project?.name ?? pubProjectId, findings: count, summary: pubSummary.trim() });
    setLocalFindings((prev) => [{ title: pubTitle.trim(), project: project?.name ?? pubProjectId, findings: count, summary: pubSummary.trim(), date: today }, ...prev]);
    setPubMsg("Finding published. It now appears in the citizen timeline and on the public Audits page under recently published findings.");
    setPubTitle("");
    setPubSummary("");
    setPubFindings("1");
  }

  return (
    <WorkspaceLayout title="Independent Auditor" subtitle="Verify work, investigate risk flags, and publish findings. All figures are demo data.">
      <div className="space-y-6">
        <DemoStrip text="All figures on this page are realistic synthetic demonstration data. This is not actual government expenditure." />
        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-5">
          <h2 className="text-base font-semibold text-cyan-300">Read only scope: original financial records cannot be changed here</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">
            An auditor verifies work and records findings. This workspace has no edit controls for budgets, allocations, or payments, and no payment can
            be initiated from here. If a record looks wrong, raise or update a flag and publish a finding. Detection does not prove wrongdoing. Every
            flag is labelled Requires Investigation or Potential Discrepancy.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DarkStat label="Open flags (demo)" value={String(openFlags.length)} sub="Stored flags awaiting review" tone="red" />
          <DarkStat label="Critical flags (demo)" value={String(criticalFlags.length)} sub="Highest risk level, open" tone="red" />
          <DarkStat label="Verified milestones (demo)" value={String(verifiedMilestones.length)} sub={"Of " + milestones.length + " milestones in demo data"} tone="green" />
          <DarkStat label="Published reports (demo)" value={String(publishedCount)} sub={seedReports.length + " seeded reports, " + localFindings.length + " published this session"} />
        </div>

        <DarkCard>
          <DarkCardTitle title="Live risk scan" sub="Computed now from the current demo records. A scan result is a prompt for investigation, not a verdict." />
          <p className="text-sm text-slate-400">
            {computed.length} flags found: {computedByRisk.Critical} Critical, {computedByRisk.High} High, {computedByRisk.Medium} Medium,{" "}
            {computedByRisk.Low} Low. This scan can overlap the stored flags below, because stored flags were raised by earlier scans.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {computed.map((f) => (
              <RiskFlagCard key={f.id} flag={f} compact />
            ))}
            {computed.length === 0 ? <p className="text-sm text-slate-400">No risk flags from the live scan.</p> : null}
          </div>
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Risk flags" sub="Stored flags with investigation status, notes, and history. Select a flag to see its detail and resolve it." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Department">
              <SelectInput value={deptFilter} onChange={setDeptFilter} options={[{ value: "All", label: "All" }, ...departments.map((d) => ({ value: d, label: d }))]} />
            </Field>
            <Field label="Risk">
              <SelectInput
                value={riskFilter}
                onChange={setRiskFilter}
                options={[{ value: "All", label: "All" }, { value: "Low", label: "Low" }, { value: "Medium", label: "Medium" }, { value: "High", label: "High" }, { value: "Critical", label: "Critical" }]}
              />
            </Field>
            <Field label="Status">
              <SelectInput
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "All", label: "All" }, { value: "Open", label: "Open" }, { value: "Under Review", label: "Under Review" }, { value: "Resolved", label: "Resolved" }]}
              />
            </Field>
            <Field label="Search">
              <TextInput value={search} onChange={setSearch} placeholder="Project, reason, or evidence" />
            </Field>
          </div>
          <p className="mt-3 text-sm text-slate-400">{filteredFlags.length} of {flags.length} flags shown. All amounts are demo data.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              {filteredFlags.map((f) => (
                <RiskFlagCard key={f.id} flag={f} onSelect={(flag) => setSelectedId(flag.id)} selected={selectedId === f.id} />
              ))}
              {filteredFlags.length === 0 ? <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-slate-400">No flags match these filters. Try clearing a filter.</p> : null}
            </div>
            <div>
              {selectedFlag ? (
                <div className="rounded-2xl border border-white/10 bg-[#111D2E] p-5 xl:sticky xl:top-24">
                  <div className="flex flex-wrap gap-2">
                    <DarkBadge tone={selectedFlag.risk === "Critical" || selectedFlag.risk === "High" ? "red" : selectedFlag.risk === "Medium" ? "amber" : "slate"}>
                      {selectedFlag.risk} risk
                    </DarkBadge>
                    <DarkBadge tone={statusTone(selectedFlag.status)}>{selectedFlag.status}</DarkBadge>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-white">{selectedFlag.reason}</h3>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Project</dt><dd className="text-right font-medium text-white"><Link href={"/janlekha/projects/" + selectedFlag.projectId} className="text-cyan-300 hover:underline">{selectedFlag.project}</Link></dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Department</dt><dd className="text-right text-slate-200">{selectedFlag.department}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Amount</dt><dd className="text-right font-medium text-white">{selectedFlag.amountInr > 0 ? formatINR(selectedFlag.amountInr) + " (demo data)" : "Not applicable to this record"}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Investigation status</dt><dd className="text-right text-slate-200">{selectedFlag.status}</dd></div>
                  </dl>
                  <div className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence</p>
                      <p className="mt-1 break-words text-slate-300">{selectedFlag.evidence}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Auditor notes</p>
                      <p className="mt-1 text-slate-300">{selectedFlag.notes || "No notes yet."}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resolution history</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-300">
                        {selectedFlag.history.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {selectedFlag.status !== "Resolved" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleResolve();
                      }}
                      className="mt-4 border-t border-white/10 pt-4"
                    >
                      <Field label="Resolution note">
                        <TextAreaInput value={resolveNote} onChange={setResolveNote} placeholder="What was checked, and what was found?" rows={3} />
                      </Field>
                      <div className="mt-2">
                        <PrimaryButton type="submit" disabled={!isAuditor}>Mark resolved</PrimaryButton>
                      </div>
                      {resolveMsg ? <p className="mt-2 text-sm text-emerald-400">{resolveMsg}</p> : null}
                    </form>
                  ) : (
                    <p className="mt-4 rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">This flag is resolved.</p>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-[#111D2E] p-6">
                  <p className="text-sm text-slate-400">Select a flag on the left to see its project, department, amount, reason, evidence, risk level, investigation status, notes, and resolution history.</p>
                </div>
              )}
            </div>
          </div>
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Milestone verification queue" sub="A contractor cannot verify their own work: verification is independent, only the Independent Auditor role can verify, and the submitting contractor is never the verifier." />
          <p className="text-sm text-slate-400">{queue.length} milestone(s) submitted and awaiting verification.</p>
          {verifyMsg ? <p className="mt-2 rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">{verifyMsg}</p> : null}
          <div className="mt-4 space-y-3">
            {queue.map((m) => (
              <div key={m.id} className="rounded-xl border border-white/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{m.title}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      <Link href={"/janlekha/projects/" + m.projectId} className="text-cyan-300 hover:underline">{m.project}</Link>
                      {" | " + formatINR(m.amountInr) + " (demo data) | Due " + formatDate(m.dueDate)}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500">Evidence hash: {m.evidenceHash ? shortHash(m.evidenceHash) : "None attached"}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <DarkBadge tone={statusTone(m.status)}>{m.status}</DarkBadge>
                    <PrimaryButton onClick={() => handleVerify(m.id, m.title)} disabled={!isAuditor}>Verify milestone</PrimaryButton>
                  </div>
                </div>
              </div>
            ))}
            {queue.length === 0 ? <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-slate-400">No milestones are waiting for verification.</p> : null}
          </div>
          <p className="mt-3 text-sm text-slate-400">{verifiedMilestones.length} milestones already verified or paid in demo data.</p>
        </DarkCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Publish audit findings" sub="Publishing adds a public event to the citizen timeline and lists the finding on the public Audits page. It does not edit any original financial record." />
            <form onSubmit={handlePublish} className="space-y-3">
              <Field label="Finding title"><TextInput value={pubTitle} onChange={setPubTitle} placeholder="For example: Delayed drainage milestone, Kanpur" /></Field>
              <Field label="Related project">
                <SelectInput value={pubProjectId} onChange={setPubProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
              <Field label="Number of findings"><TextInput type="number" min="1" value={pubFindings} onChange={setPubFindings} /></Field>
              <Field label="Summary">
                <TextAreaInput value={pubSummary} onChange={setPubSummary} placeholder="What was found, and what needs investigation. Use Requires Investigation or Potential Discrepancy, never a conclusion of wrongdoing." rows={4} />
              </Field>
              <PrimaryButton type="submit" disabled={!isAuditor}>Publish finding</PrimaryButton>
              {pubMsg ? <p className="text-sm text-emerald-400">{pubMsg}</p> : null}
            </form>
            {localFindings.length > 0 ? (
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-sm font-semibold text-white">Published this session</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-300">
                  {localFindings.map((f, i) => (
                    <li key={i}>
                      <strong className="text-white">{f.title}</strong> ({f.findings} finding(s), {formatDate(f.date)})<br />
                      <span className="text-slate-400">{f.project}. {f.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4">
              <Link href="/janlekha/audits" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open public audits page</Link>
            </div>
          </DarkCard>

          <div className="space-y-6">
            <DarkCard>
              <DarkCardTitle title="Auditor notifications" sub="For the Independent Auditor role." />
              <ul className="space-y-3">
                {auditorNotes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                    <span className="text-sm">
                      <strong className="text-white">{n.title}</strong>
                      <br />
                      <span className="text-slate-400">{n.body}</span>
                      <br />
                      <span className="text-xs text-slate-500">{formatDate(n.date)}</span>
                    </span>
                    {n.read ? (
                      <DarkBadge tone="green">Read</DarkBadge>
                    ) : (
                      <button type="button" onClick={() => markNotificationRead(n.id)} className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-white/5">
                        Mark read
                      </button>
                    )}
                  </li>
                ))}
                {auditorNotes.length === 0 ? <li className="text-sm text-slate-400">No auditor notifications.</li> : null}
              </ul>
            </DarkCard>
            <DarkCard>
              <DarkCardTitle title="Recent auditor events" sub="These events also appear in the citizen timeline, so the public can trace what the auditor did." />
              <ul className="space-y-2 text-sm text-slate-300">
                {auditEvents.map((e) => (
                  <li key={e.id}>
                    <strong className="text-white">{e.type}</strong> | {e.description} <span className="text-slate-500">({formatDate(e.date)})</span>
                  </li>
                ))}
                {auditEvents.length === 0 ? <li className="text-sm text-slate-400">No auditor events yet.</li> : null}
              </ul>
            </DarkCard>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Notifications" sub="For the Independent Auditor role." />
            <NotificationsPanel role="INDEPENDENT_AUDITOR" items={notifications} />
          </DarkCard>
          <DarkCard>
            <DarkCardTitle title="Auditor activity" sub="Immutable event history, newest first. Events are appended, never edited." />
            <ActivityTimeline events={events} limit={8} />
          </DarkCard>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
