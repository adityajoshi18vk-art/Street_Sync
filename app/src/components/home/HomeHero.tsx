import Link from "next/link";
import { ArrowRight, CircleCheck, Coins, Fingerprint, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { formatUsdcDisplaySafe, type BountyMapItem } from "@/lib/types";

export function HomeHero({
  chainName,
  bounties,
  loading
}: {
  chainName: string;
  bounties: BountyMapItem[];
  loading: boolean;
}) {
  const escrowed = bounties.reduce((sum, b) => sum + (Number.isFinite(b.totalPledged) ? b.totalPledged : 0), 0);
  const stats = [
    { icon: MapPin, label: "Bounties on the map", value: String(bounties.length) },
    { icon: Coins, label: "USDC in escrow", value: formatUsdcDisplaySafe(escrowed) },
    { icon: Sparkles, label: "Open to claim", value: String(bounties.filter((b) => b.status === 0).length) },
    { icon: CircleCheck, label: "Repairs approved", value: String(bounties.filter((b) => b.status === 4).length) }
  ];

  return (
    <section className="relative isolate overflow-hidden rounded-[2rem] border border-white/[0.08] px-5 pb-6 pt-12 text-center sm:px-10 sm:pt-16">
      <div className="aurora" aria-hidden>
        <span className="left-[8%] top-[10%] h-72 w-72 animate-aurora bg-brand-400/50" />
        <span className="right-[6%] top-[0%] h-80 w-80 animate-aurora bg-accent-500/60 [animation-delay:-6s]" />
        <span className="left-[40%] top-[35%] h-64 w-64 animate-aurora bg-emerald-400/30 [animation-delay:-11s]" />
      </div>
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,transparent_20%,rgb(5_5_6/0.85)_75%)]" aria-hidden />

      <p className="eyebrow animate-rise">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-glow-pulse" />
        Live on {chainName}
        <span className="hidden sm:inline">· USDC escrow · World ID</span>
      </p>

      <h1 className="heading animate-rise stagger-1 mx-auto mt-5 max-w-3xl text-[2.15rem] leading-[1.04] min-[400px]:text-[2.5rem] sm:text-6xl lg:text-7xl">
        Fix your street.
        <br />
        <span className="text-gradient whitespace-nowrap">Proven on-chain.</span>
      </h1>

      <p className="animate-rise stagger-2 mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-400 sm:text-base">
        Neighbors fund it, a verified human fixes it, other verified humans confirm it — USDC
        releases only when the community agrees.
      </p>

      <div className="animate-rise stagger-3 mt-7 flex flex-wrap items-center justify-center gap-3">
        <a href="#create" className="btn-primary px-6 py-2.5">
          <MapPin className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          Drop a bounty
        </a>
        <Link href="/review" className="btn-ghost px-6 py-2.5">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Review repairs
          <ArrowRight className="h-4 w-4 opacity-60" aria-hidden />
        </Link>
      </div>

      <dl className="animate-rise stagger-4 mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] text-left lg:grid-cols-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 bg-ink-950/80 px-3.5 py-4 backdrop-blur sm:px-4">
            <span className="icon-tile h-9 w-9 rounded-xl">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col-reverse">
              <dt className="text-[11px] font-medium leading-tight text-zinc-500">{label}</dt>
              <dd className="font-display text-xl font-extrabold tabular-nums text-white">
                {loading ? <span className="skeleton inline-block h-6 w-12 align-middle" /> : value}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="mt-4 flex items-start justify-center gap-1.5 text-[11px] text-zinc-500 sm:items-center">
        <Fingerprint className="mt-px h-3.5 w-3.5 shrink-0 sm:mt-0" aria-hidden />
        One human, one claim — every worker and reviewer is World ID verified.
      </p>
    </section>
  );
}
