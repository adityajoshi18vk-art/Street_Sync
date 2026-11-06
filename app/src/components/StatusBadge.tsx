import { STATUS_COLORS, STATUS_TEXT_CLASSES, statusLabel, statusName } from "@/lib/types";

export function StatusBadge({ status }: { status: number }) {
  const name = statusName(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_TEXT_CLASSES[name]}`}
    >
      <span
        className="mr-1.5 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLORS[name] }}
      />
      {statusLabel(status)}
    </span>
  );
}

export function HashBadge({
  label,
  hash,
  match,
  href
}: {
  label: string;
  hash: string | null | undefined;
  match?: boolean;
  href?: string;
}) {
  const short = hash
    ? `${hash.slice(0, 10)}…${hash.slice(-8)}`
    : "—";
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-xs text-brand-700 hover:underline"
          >
            {short}
          </a>
        ) : (
          <p className="truncate font-mono text-xs text-gray-700">{short}</p>
        )}
      </div>
      {match !== undefined && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            match ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          {match ? "MATCH" : "MISMATCH"}
        </span>
      )}
    </div>
  );
}
