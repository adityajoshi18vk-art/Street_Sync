import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JanLekha", template: "%s · JanLekha" },
  description: "Public, verifiable audit trail for government budgets and procurement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
