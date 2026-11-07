// Allocations: searchable, filterable allocation table with totals, plus a
// working approve and create allocation flow backed by the provider.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact, formatDate } from "@/lib/janlekha/format";
import { Badge, Card, PageHeader, StatCard, VerificationBadge, VerificationLegend, statusTone } from "@/components/janlekha/ui";

export default function AllocationsPage() {
  const { allocations, projects, createAllocation, approveAllocation } = useJanLekha();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [amountCr, setAmountCr] = useState("");
  const [message, setMessage] = useState("");
  const statuses = useMemo(() => [...new Set(allocations.map((a) => a.status))], [allocations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allocations.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (q && !(a.project.toLowerCase().includes(q) || a.department.toLowerCase().includes(q) || a.approvedBy.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allocations, search, status]);

  const total = filtered.reduce((s, a) => s + a.amountInr, 0);
  const approvedTotal = filtered.filter((a) => a.status === "Approved").reduce((s, a) => s + a.amountInr, 0);

  const submitAllocation = () => {
    const amount = Number(amountCr);
    if (!projectId || !amount || amount <= 0) {
      setMessage("Pick a project and enter an amount above zero, in Cr.");
      return;
    }
    createAllocation(projectId, amount * 10000000);
    setMessage("Allocation of Rs " + amount + " Cr approved for the selected project. It now appears at the top of the table.");
    setAmountCr("");
  };

  return (
    <div>
      <PageHeader
        title="Allocations"
        subtitle="Funds reserved for a project from its department budget. Every allocation is traceable to a project record, and the create form below adds a real allocation to the demo data."
        actions={<Link href="/janlekha/releases" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">See releases</Link>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Filtered total allocated" value={formatINR(total)} sub={filtered.length + " allocations shown"} tone="cyan" />
        <StatCard label="Approved in filter" value={formatINR(approvedTotal)} sub="Approved allocations only" tone="green" />
        <StatCard label="Projects with allocations" value={String(new Set(allocations.map((a) => a.projectId)).size)} sub={projects.length + " demo projects in total"} tone="navy" />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-lg font-bold text-[#080F1C]">Approve a new allocation</h2>
        <p className="mt-1 text-sm text-slate-600">This writes to the demo data in this browser. It is not a real budget action.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="alloc-project">Project</label>
            <select id="alloc-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="alloc-amount">Amount (Rs Cr)</label>
            <input id="alloc-amount" type="number" min="0" step="0.01" value={amountCr} onChange={(e) => setAmountCr(e.target.value)} placeholder="e.g. 25" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </div>
          <div className="flex items-end">
            <button onClick={submitAllocation} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">Approve allocation</button>
          </div>
        </div>
        {message ? <p className="mt-3 text-sm font-medium text-emerald-700">{message}</p> : null}
      </Card>

      <Card className="mt-6 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="alloc-search">Search</label>
            <input id="alloc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, department or approver" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="alloc-status">Status</label>
            <select id="alloc-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{filtered.length} of {allocations.length} allocations</p>
          {(search || status !== "all") && (
            <button onClick={() => { setSearch(""); setStatus("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No allocations match. Clear the search or the status filter.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Figure label</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={"/janlekha/projects/" + a.projectId} className="font-semibold text-slate-900 hover:text-cyan-700">{a.project}</Link>
                    <span className="block text-xs text-slate-500">Approved by {a.approvedBy}</span>
                  </td>
                  <td className="px-4 py-3">{a.department}</td>
                  <td className="px-4 py-3 font-semibold">{formatINRCompact(a.amountInr)}</td>
                  <td className="px-4 py-3">{formatDate(a.date)}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(a.status)}>{a.status}</Badge></td>
                  <td className="px-4 py-3"><VerificationBadge label="demonstration data" /></td>
                  <td className="px-4 py-3">
                    {a.status !== "Approved" ? (
                      <button onClick={() => approveAllocation(a.id)} className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700">Approve</button>
                    ) : (
                      <span className="text-xs text-slate-500">Approved</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-4 py-3">Filtered total</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3">{formatINRCompact(total)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3"><VerificationBadge label="demonstration data" /></td>
                <td className="px-4 py-3" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <VerificationLegend />
    </div>
  );
}
