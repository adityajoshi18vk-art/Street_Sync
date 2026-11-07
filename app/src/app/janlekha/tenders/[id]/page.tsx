"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { formatINR, formatDate } from "@/lib/janlekha/format";

function TenderDetailInner() {
  const { id } = useParams() as { id: string };
  const { tenders } = useApp();
  const tender = tenders.find((t) => t.id === id);
  if (!tender) {
    return (
      <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
        <PageHeader title="Tender not found" subtitle="This demo tender does not exist in the current data." />
        <EmptyState title="Tender not found" body="The link may be old, or the demo data was reset. Browse the full tender list instead." link="/janlekha/tenders" linkLabel="Browse tenders" />
      </div>
    );
  }
  const bids = [...tender.bids].sort((a, b) => a.amountInr - b.amountInr);
  const lowest = bids[0];
  const selected = tender.bids.find((b) => b.status === "Selected");

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha/tenders" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All tenders
      </Link>
      <div className="mt-4">
        <PageHeader
          title={tender.title}
          subtitle={"For project: " + tender.project + ". Department: " + tender.department + "."}
          actions={<Link href="/janlekha/tenders" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">All tenders</Link>}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(tender.status)}>{tender.status}</Badge>
        <Badge tone="slate">Value {formatINR(tender.valueInr)}</Badge>
        <Badge tone="slate">Deadline {formatDate(tender.deadline)}</Badge>
        <Badge tone="slate">{tender.bids.length} bids</Badge>
        <DemoBadge />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-lg font-bold text-[#080F1C]">Tender summary</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex justify-between gap-2"><span className="text-slate-600">Tender value</span><strong>{formatINR(tender.valueInr)}</strong></li>
            <li className="flex justify-between gap-2"><span className="text-slate-600">Deadline</span><strong>{formatDate(tender.deadline)}</strong></li>
            <li className="flex justify-between gap-2"><span className="text-slate-600">Status</span><strong>{tender.status}</strong></li>
            <li className="flex justify-between gap-2"><span className="text-slate-600">Lowest bid</span><strong>{lowest ? formatINR(lowest.amountInr) + " by " + lowest.contractor : "No bids"}</strong></li>
            <li className="flex justify-between gap-2"><span className="text-slate-600">Selected bid</span><strong>{selected ? formatINR(selected.amountInr) + " by " + selected.contractor : "None selected"}</strong></li>
          </ul>
          <p className="mt-4 text-sm text-slate-600">All figures are demo data. The selected bid is highlighted in green in the bids table.</p>
          <Link href={"/janlekha/projects/" + tender.projectId} className="mt-4 inline-block rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open the project</Link>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-lg font-bold text-[#080F1C]">Bids</h2>
          {bids.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No bids are recorded for this tender in the demo data.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-2">Contractor</th><th className="py-2 pr-2">Amount</th><th className="py-2 pr-2">Submitted</th><th className="py-2 pr-2">Status</th><th className="py-2"></th></tr></thead>
                <tbody>
                  {bids.map((b) => {
                    const isSelected = b.status === "Selected";
                    const isLowest = lowest && b.id === lowest.id;
                    return (
                      <tr key={b.id} className={"border-b border-slate-100 " + (isSelected ? "bg-emerald-50" : "")}>
                        <td className="py-3 pr-2 font-semibold text-slate-900">
                          {b.contractor}
                          {isLowest ? <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-800">Lowest bid</span> : null}
                        </td>
                        <td className="py-3 pr-2 font-semibold">{formatINR(b.amountInr)}</td>
                        <td className="py-3 pr-2">{formatDate(b.submitted)}</td>
                        <td className="py-3 pr-2"><Badge tone={statusTone(b.status)}>{b.status}</Badge></td>
                        <td className="py-3">{isSelected ? <span className="text-sm font-semibold text-emerald-700">Selected</span> : <span className="text-sm text-slate-500">Not selected</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Bids are sorted lowest first. Selection in the demo data is by the procurement officer, and the selected bid is not always the lowest bid.</p>
        </Card>
      </div>
    </div>
  );
}

export default function TenderDetailPage() {
  return (
    <JanLekhaProvider>
      <TenderDetailInner />
    </JanLekhaProvider>
  );
}
