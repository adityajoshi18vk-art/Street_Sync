import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-2xl animate-rise py-10">
      <h1 className="heading text-4xl sm:text-5xl"><span className="text-gradient">JanLekha</span></h1>
      <p className="mt-3 text-slate-200">
        A publicly verifiable audit trail for government budgets, procurement and project milestones. JanLekha records
        document hashes, deadlines and approvals on Hedera. It does not move government money into crypto.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link href="/projects" className="btn-primary">Browse projects</Link>
        <Link href="/verify" className="btn-ghost">Verify a document</Link>
      </div>
      <p className="mt-6 text-xs text-slate-400">
        No wallet needed. <Link href="/health" className="underline underline-offset-2">System health</Link>
      </p>
    </div>
  );
}
