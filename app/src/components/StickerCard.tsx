"use client";

import type { StickerStatus } from "@/lib/api";

const TIER_STYLES: Record<
  StickerStatus["tier"],
  { disc: string; ring: string; label: string; labelClass: string }
> = {
  bronze: {
    disc: "bg-gradient-to-br from-amber-200 via-orange-300 to-amber-500",
    ring: "ring-amber-300",
    label: "Bronze",
    labelClass: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30"
  },
  silver: {
    disc: "bg-gradient-to-br from-slate-100 via-slate-300 to-slate-500",
    ring: "ring-slate-300",
    label: "Silver",
    labelClass: "bg-slate-300/10 text-slate-200 ring-1 ring-slate-300/30"
  },
  gold: {
    disc: "bg-gradient-to-br from-yellow-200 via-amber-300 to-yellow-500",
    ring: "ring-yellow-300",
    label: "Gold",
    labelClass: "bg-yellow-400/10 text-yellow-300 ring-1 ring-yellow-400/30"
  }
};

const NEW_WINDOW_SECONDS = 48 * 3600;

export function StickerCard({ sticker, index }: { sticker: StickerStatus; index: number }) {
  const tier = TIER_STYLES[sticker.tier];
  const pct = Math.min(100, Math.round((sticker.progress / sticker.target) * 100));
  const isNew =
    sticker.earned &&
    sticker.awardedAt !== null &&
    Date.now() / 1000 - sticker.awardedAt < NEW_WINDOW_SECONDS;
  // Alternating die-cut tilt for a sticker-sheet feel
  const tilt = index % 2 === 0 ? "-rotate-3" : "rotate-2";

  return (
    <div
      className={`relative flex flex-col items-center card p-4 text-center transition-all duration-300 ${
        sticker.earned ? "hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.05]" : "opacity-80"
      }`}
    >
      {isNew && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-glow-sm">
          New
        </span>
      )}

      <div
        className={`flex h-20 w-20 items-center justify-center rounded-full border-4 border-ink-950 shadow-lg ring-2 ${
          sticker.earned
            ? `${tier.disc} ${tier.ring} ${tilt}`
            : "bg-white/[0.05] ring-white/10"
        }`}
      >
        <span
          className={`text-4xl leading-none ${sticker.earned ? "" : "opacity-40 grayscale"}`}
          role="img"
          aria-label={sticker.name}
        >
          {sticker.earned ? sticker.emoji : "🔒"}
        </span>
      </div>

      <p className={`mt-3 text-sm font-bold ${sticker.earned ? "text-white" : "text-slate-500"}`}>
        {sticker.name}
      </p>
      <p className="mt-1 min-h-[2rem] text-[11px] leading-snug text-slate-400">
        {sticker.description}
      </p>

      <div className="mt-2 flex items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tier.labelClass}`}>
          {tier.label}
        </span>
        <span className="rounded-full bg-brand-400/10 px-2 py-0.5 text-[10px] font-bold text-brand-300 ring-1 ring-brand-400/30">
          +{sticker.xp} XP
        </span>
      </div>

      {sticker.earned ? (
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          Collected
          {sticker.awardedAt
            ? ` · ${new Date(sticker.awardedAt * 1000).toLocaleDateString()}`
            : ""}
        </p>
      ) : (
        <div className="mt-2 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-400 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] font-medium text-slate-500">
            {sticker.progress} / {sticker.target}
          </p>
        </div>
      )}
    </div>
  );
}

export default StickerCard;
