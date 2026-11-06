"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, MapPin, ShieldCheck } from "lucide-react";

import { HeroSection03 } from "@/components/ui/hero-03";
import { StatusBadge } from "@/components/StatusBadge";
import { ACTIVE_CHAIN, ESCROW_ADDRESS } from "@/config/contracts";
import { getBackendHealth } from "@/lib/api";
import { formatUsdcDisplaySafe, type BountyMapItem } from "@/lib/types";

const REPO_URL = "https://github.com/akashpandey2388-arch/Street_Sync";
// Unsplash, photo by ThisisEngineering — a technician at work.
const HERO_PHOTO =
  "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=900&q=75&auto=format&fit=crop";

type IndexerState = "checking" | "live" | "offline";

/** Glyphs rendered on the server (see app/page.tsx) so the icon libraries never ship to the browser. */
export interface HeroGlyphs {
  pin: ReactNode;
  github: ReactNode;
}

/** Filled "verified" seal: lucide badge-check outline, filled with the accent. */
function ProofSeal() {
  return (
    <svg viewBox="0 0 24 24" className="mx-[0.06em] h-[0.82em] w-[0.82em] shrink-0" aria-hidden>
      <path
        fill="#a78bfa"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path d="m8.6 12 2.4 2.4 4.6-4.8" fill="none" stroke="#050506" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useIndexerState(): IndexerState {
  const [state, setState] = useState<IndexerState>("checking");
  useEffect(() => {
    let cancelled = false;
    getBackendHealth()
      .then((h) => !cancelled && setState(h.status === "ok" && h.chainId === ACTIVE_CHAIN.id ? "live" : "offline"))
      .catch(() => !cancelled && setState("offline"));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function HomeHero({
  bounties,
  loading,
  glyphs
}: {
  bounties: BountyMapItem[];
  loading: boolean;
  glyphs: HeroGlyphs;
}) {
  const indexer = useIndexerState();
  const escrowed = bounties.reduce((sum, b) => sum + (Number.isFinite(b.totalPledged) ? b.totalPledged : 0), 0);
  const open = bounties.filter((b) => b.status === 0).length;
  const approved = bounties.filter((b) => b.status === 4).length;
  const latest = bounties.reduce<BountyMapItem | null>(
    (top, b) => (!top || Number(b.bountyId) > Number(top.bountyId) ? b : top),
    null
  );
  const explorer = ACTIVE_CHAIN.blockExplorers?.default.url;

  return (
    <HeroSection03
      title="StreetSync: fix the block, proof pays."
      meta={{
        start: (
          <>
            StreetSync<span className="hidden sm:inline"> — civic repairs, settled on-chain</span>
          </>
        ),
        end: (
          <span className="inline-flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                indexer === "live" ? "bg-primary animate-glow-pulse" : indexer === "offline" ? "bg-red-400" : "bg-zinc-500"
              }`}
            />
            {indexer === "live" ? `Indexer live · ${ACTIVE_CHAIN.name}` : indexer === "offline" ? "Indexer offline" : "Checking indexer…"}
          </span>
        )
      }}
      rows={[
        {
          content: "Fix the",
          caption: "Neighbors pool USDC for a repair on their own street.",
          captionSide: "start"
        },
        {
          content: (
            <>
              <span>Bl</span>
              {glyphs.pin}
              <span>ck</span>
            </>
          ),
          caption: "A World ID–verified human does the work. Three verified reviewers decide whether it's done."
        },
        {
          content: (
            <>
              <span>Proof</span>
              <ProofSeal />
              <span>Pays</span>
            </>
          )
        }
      ]}
      signature={{
        detail: `${ACTIVE_CHAIN.name} · USDC escrow`,
        label: "In escrow",
        value: loading ? (
          <span className="skeleton inline-block h-10 w-28 align-middle" />
        ) : (
          <>
            {formatUsdcDisplaySafe(escrowed)}
            <span className="ml-2 align-baseline font-mono text-xs font-normal not-italic tracking-[0.18em] text-muted-foreground md:text-sm">
              USDC
            </span>
          </>
        )
      }}
      media={
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_PHOTO} alt="Technician repairing street-side equipment" className="h-full w-full object-cover" />
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-ink-950/80 px-3 py-1 text-[11px] font-semibold text-zinc-100 backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            Verified human at work
          </span>
        </>
      }
      aside={
        <div className="space-y-5">
          <div>
            <p className="label-micro">Latest on the map</p>
            {loading ? (
              <div className="skeleton mt-2 h-14 max-w-md" />
            ) : latest ? (
              <Link
                href={`/bounty/${latest.bountyId}`}
                className="group mt-2 flex max-w-md items-center justify-between gap-4 rounded-2xl border border-border bg-white/[0.03] px-4 py-3 transition hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                    Bounty #{latest.bountyId}
                    <StatusBadge status={latest.status} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {latest.description ?? `Pinned at ${latest.lat.toFixed(4)}, ${latest.lng.toFixed(4)}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 font-display text-sm font-bold text-foreground">
                  {formatUsdcDisplaySafe(latest.totalPledged)} USDC
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                </span>
              </Link>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No bounties yet — drop the first pin.</p>
            )}
            {!loading && (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {bounties.length} bounties · {open} open · {approved} approved
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="#create" className="btn-primary">
              <MapPin className="h-4 w-4" strokeWidth={2.5} aria-hidden />
              Drop a bounty
            </a>
            <Link href="/review" className="btn-ghost">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Review repairs
            </Link>
          </div>
        </div>
      }
      links={
        <>
          {explorer && ESCROW_ADDRESS && (
            <a
              href={`${explorer}/address/${ESCROW_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold transition hover:text-foreground"
            >
              Escrow on explorer
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" className="transition hover:text-foreground">
            {glyphs.github}
          </a>
        </>
      }
      sideTab={
        <a
          href="#create"
          className="flex items-center gap-2 rounded-l-xl bg-primary px-3 py-5 text-sm font-bold text-primary-foreground shadow-glow-sm transition hover:pr-4"
        >
          <span className="rotate-180 [writing-mode:vertical-rl]">Drop a bounty</span>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </a>
      }
    />
  );
}
