"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR } from "@/lib/janlekha/format";

type SortKey = "spent-desc" | "budget-desc" | "progress-desc" | "name-asc";

export default function Projects() {
  const { projects, departments } = useJanLekha();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("spent-desc");
  const statuses = useMemo(() => [...new Set(projects.map((p) => p.status))], [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (dept !== "all" && p.departmentId !== dept) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q) || p.contractor.toLowerCase().includes(q))) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === "spent-desc") sorted.sort((a, b) => b.spentInr - a.spentInr);
    if (sort === "budget-desc") sorted.sort((a, b) => b.budgetInr - a.budgetInr);
    if (sort === "progress-desc") sorted.sort((a, b) => b.progress - a.progress);
    if (sort === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [projects, search, dept, status, sort]);

  return (
    <>
      <PageHeader title="Projects" subtitle="Searchable, filterable list of demo public projects. Every figure is demo data." />
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="project-search">Search</label>
            <input id="project-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, place or contractor" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="project-dept">Department</label>
            <select id="project-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="project-status">Status</label>
            <select id="project-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="project-sort">Sort by</label>
            <select id="project-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="spent-desc">Highest spend</option>
              <option value="budget-desc">Largest budget</option>
              <option value="progress-desc">Most progress</option>
              <option value="name-asc">Name, A to Z</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{filtered.length} of {projects.length} demo projects</p>
          <div className="flex items-center gap-2">
            <DemoBadge />
            {(search || dept !== "all" || status !== "all") ? (
              <button onClick={() => { setSearch(""); setDept("all"); setStatus("all"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear filters</button>
            ) : null}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <div className="mt-6"><EmptyState title="No projects match" body="Try a different search term or clear a filter. The demo set has a small number of projects." link="/janlekha/projects" linkLabel="Reset list" /></div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link key={p.id} href={"/janlekha/projects/" + p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-cyan-400 hover:shadow-md">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                <span className="text-xs font-semibold text-slate-500">{p.state}</span>
              </span>
              <span className="mt-3 block font-bold text-[#080F1C]">{p.name}</span>
              <span className="mt-1 block text-sm text-slate-600">{p.department}</span>
              <span className="mt-1 block text-sm text-slate-600">{p.location} . Contractor: {p.contractor}</span>
              <span className="mt-3 block text-sm text-slate-600">Budget {formatINR(p.budgetInr)} . Spent {formatINR(p.spentInr)}</span>
              <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-cyan-500" style={{ width: p.progress + "%" }} /></span>
              <span className="mt-2 block text-sm text-slate-600">{p.progress}% complete</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
