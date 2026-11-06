import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import { ACTIVE_CHAIN, isLocalNetwork, JANLEKHA_URL } from "@/config/contracts";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: {
    default: "StreetSync",
    template: "%s · StreetSync"
  },
  description:
    "Neighbors fund it, a verified human fixes it, other verified humans confirm it — USDC releases only when the community agrees.",
  manifest: "/manifest.webmanifest",
  applicationName: "StreetSync",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StreetSync"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000"
};

const NAV_LINKS = [
  { href: "/", label: "Map" },
  { href: "/review", label: "Review" },
  { href: "/stickers", label: "Stickers" }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-dvh font-sans">
        <Providers>
          <header className="sticky top-0 z-[600] border-b border-white/10 bg-black/65 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
              <Link href="/" className="group flex items-center gap-2.5">
                <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-black text-white shadow-glow-sm transition group-hover:shadow-glow">
                  SS
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-400 animate-glow-pulse" />
                </span>
                <span className="font-display text-lg font-extrabold tracking-tight text-white">
                  Street<span className="text-brand-400">Sync</span>
                </span>
                <span
                  className={`hidden rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline ${
                    isLocalNetwork
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-brand-400/30 bg-brand-400/10 text-brand-300"
                  }`}
                >
                  {ACTIVE_CHAIN.name}
                </span>
              </Link>
              <nav className="hidden items-center gap-1 md:flex">
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-full px-3.5 py-1.5 text-[15px] font-semibold text-slate-400 transition hover:bg-white/10 hover:text-white"
                  >
                    {l.label}
                  </Link>
                ))}
                <a
                  href={JANLEKHA_URL}
                  className="ml-2 rounded-full border border-white/15 px-3.5 py-1.5 text-[15px] font-semibold text-slate-400 transition hover:bg-white/10 hover:text-accent-300"
                >
                  JanLekha · Spending
                </a>
              </nav>
              <ConnectButton />
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 safe-bottom">
            {children}
          </main>
          <footer className="border-t border-white/[0.06] py-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-slate-500">
              <p>
                <span className="font-display font-bold text-slate-300">StreetSync</span> · verified
                humans fixing real streets
              </p>
              <p className="flex items-center gap-3">
                <span>Arc Testnet · USDC escrow</span>
                <span className="h-1 w-1 rounded-full bg-slate-600" />
                <span>World ID v4</span>
                <span className="h-1 w-1 rounded-full bg-slate-600" />
                <span>Arkiv + Swarm evidence</span>
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
