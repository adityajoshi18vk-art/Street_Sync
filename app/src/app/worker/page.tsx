"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  Hammer,
  MapPin,
  CheckCircle2,
  Coins,
  RefreshCw,
  Sparkles,
  Camera
} from "lucide-react";

import { listBounties } from "@/lib/api";
import { formatUsdcDisplaySafe, normalizeBounty, shortAddress, type BountyMapItem } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { reverseGeocode } from "@/lib/geocode";

export default function WorkerDashboardPage() {
  const { address, isConnected } = useAccount();

  const [bounties, setBounties] = useState<BountyMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"available" | "mine" | "completed">("available");
  const [locations, setLocations] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await listBounties({ limit: 200 });
      const items = raw.map(normalizeBounty);
      setBounties(items);

      // Async reverse geocode first 10 bounties for friendly location names
      items.slice(0, 10).forEach(async (b) => {
        if (b.lat && b.lng) {
          try {
            const label = await reverseGeocode(b.lat, b.lng);
            if (label) {
              setLocations((prev) => ({ ...prev, [b.bountyId]: label }));
            }
          } catch {}
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Derived subsets
  const openBounties = useMemo(
    () => bounties.filter((b) => b.status === 0),
    [bounties]
  );

  const myClaimedBounties = useMemo(
    () =>
      address
        ? bounties.filter(
            (b) =>
              b.worker?.toLowerCase() === address.toLowerCase() &&
              b.status === 1
          )
        : [],
    [bounties, address]
  );

  const myCompletedBounties = useMemo(
    () =>
      address
        ? bounties.filter(
            (b) =>
              b.worker?.toLowerCase() === address.toLowerCase() &&
              (b.status === 2 || b.status === 3 || b.status === 4)
          )
        : [],
    [bounties, address]
  );

  const totalOpenEscrow = useMemo(
    () => openBounties.reduce((sum, b) => sum + (b.totalPledged || 0), 0),
    [openBounties]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Top Banner */}
      <div className="card relative overflow-hidden p-6 md:p-8">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-400/10 px-3 py-1 text-xs font-bold text-brand-300">
              <Hammer className="h-3.5 w-3.5" />
              <span>Civic Worker Hub</span>
            </div>
            <h1 className="heading text-2xl md:text-3xl font-extrabold text-white">
              Worker Dashboard &amp; Jobs
            </h1>
            <p className="max-w-xl text-sm text-zinc-400">
              Claim open civic repair bounties on Arc Testnet, fix public infrastructure, upload
              anti-spoofed evidence to Arkiv &amp; Swarm, and receive instant USDC rewards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadAll}
              disabled={loading}
              className="btn-ghost btn-sm flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <Link href="/" className="btn-primary btn-sm flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              View on Map
            </Link>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-6 sm:grid-cols-4">
          <div className="card-inset p-3.5">
            <p className="label-micro !text-brand-300">Available to Claim</p>
            <p className="text-xl font-black text-white">{openBounties.length}</p>
            <p className="text-[11px] text-zinc-500">Open bounties</p>
          </div>
          <div className="card-inset p-3.5">
            <p className="label-micro !text-amber-300">My Active Jobs</p>
            <p className="text-xl font-black text-amber-200">{myClaimedBounties.length}</p>
            <p className="text-[11px] text-zinc-500">Claimed &amp; working</p>
          </div>
          <div className="card-inset p-3.5">
            <p className="label-micro !text-emerald-300">Total Escrow Pool</p>
            <p className="text-xl font-black text-emerald-400">
              {formatUsdcDisplaySafe(totalOpenEscrow)} USDC
            </p>
            <p className="text-[11px] text-zinc-500">Ready to earn</p>
          </div>
          <div className="card-inset p-3.5">
            <p className="label-micro !text-zinc-400">Worker Status</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-xs font-semibold text-zinc-200">
                {isConnected ? shortAddress(address) : "Wallet not connected"}
              </p>
            </div>
            <p className="text-[11px] text-zinc-500">Arc Testnet (5042002)</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-2">
        <button
          onClick={() => setActiveTab("available")}
          className={`flex items-center gap-2 pb-3 px-3 text-sm font-bold transition border-b-2 ${
            activeTab === "available"
              ? "border-brand-400 text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Coins className="h-4 w-4 text-brand-400" />
          <span>Available Bounties</span>
          <span className="rounded-full bg-brand-400/20 px-2 py-0.5 text-xs text-brand-300 font-mono">
            {openBounties.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("mine")}
          className={`flex items-center gap-2 pb-3 px-3 text-sm font-bold transition border-b-2 ${
            activeTab === "mine"
              ? "border-amber-400 text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Hammer className="h-4 w-4 text-amber-400" />
          <span>My Active Workbench</span>
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-300 font-mono">
            {myClaimedBounties.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("completed")}
          className={`flex items-center gap-2 pb-3 px-3 text-sm font-bold transition border-b-2 ${
            activeTab === "completed"
              ? "border-emerald-400 text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>Completed &amp; History</span>
          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300 font-mono">
            {myCompletedBounties.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Available Bounties */}
      {activeTab === "available" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <p>Select any open bounty to claim it with World ID and start fixing.</p>
            <p>{openBounties.length} bounties available</p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-28 rounded-2xl" />
              ))}
            </div>
          ) : openBounties.length === 0 ? (
            <div className="card border-dashed p-12 text-center space-y-3">
              <Sparkles className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="heading text-base">No open bounties right now</p>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                All existing bounties have been claimed or completed. You can drop a new bounty on the map to test.
              </p>
              <Link href="/" className="btn-primary btn-sm inline-flex items-center gap-2">
                Go to Map
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {openBounties.map((b) => {
                const locLabel = locations[b.bountyId] || `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`;
                return (
                  <div
                    key={b.bountyId}
                    className="card card-hover flex flex-col justify-between p-5 space-y-4 border border-white/10"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-brand-300">
                          Bounty #{b.bountyId}
                        </span>
                        <StatusBadge status={b.status} />
                      </div>

                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-2xl font-black text-white">
                            {formatUsdcDisplaySafe(b.totalPledged)} <span className="text-sm font-semibold text-brand-400">USDC</span>
                          </p>
                          <p className="text-[11px] text-zinc-500">Reward deposited in smart escrow</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                        <MapPin className="h-3.5 w-3.5 text-brand-400 shrink-0" />
                        <span className="truncate font-medium">{locLabel}</span>
                      </div>

                      {b.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 bg-black/30 p-2.5 rounded-lg border border-white/5">
                          {b.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                      <Link
                        href={`/bounty/${b.bountyId}/work`}
                        className="btn-success btn-sm flex-1 flex items-center justify-center gap-1.5 font-bold shadow-glow-sm"
                      >
                        <Hammer className="h-3.5 w-3.5" />
                        Claim &amp; Start Work
                      </Link>
                      <Link
                        href={`/bounty/${b.bountyId}`}
                        className="btn-ghost btn-sm px-3"
                        title="View bounty details"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: My Active Jobs */}
      {activeTab === "mine" && (
        <div className="space-y-4">
          {!isConnected ? (
            <div className="card p-8 text-center space-y-3">
              <p className="heading text-base">Connect your wallet</p>
              <p className="text-xs text-zinc-400">
                Connect the wallet address you used to claim bounties to view your active workbench.
              </p>
            </div>
          ) : myClaimedBounties.length === 0 ? (
            <div className="card border-dashed p-12 text-center space-y-3">
              <Hammer className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="heading text-base">You have no active claimed jobs</p>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Explore available bounties in the first tab and tap &quot;Claim &amp; Start Work&quot; to pick up a task.
              </p>
              <button
                onClick={() => setActiveTab("available")}
                className="btn-primary btn-sm inline-flex items-center gap-2"
              >
                Browse Available Bounties
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {myClaimedBounties.map((b) => (
                <div
                  key={b.bountyId}
                  className="card p-5 space-y-4 border border-amber-400/30 bg-amber-500/[0.02]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-amber-300">
                      Bounty #{b.bountyId} · IN PROGRESS
                    </span>
                    <StatusBadge status={b.status} />
                  </div>

                  <div className="space-y-1">
                    <p className="text-xl font-black text-white">
                      {formatUsdcDisplaySafe(b.totalPledged)} USDC Escrow
                    </p>
                    <p className="text-xs text-zinc-400">
                      Location: {locations[b.bountyId] || `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`}
                    </p>
                  </div>

                  <Link
                    href={`/bounty/${b.bountyId}/work`}
                    className="btn-primary btn-sm w-full flex items-center justify-center gap-1.5 font-bold"
                  >
                    <Camera className="h-4 w-4" />
                    Open Workbench &amp; Submit Proof
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Completed & History */}
      {activeTab === "completed" && (
        <div className="space-y-4">
          {!isConnected ? (
            <div className="card p-8 text-center space-y-3">
              <p className="heading text-base">Connect your wallet</p>
              <p className="text-xs text-zinc-400">
                Connect your wallet to review all bounties you completed.
              </p>
            </div>
          ) : myCompletedBounties.length === 0 ? (
            <div className="card border-dashed p-12 text-center space-y-3">
              <CheckCircle2 className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="heading text-base">No completed jobs yet</p>
              <p className="text-xs text-zinc-400">
                Completed and reviewed bounties will appear here with proof verification links and escrow payout hashes.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {myCompletedBounties.map((b) => (
                <div
                  key={b.bountyId}
                  className="card p-4 flex items-center justify-between gap-4 border border-white/10"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white">
                        Bounty #{b.bountyId}
                      </span>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-sm font-semibold text-emerald-400">
                      {formatUsdcDisplaySafe(b.totalPledged)} USDC
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/bounty/${b.bountyId}`}
                      className="btn-ghost btn-sm text-xs"
                    >
                      View Bounty
                    </Link>
                    <Link
                      href={`/audit/${b.bountyId}`}
                      className="btn-primary btn-sm text-xs"
                    >
                      Audit Proof
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
