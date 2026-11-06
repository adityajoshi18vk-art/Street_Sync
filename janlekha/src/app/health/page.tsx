import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
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
    ["Chain ID", String(health.chain.id)],
    ["RPC URL", health.chain.rpcUrl],
    ["JanLekha contract", health.chain.contractAddress ?? "Not deployed / not configured"],
    ["Checked at", health.timestamp],
  ];

  return (
    <dl className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
          <dt className="font-medium text-neutral-600">{label}</dt>
          <dd className="col-span-2 break-all font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">System health</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-600">
        Machine-readable version: <code className="font-mono">/api/health</code>
      </p>
      <Suspense fallback={<p className="text-sm text-neutral-500">Checking…</p>}>
        <HealthDetails />
      </Suspense>
    </main>
  );
}
