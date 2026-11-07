// Budgets: searchable, filterable department budget table with totals.
// Every figure is traceable to a department record and carries a label.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact } from "@/lib/janlekha/format";
import { Card, PageHeader, StatCard, VerificationBadge, VerificationLegend, verificationLabelFor } from "@/components/janlekha/ui";

export default function BudgetsPage() {
  const { departments, documents } = useJanLekha();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const states = useMemo(() => [...new Set(departments.map((d) => d.state))], [departments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return departments.filter((d) => {
      if (state !== "all" && d.state !== state) return false;
      if (q && !(d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q) || d.head.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [departments, search, state]);

  const totalBudget = filtered.reduce((s, d) => s + d.budgetInr, 0);
  const totalAllocated = filtered.reduce((s, d) => s + d.allocatedInr, 0);
  const totalReleased = filtered.reduce((s, d) => s + d.releasedInr, 0);
  const totalSpent = filtered.reduce((s, d) => s + d.spentInr, 0);

  const labelFor = (deptId: string) => {
    const docs = documents.filter((d) => departments.find((x) => x.id === deptId)?.name === d.project || false);
    const verified = docs.some((d) => d.verified);
    const hasHash = docs.some((d) => d.hash);
    return verificationLabelFor({ verified, hasHash });
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Approved budget for each demo department. Search and filter the table, and open a department to see its projects and the figures behind them."
        actions={<Link href="/janlekha/allocations" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">See allocations</Link>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total budget" value={formatINR(totalBudget)} sub={filtered.length + " departments shown"} tone="navy" />
        <StatCard label="Allocated" value={formatINR(totalAllocated)} sub="Of the filtered budget" tone="cyan" />
        <StatCard label="Released" value={formatINR(totalReleased)} sub="Of the filtered allocation" tone="cyan" />
        <StatCard label="Spent" value={formatINR(totalSpent)} sub="Of the filtered release" tone="green" />
      </div>

      <Card className="mt-6 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="budget-search">Search</label>
            <input id="budget-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Department, code or head" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="budget-state">State</label>
            <select id="budget-state" value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="all">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{filtered.length} of {departments.length} departments</p>
          {(search || state !== "all") && (
            <button onClick={() => { setSearch(""); setState("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No departments match. Clear the search or the state filter.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Allocated</th>
                <th className="px-4 py-3">Released</th>
                <th className="px-4 py-3">Spent</th>
                <th className="px-4 py-3">Remaining</th>
                <th className="px-4 py-3">Figure label</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={"/janlekha/departments/" + d.id} className="font-semibold text-slate-900 hover:text-cyan-700">{d.name}</Link>
                    <span className="block text-xs text-slate-500">{d.code} . Head: {d.head} . {d.state}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{formatINRCompact(d.budgetInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(d.allocatedInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(d.releasedInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(d.spentInr)}</td>
                  <td className="px-4 py-3">{formatINRCompact(d.budgetInr - d.spentInr)}</td>
                  <td className="px-4 py-3"><VerificationBadge label={labelFor(d.id)} /></td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-4 py-3">Filtered total</td>
                <td className="px-4 py-3">{formatINRCompact(totalBudget)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalAllocated)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalReleased)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalSpent)}</td>
                <td className="px-4 py-3">{formatINRCompact(totalBudget - totalSpent)}</td>
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
