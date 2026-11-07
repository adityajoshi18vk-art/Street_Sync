"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Card, DemoBadge, DemoNotice, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { FlowLineChart, MoneyBarChart } from "@/components/janlekha/Charts";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR } from "@/lib/janlekha/format";

export default function DepartmentDetail() {
  const params = useParams();
  const id = params.id as string;
  const { departments, projects } = useJanLekha();
  const dept = departments.find((d) => d.id === id);
  if (!dept) {
    return (
          <>
          <PageHeader title="Department not found" subtitle="This demo department does not exist in the current data." />
        <EmptyState title="Department not found" body="The link may be old, or the demo data was reset. Browse the full department list instead." link="/janlekha/departments" linkLabel="Browse departments" />
      </>
      );
  }
  const deptProjects = projects.filter((p) => p.departmentId === dept.id);
  const util = dept.budgetInr > 0 ? (dept.spentInr / dept.budgetInr) * 100 : 0;
  const barData = [{ name: dept.code, Budget: dept.budgetInr, Allocated: dept.allocatedInr, Released: dept.releasedInr, Spent: dept.spentInr }];
  const lineData = deptProjects.map((p) => ({ label: p.name.length > 18 ? p.name.slice(0, 18) + "..." : p.name, Released: p.releasedInr, Spent: p.spentInr }));

  return (
    <>
      <PageHeader
        title={dept.name}
        subtitle={"Department " + dept.code + ". Head: " + dept.head + ". Base state in demo data: " + dept.state + "."}
        actions={<Link href="/janlekha/departments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">All departments</Link>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="cyan">{dept.code}</Badge>
        <Badge tone="green">Utilisation {util.toFixed(1)}%</Badge>
        <Badge tone="slate">{deptProjects.length} projects</Badge>
        <DemoBadge />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Budget vs allocated vs released vs spent</h2>
          <p className="mt-1 text-sm text-slate-600">Demo figures for this department.</p>
          <div className="mt-4"><MoneyBarChart data={barData} /></div>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex justify-between"><span className="text-slate-600">Budget</span><strong>{formatINR(dept.budgetInr)}</strong></li>
            <li className="flex justify-between"><span className="text-slate-600">Allocated</span><strong>{formatINR(dept.allocatedInr)}</strong></li>
            <li className="flex justify-between"><span className="text-slate-600">Released</span><strong>{formatINR(dept.releasedInr)}</strong></li>
            <li className="flex justify-between"><span className="text-slate-600">Spent</span><strong>{formatINR(dept.spentInr)}</strong></li>
            <li className="flex justify-between"><span className="text-slate-600">Remaining budget</span><strong>{formatINR(dept.budgetInr - dept.spentInr)}</strong></li>
            <li className="flex justify-between"><span className="text-slate-600">Allocated but not released</span><strong>{formatINR(dept.allocatedInr - dept.releasedInr)}</strong></li>
          </ul>
          <div className="mt-3"><DemoNotice /></div>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Released vs spent by project</h2>
          <p className="mt-1 text-sm text-slate-600">Demo figures for this department's projects.</p>
          {lineData.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No projects are recorded for this department.</p>
          ) : (
            <div className="mt-4"><FlowLineChart data={lineData} /></div>
          )}
        </Card>
      </div>

      <h2 className="mt-8 text-xl font-bold text-[#080F1C]">Projects in this department</h2>
      {deptProjects.length === 0 ? (
        <div className="mt-4"><EmptyState title="No projects" body="No demo projects are recorded for this department." link="/janlekha/projects" linkLabel="Browse all projects" /></div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {deptProjects.map((p) => (
            <Link key={p.id} href={"/janlekha/projects/" + p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-cyan-400">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                <span className="text-xs font-semibold text-slate-500">{p.state}</span>
              </span>
              <span className="mt-3 block font-bold text-[#080F1C]">{p.name}</span>
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
