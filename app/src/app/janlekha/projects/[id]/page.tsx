"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Card, DemoBadge, DemoNotice, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatUSDC, formatDate, shortHash } from "@/lib/janlekha/format";
import { ARC_TESTNET } from "@/lib/janlekha/arc";

function MoneyBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-bold text-slate-900">{formatINR(value)} <span className="font-normal text-slate-500">({pct.toFixed(1)}% of budget)</span></span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: pct + "%", backgroundColor: color }} /></div>
    </div>
  );
}

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id as string;
  const { projects, milestones, payments, documents, flags, events, contractors, tenders } = useJanLekha();
  const project = projects.find((p) => p.id === id);
  if (!project) {
    return (
          <>
          <PageHeader title="Project not found" subtitle="This demo project does not exist in the current data." />
        <EmptyState title="Project not found" body="The link may be old, or the demo data was reset. Browse the full project list instead." link="/janlekha/projects" linkLabel="Browse projects" />
      </>
      );
  }
  const projectMilestones = milestones.filter((m) => m.projectId === project.id);
  const projectPayments = payments.filter((p) => p.projectId === project.id);
  const projectDocs = documents.filter((d) => d.projectId === project.id);
  const projectFlags = flags.filter((f) => f.projectId === project.id);
  const timeline = events.filter((e) => e.projectId === project.id).sort((a, b) => b.date.localeCompare(a.date));
  const contractor = contractors.find((c) => c.id === project.contractorId);
  const tender = tenders.find((t) => t.id === project.tenderId);
  const riskTone = (r: string): "green" | "amber" | "red" | "slate" => (r === "Critical" || r === "High" ? "red" : r === "Medium" ? "amber" : r === "Low" ? "green" : "slate");

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={project.description}
        actions={
          <>
            <Link href="/janlekha/projects" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">All projects</Link>
            <Link href="/janlekha/money-flow" className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">Follow the money</Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(project.status)}>{project.status}</Badge>
        <Badge tone="slate">{project.department}</Badge>
        <Badge tone="slate">{project.location}</Badge>
        <Badge tone="cyan">{project.progress}% complete</Badge>
        <DemoBadge />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-lg font-bold text-[#080F1C]">Budget breakdown</h2>
          <p className="mt-1 text-sm text-slate-600">Demo figures. {formatDate(project.startDate)} to {formatDate(project.endDate)}.</p>
          <div className="mt-4 space-y-4">
            <MoneyBar label="Budget" value={project.budgetInr} max={project.budgetInr} color="#080F1C" />
            <MoneyBar label="Allocated" value={project.allocatedInr} max={project.budgetInr} color="#0891B2" />
            <MoneyBar label="Released" value={project.releasedInr} max={project.budgetInr} color="#22D3EE" />
            <MoneyBar label="Spent" value={project.spentInr} max={project.budgetInr} color="#34D399" />
          </div>
          <p className="mt-4 text-sm text-slate-600">Unspent budget: <strong className="text-slate-900">{formatINR(project.budgetInr - project.spentInr)}</strong>. Released but not yet spent: <strong className="text-slate-900">{formatINR(project.releasedInr - project.spentInr)}</strong>.</p>
          <div className="mt-2"><DemoNotice /></div>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Contractor</h2>
          {contractor ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="font-semibold text-slate-900">{contractor.name}</p>
              <p className="text-slate-600">{contractor.type} . {contractor.location}</p>
              <p className="text-slate-600">Rating {contractor.rating} / 5 . {contractor.projectsCompleted} projects completed</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Contractor: {project.contractor}</p>
          )}
          <h3 className="mt-5 text-sm font-bold text-[#080F1C]">Tender</h3>
          {tender ? (
            <p className="mt-2 text-sm text-slate-600">{tender.title} . Value {formatINR(tender.valueInr)} . {tender.status}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Tender reference: {project.tenderId}</p>
          )}
          {tender ? <Link href={"/janlekha/tenders/" + tender.id} className="mt-3 inline-block text-sm font-semibold text-cyan-700 hover:text-cyan-800">View tender and bids</Link> : null}
          <h3 className="mt-5 text-sm font-bold text-[#080F1C]">Department</h3>
          <Link href={"/janlekha/departments/" + project.departmentId} className="mt-2 inline-block text-sm font-semibold text-cyan-700 hover:text-cyan-800">{project.department}</Link>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Milestones</h2>
            <DemoBadge />
          </div>
          {projectMilestones.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No milestones are recorded for this project in the demo data.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {projectMilestones.map((m) => (
                <li key={m.id} className="rounded-xl border border-slate-200 p-4">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{m.title}</span>
                    <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">{formatINR(m.amountInr)} . Due {formatDate(m.dueDate)}{m.verifiedBy ? " . Verified by " + m.verifiedBy : ""}</span>
                  {m.evidenceHash ? <span className="mt-1 block text-xs text-slate-500">Evidence hash: {shortHash(m.evidenceHash)}</span> : <span className="mt-1 block text-xs text-amber-700">No evidence hash on record.</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#080F1C]">Payments</h2>
            <DemoBadge />
          </div>
          {projectPayments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No payments are recorded for this project in the demo data.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Payee</th><th className="py-2 pr-2">INR</th><th className="py-2 pr-2">USDC (simulated)</th><th className="py-2">Reference</th></tr></thead>
                <tbody>
                  {projectPayments.map((pay) => (
                    <tr key={pay.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2">{formatDate(pay.date)}</td>
                      <td className="py-2 pr-2">{pay.payee}<span className="block text-xs text-slate-500">{pay.status}</span></td>
                      <td className="py-2 pr-2 font-semibold">{formatINR(pay.amountInr)}</td>
                      <td className="py-2 pr-2">{formatUSDC(pay.amountUsdc)}</td>
                      <td className="py-2">
                        <a href={ARC_TESTNET.explorer} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline" title="Simulated demo reference, not a real transaction hash. Link opens the Arc Testnet explorer home.">{pay.txRef}</a>
                        <span className="block text-xs text-slate-500">SIMULATED</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">INR and USDC are separate concepts. USDC figures are simulated settlement on Arc Testnet, and SIM-ARC references are demo references, not real transaction hashes.</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Documents</h2>
          {projectDocs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No documents are recorded for this project in the demo data.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {projectDocs.map((d) => (
                <li key={d.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{d.title}</span>
                    <Badge tone={d.verified ? "green" : "amber"}>{d.verified ? "Verified" : "Unverified"}</Badge>
                  </span>
                  <span className="mt-1 block text-slate-600">{d.type} . {formatDate(d.date)} . Uploaded by {d.uploadedBy}</span>
                  <span className="mt-1 block font-mono text-xs text-slate-500">Hash: {shortHash(d.hash)}</span>
                  <Link href="/janlekha/verify" className="mt-2 inline-block font-semibold text-cyan-700 hover:text-cyan-800">Verify this document</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Audit flags</h2>
          {projectFlags.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No audit flags are open for this project. A clean flag list is not proof of no issue, only that nothing is flagged in the demo data.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {projectFlags.map((f) => (
                <li key={f.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={riskTone(f.risk)}>{f.risk} risk</Badge>
                    <Badge tone={statusTone(f.status)}>{f.status}</Badge>
                  </span>
                  <p className="mt-2 font-semibold text-slate-900">{f.reason}</p>
                  <p className="mt-1 text-slate-600">{formatINR(f.amountInr)} . {f.notes}</p>
                  <Link href="/janlekha/audits" className="mt-2 inline-block font-semibold text-cyan-700 hover:text-cyan-800">See audit reports</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Timeline</h2>
          {timeline.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No events are recorded for this project in the demo data.</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {timeline.map((e) => (
                <li key={e.id} className="border-l-2 border-cyan-400 pl-4 text-sm">
                  <p className="font-semibold text-slate-900">{e.type}</p>
                  <p className="text-slate-600">{e.description}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(e.date)} . {e.actor} . Ref {e.txRef} (simulated)</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
