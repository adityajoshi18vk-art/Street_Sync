import Link from "next/link";

const STEPS = [
  {
    n: 1,
    title: "Report",
    body: "Pin the problem, add a photo and fund the repair in USDC.",
    href: "/",
    cta: null
  },
  {
    n: 2,
    title: "Neighbours confirm",
    body: "Two verified neighbours nearby vote that the problem is real.",
    href: null,
    cta: null
  },
  {
    n: 3,
    title: "Worker fixes it",
    body: "A verified worker claims the job and submits before/after photos.",
    href: "/work",
    cta: "Find work"
  },
  {
    n: 4,
    title: "Reviewers verify",
    body: "Three staked reviewers compare the photos; USDC releases on approval.",
    href: "/review",
    cta: "Become a reviewer"
  }
] as const;

/** Four-step explainer of the bounty lifecycle with links to each role's dashboard. */
export default function HowItWorks() {
  return (
    <section aria-label="How StreetSync works" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {STEPS.map((s) => (
        <div key={s.n} className="flex gap-2 rounded-xl bg-white p-2.5 shadow-card ring-1 ring-gray-200 sm:gap-3 sm:p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white sm:h-7 sm:w-7 sm:text-xs">
            {s.n}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 sm:text-sm">{s.title}</p>
            <p className="mt-0.5 hidden text-xs leading-snug text-gray-500 sm:block">{s.body}</p>
            {s.href && s.cta && (
              <Link href={s.href} className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline">
                {s.cta} →
              </Link>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
