"use client";

import Link from "next/link";
import { Badge, Card, DemoBadge, DemoNotice, StatCard, statusTone } from "@/components/janlekha/ui";
import { MoneyBarChart } from "@/components/janlekha/Charts";
import { reports } from "@/lib/janlekha/data";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact, formatDate } from "@/lib/janlekha/format";

const SECTIONS = [
  { to: "/janlekha/money-flow", title: "Where Did My Money Go", body: "Follow demo funds from the national budget to departments, projects, contractors and payments." },
  { to: "/janlekha/departments", title: "Departments", body: "Six departments, with budget, allocation, release and spend for each one." },
  { to: "/janlekha/projects", title: "Projects", body: "Searchable public projects with milestones, payments and documents." },
  { to: "/janlekha/tenders", title: "Tenders", body: "Open and awarded tenders with every bid shown in public." },
  { to: "/janlekha/payments", title: "Payments", body: "Payment history in INR and, separately, simulated USDC on Arc Testnet." },
  { to: "/janlekha/documents", title: "Documents", body: "Contracts, award letters and certificates with verification hashes." },
  { to: "/janlekha/audits", title: "Audit reports", body: "Independent audit reports and open risk flags." },
  { to: "/janlekha/map", title: "Project map", body: "Projects by state on a simplified map with approximate positions." },
  { to: "/janlekha/complaints", title: "Complaints", body: "Raise a complaint about a public project and track its status." },
  { to: "/janlekha/verify", title: "Verify a document", body: "Check a document hash against the demo record." },
];

export default function CitizenPortal() {
  const { projects, payments, departments } = useJanLekha();
  const t = {
    totalBudget: departments.reduce((s, d) => s + d.budgetInr, 0),
    totalAllocated: departments.reduce((s, d) => s + d.allocatedInr, 0),
    totalReleased: departments.reduce((s, d) => s + d.releasedInr, 0),
    totalSpent: departments.reduce((s, d) => s + d.spentInr, 0),
    remaining: 0,
    unreleased: 0,
  };
  t.remaining = t.totalBudget - t.totalSpent;
  t.unreleased = t.totalAllocated - t.totalReleased;
  const topProjects = [...projects].sort((a, b) => b.spentInr - a.spentInr).slice(0, 4);
  const latestPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const latestReports = [...reports].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const barData = departments.map((d) => ({ name: d.code, Budget: d.budgetInr, Allocated: d.allocatedInr, Released: d.releasedInr, Spent: d.spentInr }));

  return (
    <>
      <section className="rounded-3xl bg-[#080F1C] px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="flex flex-wrap items-center gap-2">
          <DemoBadge />
          <Badge tone="green">No wallet required</Badge>
          <Badge tone="cyan">Public access</Badge>
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">Every rupee, traced from budget to payment.</h1>
        <p className="mt-4 max-w-2xl text-base text-slate-300">
          JanLekha 2.0 is a public financial transparency platform. Citizens can see demo budgets, allocations, releases, milestones and payments, and follow the money to the contractor who was paid.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/janlekha/money-flow" className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#080F1C] hover:bg-cyan-300">Where Did My Money Go</Link>
          <Link href="/janlekha/projects" className="rounded-lg border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">Browse projects</Link>
          <Link href="/janlekha/map" className="rounded-lg border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">Explore the map</Link>
        </div>
        <p className="mt-6 text-xs text-slate-400">Demo data: realistic synthetic demonstration data. This is not actual government expenditure.</p>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-[#080F1C]">National totals</h2>
          <DemoBadge />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Total budget" value={formatINR(t.totalBudget)} sub="Demo, all departments" tone="navy" />
          <StatCard label="Allocated" value={formatINR(t.totalAllocated)} sub={((t.totalAllocated / t.totalBudget) * 100).toFixed(1) + "% of budget"} tone="cyan" />
          <StatCard label="Released" value={formatINR(t.totalReleased)} sub={((t.totalReleased / t.totalAllocated) * 100).toFixed(1) + "% of allocated"} tone="cyan" />
          <StatCard label="Spent" value={formatINR(t.totalSpent)} sub={((t.totalSpent / t.totalReleased) * 100).toFixed(1) + "% of released"} tone="green" />
          <StatCard label="Remaining" value={formatINR(t.remaining)} sub="Budget minus spent" tone="amber" />
        </div>
        <div className="mt-2"><DemoNotice /></div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Department expenditure</h2>
            <DemoBadge />
          </div>
          <p className="mt-1 text-sm text-slate-600">Budget, allocated, released and spent by department. Demo data.</p>
          <div className="mt-4"><MoneyBarChart data={barData} /></div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Where Did My Money Go</h2>
            <DemoBadge />
          </div>
          <p className="mt-2 text-sm text-slate-600">Pick a project and follow it step by step: budget, allocation, release, milestone, payment.</p>
          <ol className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#080F1C] text-xs font-bold text-cyan-400">1</span><span><strong>Budget approved</strong> for a department and project.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#080F1C] text-xs font-bold text-cyan-400">2</span><span><strong>Funds allocated and released</strong> in stages, not all at once.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#080F1C] text-xs font-bold text-cyan-400">3</span><span><strong>Milestone verified</strong> by an independent auditor before payment.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#080F1C] text-xs font-bold text-cyan-400">4</span><span><strong>Payment settled</strong> to the contractor, shown as a simulated USDC reference.</span></li>
          </ol>
          <Link href="/janlekha/money-flow" className="mt-5 inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">Follow the money</Link>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Top projects by spend</h2>
            <DemoBadge />
          </div>
          <ul className="mt-4 space-y-4">
            {topProjects.map((p) => (
              <li key={p.id}>
                <Link href={"/janlekha/projects/" + p.id} className="block rounded-xl p-2 hover:bg-slate-50">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{p.name}</span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">{p.department} . {p.location} . Spent {formatINR(p.spentInr)} of {formatINR(p.budgetInr)}</span>
                  <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-cyan-500" style={{ width: p.progress + "%" }} /></span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/janlekha/projects" className="mt-4 inline-block text-sm font-semibold text-cyan-700 hover:text-cyan-800">See all projects</Link>
        </Card>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Latest payments</h2>
            <DemoBadge />
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {latestPayments.map((pay) => (
              <li key={pay.id} className="py-3">
                <Link href="/janlekha/payments" className="block hover:text-cyan-700">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{pay.payee}</span>
                    <span className="font-bold text-emerald-600">{formatINRCompact(pay.amountInr)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">{pay.project} . {formatDate(pay.date)} . {pay.status} . Ref {pay.txRef} (simulated)</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/janlekha/payments" className="mt-4 inline-block text-sm font-semibold text-cyan-700 hover:text-cyan-800">See all payments</Link>
        </Card>
      </section>

      <section className="mt-8">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Latest audit reports</h2>
            <DemoBadge />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {latestReports.map((r) => (
              <Link key={r.id} href="/janlekha/audits" className="rounded-xl border border-slate-200 p-4 hover:border-cyan-400">
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <p className="mt-2 font-semibold text-slate-900">{r.title}</p>
                <p className="mt-1 text-sm text-slate-600">{r.summary}</p>
                <p className="mt-2 text-xs text-slate-500">{r.auditor} . {formatDate(r.date)} . {r.findings} findings</p>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-[#080F1C]">Explore every public section</h2>
        <p className="mt-1 text-sm text-slate-600">All sections are open to citizens. No sign in and no wallet is needed.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SECTIONS.map((s) => (
            <Link key={s.to} href={s.to} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-cyan-400 hover:shadow-md">
              <h3 className="font-bold text-[#080F1C]">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{s.body}</p>
              <span className="mt-3 inline-block text-sm font-semibold text-cyan-700">Open section</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
