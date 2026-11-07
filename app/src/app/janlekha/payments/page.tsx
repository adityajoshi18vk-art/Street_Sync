"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { formatINR, formatINRCompact, formatUSDC, formatDate } from "@/lib/janlekha/format";
import { ARC_TESTNET } from "@/lib/janlekha/arc";

function PaymentsInner() {
  const { payments, projects } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const statuses = useMemo(() => [...new Set(payments.map((p) => p.status))], [payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...payments]
      .filter((p) => {
        if (status !== "all" && p.status !== status) return false;
        if (projectId !== "all" && p.projectId !== projectId) return false;
        if (q && !(p.payee.toLowerCase().includes(q) || p.txRef.toLowerCase().includes(q) || p.project.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [payments, search, status, projectId]);

  const totalInr = filtered.reduce((s, p) => s + p.amountInr, 0);
  const totalUsdc = filtered.reduce((s, p) => s + p.amountUsdc, 0);

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Payments"
          subtitle="Payment history. INR budget records and simulated USDC settlement are separate concepts. Every SIM-ARC reference is a simulated demo reference, not a real transaction hash."
          actions={
            <a href={ARC_TESTNET.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Arc Testnet explorer <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          }
        />
      </div>
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="pay-search">Search</label>
            <input id="pay-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Payee, project or reference" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="pay-status">Status</label>
            <select id="pay-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="pay-project">Project</label>
            <select id="pay-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            {filtered.length} of {payments.length} demo payments . Filtered total: <strong className="text-slate-900">{formatINR(totalInr)}</strong> and, separately, <strong className="text-slate-900">{formatUSDC(totalUsdc)}</strong> (simulated)
          </p>
          <div className="flex items-center gap-2">
            <DemoBadge />
            {(search || status !== "all" || projectId !== "all") ? (
              <button onClick={() => { setSearch(""); setStatus("all"); setProjectId("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
            ) : null}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <div className="mt-6"><EmptyState title="No payments match" body="Try a different search term or clear a filter." link="/janlekha/payments" linkLabel="Reset list" /></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Payee</th><th className="px-4 py-3">Amount (INR)</th><th className="px-4 py-3">Amount (USDC, simulated)</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reference</th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">{formatDate(p.date)}</td>
                  <td className="px-4 py-3"><Link href={"/janlekha/projects/" + p.projectId} className="font-semibold text-slate-900 hover:text-cyan-700">{p.project}</Link><span className="block text-xs text-slate-500">{p.kind}</span></td>
                  <td className="px-4 py-3">{p.payee}</td>
                  <td className="px-4 py-3 font-semibold">{formatINRCompact(p.amountInr)}</td>
                  <td className="px-4 py-3">{formatUSDC(p.amountUsdc)}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="px-4 py-3">
                    <a href={ARC_TESTNET.explorer} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline" title="Simulated demo reference, not a real transaction hash. Link opens the Arc Testnet explorer home.">{p.txRef}</a>
                    <span className="block text-xs font-semibold text-amber-700">SIMULATED</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Demo data only. References link to the Arc Testnet explorer home, never to a transaction page, because no real transaction exists for these demo payments.
      </p>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <JanLekhaProvider>
      <PaymentsInner />
    </JanLekhaProvider>
  );
}
