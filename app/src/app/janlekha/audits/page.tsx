"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileJson, FileText, Printer, Scale } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { reports, type AuditReport } from "@/lib/janlekha/data";
import { Badge, Card, DemoNotice, PageHeader, statusTone } from "@/components/janlekha/ui";
import { formatDate } from "@/lib/janlekha/format";

function reportAsText(r: AuditReport): string {
  return [
    "JanLekha Audit Report (DEMO DATA)",
    "==============================",
    "Title: " + r.title,
    "Auditor: " + r.auditor,
    "Date: " + r.date,
    "Status: " + r.status,
    "Project: " + r.project,
    "Findings: " + r.findings,
    "",
    "Summary:",
    r.summary,
    "",
    "Note: This is realistic synthetic demonstration data. It is not actual government expenditure.",
    "Detection does not prove wrongdoing. Findings are labelled Requires Investigation or Potential Discrepancy.",
  ].join("\n");
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AuditsInner() {
  const { events } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const selected = reports.find((r) => r.id === selectedId) ?? null;
  const recentFindings = events.filter((e) => e.type === "Audit report published");

  function downloadReport(r: AuditReport, format: "txt" | "json") {
    if (format === "txt") {
      download(r.id + "-audit-report.txt", reportAsText(r), "text/plain");
    } else {
      download(r.id + "-audit-report.json", JSON.stringify({ ...r, demoData: true, notice: "Realistic synthetic demonstration data. Not actual government expenditure." }, null, 2), "application/json");
    }
  }

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Audit Reports"
          subtitle="Published audit reports and findings from the Independent Audit Panel. Every report is demo data, and every finding is labelled Requires Investigation or Potential Discrepancy."
        />
      </div>

      {recentFindings.length > 0 ? (
        <Card className="mb-6 border-cyan-200 bg-cyan-50 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Scale className="h-5 w-5 text-cyan-700" aria-hidden /> Recently published findings
          </h2>
          <p className="mt-1 text-sm text-slate-600">Findings published from the auditor workspace appear here as public events.</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {recentFindings.map((e) => (
              <li key={e.id}>
                <strong>{e.description}</strong>
                <span className="text-slate-500"> ({formatDate(e.date)})</span>
                {e.projectId ? (
                  <span> . <Link href={"/janlekha/projects/" + e.projectId} className="font-medium text-cyan-700 hover:underline">View project</Link></span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={
                "w-full rounded-2xl border p-5 text-left shadow-sm " +
                (selectedId === r.id ? "border-cyan-500 bg-cyan-50 ring-2 ring-cyan-100" : "border-slate-200 bg-white hover:border-cyan-400")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <Badge tone="cyan">{r.findings} finding(s)</Badge>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{r.title}</p>
              <p className="mt-1 text-sm text-slate-600">{r.auditor} . {formatDate(r.date)}</p>
              <p className="mt-1 text-sm text-slate-600">{r.project}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {selected ? (
            <Card className="p-5 sm:p-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                  <Badge tone="cyan">{selected.findings} finding(s)</Badge>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">DEMO DATA</span>
                </div>
                <h2 className="mt-3 text-xl font-bold text-slate-900">{selected.title}</h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Auditor</dt><dd className="text-right font-medium text-slate-900">{selected.auditor}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Date</dt><dd className="text-right text-slate-900">{formatDate(selected.date)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Findings</dt><dd className="text-right text-slate-900">{selected.findings}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Related project</dt><dd className="text-right"><Link href={"/janlekha/projects/" + selected.projectId} className="font-medium text-cyan-700 hover:underline">{selected.project}</Link></dd></div>
                </dl>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{selected.summary}</p>
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  Detection does not prove wrongdoing. A finding means the record needs a human investigation.
                  This report is realistic synthetic demonstration data, not actual government expenditure.
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
                <button type="button" onClick={() => downloadReport(selected, "txt")} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
                  <FileText className="h-4 w-4" aria-hidden /> Download as text
                </button>
                <button type="button" onClick={() => downloadReport(selected, "json")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  <FileJson className="h-4 w-4" aria-hidden /> Download as JSON
                </button>
                <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Printer className="h-4 w-4" aria-hidden /> Print friendly view
                </button>
                <Link href={"/janlekha/projects/" + selected.projectId} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  View related project
                </Link>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <Download className="h-3.5 w-3.5" aria-hidden /> Print opens the browser print dialog for this report. Downloads save a real file to your device.
              </p>
              <DemoNotice />
            </Card>
          ) : (
            <Card className="p-6 text-center"><p className="text-sm text-slate-600">Select a report to see its detail.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditsPage() {
  return (
    <JanLekhaProvider>
      <AuditsInner />
    </JanLekhaProvider>
  );
}
