import type { Metadata } from "next";
import Link from "next/link";
import { WalletBar } from "@/components/wallet/WalletBar";
import { Providers } from "./providers";
import { publicEnv } from "@/env/public";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JanLekha", template: "%s · JanLekha" },
  description: "Public, verifiable audit trail for government budgets and procurement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Providers>
        <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-ink-950/70 backdrop-blur-xl">
          <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3 text-sm">
            <Link href="/" className="heading text-base">Jan<span className="text-gradient">Lekha</span></Link>
            <Link href="/projects" className="text-slate-300 hover:text-white">Projects</Link>
            <Link href="/verify" className="text-slate-300 hover:text-white">Verify a document</Link>
            <a href={publicEnv.NEXT_PUBLIC_STREETSYNC_URL} className="border-l border-white/[0.08] pl-5 text-slate-300 hover:text-white">
              StreetSync · Repairs
            </a>
            <span className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300 ring-1 ring-amber-400/30">
              Synthetic demo data
            </span>
            <div className="ml-auto">
              <WalletBar />
            </div>
          </nav>
        </header>
        <main className="animate-rise mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
