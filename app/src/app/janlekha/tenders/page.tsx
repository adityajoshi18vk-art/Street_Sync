"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { formatINR, formatDate } from "@/lib/janlekha/format";

function TendersInner() {
  const { tenders, departments } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dept, setDept] = useState("all");
  const statuses = useMemo(() => [...new Set(tenders.map((t) => t.status))], [tenders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenders.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (dept !== "all" && t.departmentId !== dept) return false;
      if (q && !(t.title.toLowerCase().includes(q) || t.project.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tenders, search, status, dept]);

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader title="Tenders" subtitle="Public tenders with their bids. All values are demo data." />
      </div>
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="tender-search">Search</label>
            <input id="tender-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tender or project name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="tender-status">Status</label>
            <select id="tender-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="tender-dept">Department</label>
            <select id="tender-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{filtered.length} of {tenders.length} demo tenders</p>
          <div className="flex items-center gap-2">
            <DemoBadge />
            {(search || status !== "all" || dept !== "all") ? (
              <button onClick={() => { setSearch(""); setStatus("all"); setDept("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
            ) : null}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <div className="mt-6"><EmptyState title="No tenders match" body="Try a different search term or clear a filter." link="/janlekha/tenders" linkLabel="Reset list" /></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><th className="px-4 py-3">Tender</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Deadline</th><th className="px-4 py-3">Bids</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3"><Link href={"/janlekha/tenders/" + t.id} className="font-semibold text-slate-900 hover:text-cyan-700">{t.title}</Link><span className="block text-xs text-slate-500">{t.project}</span></td>
                  <td className="px-4 py-3">{t.department}</td>
                  <td className="px-4 py-3 font-semibold">{formatINR(t.valueInr)}</td>
                  <td className="px-4 py-3">{formatDate(t.deadline)}</td>
                  <td className="px-4 py-3">{t.bids.length}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                  <td className="px-4 py-3"><Link href={"/janlekha/tenders/" + t.id} className="inline-flex items-center gap-1 font-semibold text-cyan-700 hover:text-cyan-800"><FileText className="h-4 w-4" aria-hidden /> View bids</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TendersPage() {
  return (
    <JanLekhaProvider>
      <TendersInner />
    </JanLekhaProvider>
  );
}
