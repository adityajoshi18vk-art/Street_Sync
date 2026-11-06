"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const ROLE_LINKS = [
  { href: "/", label: "Report", hint: "Report & fund problems", icon: "📍" },
  { href: "/work", label: "Work", hint: "Claim & fix bounties", icon: "🛠️" },
  { href: "/review", label: "Review", hint: "Verify finished work", icon: "✅" }
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || (pathname.startsWith("/bounty/") && !pathname.endsWith("/work"));
  if (href === "/work") return pathname === "/work" || pathname.endsWith("/work");
  return pathname.startsWith(href);
}

/** Desktop role tabs (header). */
export function RoleNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="hidden items-center gap-1 rounded-xl bg-gray-100 p-1 md:flex" aria-label="Dashboards">
      {ROLE_LINKS.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
              active ? "bg-white text-brand-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom tab bar. */
export function MobileRoleNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[700] border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Dashboards"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        {ROLE_LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                active ? "text-brand-700" : "text-gray-500"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>
                {l.icon}
              </span>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
