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
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/65 backdrop-blur-md">
          <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2 text-[15px] sm:px-6">
            <Link href="/" className="heading mr-1 rounded-full px-3 py-1.5 text-xl hover:bg-white/10 transition md:mr-3">Jan<span className="text-gradient">Lekha</span></Link>
            <div className="order-2 ml-auto md:order-3 md:ml-2">
              <WalletBar />
            </div>
            {/* links drop to their own row on small screens so nothing wraps raggedly */}
            <div className="order-3 flex w-full flex-wrap items-center gap-x-1 gap-y-1 pt-1 md:order-2 md:ml-auto md:w-auto md:justify-end md:pt-0">
              <Link href="/projects" className="rounded-full px-3 py-1.5 font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">Projects</Link>
              <Link href="/verify" className="rounded-full px-3 py-1.5 font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">Verify a document</Link>
              <a href={publicEnv.NEXT_PUBLIC_STREETSYNC_URL} className="rounded-full px-3 py-1.5 font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                StreetSync · Repairs
              </a>
              <span className="ml-1 rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300 ring-1 ring-amber-400/30">
                Synthetic demo data
              </span>
            </div>
          </nav>
        </header>
        <main className="animate-rise mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
