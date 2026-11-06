import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { Route } from "lucide-react";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { ACTIVE_CHAIN, isLocalNetwork, contractsDeployed, DEPLOYMENT_ERROR } from "@/config/contracts";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });

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
  themeColor: "#050506"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh font-sans">
        <Providers>
          <header className="sticky top-0 z-[600] border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
            <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[1fr_auto_1fr]">
              <Link href="/" className="group flex w-fit items-center gap-2.5" aria-label="StreetSync home">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-400 text-ink-950 shadow-glow-sm transition group-hover:rotate-[-6deg] group-hover:shadow-glow">
                  <Route className="h-5 w-5" strokeWidth={2.5} aria-hidden />
                </span>
                <span className="font-display text-lg font-extrabold tracking-tight text-white">
                  Street<span className="text-brand-300">Sync</span>
                </span>
                <span
                  className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider lg:inline-flex ${
                    isLocalNetwork
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-brand-300/25 bg-brand-400/10 text-brand-300"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-glow-pulse" />
                  {ACTIVE_CHAIN.name}
                </span>
              </Link>
              <DesktopNav />
              <div className="flex justify-end">
                <ConnectButton />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:pb-16">
            {!contractsDeployed && (
              <div role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                <p className="font-semibold">Deployment required</p>
                <p className="mt-1">{DEPLOYMENT_ERROR}</p>
                <p className="mt-1 text-zinc-400">Funding, claiming, and reviewing are disabled until setup is complete.</p>
              </div>
            )}
            {children}
          </main>
          <footer className="border-t border-white/[0.06] pb-28 pt-8 md:pb-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-zinc-500">
              <p className="flex items-center gap-2">
                <Route className="h-4 w-4 text-brand-300" aria-hidden />
                <span className="font-display font-bold text-zinc-200">StreetSync</span> · verified humans fixing real streets
              </p>
              <p className="flex flex-wrap items-center gap-3">
                <span>Arc Testnet · USDC escrow</span>
                <span className="h-1 w-1 rounded-full bg-zinc-700" />
                <span>World ID v4</span>
                <span className="h-1 w-1 rounded-full bg-zinc-700" />
                <span>Arkiv + Swarm evidence</span>
              </p>
            </div>
          </footer>
          <MobileTabBar />
        </Providers>
      </body>
    </html>
  );
}
