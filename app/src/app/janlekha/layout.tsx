// JanLekha module layout: wraps every /janlekha route in the provider and
// adds the module sub nav. The citizen portal is light themed inside the
// dark StreetSync shell. No wallet is needed for citizens.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { JanLekhaProvider } from "@/lib/janlekha/context";

const NAV: { href: string; label: string }[] = [
  { href: "/janlekha", label: "Overview" },
  { href: "/janlekha/budgets", label: "Budgets" },
  { href: "/janlekha/allocations", label: "Allocations" },
  { href: "/janlekha/releases", label: "Releases" },
  { href: "/janlekha/expenditure", label: "Expenditure" },
  { href: "/janlekha/projects", label: "Projects" },
  { href: "/janlekha/departments", label: "Departments" },
  { href: "/janlekha/money-flow", label: "Money Flow" },
  { href: "/janlekha/map", label: "Map" },
  { href: "/janlekha/verify", label: "Verify" },
  { href: "/janlekha/documents", label: "Documents" },
  { href: "/janlekha/complaints", label: "Complaints" },
  { href: "/janlekha/audits", label: "Audits" },
  { href: "/janlekha/audit-trail", label: "Audit Trail" },
  { href: "/janlekha/roles/citizen", label: "Roles" },
  { href: "/janlekha/login", label: "Login" },
];

export default function JanLekhaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <JanLekhaProvider>
      <div className="rounded-3xl bg-white text-slate-900 shadow-sm">
        <div className="rounded-t-3xl bg-[#080F1C] px-5 py-4 text-white sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#080F1C]">DEMO DATA</span>
            <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-300">Arc Testnet</span>
            <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">No wallet needed for citizens</span>
          </div>
          <p className="mt-3 text-lg font-bold leading-tight sm:text-xl">JanLekha 2.0: public financial transparency</p>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            Realistic synthetic demonstration data. This is not actual government expenditure. Payments are simulated, no contracts are deployed
            yet, and new payments currently mark Settled immediately even though the second authoriser rule is shown.
          </p>
        </div>
        <nav aria-label="JanLekha sections" className="flex gap-1.5 overflow-x-auto border-b border-slate-200 px-3 py-3 sm:px-5">
          {NAV.map((item) => {
            const active =
              item.href === "/janlekha"
                ? pathname === "/janlekha"
                : item.href.startsWith("/janlekha/roles")
                  ? pathname.startsWith("/janlekha/roles")
                  : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold " +
                  (active ? "bg-[#080F1C] text-cyan-300" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-6 sm:px-6">{children}</div>
      </div>
    </JanLekhaProvider>
  );
}
