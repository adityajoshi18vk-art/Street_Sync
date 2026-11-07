"use client";

import { useState } from "react";
import Link from "next/link";
import type { AuditFlag } from "@/lib/janlekha/data";
import { formatINR } from "@/lib/janlekha/format";
import { Badge, statusTone } from "@/components/janlekha/ui";

export function riskTone(risk: AuditFlag["risk"]): "green" | "amber" | "red" | "slate" {
  if (risk === "Critical" || risk === "High") return "red";
  if (risk === "Medium") return "amber";
  return "slate";
}

interface RiskFlagCardProps {
  flag: AuditFlag;
  /** Called when the card is selected for a detail view. If omitted, the card expands inline. */
  onSelect?: (flag: AuditFlag) => void;
  selected?: boolean;
  /** Show a compact one line summary instead of the full card. */
  compact?: boolean;
}

/**
 * Reusable risk flag card, used by the auditor dashboard and by project
 * detail views. A flag is a prompt for human review, never a conclusion
 * of wrongdoing, and the card never presents it as one.
 */
export default function RiskFlagCard({ flag, onSelect, selected, compact }: RiskFlagCardProps) {
  const [expanded, setExpanded] = useState(false);
  const showDetail = expanded || selected;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => (onSelect ? onSelect(flag) : setExpanded(!expanded))}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-cyan-400"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{flag.reason}</span>
          <span className="block text-xs text-slate-500">
            {flag.project} {flag.amountInr > 0 ? " . " + formatINR(flag.amountInr) : ""}
          </span>
        </span>
        <span className="flex shrink-0 gap-2">
          <Badge tone={riskTone(flag.risk)}>{flag.risk}</Badge>
          <Badge tone={statusTone(flag.status)}>{flag.status}</Badge>
        </span>
      </button>
    );
  }

  return (
    <article
      className={
        "rounded-2xl border bg-white p-5 shadow-sm " +
        (selected ? "border-cyan-500 ring-2 ring-cyan-100" : "border-slate-200")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={riskTone(flag.risk)}>{flag.risk} risk</Badge>
            <Badge tone={statusTone(flag.status)}>{flag.status}</Badge>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">DEMO DATA</span>
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug text-slate-900">{flag.reason}</h3>
          <p className="mt-1 text-sm text-slate-600">
            <Link href={"/janlekha/projects/" + flag.projectId} className="font-medium text-cyan-700 hover:underline">
              {flag.project}
            </Link>
            {" . " + flag.department}
            {flag.amountInr > 0 ? " . " + formatINR(flag.amountInr) : " . No amount is attached to this record."}
          </p>
        </div>
      </div>

      {showDetail ? (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence</p>
            <p className="mt-1 break-words text-slate-700">{flag.evidence}</p>
          </div>
          {flag.notes ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Auditor notes</p>
              <p className="mt-1 text-slate-700">{flag.notes}</p>
            </div>
          ) : null}
          {flag.history.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resolution history</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                {flag.history.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            Detection does not prove wrongdoing. This flag means the record needs a human investigation.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (onSelect ? onSelect(flag) : setExpanded(!expanded))}
          className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
        >
          {showDetail && !onSelect ? "Hide detail" : "View detail"}
        </button>
        <Link
          href={"/janlekha/projects/" + flag.projectId}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          View project
        </Link>
      </div>
    </article>
  );
}
