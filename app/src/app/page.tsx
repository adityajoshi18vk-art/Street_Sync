"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useConfig, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, erc20Abi } from "viem";
import { REPORT_MAX_DESCRIPTION, REPORT_MIN_DESCRIPTION, normalizeDescription, packReport } from "@streetsync/evidence";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  ACTIVE_CHAIN,
  contractsDeployed,
  formatUsdcDisplay,
  latLngToE5,
  parseUsdc,
  regionCellFromLatLng,
  USDC_ADDRESS
} from "@/config/contracts";
import HowItWorks from "@/components/HowItWorks";
import { reportReadiness } from "@/lib/readiness";
import { approveUsdcExact, waitTx } from "@/lib/tx";
import { uploadBountyReport } from "@/lib/api";
import { loadBounties as fetchBounties } from "@/lib/bounty-source";
import { IndexStatusBanner } from "@/components/IndexStatusBanner";
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
  { ssr: false, loading: () => <div className="skeleton h-[420px] w-full rounded-xl" /> }
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
  const [fromChain, setFromChain] = useState(false);
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
      const res = await fetchBounties(config, { limit: 200, status: statusFilter ?? undefined });
      setBounties(res.rows.map(normalizeBounty).filter((b) => b.lat !== 0 || b.lng !== 0));
      setFromChain(res.source === "chain");
      setListError(res.backendError);
    } catch (e) {
      setFromChain(false);
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config, statusFilter]);

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

  // Without a location fix, centre the map on existing reports instead of the map default.
  useEffect(() => {
    if (mapCenter === null && bounties.length > 0) setMapCenter({ lat: bounties[0].lat, lng: bounties[0].lng });
  }, [bounties, mapCenter]);

  const selectedBounty = useMemo(
    () => bounties.find((b) => b.bountyId === selectedId) ?? null,
    [bounties, selectedId]
  );

  const selectedExpiry = expiryChoices.find((c) => c.seconds === expirySeconds) ?? expiryChoices[0];
  const normalizedDescription = normalizeDescription(description);
  const descriptionLength = [...normalizedDescription].length;
  const descriptionValid =
    descriptionLength >= REPORT_MIN_DESCRIPTION && descriptionLength <= REPORT_MAX_DESCRIPTION;

  const { switchChain, isPending: switching } = useSwitchChain();
  const balanceQuery = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: USDC_ADDRESS ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!USDC_ADDRESS && !!address, refetchInterval: 20_000 }
  });
  const usdcBalance = typeof balanceQuery.data === "bigint" ? balanceQuery.data : null;
  const parsedAmount = (() => {
    try {
      return amount.trim() ? parseUsdc(amount.trim()) : null;
    } catch {
      return null;
    }
  })();
  const readiness = reportReadiness({
    isConnected,
    onActiveChain: chainId === ACTIVE_CHAIN.id,
    contractsDeployed,
    hasPin: !!draftPin,
    hasPhoto: !!photo,
    descriptionLength,
    minDescription: REPORT_MIN_DESCRIPTION,
    maxDescription: REPORT_MAX_DESCRIPTION,
    amount: parsedAmount,
    amountInput: amount,
    balance: usdcBalance,
    hasExpiry: windowReady && !!selectedExpiry
  });
  const scrollToMap = () => document.getElementById("bounty-map")?.scrollIntoView({ behavior: "smooth", block: "center" });

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

  const selectedDisplay = selectedBounty ? bountyDisplayStatus(selectedBounty, now) : null;

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
    <div className="space-y-6">
      {listError && <IndexStatusBanner error={listError} fallback={fromChain} onRetry={() => void loadBounties()} />}

      <HowItWorks />

      {/* Map */}
      <div id="bounty-map" className="card overflow-hidden p-2">
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
          className="h-[440px] w-full sm:h-[500px]"
        />
        <p className="px-2 pb-1 pt-2 text-center text-[11px] text-zinc-500">
          {draftPin
            ? "Pin placed. Fill in the report form below (tap again to move it)."
            : "Search or tap the map where the problem is to drop a pin · existing pins are coloured by status"}
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
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
                style={{ backgroundColor: STATUS_COLORS[name] }}
              />
              {STATUS_LABELS[name]} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Create bounty panel */}
        <section className="card p-6 lg:col-span-2">
          <h2 className="heading text-base">Report a problem &amp; fund repair</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Tap the map to set the location, add a photo, and fund the escrow in USDC. Verified
            neighbours confirm the problem is real before work can start.
          </p>

          <div className="mt-4 space-y-3">
            <div className="card-inset px-3.5 py-2.5 text-xs">
              <p className="label-micro">Location</p>
              {draftPin ? (
                <p className="mt-0.5 font-mono text-zinc-200">
                  {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                </p>
              ) : (
                <button type="button" onClick={scrollToMap} className="mt-0.5 font-semibold text-brand-300 hover:underline">
                  Tap the map to drop a pin ↑
                </button>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-zinc-300" htmlFor="problem-photo">
                Photo of the problem
              </label>
              <input
                id="problem-photo"
                type="file"
                accept="image/*"
                disabled={photoBusy}
                onChange={(e) => {
                  void handlePhotoChange(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="sr-only"
              />
              <label
                htmlFor="problem-photo"
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-sm font-semibold transition ${
                  photo
                    ? "border-white/10 bg-white/[0.02] text-zinc-300 hover:border-brand-300/40"
                    : "border-brand-400/30 bg-brand-400/[0.05] text-brand-300 hover:border-brand-400"
                } ${photoBusy ? "pointer-events-none opacity-50" : ""}`}
              >
                <span aria-hidden>📷</span>
                {photo ? "Change photo" : "Take or choose a photo"}
              </label>
              {photoBusy && <p className="text-[11px] text-zinc-400">Optimising photo…</p>}
              {photoError && <p className="alert-error !p-2 text-xs">{photoError}</p>}
              {photo && (
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt="Problem preview" className="h-40 w-full object-cover" />
                  <p className="px-2.5 py-1 text-[11px] text-zinc-400 border-t border-white/5">
                    Ready to seal · WebP {formatBytes(photo.bytes.length)}
                  </p>
                </div>
              )}
            </div>

            <div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's wrong? e.g. Broken sidewalk slab near the north crosswalk"
                rows={3}
                maxLength={REPORT_MAX_DESCRIPTION * 2}
                className="field resize-none"
              />
              <p
                className={`mt-1 text-right text-[11px] ${
                  descriptionLength === 0 || descriptionValid ? "text-zinc-500" : "text-red-400"
                }`}
              >
                {descriptionLength} / {REPORT_MAX_DESCRIPTION} (min {REPORT_MIN_DESCRIPTION})
              </p>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300">Funding (USDC)</span>
              {address && (
                <span className="text-zinc-400">
                  Balance: {usdcBalance === null ? "…" : `${formatUsdcDisplay(usdcBalance)} USDC`}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 5.00"
                className="field"
              />
              <select
                value={selectedExpiry?.seconds ?? ""}
                onChange={(e) => setExpirySeconds(Number(e.target.value))}
                aria-label="Bounty expiry"
                className="field w-auto shrink-0"
              >
                {expiryChoices.map((opt) => (
                  <option key={opt.label} value={opt.seconds}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-zinc-500">
              Expiry counts from now.{" "}
              {validationWindow !== null &&
                `Neighbours get ${formatDuration(validationWindow)} to confirm the problem first.`}
            </p>

            {txStatus && (
              <p className="alert-info p-2.5 text-xs font-medium">
                {txStatus}
              </p>
            )}
            {txNotice && (
              <p className="alert-warn p-2.5 text-xs">
                {txNotice}
              </p>
            )}
            {txError && (
              <p className="alert-error p-2.5 text-xs">
                {txError}
              </p>
            )}

            {!readiness.ready && !txStatus && (
              <div className="card-inset p-3">
                <p className="label-micro">Before you can submit</p>
                <ul className="mt-2 space-y-1.5">
                  {readiness.items
                    .filter((item) => !item.done)
                    .map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                          {item.label}
                        </span>
                        {item.key === "network" && isConnected && (
                          <button
                            type="button"
                            onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}
                            disabled={switching}
                            className="btn-primary btn-sm !min-h-[1.5rem] !px-2.5 !py-0.5 text-xs"
                          >
                            {switching ? "Switching…" : "Switch"}
                          </button>
                        )}
                        {item.key === "pin" && (
                          <button
                            type="button"
                            onClick={scrollToMap}
                            className="btn-ghost btn-sm !min-h-[1.5rem] !px-2.5 !py-0.5 text-xs"
                          >
                            Show map
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <button
              onClick={handleCreateBounty}
              disabled={!readiness.ready || writing || !!txStatus || photoBusy}
              className="btn-primary w-full py-3"
            >
              {writing ? "Confirm in wallet…" : txStatus ? "Working…" : "Approve USDC & report problem"}
            </button>
            <p className="text-center text-[11px] text-zinc-500">
              Two wallet confirmations: approve the exact USDC amount, then create the bounty.
            </p>
          </div>
        </section>

        {/* Bounty list */}
        <section className="space-y-3 lg:col-span-3">
          {selectedBounty && (
            <div className="card border-brand-400/40 p-5 shadow-glow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="heading text-sm">
                    Bounty #{selectedBounty.bountyId}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {selectedDisplay?.label} · escrow{" "}
                    <strong className="text-zinc-200">{formatUsdcDisplaySafe(selectedBounty.totalPledged)} USDC</strong>
                  </p>
                </div>
                <Link
                  href={`/bounty/${selectedBounty.bountyId}`}
                  className="btn-primary btn-sm"
                >
                  Details
                </Link>
              </div>
              {selectedBounty.description && (
                <p className="mt-2 text-xs text-zinc-300">{selectedBounty.description}</p>
              )}
              {canPledge(
                {
                  status: selectedBounty.status,
                  validationDeadline: selectedBounty.validationDeadline,
                  claimDeadline: selectedBounty.claimDeadline,
                  workDeadline: selectedBounty.workDeadline,
                  reworkCount: 0
                },
                now
              ) && (
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
                    disabled={!isConnected || !canWrite || writing || !pledgeAmount}
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
                <div key={i} className="skeleton h-20 rounded-2xl" />
              ))}
            </div>
          ) : bounties.length === 0 ? (
            <div className="card border-dashed p-8 text-center">
              <p className="text-sm font-semibold text-zinc-300">No bounties indexed yet</p>
              <p className="mt-1 text-xs text-zinc-500">
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
                className={`card flex w-full items-center justify-between gap-3 p-4 text-left transition hover:border-brand-300/40 ${
                  selectedId === b.bountyId ? "border-brand-400/60 shadow-glow-sm" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="heading text-sm">
                    Bounty #{b.bountyId}
                  </p>
                  {b.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{b.description}</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: bountyDisplayStatus(b, now).color }}
                    />
                    {bountyDisplayStatus(b, now).label}
                    {b.worker && <span>· worker {shortAddress(b.worker)}</span>}
                    {b.creator && !b.worker && <span>· by {shortAddress(b.creator)}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="heading text-sm text-brand-300">
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
