import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import { ACTIVE_CHAIN, isLocalNetwork, JANLEKHA_URL } from "@/config/contracts";
import "./globals.css";

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
    statusBarStyle: "default",
    title: "StreetSync"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1b6bf5"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          <header className="sticky top-0 z-[600] border-b border-gray-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">
                  SS
                </span>
                <span className="text-base font-bold tracking-tight text-gray-900">
                  StreetSync
                </span>
                <span
                  className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline ${
                    isLocalNetwork
                      ? "bg-amber-100 text-amber-700"
                      : "bg-brand-50 text-brand-700"
                  }`}
                >
                  {ACTIVE_CHAIN.name}
                </span>
              </Link>
              <nav className="hidden items-center gap-4 text-sm font-medium text-gray-600 md:flex">
                <Link href="/" className="hover:text-brand-700">
                  Map
                </Link>
                <Link href="/review" className="hover:text-brand-700">
                  Review
                </Link>
                <Link href="/stickers" className="hover:text-brand-700">
                  Stickers
                </Link>
                <a href={JANLEKHA_URL} className="border-l border-gray-200 pl-4 hover:text-brand-700">
                  JanLekha · Spending
                </a>
              </nav>
              <ConnectButton />
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 safe-bottom">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
