"use client";
// Procurement Officer workspace. Ported from
// ~/workspace/janlekha/src/pages/roles/ProcurementDashboard.tsx.
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { can } from "@/lib/janlekha/permissions";
import { formatINR, formatDate } from "@/lib/janlekha/format";
import { statusTone } from "@/components/janlekha/ui";
import {
  AccessDenied, ActivityTimeline, DarkBadge, DarkCard, DarkCardTitle, DarkStat, DataTable, DemoStrip, Field,
  GhostButton, NotificationsPanel, PrimaryButton, SelectInput, SuccessNote, Td, TextAreaInput, TextInput, WorkspaceLayout,
} from "@/components/janlekha/RoleShared";

const CR = 10000000;

export default function ProcurementRolePage() {
  return (
    <JanLekhaProvider>
      <ProcurementInner />
    </JanLekhaProvider>
  );
}

function ProcurementInner() {
  const { role, departments, projects, tenders, events, notifications, publishTender, selectBid } = useApp();

  const [title, setTitle] = useState("");
  const [deptId, setDeptId] = useState(departments[0]?.id ?? "");
  const [projId, setProjId] = useState(projects[0]?.id ?? "");
  const [valueCr, setValueCr] = useState("");
  const [deadline, setDeadline] = useState("");
  const [tenderMsg, setTenderMsg] = useState<string | null>(null);

  const [evalTenderId, setEvalTenderId] = useState(tenders[0]?.id ?? "");
  const [bidMsg, setBidMsg] = useState<string | null>(null);

  const [amendText, setAmendText] = useState("");
  const [amendments, setAmendments] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const visibleTenders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenders.filter((t) => {
      if (statusFilter !== "All" && t.status !== statusFilter) return false;
      if (q && !(t.title + " " + t.project + " " + t.department).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tenders, search, statusFilter]);

  if (role !== "PROCUREMENT_OFFICER") {
    return (
      <WorkspaceLayout title="Procurement Officer" subtitle="Procurement workspace">
        <AccessDenied required="PROCUREMENT_OFFICER" />
      </WorkspaceLayout>
    );
  }

  const openTenders = tenders.filter((t) => t.status === "Open");
  const awarded = tenders.filter((t) => t.status === "Awarded");
  const totalBids = tenders.reduce((s, t) => s + t.bids.length, 0);
  const evalTender = tenders.find((t) => t.id === evalTenderId);
  const canPublish = can(role, "publish_tender");
  const canEvaluate = can(role, "evaluate_bids");

  const submitTender = (e: FormEvent) => {
    e.preventDefault();
    const dept = departments.find((d) => d.id === deptId);
    const proj = projects.find((p) => p.id === projId);
    const value = Number(valueCr) * CR;
    if (!dept || !proj || !title.trim() || !(value > 0) || !deadline) {
      setTenderMsg("Fill in every field, pick a department and a project, and enter a value above zero.");
      return;
    }
    publishTender({ title: title.trim(), departmentId: dept.id, department: dept.name, projectId: proj.id, project: proj.name, valueInr: value, deadline });
    setTenderMsg("Tender " + title.trim() + " published as Open, for " + proj.name + ", value " + formatINR(value) + ". Demo data only.");
    setTitle("");
    setValueCr("");
    setDeadline("");
  };

  const chooseBid = (tenderId: string, bidId: string, contractor: string) => {
    selectBid(tenderId, bidId);
    const t = tenders.find((x) => x.id === tenderId);
    setBidMsg("Bid from " + contractor + " selected for " + (t?.title ?? "the tender") + ". The tender is now Awarded. Demo data only.");
  };

  return (
    <WorkspaceLayout title="Procurement Officer" subtitle="Tenders, bids, awards, and contracts. All figures are demo data.">
      <div className="space-y-6">
        <DemoStrip text="All figures on this page are realistic synthetic demonstration data. This is not actual government expenditure." />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DarkStat label="Tenders (demo)" value={String(tenders.length)} sub={openTenders.length + " open, " + awarded.length + " awarded"} />
          <DarkStat label="Bids received (demo)" value={String(totalBids)} sub="Across all tenders" tone="green" />
          <DarkStat label="Open tenders (demo)" value={String(openTenders.length)} sub="Accepting bids in this demo" />
          <DarkStat label="Awarded (demo)" value={String(awarded.length)} sub="Contracts on record" tone="green" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Publish a tender" sub="The tender opens with no bids, and contractors can then submit bids." />
            {canPublish ? (
              <form onSubmit={submitTender} className="space-y-3">
                <Field label="Tender title"><TextInput value={title} onChange={setTitle} placeholder="e.g. Hospital modernisation civil works, package B" required /></Field>
                <Field label="Department">
                  <SelectInput value={deptId} onChange={setDeptId} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
                </Field>
                <Field label="Project">
                  <SelectInput value={projId} onChange={setProjId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Estimated value (Rs Cr)"><TextInput type="number" min="0" step="1" value={valueCr} onChange={setValueCr} placeholder="e.g. 40" required /></Field>
                  <Field label="Bid deadline"><TextInput type="date" value={deadline} onChange={setDeadline} required /></Field>
                </div>
                <PrimaryButton type="submit">Publish tender</PrimaryButton>
                <SuccessNote message={tenderMsg} />
              </form>
            ) : (
              <p className="text-sm text-slate-400">Your role cannot publish tenders.</p>
            )}
          </DarkCard>

          <DarkCard>
            <DarkCardTitle title="Evaluate bids" sub="Pick a tender, compare bids, and select one. Selecting a bid awards the tender." />
            <Field label="Tender to evaluate">
              <SelectInput
                value={evalTenderId}
                onChange={(v) => {
                  setEvalTenderId(v);
                  setBidMsg(null);
                }}
                options={tenders.map((t) => ({ value: t.id, label: t.title + " (" + t.status + ", " + t.bids.length + " bids)" }))}
              />
            </Field>
            {evalTender ? (
              <div className="mt-4">
                <p className="text-sm text-slate-400">
                  {evalTender.project} | {evalTender.department} | Value {formatINR(evalTender.valueInr)} | Deadline {formatDate(evalTender.deadline)} | Status{" "}
                  <DarkBadge tone={statusTone(evalTender.status)}>{evalTender.status}</DarkBadge>
                </p>
                {evalTender.bids.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">No bids yet on this tender. Contractors submit bids from the Contractor workspace or the public tenders page.</p>
                ) : (
                  <div className="mt-3">
                    <DataTable headers={["Contractor", "Bid amount", "Submitted", "Status", "Action"]}>
                      {[...evalTender.bids]
                        .sort((a, b) => a.amountInr - b.amountInr)
                        .map((b) => (
                          <tr key={b.id}>
                            <Td><span className="font-semibold text-white">{b.contractor}</span></Td>
                            <Td>{formatINR(b.amountInr)}</Td>
                            <Td>{formatDate(b.submitted)}</Td>
                            <Td><DarkBadge tone={statusTone(b.status)}>{b.status}</DarkBadge></Td>
                            <Td>
                              {evalTender.status === "Open" && canEvaluate ? (
                                <PrimaryButton onClick={() => chooseBid(evalTender.id, b.id, b.contractor)}>Select bid</PrimaryButton>
                              ) : (
                                <span className="text-xs text-slate-500">{evalTender.status !== "Open" ? "Tender already awarded." : "Your role cannot evaluate bids."}</span>
                              )}
                            </Td>
                          </tr>
                        ))}
                    </DataTable>
                    <p className="mt-2 text-xs text-slate-500">Bids are listed cheapest first for comparison. Price is one factor, and the demo does not claim it is the only one.</p>
                  </div>
                )}
                <SuccessNote message={bidMsg} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No tenders on record.</p>
            )}
          </DarkCard>
        </div>

        <DarkCard>
          <DarkCardTitle title="Tenders" sub="All tenders, open and awarded. All figures are demo data." />
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="min-w-0 flex-1">
              <TextInput value={search} onChange={setSearch} placeholder="Search by tender, project, or department" />
            </div>
            <div className="w-52">
              <SelectInput
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "All", label: "All statuses" }, { value: "Open", label: "Open" }, { value: "Awarded", label: "Awarded" }]}
              />
            </div>
          </div>
          <p className="mb-3 text-sm text-slate-400">{visibleTenders.length} of {tenders.length} tenders shown.</p>
          <DataTable headers={["Tender", "Project", "Value", "Deadline", "Bids", "Status"]}>
            {visibleTenders.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link href="/janlekha/tenders" className="font-semibold text-cyan-300 hover:underline">{t.title}</Link>
                  <span className="block text-xs text-slate-500">{t.department}</span>
                </Td>
                <Td>{t.project}</Td>
                <Td>{formatINR(t.valueInr)}</Td>
                <Td>{formatDate(t.deadline)}</Td>
                <Td>{t.bids.length}</Td>
                <Td><DarkBadge tone={statusTone(t.status)}>{t.status}</DarkBadge></Td>
              </tr>
            ))}
          </DataTable>
          {visibleTenders.length === 0 ? <p className="mt-3 text-sm text-slate-400">No tenders match that search.</p> : null}
          <div className="mt-4">
            <Link href="/janlekha/tenders" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open public tenders page</Link>
          </div>
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Contract details" sub="Awarded tenders and the selected bidder. All figures are demo data." />
          {awarded.length === 0 ? (
            <p className="text-sm text-slate-400">No awarded contracts yet.</p>
          ) : (
            <DataTable headers={["Tender", "Project", "Selected contractor", "Selected bid", "Tender value"]}>
              {awarded.map((t) => {
                const sel = t.bids.find((b) => b.status === "Selected");
                return (
                  <tr key={t.id}>
                    <Td><span className="font-semibold text-white">{t.title}</span></Td>
                    <Td>
                      <Link href={"/janlekha/projects/" + t.projectId} className="text-cyan-300 hover:underline">{t.project}</Link>
                    </Td>
                    <Td>{sel ? sel.contractor : "Not recorded"}</Td>
                    <Td>{sel ? formatINR(sel.amountInr) : "Not recorded"}</Td>
                    <Td>{formatINR(t.valueInr)}</Td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Amendments note" sub="How changes to a published tender are handled." />
          <p className="text-sm leading-relaxed text-slate-300">
            A published tender is not silently edited in this demo. The Procurement Officer does not hold an edit records permission, so a change must be
            published as a dated amendment notice, and bidders must be able to see what changed. The log below is a demo only record kept in this browser
            session. It is not a system record, and it is cleared when the page reloads.
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amendText.trim()) return;
              setAmendments((prev) => [new Date().toISOString().slice(0, 10) + ": " + amendText.trim(), ...prev]);
              setAmendText("");
            }}
          >
            <Field label="Amendment note (demo log only)">
              <TextAreaInput value={amendText} onChange={setAmendText} placeholder="e.g. Deadline for tender ten-9 extended by 7 days. Bidders notified." rows={2} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="submit">Record amendment note</PrimaryButton>
              <GhostButton onClick={() => setAmendments([])}>Clear demo log</GhostButton>
            </div>
          </form>
          {amendments.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {amendments.map((a, i) => (
                <li key={i} className="rounded-xl border border-white/10 p-3 text-sm text-slate-300">{a}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No amendment notes recorded in this session.</p>
          )}
        </DarkCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Notifications" sub="For the Procurement Officer role." />
            <NotificationsPanel role="PROCUREMENT_OFFICER" items={notifications} />
          </DarkCard>
          <DarkCard>
            <DarkCardTitle title="Procurement activity" sub="Latest procurement events, newest first." />
            <ActivityTimeline events={events.filter((e) => e.role === "PROCUREMENT_OFFICER")} limit={8} />
          </DarkCard>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
