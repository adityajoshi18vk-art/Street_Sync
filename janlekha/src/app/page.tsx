import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-2xl py-8">
      <h1 className="text-3xl font-semibold">JanLekha</h1>
      <p className="mt-3 text-neutral-700">
        A publicly verifiable audit trail for government budgets, procurement and project milestones. JanLekha records
        document hashes, deadlines and approvals on Hedera. It does not move government money into crypto.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link href="/projects" className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white">Browse projects</Link>
        <Link href="/verify" className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-medium">Verify a document</Link>
      </div>
      <p className="mt-6 text-xs text-neutral-500">
        No wallet needed. <Link href="/health" className="underline underline-offset-2">System health</Link>
      </p>
    </div>
  );
}
