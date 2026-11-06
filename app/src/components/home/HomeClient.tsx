"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { HomeHero, type HeroGlyphs } from "@/components/home/HomeHero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { MapPinPlus, ListFilter, RefreshCw, Hammer, Camera, ImagePlus, Video, X, Play } from "lucide-react";
import { uploadVideo, getVideoPlaybackUrl, computeVideoSha256, type VideoEvidence } from "@streetsync/swarm-client";
import { getArkivClient } from "@/lib/arkiv";
import { listBounties } from "@/lib/api";
import { reverseGeocode } from "@/lib/geocode";
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
  { ssr: false, loading: () => <div className="skeleton h-[460px] w-full sm:h-[540px]" /> }
);

const EXPIRY_OPTIONS = [
  { label: "1 day", seconds: 86_400 },
  { label: "3 days", seconds: 3 * 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "30 days", seconds: 30 * 86_400 }
];

export function HomeClient({ glyphs }: { glyphs: HeroGlyphs }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const { writeContractAsync, isPending: writing } = useWriteContract();

  const [bounties, setBounties] = useState<BountyMapItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<number | "mine" | null>(null);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const [draftLabel, setDraftLabel] = useState<string | null>(null);
  const [draftLabelLoading, setDraftLabelLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(2);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeStatus, setPledgeStatus] = useState<string | null>(null);

  // Creator issue evidence (Photo on Arkiv + Video on Ethereum Swarm)
  const [issuePhoto, setIssuePhoto] = useState<{ dataUrl: string; bytes: Uint8Array; name: string } | null>(null);
  const [issueVideo, setIssueVideo] = useState<VideoEvidence | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const loadBounties = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const raw = await listBounties({
        limit: 200,
        status: typeof statusFilter === "number" ? statusFilter : undefined,
        worker: statusFilter === "mine" && address ? address : undefined
      });
      setBounties(raw.map(normalizeBounty).filter((b) => b.lat !== 0 || b.lng !== 0));
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, address]);

  useEffect(() => {
    void loadBounties();
  }, [loadBounties]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMapCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setMapCenter({ lat: 19.0760, lng: 72.8777 }),
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const selectedBounty = useMemo(
    () => bounties.find((b) => b.bountyId === selectedId) ?? null,
    [bounties, selectedId]
  );

  // Street address for the picked spot (search picks already carry one).
  useEffect(() => {
    if (!draftPin || draftLabel) return;
    const ctrl = new AbortController();
    setDraftLabelLoading(true);
    const t = setTimeout(() => {
      reverseGeocode(draftPin.lat, draftPin.lng, ctrl.signal)
        .then((label) => !ctrl.signal.aborted && setDraftLabel(label))
        .catch(() => undefined)
        .finally(() => !ctrl.signal.aborted && setDraftLabelLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draftPin, draftLabel]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      setIssuePhoto({ dataUrl, bytes, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    setVideoProgress("Uploading video to Ethereum Swarm…");
    setVideoError(null);
    try {
      const res = await uploadVideo(file, {
        filename: file.name,
        mimeType: file.type || "video/webm"
      });
      setIssueVideo(res);
      setVideoProgress(`Uploaded to Swarm: ${res.swarmReference.slice(0, 16)}…`);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Video upload failed");
    } finally {
      setUploadingVideo(false);
    }
  };

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
      const claimDeadline = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_OPTIONS[expiryIdx].seconds);
      const initialAmount = parseUsdc(amountUsdc);

      let descHash: `0x${string}`;
      let issuePayload: any = null;
      let arkivEntityKey: string | null = null;

      if (issuePhoto || issueVideo) {
        setTxStatus("Sealing issue media into Arkiv & Swarm…");
        const photoSha256 = issuePhoto ? await computeVideoSha256(issuePhoto.bytes) : null;
        issuePayload = {
          version: 1,
          type: "creator_issue_report",
          description: trimmed,
          location: { lat: draftPin.lat, lng: draftPin.lng, label: draftLabel },
          photoDataUrl: issuePhoto?.dataUrl ?? null,
          photoSha256,
          video: issueVideo ?? null,
          creator: address,
          timestamp: Date.now()
        };
        const payloadBytes = new TextEncoder().encode(JSON.stringify(issuePayload));
        const client = getArkivClient();
        const arkivRes = await client.writeEntity(payloadBytes, {
          project: "streetsync",
          entity_type: "creator_issue",
          creator: address.toLowerCase(),
          has_photo: issuePhoto ? "true" : "false",
          has_video: issueVideo ? "true" : "false"
        });
        arkivEntityKey = arkivRes.key;
        descHash = keccak256(payloadBytes);

        // Store mappings in localStorage
        localStorage.setItem(`streetsync:issue:${descHash.toLowerCase()}`, JSON.stringify(issuePayload));
        localStorage.setItem(`streetsync:issue_key:${descHash.toLowerCase()}`, arkivRes.key);
      } else {
        descHash = keccak256(toHex(trimmed));
      }

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

      if (newId && issuePayload) {
        localStorage.setItem(`streetsync:issue:${newId}`, JSON.stringify(issuePayload));
        if (arkivEntityKey) {
          localStorage.setItem(`streetsync:issue_key:${newId}`, arkivEntityKey);
        }
      }

      setTxStatus(null);
      setDescription("");
      setAmount("");
      setDraftPin(null);
      setDraftLabel(null);
      setIssuePhoto(null);
      setIssueVideo(null);
      setVideoProgress(null);
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
      <HomeHero bounties={bounties} loading={loading} glyphs={glyphs} />

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
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
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
          onMapClick={(lat, lng, label) => {
            setDraftPin({ lat, lng });
            setDraftLabel(label ?? null);
            setSelectedId(null);
          }}
          center={mapCenter}
          className="h-[460px] w-full overflow-hidden rounded-xl sm:h-[540px]"
        />
        <p className="px-2 pb-1 pt-2 text-center text-[11px] text-zinc-500">
          Search, use your location or tap the map to drop a pin · drag the pin to fine-tune
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2 animate-rise stagger-3">
        <ListFilter className="mr-1 h-4 w-4 text-zinc-500" aria-label="Filter by status" />
        <button
          onClick={() => setStatusFilter(null)}
          className={`chip ${statusFilter === null ? "chip-active" : ""}`}
        >
          All ({bounties.length})
        </button>
        {isConnected && address && (
          <button
            onClick={() => setStatusFilter(statusFilter === "mine" ? null : "mine")}
            className={`chip font-semibold ${
              statusFilter === "mine"
                ? "chip-active !bg-primary/20 !text-primary !border-primary/40 ring-1 ring-primary/40"
                : "border-primary/20 text-primary hover:border-primary/40"
            }`}
          >
            🔨 My Jobs
          </button>
        )}
        {STATUS_NAMES.map((name, idx) => {
          const count = bounties.filter((b) => b.status === idx).length;
          return (
            <button
              key={name}
              onClick={() => setStatusFilter(statusFilter === idx ? null : idx)}
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
        <section id="create" className="card animate-rise stagger-4 h-fit scroll-mt-24 p-6 lg:col-span-2">
          <div className="flex items-start gap-3">
            <span className="icon-tile">
              <MapPinPlus className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="heading text-lg">Create a bounty</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Fund a repair escrow in USDC. Search or tap the map to set the location.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="card-inset px-3.5 py-2.5 text-xs">
              <p className="label-micro">Location</p>
              {draftPin ? (
                <>
                  <p className="mt-1 text-[13px] font-semibold text-zinc-100">
                    {draftLabel ?? (draftLabelLoading ? <span className="skeleton inline-block h-4 w-40 align-middle" /> : "Pinned location")}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-zinc-500">Search or tap the map to drop a pin</p>
              )}
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Repave the broken sidewalk section near the north crosswalk"
              rows={3}
              className="field resize-none"
            />

            {/* Media Attachments: Photo (Arkiv) + Video (Swarm) */}
            <div className="card-inset p-3 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5 text-brand-400" />
                  Attach Problem Evidence
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">Arkiv + Swarm</span>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="btn-ghost btn-sm flex items-center gap-1.5 border border-white/10 hover:border-brand-400/40 text-xs"
                >
                  <ImagePlus className="h-3.5 w-3.5 text-brand-300" />
                  {issuePhoto ? "Replace Photo" : "Add Photo (Arkiv)"}
                </button>

                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingVideo}
                  onClick={() => videoInputRef.current?.click()}
                  className="btn-ghost btn-sm flex items-center gap-1.5 border border-white/10 hover:border-amber-400/40 text-xs text-amber-200"
                >
                  <Video className="h-3.5 w-3.5 text-amber-400" />
                  {uploadingVideo ? "Uploading to Swarm…" : issueVideo ? "Replace Video" : "Add Video (Swarm)"}
                </button>
              </div>

              {/* Photo preview */}
              {issuePhoto && (
                <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40 p-2 flex items-center gap-3">
                  <img
                    src={issuePhoto.dataUrl}
                    alt="Issue preview"
                    className="h-12 w-12 rounded object-cover border border-white/10 shrink-0"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate font-medium text-zinc-200">{issuePhoto.name}</p>
                    <p className="text-[10px] text-brand-300">Ready to seal into Arkiv</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIssuePhoto(null)}
                    className="text-zinc-500 hover:text-red-400 p-1"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Video upload in progress */}
              {uploadingVideo && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-300 flex items-center gap-2">
                  <span className="spinner spinner-sm spinner-inherit shrink-0" />
                  <span>Uploading video to Ethereum Swarm Bee gateway…</span>
                </div>
              )}

              {videoError && (
                <p className="text-xs text-red-300">{videoError}</p>
              )}

              {/* Video preview / confirmed */}
              {issueVideo && !uploadingVideo && (
                <div className="relative rounded-lg overflow-hidden border border-amber-500/30 bg-black/40 p-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Play className="h-4 w-4 text-amber-400" />
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="font-semibold text-amber-200">
                        Swarm Video Attached ({issueVideo.durationSeconds}s)
                      </p>
                      <p className="text-[10px] text-zinc-400 font-mono truncate">
                        Ref: {issueVideo.swarmReference.slice(0, 16)}…
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIssueVideo(null);
                      setVideoProgress(null);
                    }}
                    className="text-zinc-500 hover:text-red-400 p-1 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

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
                  <span className="spinner spinner-sm spinner-inherit" />
                  Confirm in wallet…
                </>
              ) : (
                "Approve USDC & Create Bounty"
              )}
            </button>
            {!isConnected && (
              <p className="text-center text-[11px] text-zinc-500">
                Connect a wallet to fund bounties.
              </p>
            )}
            <TestUsdcFaucet />
          </div>
        </section>

        {/* Bounty list */}
        <section id="bounties" className="animate-rise stagger-5 space-y-3 scroll-mt-24 lg:col-span-3">
          {selectedBounty && (
            <div className="card border-brand-400/40 p-5 shadow-glow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="heading text-sm">
                    Bounty #{selectedBounty.bountyId}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {statusName(selectedBounty.status)} · escrow{" "}
                    <strong className="text-zinc-200">
                      {formatUsdcDisplaySafe(selectedBounty.totalPledged)} USDC
                    </strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedBounty.status === 0 ? (
                    <Link
                      href={`/bounty/${selectedBounty.bountyId}/work`}
                      className="btn-success btn-sm flex items-center gap-1.5 font-bold"
                    >
                      <Hammer className="h-3.5 w-3.5" />
                      Accept &amp; Work
                    </Link>
                  ) : address && selectedBounty.worker?.toLowerCase() === address.toLowerCase() ? (
                    <Link
                      href={`/bounty/${selectedBounty.bountyId}/work`}
                      className="btn-primary btn-sm flex items-center gap-1.5 font-bold"
                    >
                      <Hammer className="h-3.5 w-3.5" />
                      Workbench
                    </Link>
                  ) : null}
                  <Link
                    href={`/bounty/${selectedBounty.bountyId}`}
                    className="btn-ghost btn-sm"
                  >
                    Details
                  </Link>
                </div>
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
                className={`card card-hover flex w-full items-center justify-between gap-3 p-4 text-left ${
                  selectedId === b.bountyId ? "border-brand-400/50 shadow-glow-sm" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    Bounty #{b.bountyId}
                    {b.description && (
                      <span className="ml-2 truncate text-xs font-normal text-zinc-500">
                        {b.description}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[statusName(b.status)], boxShadow: `0 0 5px ${STATUS_COLORS[statusName(b.status)]}` }}
                    />
                    {statusName(b.status)}
                    {b.status === 0 && (
                      <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                        Open to Claim
                      </span>
                    )}
                    {address && b.worker?.toLowerCase() === address.toLowerCase() && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30">
                        Your Job
                      </span>
                    )}
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

      <HowItWorks />
    </div>
  );
}
