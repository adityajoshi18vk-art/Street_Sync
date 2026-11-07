"use client";
// Ported from ~/workspace/janlekha/src/components/RoleShared.tsx and the
// workspace shell in ~/workspace/janlekha/src/components/Layout.tsx,
// adapted for Next.js App Router (next/link, next/navigation).
// Dark theme: midnight navy #080F1C background, surface #111D2E,
// cyan #22D3EE, verified green #34D399.
// All figures shown through these components are DEMO DATA. Role checks here
// are app layer only; production must enforce permissions server side.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Landmark, LogOut, Menu, Repeat, X } from "lucide-react";
import { useApp } from "@/lib/janlekha/context";
import { ROLE_LABELS, ROLE_ROUTES, type Role } from "@/lib/janlekha/permissions";
import type { NotificationItem, TxEvent, AuditFlag } from "@/lib/janlekha/data";
import { formatDate, formatINR } from "@/lib/janlekha/format";
import { statusTone } from "@/components/janlekha/ui";

const inputCls =
  "w-full rounded-lg border border-white/15 bg-[#111D2E] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

export function DarkCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"rounded-2xl border border-white/10 bg-[#0B1626] p-5 " + className}>{children}</section>;
}

export function DarkCardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {sub ? <p className="mt-1 text-sm text-slate-400">{sub}</p> : null}
    </div>
  );
}

const statTones: Record<string, string> = {
  cyan: "text-cyan-400",
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
  white: "text-white",
};

export function DarkStat({ label, value, sub, tone = "cyan" }: { label: string; value: string; sub?: string; tone?: "cyan" | "green" | "amber" | "red" | "white" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0B1626] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={"mt-2 text-2xl font-bold tracking-tight " + statTones[tone]}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; min?: string; step?: string }) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      required={props.required}
      min={props.min}
      step={props.step}
      className={inputCls}
    />
  );
}

export function SelectInput(props: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; required?: boolean }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} required={props.required} className={inputCls}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextAreaInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; rows?: number }) {
  return (
    <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} required={props.required} rows={props.rows ?? 3} className={inputCls} />
  );
}

export function PrimaryButton(props: { children: ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean }) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-[#080F1C] hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

export function GhostButton(props: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

export function SuccessNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300" role="status">
      {message}
    </div>
  );
}

export function DemoStrip({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
      <span className="font-semibold">DEMO DATA:</span> {text}
    </p>
  );
}

const darkBadgeTones: Record<string, string> = {
  slate: "bg-white/10 text-slate-300",
  green: "bg-emerald-400/15 text-emerald-300",
  amber: "bg-amber-400/15 text-amber-300",
  red: "bg-red-400/15 text-red-300",
  cyan: "bg-cyan-400/15 text-cyan-300",
  blue: "bg-blue-400/15 text-blue-300",
};

export function DarkBadge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "cyan" | "blue" }) {
  return <span className={"inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold " + darkBadgeTones[tone]}>{children}</span>;
}

export function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-slate-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={"px-3 py-2.5 align-top " + className}>{children}</td>;
}

export function AccessDenied({ required }: { required: Role }) {
  const { role, setRole } = useApp();
  const router = useRouter();
  const switchTo = () => {
    setRole(required);
    router.push(ROLE_ROUTES[required]);
  };
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-[#0B1626] p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Access denied</p>
      <h2 className="mt-2 text-xl font-bold text-white">This workspace needs a different role</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Required role: <span className="font-semibold text-white">{ROLE_LABELS[required]}</span>
        <br />
        Current role: <span className="font-semibold text-white">{ROLE_LABELS[role]}</span>
        <br />
        Demo sign in is local only. Production must enforce this check server side, not only in the page.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <PrimaryButton onClick={switchTo}>Switch to {ROLE_LABELS[required]}</PrimaryButton>
        <GhostButton onClick={() => router.push("/janlekha/login")}>Choose another role</GhostButton>
      </div>
    </div>
  );
}

export function ActivityTimeline({ events, limit = 8 }: { events: TxEvent[]; limit?: number }) {
  const shown = events.slice(0, limit);
  if (shown.length === 0) {
    return <p className="text-sm text-slate-400">No activity yet in this demo session.</p>;
  }
  return (
    <ol className="space-y-4">
      {shown.map((e) => (
        <li key={e.id} className="border-l-2 border-cyan-400/40 pl-4">
          <div className="flex flex-wrap items-center gap-2">
            <DarkBadge tone={statusTone(e.type)}>{e.type}</DarkBadge>
            <span className="text-xs text-slate-500">{formatDate(e.date)}</span>
          </div>
          <p className="mt-1 text-sm text-slate-200">{e.description}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {e.actor} ({e.role})
            {e.txRef ? " | Ref: " + e.txRef : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function NotificationsPanel({ role, items }: { role: Role; items: NotificationItem[] }) {
  const { markNotificationRead } = useApp();
  const mine = items.filter((n) => n.role === role || n.role === "ALL");
  const unread = mine.filter((n) => !n.read).length;
  return (
    <div>
      <p className="mb-3 text-sm text-slate-400">
        {unread} unread notification{unread === 1 ? "" : "s"} for {ROLE_LABELS[role]}.
      </p>
      {mine.length === 0 ? (
        <p className="text-sm text-slate-400">No notifications for this role.</p>
      ) : (
        <ul className="space-y-3">
          {mine.slice(0, 8).map((n) => (
            <li key={n.id} className={"rounded-xl border p-3 " + (n.read ? "border-white/5 bg-white/[0.02]" : "border-cyan-400/30 bg-cyan-400/5")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{n.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(n.date)}</p>
                </div>
                {!n.read ? (
                  <button
                    type="button"
                    onClick={() => markNotificationRead(n.id)}
                    className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5"
                  >
                    Mark read
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-emerald-400">Read</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function riskTone(risk: AuditFlag["risk"]): "green" | "amber" | "red" | "slate" {
  if (risk === "Critical" || risk === "High") return "red";
  if (risk === "Medium") return "amber";
  return "slate";
}

// Dark themed risk flag card. A flag is a prompt for human review, never a
// conclusion of wrongdoing, and the card never presents it as one.
export function RiskFlagCard({ flag, onSelect, selected, compact }: { flag: AuditFlag; onSelect?: (flag: AuditFlag) => void; selected?: boolean; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const showDetail = expanded || selected;
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => (onSelect ? onSelect(flag) : setExpanded(!expanded))}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B1626] px-4 py-3 text-left hover:border-cyan-400/50"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{flag.reason}</span>
          <span className="block text-xs text-slate-500">
            {flag.project} {flag.amountInr > 0 ? " | " + formatINR(flag.amountInr) : ""}
          </span>
        </span>
        <span className="flex shrink-0 gap-2">
          <DarkBadge tone={riskTone(flag.risk)}>{flag.risk}</DarkBadge>
          <DarkBadge tone={statusTone(flag.status)}>{flag.status}</DarkBadge>
        </span>
      </button>
    );
  }
  return (
    <article className={"rounded-2xl border bg-[#0B1626] p-5 " + (selected ? "border-cyan-400/60" : "border-white/10")}>
      <div className="flex flex-wrap items-center gap-2">
        <DarkBadge tone={riskTone(flag.risk)}>{flag.risk} risk</DarkBadge>
        <DarkBadge tone={statusTone(flag.status)}>{flag.status}</DarkBadge>
        <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">DEMO DATA</span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug text-white">{flag.reason}</h3>
      <p className="mt-1 text-sm text-slate-400">
        <Link href={"/janlekha/projects/" + flag.projectId} className="font-medium text-cyan-300 hover:underline">
          {flag.project}
        </Link>
        {" | " + flag.department}
        {flag.amountInr > 0 ? " | " + formatINR(flag.amountInr) : " | No amount is attached to this record."}
      </p>
      {showDetail ? (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence</p>
            <p className="mt-1 break-words text-slate-300">{flag.evidence}</p>
          </div>
          {flag.notes ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Auditor notes</p>
              <p className="mt-1 text-slate-300">{flag.notes}</p>
            </div>
          ) : null}
          {flag.history.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resolution history</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-300">
                {flag.history.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">Detection does not prove wrongdoing. This flag means the record needs a human investigation.</p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (onSelect ? onSelect(flag) : setExpanded(!expanded))}
          className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-[#080F1C] hover:bg-cyan-400"
        >
          {showDetail && !onSelect ? "Hide detail" : "View detail"}
        </button>
        <Link href={"/janlekha/projects/" + flag.projectId} className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">
          View project
        </Link>
      </div>
    </article>
  );
}

const WORKSPACE_NAV: Record<Role, { to: string; label: string }[]> = {
  GOVERNMENT_ADMIN: [
    { to: "/janlekha/roles/admin", label: "Overview" },
    { to: "/janlekha/projects", label: "Projects" },
    { to: "/janlekha/tenders", label: "Tenders" },
    { to: "/janlekha/audits", label: "Audit reports" },
    { to: "/janlekha/documents", label: "Documents" },
    { to: "/janlekha", label: "Public portal" },
  ],
  FINANCE_OFFICER: [
    { to: "/janlekha/roles/finance", label: "Overview" },
    { to: "/janlekha/projects", label: "Projects" },
    { to: "/janlekha/audits", label: "Audit reports" },
    { to: "/janlekha/documents", label: "Documents" },
    { to: "/janlekha", label: "Public portal" },
  ],
  PROCUREMENT_OFFICER: [
    { to: "/janlekha/roles/procurement", label: "Overview" },
    { to: "/janlekha/tenders", label: "Tenders" },
    { to: "/janlekha/projects", label: "Projects" },
    { to: "/janlekha/documents", label: "Documents" },
    { to: "/janlekha", label: "Public portal" },
  ],
  CONTRACTOR: [
    { to: "/janlekha/roles/contractor", label: "Overview" },
    { to: "/janlekha/projects", label: "My projects" },
    { to: "/janlekha/tenders", label: "Tenders" },
    { to: "/janlekha/audits", label: "Audit reports" },
    { to: "/janlekha", label: "Public portal" },
  ],
  INDEPENDENT_AUDITOR: [
    { to: "/janlekha/roles/auditor", label: "Overview" },
    { to: "/janlekha/audits", label: "Audit reports" },
    { to: "/janlekha/projects", label: "Projects" },
    { to: "/janlekha/documents", label: "Documents" },
    { to: "/janlekha/verify", label: "Verify a document" },
    { to: "/janlekha", label: "Public portal" },
  ],
  CITIZEN: [
    { to: "/janlekha/roles/citizen", label: "Overview" },
    { to: "/janlekha/projects", label: "Projects" },
    { to: "/janlekha/verify", label: "Verify a document" },
    { to: "/janlekha/complaints", label: "Complaints" },
    { to: "/janlekha/audits", label: "Audit reports" },
    { to: "/janlekha", label: "Public portal" },
  ],
};

export function WorkspaceLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const { role, setRole, notifications } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read && (n.role === role || n.role === "ALL")).length;
  const nav = WORKSPACE_NAV[role];
  return (
    <div className="min-h-screen rounded-2xl bg-[#080F1C] text-slate-100 lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-[#0B1626] p-5 lg:flex">
        <Link href="/janlekha" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/20 text-lg font-bold text-cyan-400">
            <Landmark className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-lg font-bold leading-none text-white">JanLekha</span>
            <span className="block text-[11px] text-slate-400">Government workspace</span>
          </span>
        </Link>
        <div className="mt-6 rounded-xl bg-white/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Signed in as</p>
          <p className="mt-1 text-sm font-semibold text-white">{ROLE_LABELS[role]}</p>
          <p className="text-xs text-slate-400">Demo role, local only. No real account.</p>
        </div>
        <nav className="mt-6 space-y-1" aria-label="Workspace">
          {nav.map((l) => (
            <Link key={l.to} href={l.to} className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={() => router.push("/janlekha/login")}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            <Repeat className="h-4 w-4" aria-hidden /> Switch role
          </button>
          <Link href="/janlekha" className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white">
            <LogOut className="h-4 w-4" aria-hidden /> Back to public portal
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080F1C]/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
              {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                <Bell className="h-3.5 w-3.5" aria-hidden /> {unread} unread
              </span>
              <select
                value={role}
                onChange={(e) => {
                  const r = e.target.value as Role;
                  setRole(r);
                  router.push(ROLE_ROUTES[r]);
                }}
                className="rounded-lg border border-white/15 bg-[#111D2E] px-3 py-2 text-sm text-white"
                aria-label="Switch role"
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setOpen(!open)} className="rounded-lg border border-white/15 px-3 py-2 text-sm lg:hidden" aria-label="Menu">
                {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>
          {open ? (
            <nav className="mt-3 space-y-1 lg:hidden">
              {nav.map((l) => (
                <Link key={l.to} href={l.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                  {l.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
