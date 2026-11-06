"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getStickerProfile, type StickerProfile } from "@/lib/api";
import { StickerCard } from "@/components/StickerCard";
import { formatUsdcDisplaySafe } from "@/lib/types";

export default function StickersPage() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState<StickerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // ?address=0x… lets anyone view a public sticker profile without connecting
  const [viewAddress, setViewAddress] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address");
    if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) setViewAddress(q.toLowerCase());
  }, []);

  const target = viewAddress ?? (isConnected ? address : undefined);

  const loadProfile = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      setProfile(await getStickerProfile(target));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (!target) {
    return (
      <div className="mx-auto max-w-md card animate-rise border-dashed p-10 text-center">
        <p className="text-4xl">🏅</p>
        <h1 className="heading mt-3 text-xl">Your Sticker Book</h1>
        <p className="mt-2 text-sm text-slate-400">
          Connect your wallet to see the stickers you&apos;ve collected by funding,
          fixing, and reviewing civic repairs.
        </p>
      </div>
    );
  }

  const xpIntoLevel = profile ? profile.xp - profile.level.minXp : 0;
  const xpForLevel = profile?.level.nextXp
    ? profile.level.nextXp - profile.level.minXp
    : null;
  const levelPct =
    profile && xpForLevel ? Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100)) : 100;

  return (
    <div className="space-y-6">
      {/* Level header */}
      <section className="card animate-rise relative overflow-hidden bg-gradient-to-br from-brand-600/40 via-ink-900/60 to-accent-500/20 p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="label-micro text-brand-300">
              Level {profile ? profile.level.index + 1 : "–"}
            </p>
            <h1 className="heading text-3xl">
              {profile?.level.title ?? "Sticker Book"}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              {profile
                ? `${profile.earnedCount} of ${profile.totalCount} stickers collected · ${profile.xp} XP`
                : "Loading your collection…"}
            </p>
          </div>
          <div className="min-w-[180px] flex-1 sm:max-w-xs">
            <div className="flex justify-between text-[11px] font-semibold text-slate-300">
              <span>{profile?.level.minXp ?? 0} XP</span>
              <span>{profile?.level.nextXp != null ? `${profile.level.nextXp} XP` : "MAX"}</span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-400 transition-all"
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-brand-300">
              {profile?.level.nextXp != null
                ? `${profile.level.nextXp - profile.xp} XP to next level`
                : "Top level reached!"}
            </p>
          </div>
        </div>

        {profile && (
          <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[
              { label: "Bounties created", value: String(profile.stats.bountiesCreated) },
              {
                label: "USDC pledged",
                value: formatUsdcDisplaySafe(Number(profile.stats.pledgedTotal) / 1_000_000)
              },
              { label: "Approved fixes", value: String(profile.stats.approvedFixes) },
              { label: "Votes revealed", value: String(profile.stats.votesRevealed) }
            ].map((s) => (
              <div key={s.label} className="card-inset px-2 py-3">
                <p className="font-display text-xl font-bold text-gradient">{s.value}</p>
                <p className="label-micro">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="alert-error">
          {error}
          <button
            onClick={() => void loadProfile()}
            className="ml-3 font-bold text-red-100 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Sticker grid */}
      {loading && !profile ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton h-56 rounded-2xl" />
          ))}
        </div>
      ) : profile ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {profile.stickers.map((s, i) => (
            <StickerCard key={s.id} sticker={s} index={i} />
          ))}
        </div>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Stickers are earned automatically from your on-chain activity — fund a bounty,
        fix a street, or review a repair to grow your collection.
      </p>
    </div>
  );
}
