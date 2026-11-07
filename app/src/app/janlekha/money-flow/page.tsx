"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sankey from "@/components/janlekha/Sankey";
import { Badge, Card, DemoBadge, PageHeader, statusTone } from "@/components/janlekha/ui";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR, formatUSDC, formatDate } from "@/lib/janlekha/format";
import { ARC_TESTNET } from "@/lib/janlekha/arc";

export default function MoneyFlow() {
  const { projects, milestones, payments } = useJanLekha();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [openStep, setOpenStep] = useState<number | null>(4);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const projectMilestones = useMemo(
    () => (project ? milestones.filter((m) => m.projectId === project.id).sort((a, b) => b.dueDate.localeCompare(a.dueDate)) : []),
    [milestones, project],
  );
  const projectPayments = useMemo(
    () => (project ? payments.filter((p) => p.projectId === project.id).sort((a, b) => b.date.localeCompare(a.date)) : []),
    [payments, project],
  );
  const latestMilestone = projectMilestones[0];
  const latestPayment = projectPayments[0];
  const paidTotal = projectPayments.filter((p) => p.status === "Settled").reduce((s, p) => s + p.amountInr, 0);

  const steps = project
    ? [
        { n: 1, title: "Budget approved", amount: formatINR(project.budgetInr), detail: "The demo budget approved for " + project.name + " in " + project.department + ". This is the ceiling, not money already spent." },
        { n: 2, title: "Funds allocated", amount: formatINR(project.allocatedInr), detail: formatINR(project.allocatedInr) + " of the budget was allocated to this project. Allocation reserves funds for the project." },
        { n: 3, title: "Funds released", amount: formatINR(project.releasedInr), detail: formatINR(project.releasedInr) + " has been released so far. Releases happen in stages as work progresses." },
        {
          n: 4,
          title: "Milestone verified",
          amount: latestMilestone ? formatINR(latestMilestone.amountInr) : "No milestone on record",
          detail: latestMilestone
            ? "Latest milestone: " + latestMilestone.title + ", due " + formatDate(latestMilestone.dueDate) + ", status " + latestMilestone.status + (latestMilestone.verifiedBy ? ", verified by " + latestMilestone.verifiedBy + "." : ".")
            : "No milestone is recorded for this project in the demo data.",
        },
        {
          n: 5,
          title: "Payment settled",
          amount: latestPayment ? formatINR(latestPayment.amountInr) + " (" + formatUSDC(latestPayment.amountUsdc) + ", simulated)" : "No payment on record",
          detail: latestPayment
            ? "Latest payment to " + latestPayment.payee + " on " + formatDate(latestPayment.date) + ", status " + latestPayment.status + ". Reference " + latestPayment.txRef + " is a simulated demo reference, not a real transaction hash."
            : "No payment is recorded for this project in the demo data.",
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Where Did My Money Go"
        subtitle="Follow demo public money from the national budget down to a single payment. Click a node in the flow, or pick a project and walk the journey step by step."
      />
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#080F1C]">Money flow, budget to payment</h2>
          <DemoBadge />
        </div>
        <div className="mt-4"><Sankey /></div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#080F1C]">Follow one project, step by step</h2>
          <DemoBadge />
        </div>
        <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="journey-project">Pick a project</label>
        <select
          id="journey-project"
          value={project?.id ?? ""}
          onChange={(e) => {
            setProjectId(e.target.value);
            setOpenStep(null);
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-xl"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {project ? (
          <div className="mt-4">
            <p className="text-sm text-slate-600">
              {project.description} Contractor: <strong className="text-slate-900">{project.contractor}</strong>. Location: {project.location}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(project.status)}>{project.status}</Badge>
              <Badge tone="slate">{project.progress}% complete</Badge>
              <Badge tone="green">Settled demo payments: {formatINR(paidTotal)}</Badge>
            </div>
            <ol className="mt-5 space-y-3">
              {steps.map((s) => (
                <li key={s.n} className="rounded-xl border border-slate-200">
                  <button onClick={() => setOpenStep(openStep === s.n ? null : s.n)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={openStep === s.n}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#080F1C] text-sm font-bold text-cyan-400">{s.n}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-900">{s.title}</span>
                      <span className="block text-sm text-slate-600">{s.amount}</span>
                    </span>
                    <span className="text-sm font-semibold text-cyan-700">{openStep === s.n ? "Hide" : "Show"}</span>
                  </button>
                  {openStep === s.n ? <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{s.detail}</p> : null}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={"/janlekha/projects/" + project.id} className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open full project page</Link>
              <Link href="/janlekha/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">See all payments</Link>
              <a href={ARC_TESTNET.explorer} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Arc Testnet explorer (demo references only)</a>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              INR amounts are demo budget records. USDC amounts are a separate, simulated settlement concept on Arc Testnet. Payment references starting SIM-ARC are demo references, not real transaction hashes.
            </p>
          </div>
        ) : null}
      </Card>
    </>
  );
}
