"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Award, Hammer, Landmark, Map, ShieldCheck, type LucideIcon } from "lucide-react";
import { JANLEKHA_URL } from "@/config/contracts";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", label: "Map", icon: Map },
  { href: "/worker", label: "Worker", icon: Hammer },
  { href: "/review", label: "Review", icon: ShieldCheck },
  { href: "/stickers", label: "Stickers", icon: Award },
  { href: "/janlekha", label: "JanLekha", icon: Landmark }
];

// "/" matches only itself; bounty/audit pages belong to the map flow.
function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/bounty") || pathname.startsWith("/audit");
  if (href === "/janlekha") return pathname.startsWith("/janlekha") || pathname.startsWith("/projects") || pathname.startsWith("/verify");
  return pathname.startsWith(href);
}

export function DesktopNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 md:flex">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              active ? "bg-white text-ink-950" : "text-zinc-400 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar for phones, where the desktop nav is hidden. */
export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-3 z-[600] flex items-center justify-around rounded-full border border-white/10 bg-ink-900/85 p-1.5 shadow-card backdrop-blur-xl md:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold transition ${
              active ? "bg-brand-400 text-ink-950" : "text-zinc-400"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
