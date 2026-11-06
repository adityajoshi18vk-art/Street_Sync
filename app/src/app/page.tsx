"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useConfig, useWriteContract } from "wagmi";
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
  { ssr: false, loading: () => <div className="h-[420px] w-full animate-pulse rounded-xl bg-gray-200" /> }
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
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id;
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
    if (!canWrite || !draftPin || !address || !ESCROW_ADDRESS) return;
    setTxError(null);
    const trimmed = description.trim();
    if (trimmed.length < 8) {
      setTxError("Description must be at least 8 characters.");
      return;
    }
    let amountUsdc: string;
    try {
      amountUsdc = amount.trim();
      if (parseUsdc(amountUsdc) <= 0n) throw new Error("positive");
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
        args: [descHash, latE5, lngE5, regionCell, initialAmount, claimDeadline],
        chain: ACTIVE_CHAIN,
        account: address
      });
      setTxStatus("Waiting for confirmation…");
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: ACTIVE_CHAIN.id });

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
    if (!canWrite || !selectedBounty || !address || !ESCROW_ADDRESS) return;
    setPledgeStatus(null);
    try {
      const amountUsdc = pledgeAmount.trim();
      if (parseUsdc(amountUsdc) <= 0n) throw new Error("Enter a valid USDC amount.");

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
        args: [BigInt(selectedBounty.bountyId), parseUsdc(amountUsdc)],
        chain: ACTIVE_CHAIN,
        account: address
      });
      await waitForTransactionReceipt(config, { hash, chainId: ACTIVE_CHAIN.id });
      setPledgeAmount("");
      setPledgeStatus("Pledge confirmed");
      void loadBounties();
    } catch (e) {
      setPledgeStatus(null);
      setTxError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5">
      {!contractsDeployed && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          <p className="font-semibold">Contracts not configured on {ACTIVE_CHAIN.name}</p>
          <p className="mt-1 text-xs">
            Deploy with <code className="rounded bg-amber-100 px-1">npm run deploy:arc</code> (or
            <code className="ml-1 rounded bg-amber-100 px-1">deploy:local</code> for Hardhat), then
            set the addresses in <code className="rounded bg-amber-100 px-1">contracts/deployments/</code> or
            via NEXT_PUBLIC_ESCROW_ADDRESS.
          </p>
        </div>
      )}

      {listError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          <span>Backend index unavailable — {listError}</span>
          <button
            onClick={() => void loadBounties()}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Map */}
      <div className="overflow-hidden rounded-xl bg-white p-2 shadow-card ring-1 ring-gray-200">
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
          className="h-[420px] w-full sm:h-[480px]"
        />
        <p className="px-2 pb-1 pt-2 text-center text-[11px] text-gray-400">
          Tap the map to drop a new bounty pin · pins are colored by lifecycle status
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter(null)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
            statusFilter === null
              ? "bg-gray-900 text-white ring-gray-900"
              : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-50"
          }`}
        >
          All ({bounties.length})
        </button>
        {STATUS_NAMES.map((name, idx) => {
          const count = bounties.filter((b) => b.status === idx).length;
          return (
            <button
              key={name}
              onClick={() => setStatusFilter(idx)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                statusFilter === idx
                  ? "bg-gray-900 text-white ring-gray-900"
                  : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-50"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[name] }}
              />
              {name} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Create bounty panel */}
        <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900">Create a bounty</h2>
          <p className="mt-1 text-xs text-gray-500">
            Fund a repair escrow in USDC. Tap the map first to set the location.
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs ring-1 ring-gray-200">
              <p className="text-gray-400">Location</p>
              {draftPin ? (
                <p className="font-mono text-gray-800">
                  {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                </p>
              ) : (
                <p className="text-gray-500">Tap the map to drop a pin</p>
              )}
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Repave the broken sidewalk section near the north crosswalk"
              rows={3}
              className="w-full rounded-lg border-gray-300 text-sm ring-1 ring-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />

            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC amount (6 decimals enforced)"
                className="w-full rounded-lg text-sm ring-1 ring-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <select
                value={expiryIdx}
                onChange={(e) => setExpiryIdx(Number(e.target.value))}
                className="rounded-lg bg-white text-sm ring-1 ring-gray-300 focus:outline-none"
              >
                {EXPIRY_OPTIONS.map((opt, i) => (
                  <option key={opt.label} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {txStatus && (
              <p className="rounded-lg bg-brand-50 p-2.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                {txStatus}
              </p>
            )}
            {txError && (
              <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 ring-1 ring-red-200">
                {txError}
              </p>
            )}

            <button
              onClick={handleCreateBounty}
              disabled={!draftPin || !isConnected || !canWrite || writing}
              className="w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-40"
            >
              {writing ? "Confirm in wallet…" : "Approve USDC & Create Bounty"}
            </button>
            {isConnected && !canWrite && (
              <p className="text-center text-[11px] text-amber-700">
                Connect to {ACTIVE_CHAIN.name} with deployed contracts to create or fund bounties.
              </p>
            )}
            {!isConnected && (
              <p className="text-center text-[11px] text-gray-400">
                Connect a wallet to fund bounties.
              </p>
            )}
          </div>
        </section>

        {/* Bounty list */}
        <section className="space-y-3 lg:col-span-3">
          {selectedBounty && (
            <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-brand-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    Bounty #{selectedBounty.bountyId}
                  </p>
                  <p className="text-xs text-gray-500">
                    {statusName(selectedBounty.status)} · escrow{" "}
                    <strong>{formatUsdcDisplaySafe(selectedBounty.totalPledged)} USDC</strong>
                  </p>
                </div>
                <Link
                  href={`/bounty/${selectedBounty.bountyId}`}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
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
                    className="w-full rounded-lg text-sm ring-1 ring-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    onClick={handlePledge}
                    disabled={!isConnected || !canWrite || writing || !pledgeAmount}
                    className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                  >
                    Pledge
                  </button>
                </div>
              )}
              {pledgeStatus && (
                <p className="mt-2 text-xs font-medium text-brand-700">{pledgeStatus}</p>
              )}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200" />
              ))}
            </div>
          ) : bounties.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm font-semibold text-gray-700">No bounties indexed yet</p>
              <p className="mt-1 text-xs text-gray-500">
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
                className={`flex w-full items-center justify-between gap-3 rounded-xl bg-white p-4 text-left shadow-card ring-1 transition hover:ring-brand-300 ${
                  selectedId === b.bountyId ? "ring-brand-400" : "ring-gray-200"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900">
                    Bounty #{b.bountyId}
                    {b.description && (
                      <span className="ml-2 truncate text-xs font-normal text-gray-500">
                        {b.description}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[statusName(b.status)] }}
                    />
                    {statusName(b.status)}
                    {b.worker && <span>· worker {shortAddress(b.worker)}</span>}
                    {b.creator && !b.worker && <span>· by {shortAddress(b.creator)}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-gray-900">
                    {formatUsdcDisplaySafe(b.totalPledged)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">USDC</p>
                </div>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
