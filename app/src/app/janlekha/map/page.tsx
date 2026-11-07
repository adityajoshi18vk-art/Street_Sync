"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import IndiaMap from "@/components/janlekha/IndiaMap";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatINRCompact } from "@/lib/janlekha/format";

export default function MapPage() {
  const { projects } = useJanLekha();
  const [state, setState] = useState<string | null>(null);
  const filtered = useMemo(() => (state ? projects.filter((p) => p.state === state) : projects), [projects, state]);
  const states = useMemo(() => {
    const map = new Map<string, { count: number; spent: number }>();
    projects.forEach((p) => {
      const cur = map.get(p.state) ?? { count: 0, spent: 0 };
      map.set(p.state, { count: cur.count + 1, spent: cur.spent + p.spentInr });
    });
    return [...map.entries()].sort((a, b) => b[1].spent - a[1].spent);
  }, [projects]);

  return (
    <>
      <PageHeader
        title="Project map"
        subtitle="Demo projects by state. Marker positions are approximate, not precise geography, and all figures are demo data."
        actions={<Link href="/janlekha/projects" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">List all projects</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <IndiaMap selected={state} onSelect={setState} />
          <h2 className="mt-5 text-lg font-bold text-[#080F1C]">Projects by state</h2>
          <ul className="mt-3 space-y-2">
            {states.map(([s, v]) => (
              <li key={s}>
                <button
                  onClick={() => setState(state === s ? null : s)}
                  className={"flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm hover:border-cyan-400 " + (state === s ? "border-cyan-500 bg-cyan-50" : "border-slate-200")}
                >
                  <span><strong className="text-slate-900">{s}</strong><span className="block text-slate-600">{v.count} projects</span></span>
                  <span className="font-bold text-emerald-600">{formatINRCompact(v.spent)} spent</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">{state ? "Projects in " + state : "All projects"}</h2>
            <DemoBadge />
          </div>
          <p className="mt-1 text-sm text-slate-600">{filtered.length} demo projects. Click a card for the full project page.</p>
          {filtered.length === 0 ? (
            <div className="mt-4"><EmptyState title="No projects in this state" body="No demo project is recorded for this state. Try another state or view all projects." link="/janlekha/projects" linkLabel="View all projects" /></div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {filtered.map((p) => (
                <Link key={p.id} href={"/janlekha/projects/" + p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-cyan-400">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    <span className="text-xs font-semibold text-slate-500">{p.state}</span>
                  </span>
                  <span className="mt-3 block font-bold text-[#080F1C]">{p.name}</span>
                  <span className="mt-1 block text-sm text-slate-600">{p.department} . {p.location}</span>
                  <span className="mt-3 block text-sm text-slate-600">Spent {formatINR(p.spentInr)} of {formatINR(p.budgetInr)}</span>
                  <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-cyan-500" style={{ width: p.progress + "%" }} /></span>
                  <span className="mt-2 block text-sm text-slate-600">{p.progress}% complete . Contractor: {p.contractor}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
