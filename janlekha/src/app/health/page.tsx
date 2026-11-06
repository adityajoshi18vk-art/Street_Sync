import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatBytes } from "@/lib/janlekha/format";
import { getHealth, type DatabaseStatus } from "@/lib/health";

export const metadata: Metadata = { title: "Health" };

const DB_LABEL: Record<DatabaseStatus, string> = {
  ok: "Connected",
  not_configured: "Not configured (DATABASE_URL unset)",
  unreachable: "Unreachable",
};

async function HealthDetails() {
  await connection();
  const health = await getHealth();
  const rows: [string, string][] = [
    ["Overall", health.status === "ok" ? "OK" : "Degraded"],
    ["Database", DB_LABEL[health.database.status] + (health.database.latencyMs !== undefined ? ` (${health.database.latencyMs} ms)` : "")],
    [
      "Document storage",
      health.documents.status === "ok"
        ? `Writable (${formatBytes(health.documents.usedBytes)} of ${formatBytes(health.documents.maxBytes)} used)`
        : "Not writable: authorised actions cannot attach documents",
    ],
    ["Chain ID", String(health.chain.id)],
    ["RPC URL", health.chain.rpcUrl],
    ["JanLekha contract", health.chain.contractAddress ?? "Not deployed / not configured"],
    ["Checked at", health.timestamp],
  ];

  return (
    <dl className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
          <dt className="font-medium text-slate-300">{label}</dt>
          <dd className="col-span-2 break-all font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HealthPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="heading text-2xl">System health</h1>
      <p className="mt-1 mb-6 text-sm text-slate-300">
        Machine-readable version: <code className="font-mono">/api/health</code>
      </p>
      <Suspense fallback={<p className="text-sm text-slate-400">Checking…</p>}>
        <HealthDetails />
      </Suspense>
    </div>
  );
}
