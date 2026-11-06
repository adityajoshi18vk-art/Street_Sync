import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, ErrorPanel, LoadingPanel, OffChain, OnChain } from "@/components/ui";
import { catalogProject, formatPaise, formatTimestamp, shortHex } from "@/lib/janlekha/format";
import { listProjects, type Stage } from "@/lib/janlekha/reads";
import { CreateProjectPanel } from "./CreateProjectPanel";

export const metadata: Metadata = { title: "Projects" };

const STAGE_TONE: Record<Stage, "neutral" | "good" | "warn" | "onchain"> = {
  "Tender not published": "neutral",
  "Bidding open": "good",
  "Reveal period": "warn",
  "Awaiting award": "warn",
  "In delivery": "good",
  Completed: "onchain",
};

async function ProjectList() {
  await connection();
  const result = await listProjects();
  if (!result.ok) return <ErrorPanel failure={result.failure} />;
  if (result.projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] backdrop-blur-xl p-8 text-center text-sm text-slate-300">
        No projects have been recorded on this contract yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {result.total.toString()} project(s) on chain {result.ctx.cfg.chainId}, read live at block{" "}
        {result.ctx.blockNumber.toString()} ({formatTimestamp(result.ctx.chainTime)}).
      </p>
      <ul className="space-y-3">
        {result.projects.map((p) => {
          const meta = catalogProject(p.sanctionDocumentHash);
          return (
            <li key={p.id.toString()}>
              <Link
                href={`/projects/${p.id}`}
                className="block card p-4 transition hover:border-blue-400/50 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-400">Project #{p.id.toString()}</p>
                    <p className="font-semibold text-white">{meta?.title ?? `Untitled project #${p.id}`}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {meta ? `${meta.department} · ` : ""}department <code className="font-mono">{shortHex(p.department)}</code>
                    </p>
                  </div>
                  <Badge tone={STAGE_TONE[p.stage]}>{p.stage}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  {[
                    ["Allocation", p.budget.allocationPaise],
                    ["Reserved", p.budget.reservedPaise],
                    ["Paid (mock attested)", p.budget.paidPaise],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-slate-400">{label as string}</dt>
                      <dd className="font-medium tabular-nums">{formatPaise(value as bigint)}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="heading text-2xl sm:text-3xl">Public projects</h1>
        <p className="mt-1 text-sm text-slate-300">
          Budget, tender and delivery records read directly from the JanLekha contract. No wallet needed.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <OnChain />
          <OffChain />
          <span className="text-xs text-slate-400">Titles and department names are off-chain demo metadata.</span>
        </div>
      </div>
      <CreateProjectPanel />
      <Suspense fallback={<LoadingPanel label="Reading projects from the contract…" />}>
        <ProjectList />
      </Suspense>
    </div>
  );
}
