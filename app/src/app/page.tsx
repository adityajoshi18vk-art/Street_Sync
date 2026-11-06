"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useConfig, useReadContract, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import { REPORT_MAX_DESCRIPTION, REPORT_MIN_DESCRIPTION, normalizeDescription, packReport } from "@streetsync/evidence";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  ACTIVE_CHAIN,
  contractsDeployed,
  latLngToE5,
  parseUsdc,
  regionCellFromLatLng
} from "@/config/contracts";
import { approveUsdcExact, waitTx } from "@/lib/tx";
import { listBounties, uploadBountyReport } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { availableExpiryChoices, canPledge, formatDuration } from "@/lib/lifecycle";
import { bountyDisplayStatus } from "@/lib/map-utils";
import { encodeReportPhoto } from "@/lib/photo";
import { MAX_PHOTO_INPUT_BYTES, browserStorage, deletePendingReport, savePendingReport } from "@/lib/report";
import { useNowSeconds } from "@/lib/useNow";
import {
  formatBytes,
  normalizeBounty,
  STATUS_COLORS,
  STATUS_NAMES,
  STATUS_LABELS,
  shortAddress,
  formatUsdcDisplaySafe,
  type BountyMapItem
} from "@/lib/types";
import type { MapViewProps } from "@/components/MapView";

const MapView = dynamic<MapViewProps>(
  () => import("@/components/MapView").then((m) => m.default),
  { ssr: false, loading: () => <div className="h-[420px] w-full animate-pulse rounded-xl bg-gray-200" /> }
);

export default function HomePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id;
  const config = useConfig();
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const now = useNowSeconds();

  const validationWindowQuery = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "validationWindow",
    query: { enabled: !!ESCROW_ADDRESS && contractsDeployed }
  });
  const validationWindow =
    typeof validationWindowQuery.data === "bigint" ? Number(validationWindowQuery.data) : null;
  const windowReady = validationWindowQuery.isSuccess || validationWindowQuery.isError;
  const expiryChoices = useMemo(() => availableExpiryChoices(validationWindow), [validationWindow]);

  const [bounties, setBounties] = useState<BountyMapItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expirySeconds, setExpirySeconds] = useState(7 * 86_400);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txNotice, setTxNotice] = useState<string | null>(null);

  const [photo, setPhoto] = useState<{
    bytes: Uint8Array;
    previewUrl: string;
    capturedAtMs: number;
  } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

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

  const selectedExpiry = expiryChoices.find((c) => c.seconds === expirySeconds) ?? expiryChoices[0];
  const normalizedDescription = normalizeDescription(description);
  const descriptionLength = [...normalizedDescription].length;
  const descriptionValid =
    descriptionLength >= REPORT_MIN_DESCRIPTION && descriptionLength <= REPORT_MAX_DESCRIPTION;

  const handlePhotoChange = async (file: File | undefined) => {
    setPhotoError(null);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_INPUT_BYTES) {
      setPhotoError("That photo is too large. Choose one under 25 MB.");
      return;
    }
    setPhotoBusy(true);
    try {
      const bytes = await encodeReportPhoto(new Uint8Array(await file.arrayBuffer()));
      const capturedAtMs = file.lastModified > 0 && file.lastModified <= Date.now() ? file.lastModified : Date.now();
      setPhoto({ bytes, previewUrl: URL.createObjectURL(file), capturedAtMs });
    } catch (e) {
      setPhotoError(friendlyError(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleCreateBounty = async () => {
    if (!canWrite || !draftPin || !address || !ESCROW_ADDRESS) return;
    setTxError(null);
    setTxNotice(null);
    if (!photo) {
      setTxError("Add a photo of the problem first.");
      return;
    }
    if (!descriptionValid) {
      setTxError(`Describe the problem in ${REPORT_MIN_DESCRIPTION}–${REPORT_MAX_DESCRIPTION} characters.`);
      return;
    }
    if (!selectedExpiry) {
      setTxError("The neighbour-validation window is too long for any expiry option. Ask the operator to shorten it.");
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

    let newId: string | null = null;
    let bundle: Uint8Array;
    let reportHash: `0x${string}`;
    try {
      const { latE5, lngE5 } = latLngToE5(draftPin.lat, draftPin.lng);
      const regionCell = regionCellFromLatLng(draftPin.lat, draftPin.lng);
      const packed = await packReport({
        creator: address,
        description: normalizedDescription,
        latE5,
        lngE5,
        capturedAtMs: photo.capturedAtMs,
        photo: photo.bytes
      });
      bundle = packed.bundle;
      reportHash = packed.reportHash;

      // Persist before any transaction so a failed upload can be retried from the bounty page.
      const storage = browserStorage();
      if (!storage) throw new Error("Your browser blocks local storage, which is needed to keep your photo safe until it uploads.");
      savePendingReport(storage, reportHash, bundle);

      const claimDeadline = BigInt(Math.floor(Date.now() / 1000) + selectedExpiry.seconds);
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
        args: [packed.descriptionHash, reportHash, latE5, lngE5, regionCell, initialAmount, claimDeadline],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setTxStatus("Waiting for confirmation…");
      const receipt = await waitTx(config, hash);

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "BountyCreated") {
            newId = (decoded.args as unknown as { bountyId: bigint }).bountyId.toString();
            break;
          }
        } catch {
          // not an escrow event
        }
      }
    } catch (e) {
      setTxStatus(null);
      setTxError(friendlyError(e));
      return;
    }

    // The bounty exists on-chain from here on; only the photo upload can still fail.
    let uploaded = false;
    if (newId) {
      try {
        setTxStatus("Uploading your photo…");
        await uploadBountyReport(newId, bundle);
        deletePendingReport(browserStorage()!, reportHash);
        uploaded = true;
      } catch (e) {
        setTxNotice(
          `Your bounty is created, but the photo upload failed (${friendlyError(e)}). Open the bounty page to retry the upload.`
        );
      }
    } else {
      setTxNotice(
        "Your bounty is created, but its id couldn't be read from the receipt. Find it on the map; your photo is saved on this device and can be uploaded from the bounty page."
      );
    }

    setTxStatus(null);
    if (uploaded || newId) {
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
      setDescription("");
      setAmount("");
      setDraftPin(null);
    }
    void loadBounties();
    if (newId) router.push(`/bounty/${newId}`);
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
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);
      setPledgeAmount("");
      setPledgeStatus("Pledge confirmed");
      void loadBounties();
    } catch (e) {
      setPledgeStatus(null);
      setTxError(friendlyError(e));
    }
  };

  return (
    <div className="space-y-5">
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
