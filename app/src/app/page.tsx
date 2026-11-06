"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { decodeEventLog, keccak256, toHex } from "viem";
import { waitForTransactionReceipt, readContract } from "wagmi/actions";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  ACTIVE_CHAIN,
  contractsDeployed,
  latLngToE5,
  parseUsdc,
  regionCellFromLatLng
} from "@/config/contracts";
import { approveUsdcExact } from "@/lib/tx";
import { TestUsdcFaucet } from "@/components/TestUsdcFaucet";
import { listBounties } from "@/lib/api";
import {
  normalizeBounty,
  STATUS_COLORS,
  STATUS_NAMES,
  statusName,
  shortAddress,
  formatUsdcDisplaySafe,
  type BountyMapItem
} from "@/lib/types";
import type { MapViewProps } from "@/components/MapView";

const MapView = dynamic<MapViewProps>(
  () => import("@/components/MapView").then((m) => m.default),
  { ssr: false, loading: () => <div className="skeleton h-[420px] w-full" /> }
);

const EXPIRY_OPTIONS = [
  { label: "1 day", seconds: 86_400 },
  { label: "3 days", seconds: 3 * 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "30 days", seconds: 30 * 86_400 }
];

export default function HomePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const { writeContractAsync, isPending: writing } = useWriteContract();

  const [bounties, setBounties] = useState<BountyMapItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(2);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeStatus, setPledgeStatus] = useState<string | null>(null);

  const loadBounties = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const raw = await listBounties({ limit: 200, status: statusFilter ?? undefined });
      setBounties(raw.map(normalizeBounty).filter((b) => b.lat !== 0 || b.lng !== 0));
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadBounties();
  }, [loadBounties]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMapCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const selectedBounty = useMemo(
    () => bounties.find((b) => b.bountyId === selectedId) ?? null,
    [bounties, selectedId]
  );

  const handleCreateBounty = async () => {
    if (!draftPin || !address || !ESCROW_ADDRESS) return;
    setTxError(null);
    const trimmed = description.trim();
    if (trimmed.length < 8) {
      setTxError("Description must be at least 8 characters.");
      return;
    }
    let amountUsdc: string;
    try {
      amountUsdc = String(Number(amount));
      if (Number(amount) <= 0) throw new Error("positive");
    } catch {
      setTxError("Enter a valid USDC amount.");
      return;
    }

    try {
      const { latE5, lngE5 } = latLngToE5(draftPin.lat, draftPin.lng);
      const regionCell = regionCellFromLatLng(draftPin.lat, draftPin.lng);
      const descHash = keccak256(toHex(trimmed));
      const claimDeadline = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_OPTIONS[expiryIdx].seconds);
      const initialAmount = parseUsdc(amountUsdc);

      setTxStatus("Approving exactly " + amountUsdc + " USDC…");
      await approveUsdcExact({
        config,
        owner: address,
        spender: ESCROW_ADDRESS,
        amountUsdc,
        writeContractAsync
      });

      setTxStatus("Creating bounty on " + ACTIVE_CHAIN.name + "…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "createBounty",
        args: [descHash, latE5, lngE5, regionCell, initialAmount, claimDeadline]
      });
      setTxStatus("Waiting for confirmation…");
      const receipt = await waitForTransactionReceipt(config, { hash });

      let newId: string | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            data: log.data,
            topics: log.topics
          });
          if (decoded.eventName === "BountyCreated") {
            newId = (decoded.args as unknown as { bountyId: bigint }).bountyId.toString();
            break;
          }
        } catch {
          // not an escrow event
        }
      }

      setTxStatus(null);
      setDescription("");
      setAmount("");
      setDraftPin(null);
      void loadBounties();
      if (newId) router.push(`/bounty/${newId}`);
    } catch (e) {
      setTxStatus(null);
      setTxError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePledge = async () => {
    if (!selectedBounty || !address || !ESCROW_ADDRESS) return;
    setPledgeStatus(null);
    try {
      const amountUsdc = String(Number(pledgeAmount));
      if (Number(pledgeAmount) <= 0) throw new Error("Enter a valid USDC amount.");

      await approveUsdcExact({
        config,
        owner: address,
        spender: ESCROW_ADDRESS,
        amountUsdc,
        writeContractAsync,
        onPhase: (_p, msg) => setPledgeStatus(msg ?? null)
      });

      setPledgeStatus("Pledging " + amountUsdc + " USDC…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "pledge",
        args: [BigInt(selectedBounty.bountyId), parseUsdc(amountUsdc)]
      });
      await waitForTransactionReceipt(config, { hash });
      setPledgeAmount("");
      setPledgeStatus("Pledge confirmed");
      void loadBounties();
    } catch (e) {
      setPledgeStatus(null);
      setTxError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="animate-rise space-y-3 pt-4 text-center sm:pt-8">
        <p className="label-micro">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
            Live on {ACTIVE_CHAIN.name} · USDC escrow · World ID verified
          </span>
        </p>
        <h1 className="heading mx-auto max-w-3xl text-3xl sm:text-5xl">
          Fix your street.
          <br />
          <span className="text-gradient">Proven on-chain.</span>
        </h1>
        <p className="mx-auto max-w-xl text-sm text-slate-400 sm:text-base">
          Neighbors fund it, a verified human fixes it, other verified humans confirm it —
          USDC releases only when the community agrees.
        </p>
      </section>

      {!contractsDeployed && (
        <div className="alert-warn animate-rise stagger-1">
          <p className="font-semibold text-amber-100">
            Contracts not configured on {ACTIVE_CHAIN.name}
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            Deploy with <code className="code-pill">npm run deploy:arc</code> (or
            <code className="code-pill ml-1">deploy:local</code> for Hardhat), then
            set the addresses in <code className="code-pill">contracts/deployments/</code> or
            via NEXT_PUBLIC_ESCROW_ADDRESS.
          </p>
        </div>
      )}

      {listError && (
        <div className="alert-error flex flex-wrap items-center justify-between gap-2 animate-rise stagger-1">
          <span>Backend index unavailable — {listError}</span>
          <button
            onClick={() => void loadBounties()}
            className="btn-danger btn-sm"
          >
            Retry
          </button>
        </div>
      )}

      {/* Map */}
      <div className="card animate-rise stagger-2 overflow-hidden p-2">
        <MapView
          bounties={bounties}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            const b = bounties.find((x) => x.bountyId === id);
            if (b) setMapCenter({ lat: b.lat, lng: b.lng });
          }}
          draftPin={draftPin}
          onMapClick={(lat, lng) => {
            setDraftPin({ lat, lng });
            setSelectedId(null);
          }}
          center={mapCenter}
          className="h-[420px] w-full overflow-hidden rounded-xl sm:h-[480px]"
        />
        <p className="px-2 pb-1 pt-2 text-center text-[11px] text-slate-500">
          Tap the map to drop a new bounty pin · pins are colored by lifecycle status
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 animate-rise stagger-3">
        <button
          onClick={() => setStatusFilter(null)}
          className={`chip ${statusFilter === null ? "chip-active" : ""}`}
        >
          All ({bounties.length})
        </button>
        {STATUS_NAMES.map((name, idx) => {
          const count = bounties.filter((b) => b.status === idx).length;
          return (
            <button
              key={name}
              onClick={() => setStatusFilter(idx)}
              className={`chip ${statusFilter === idx ? "chip-active" : ""}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[name], boxShadow: `0 0 5px ${STATUS_COLORS[name]}` }}
              />
              {name} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Create bounty panel */}
        <section className="card animate-rise stagger-4 h-fit p-6 lg:col-span-2">
          <h2 className="heading text-lg">Create a bounty</h2>
          <p className="mt-1 text-xs text-slate-400">
            Fund a repair escrow in USDC. Tap the map first to set the location.
          </p>

          <div className="mt-5 space-y-3">
            <div className="card-inset px-3.5 py-2.5 text-xs">
              <p className="label-micro">Location</p>
              {draftPin ? (
                <p className="mt-0.5 font-mono text-slate-200">
                  {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                </p>
              ) : (
                <p className="mt-0.5 text-slate-500">Tap the map to drop a pin</p>
              )}
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Repave the broken sidewalk section near the north crosswalk"
              rows={3}
              className="field resize-none"
            />

            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC amount (6 decimals enforced)"
                className="field"
              />
              <select
                value={expiryIdx}
                onChange={(e) => setExpiryIdx(Number(e.target.value))}
                className="field w-auto shrink-0"
              >
                {EXPIRY_OPTIONS.map((opt, i) => (
                  <option key={opt.label} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {txStatus && (
              <p className="alert-info p-2.5 text-xs font-medium">
                {txStatus}
              </p>
            )}
            {txError && (
              <p className="alert-error p-2.5 text-xs">
                {txError}
              </p>
            )}

            <button
              onClick={handleCreateBounty}
              disabled={!draftPin || !isConnected || writing}
              className="btn-primary w-full py-3"
            >
              {writing ? (
                <>
                  <span className="spinner spinner-sm border-white/40 border-t-white" />
                  Confirm in wallet…
                </>
              ) : (
                "Approve USDC & Create Bounty"
              )}
            </button>
            {!isConnected && (
              <p className="text-center text-[11px] text-slate-500">
                Connect a wallet to fund bounties.
              </p>
            )}
            <TestUsdcFaucet />
          </div>
        </section>

        {/* Bounty list */}
        <section className="animate-rise stagger-5 space-y-3 lg:col-span-3">
          {selectedBounty && (
            <div className="card border-brand-400/40 p-5 shadow-glow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="heading text-sm">
                    Bounty #{selectedBounty.bountyId}
                  </p>
                  <p className="text-xs text-slate-400">
                    {statusName(selectedBounty.status)} · escrow{" "}
                    <strong className="text-slate-200">
                      {formatUsdcDisplaySafe(selectedBounty.totalPledged)} USDC
                    </strong>
                  </p>
                </div>
                <Link
                  href={`/bounty/${selectedBounty.bountyId}`}
                  className="btn-primary btn-sm"
                >
                  Details
                </Link>
              </div>
              {selectedBounty.status === 0 && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={pledgeAmount}
                    onChange={(e) => setPledgeAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="Add pledge (USDC)"
                    className="field"
                  />
                  <button
                    onClick={handlePledge}
                    disabled={!isConnected || writing || !pledgeAmount}
                    className="btn-success btn-sm shrink-0"
                  >
                    Pledge
                  </button>
                </div>
              )}
              {pledgeStatus && (
                <p className="mt-2 text-xs font-medium text-brand-300">{pledgeStatus}</p>
              )}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-20" />
              ))}
            </div>
          ) : bounties.length === 0 ? (
            <div className="card border-dashed p-10 text-center">
              <p className="heading text-sm">No bounties indexed yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Create the first bounty by tapping the map and funding the escrow.
              </p>
            </div>
          ) : (
            bounties.map((b) => (
              <button
                key={b.bountyId}
                onClick={() => {
                  setSelectedId(b.bountyId);
                  setMapCenter({ lat: b.lat, lng: b.lng });
                }}
                className={`card card-hover flex w-full items-center justify-between gap-3 p-4 text-left ${
                  selectedId === b.bountyId ? "border-brand-400/50 shadow-glow-sm" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    Bounty #{b.bountyId}
                    {b.description && (
                      <span className="ml-2 truncate text-xs font-normal text-slate-500">
                        {b.description}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[statusName(b.status)], boxShadow: `0 0 5px ${STATUS_COLORS[statusName(b.status)]}` }}
                    />
                    {statusName(b.status)}
                    {b.worker && <span>· worker {shortAddress(b.worker)}</span>}
                    {b.creator && !b.worker && <span>· by {shortAddress(b.creator)}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-sm font-bold text-white">
                    {formatUsdcDisplaySafe(b.totalPledged)}
                  </p>
                  <p className="label-micro">USDC</p>
                </div>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
