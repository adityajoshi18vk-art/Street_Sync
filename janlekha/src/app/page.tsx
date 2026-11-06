import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">JanLekha</h1>
      <p className="mt-3 text-neutral-700">
        A publicly verifiable audit trail for government budgets, procurement and project
        milestones. JanLekha records document hashes and approvals on Hedera; it does not move
        government money.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/health" className="underline underline-offset-4">
          System health
        </Link>
      </p>
    </main>
  );
}
