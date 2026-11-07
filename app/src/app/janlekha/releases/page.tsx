// Releases: searchable, filterable table of funds released to projects,
// with totals. A release is money actually made available, in stages.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact } from "@/lib/janlekha/format";
import { Badge, Card, PageHeader, StatCard, VerificationBadge, VerificationLegend, verificationLabelFor, statusTone } from "@/components/janlekha/ui";

export default function ReleasesPage() {
  const { projects, departments, milestones } = useJanLekha();
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

  const totalAllocated = filtered.reduce((s, p) => s + p.allocatedInr, 0);
  const totalReleased = filtered.reduce((s, p) => s + p.releasedInr, 0);
  const totalSpent = filtered.reduce((s, p) => s + p.spentInr, 0);

  const labelFor = (projectId: string) => {
    const ms = milestones.filter((m) => m.projectId === projectId);
    const verified = ms.some((m) => m.status === "Verified" || m.status === "Paid");
    const hasHash = ms.some((m) => m.evidenceHash);
    return verificationLabelFor({ verified, hasHash });
  };

  return (
    <div>
      <PageHeader
        title="Releases"
        subtitle="Funds released to each demo project, in stages as work progresses. Released is not the same as spent: the gap is money released but not yet recorded as spent."
        actions={<Link href="/janlekha/expenditure" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">See expenditure</Link>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Allocated in filter" value={formatINR(totalAllocated)} sub={filtered.length + " projects shown"} tone="cyan" />
        <StatCard label="Released in filter" value={formatINR(totalReleased)} sub={totalAllocated > 0 ? ((totalReleased / totalAllocated) * 100).toFixed(1) + "% of allocated" : "No allocation"} tone="cyan" />
        <StatCard label="Spent in filter" value={formatINR(totalSpent)} sub={totalReleased > 0 ? ((totalSpent / totalReleased) * 100).toFixed(1) + "% of released" : "No release"} tone="green" />
        <StatCard label="Released, not yet spent" value={formatINR(totalReleased - totalSpent)} sub="Released minus spent" tone="navy" />
      </div>

      <Card className="mt-6 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="rel-search">Search</label>
            <input id="rel-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, place or contractor" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="rel-dept">Department</label>
            <select id="rel-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="rel-status">Status</label>
            <select id="rel-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
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
                <th className="px-4 py-3">Allocated</th>
                <th className="px-4 py-3">Released</th>
                <th className="px-4 py-3">Released, not spent</th>
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
                  <td className="px-4 py-3">{formatINRCompact(p.allocatedInr)}</td>
                  <td className="px-4 py-3 font-semibold">{formatINRCompact(p.releasedInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(p.releasedInr - p.spentInr)}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="px-4 py-3"><VerificationBadge label={labelFor(p.id)} /></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-4 py-3">Filtered total</td>
                <td className="px-4 py-3">{formatINRCompact(totalAllocated)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalReleased)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalReleased - totalSpent)}</td>
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
