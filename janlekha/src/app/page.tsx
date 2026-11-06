import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl animate-rise py-16 text-center sm:py-24">
      <h1 className="heading text-5xl sm:text-7xl"><span className="text-gradient">JanLekha</span></h1>
      <p className="mx-auto mt-6 max-w-xl text-lg leading-6 text-slate-300">
        A publicly verifiable audit trail for government budgets, procurement and project milestones. JanLekha records
        document hashes, deadlines and approvals on Hedera. It does not move government money into crypto.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/projects" className="btn-white">Browse projects</Link>
        <Link href="/verify" className="btn-ghost">Verify a document</Link>
      </div>
      <p className="mt-8 text-[13px] text-slate-500">
        No wallet needed. <Link href="/health" className="underline underline-offset-2">System health</Link>
      </p>
    </div>
  );
}
