import type { ReactNode } from "react";
import Link from "next/link";
import { DEMO_NOTICE } from "@/lib/janlekha/data";

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-amber-800">
      DEMO DATA
    </span>
  );
}

export function DemoNotice({ light = false }: { light?: boolean }) {
  return (
    <p className={"text-xs leading-relaxed " + (light ? "text-slate-400" : "text-slate-500")}>
      <span className="font-semibold">Demo data:</span> realistic synthetic demonstration data. This is not actual government expenditure.
    </p>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"rounded-2xl border border-slate-200 bg-white shadow-sm " + className}>{children}</div>;
}

export function StatCard({ label, value, sub, tone = "cyan" }: { label: string; value: string; sub?: string; tone?: "cyan" | "green" | "amber" | "red" | "navy" }) {
  const tones: Record<string, string> = { cyan: "text-cyan-600", green: "text-emerald-600", amber: "text-amber-600", red: "text-red-600", navy: "text-slate-800" };
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={"mt-2 text-2xl font-bold tracking-tight " + tones[tone]}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "cyan" | "blue" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    cyan: "bg-cyan-100 text-cyan-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return <span className={"inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold " + tones[tone]}>{children}</span>;
}

export function statusTone(s: string): "green" | "amber" | "red" | "slate" | "cyan" | "blue" {
  if (["Verified", "Settled", "Published", "Awarded", "Selected", "Resolved"].includes(s)) return "green";
  if (["In Progress", "Submitted", "Under Review", "Open", "Pending authorisation", "Pending"].includes(s)) return "amber";
  if (["Delayed", "Critical", "High"].includes(s)) return "red";
  if (["Paid"].includes(s)) return "cyan";
  return "slate";
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p> : null}
        <div className="mt-2">
          <DemoBadge />
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, link, linkLabel }: { title: string; body: string; link?: string; linkLabel?: string }) {
  return (
    <Card className="p-8 text-center">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{body}</p>
      {link ? (
        <Link href={link} className="mt-4 inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
          {linkLabel ?? "Browse"}
        </Link>
      ) : null}
    </Card>
  );
}

// Figure traceability labels. In this demo no contracts are deployed yet,
// so "on chain verified" means the demo registry recorded a verified hash.
// It is not a real on chain record. Every figure is still DEMO DATA.
export type VerificationLabel = "on chain verified" | "reported but unverified" | "demonstration data";

export function verificationLabelFor(opts: { verified?: boolean; hasHash?: boolean; simulated?: boolean }): VerificationLabel {
  if (opts.verified) return "on chain verified";
  if (opts.hasHash) return "reported but unverified";
  return "demonstration data";
}

export function VerificationBadge({ label }: { label: VerificationLabel }) {
  const tone = label === "on chain verified" ? "green" : label === "reported but unverified" ? "amber" : "slate";
  return <Badge tone={tone}>{label}</Badge>;
}

export function VerificationLegend() {
  return (
    <p className="mt-3 text-xs leading-relaxed text-slate-500">
      Figure labels: on chain verified means a verified hash is recorded in the demo registry; reported but unverified means a figure was
      reported with a hash that is not verified; demonstration data means a demo figure with no supporting hash. No contracts are deployed yet,
      so no figure here is a real on chain record.
    </p>
  );
}

export { DEMO_NOTICE };
