import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JanLekha", template: "%s · JanLekha" },
  description: "Public, verifiable audit trail for government budgets and procurement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-neutral-50">
        <header className="border-b border-neutral-200 bg-white">
          <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold text-neutral-900">JanLekha</Link>
            <Link href="/projects" className="text-neutral-600 hover:text-neutral-900">Projects</Link>
            <Link href="/verify" className="text-neutral-600 hover:text-neutral-900">Verify a document</Link>
            <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
              Synthetic demo data
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
