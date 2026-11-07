// Expenditure: searchable, filterable table of recorded spend per project,
// with totals. Spend is recorded against released funds.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact } from "@/lib/janlekha/format";
import { Badge, Card, PageHeader, StatCard, VerificationBadge, VerificationLegend, verificationLabelFor, statusTone } from "@/components/janlekha/ui";

export default function ExpenditurePage() {
  const { projects, departments, milestones, payments } = useJanLekha();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");
  const statuses = useMemo(() => [...new Set(projects.map((p) => p.status))], [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (dept !== "all" && p.departmentId !== dept) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q) || p.contractor.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, search, dept, status]);

  const totalBudget = filtered.reduce((s, p) => s + p.budgetInr, 0);
  const totalReleased = filtered.reduce((s, p) => s + p.releasedInr, 0);
  const totalSpent = filtered.reduce((s, p) => s + p.spentInr, 0);
  const settledPaid = payments.filter((p) => p.status === "Settled" && filtered.some((x) => x.id === p.projectId)).reduce((s, p) => s + p.amountInr, 0);

  const labelFor = (projectId: string) => {
    const ms = milestones.filter((m) => m.projectId === projectId);
    const paid = payments.some((p) => p.projectId === projectId && p.status === "Settled");
    const verified = ms.some((m) => m.status === "Verified" || m.status === "Paid");
    const hasHash = ms.some((m) => m.evidenceHash);
    if (paid && verified) return verificationLabelFor({ verified: true });
    return verificationLabelFor({ verified: false, hasHash });
  };

  return (
    <div>
      <PageHeader
        title="Expenditure"
        subtitle="Recorded spend per demo project, traced to milestones and payments. The settled payments total is shown separately because INR budget records and simulated USDC settlement are different concepts."
        actions={<Link href="/janlekha/payments" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">See payments</Link>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Budget in filter" value={formatINR(totalBudget)} sub={filtered.length + " projects shown"} tone="navy" />
        <StatCard label="Released in filter" value={formatINR(totalReleased)} sub="Funds made available" tone="cyan" />
        <StatCard label="Spent in filter" value={formatINR(totalSpent)} sub={totalReleased > 0 ? ((totalSpent / totalReleased) * 100).toFixed(1) + "% of released" : "No release"} tone="green" />
        <StatCard label="Settled payments in filter" value={formatINR(settledPaid)} sub="Simulated USDC, INR record" tone="cyan" />
      </div>

      <Card className="mt-6 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="exp-search">Search</label>
            <input id="exp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, place or contractor" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="exp-dept">Department</label>
            <select id="exp-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="exp-status">Status</label>
            <select id="exp-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{filtered.length} of {projects.length} projects</p>
          {(search || dept !== "all" || status !== "all") && (
            <button onClick={() => { setSearch(""); setDept("all"); setStatus("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No projects match. Clear a filter and try again.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Released</th>
                <th className="px-4 py-3">Spent</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Figure label</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={"/janlekha/projects/" + p.id} className="font-semibold text-slate-900 hover:text-cyan-700">{p.name}</Link>
                    <span className="block text-xs text-slate-500">{p.department} . {p.location}</span>
                  </td>
                  <td className="px-4 py-3">{formatINRCompact(p.budgetInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(p.releasedInr)}</td>
                  <td className="px-4 py-3 font-semibold">{formatINRCompact(p.spentInr)}</td>
                  <td className="px-4 py-3">{p.progress}%</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="px-4 py-3"><VerificationBadge label={labelFor(p.id)} /></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-4 py-3">Filtered total</td>
                <td className="px-4 py-3">{formatINRCompact(totalBudget)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalReleased)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalSpent)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3"><VerificationBadge label="demonstration data" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <VerificationLegend />
    </div>
  );
}
