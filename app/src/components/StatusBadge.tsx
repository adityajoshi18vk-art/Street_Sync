import { STATUS_COLORS, STATUS_TEXT_CLASSES, statusLabel, statusName } from "@/lib/types";

export function StatusBadge({ status }: { status: number }) {
  const name = statusName(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_TEXT_CLASSES[name]}`}
    >
      <span
        className="mr-1.5 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLORS[name], boxShadow: `0 0 6px ${STATUS_COLORS[name]}` }}
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
    <div className="card-inset flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="label-micro">{label}</p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-xs text-brand-300 hover:text-brand-200 hover:underline"
          >
            {short}
          </a>
        ) : (
          <p className="truncate font-mono text-xs text-zinc-300">{short}</p>
        )}
      </div>
      {match !== undefined && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${
            match
              ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
              : "bg-red-400/10 text-red-300 ring-red-400/30"
          }`}
        >
          {match ? "MATCH" : "MISMATCH"}
        </span>
      )}
    </div>
  );
}
