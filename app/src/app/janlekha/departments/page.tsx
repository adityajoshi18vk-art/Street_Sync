"use client";

import Link from "next/link";
import { Card, DemoBadge, PageHeader } from "@/components/janlekha/ui";
import { SharePieChart } from "@/components/janlekha/Charts";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact } from "@/lib/janlekha/format";

export default function Departments() {
  const { departments, projects } = useJanLekha();
  const pieData = departments.map((d) => ({ name: d.code, value: d.spentInr }));

  return (
    <>
      <PageHeader title="Departments" subtitle="Budget, allocation, release and spend for each demo department. All figures are demo data." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Share of spend</h2>
            <DemoBadge />
          </div>
          <div className="mt-2"><SharePieChart data={pieData} /></div>
          <p className="text-sm text-slate-600">Demo spend by department code.</p>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {departments.map((d) => {
            const util = d.budgetInr > 0 ? (d.spentInr / d.budgetInr) * 100 : 0;
            const count = projects.filter((p) => p.departmentId === d.id).length;
            return (
              <Link key={d.id} href={"/janlekha/departments/" + d.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-cyan-400 hover:shadow-md">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-lg bg-[#080F1C] px-2.5 py-1 text-xs font-bold text-cyan-400">{d.code}</span>
                  <span className="text-xs font-semibold text-slate-500">{count} projects</span>
                </span>
                <span className="mt-3 block font-bold text-[#080F1C]">{d.name}</span>
                <span className="mt-1 block text-sm text-slate-600">Head: {d.head} . {d.state}</span>
                <span className="mt-3 block text-sm text-slate-600">Budget {formatINR(d.budgetInr)} . Spent {formatINR(d.spentInr)}</span>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: Math.min(100, util) + "%" }} /></span>
                <span className="mt-2 flex flex-wrap justify-between text-sm">
                  <span className="text-slate-600">Utilisation {util.toFixed(1)}%</span>
                  <span className="font-semibold text-cyan-700">Open department</span>
                </span>
                <span className="mt-1 block text-xs text-slate-500">Allocated {formatINRCompact(d.allocatedInr)} . Released {formatINRCompact(d.releasedInr)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
