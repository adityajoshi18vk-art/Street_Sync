import type { BountyReport } from "@/lib/api";
import { photoDataUrl } from "@/lib/report";

/** Reporter's problem photo + description. `compact` renders a small reference thumbnail. */
export default function ReportCard({
  report,
  compact = false,
  title = "Reported problem"
}: {
  report: BountyReport;
  compact?: boolean;
  title?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoDataUrl(report.photoBase64, report.photoMime)}
        alt="Problem reported by the creator"
        className={`w-full bg-gray-100 object-cover ${compact ? "h-40" : "max-h-96"}`}
      />
      <div className="p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">{report.description}</p>
        {!compact && (
          <p className="mt-1 text-[11px] text-gray-400">
            Photo taken {new Date(report.capturedAtMs).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
