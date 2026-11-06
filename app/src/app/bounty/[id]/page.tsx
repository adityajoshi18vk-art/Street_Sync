"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useAccount,
  useConfig,
  useReadContract,
  useWriteContract
} from "wagmi";
import { waitForTransactionReceipt, readContract } from "wagmi/actions";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  contractsDeployed,
  e5ToLatLng,
  formatUsdcDisplay,
  parseUsdc
} from "@/config/contracts";
import { approveUsdcExact } from "@/lib/tx";
import {
  shortAddress,
  formatUtc,
  isZeroHash,
  shortHash
} from "@/lib/types";
import { HashBadge, StatusBadge } from "@/components/StatusBadge";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import { readEvidenceBundle } from "@streetsync/arkiv-client";
import { unpackBundle } from "@streetsync/evidence";
import { getVideoPlaybackUrl, getVideoUrl, type VideoEvidence } from "@streetsync/swarm-client";

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const bountyId = params.id;
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledging, setPledging] = useState(false);
  const [pledgeStatus, setPledgeStatus] = useState<string | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [videoEvidence, setVideoEvidence] = useState<VideoEvidence | null>(null);

  const { data: bounty, refetch, isLoading } = useReadContract({
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "getBounty",
    args: [BigInt(bountyId ?? "0")],
    query: { enabled: !!ESCROW_ADDRESS && contractsDeployed, refetchInterval: 15_000 }
  });

  const { data: tally } = useReadContract({
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "getTally",
    args: [BigInt(bountyId ?? "0")],
    query: { enabled: !!ESCROW_ADDRESS && contractsDeployed }
  });
  const tallyTuple = tally as readonly [number, number] | undefined;

  const { data: commitDeadline } = useReadContract({
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "commitDeadline",
    args: [BigInt(bountyId ?? "0")],
    query: { enabled: !!ESCROW_ADDRESS && contractsDeployed }
  });

  const { data: revealDeadline } = useReadContract({
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "revealDeadline",
    args: [BigInt(bountyId ?? "0")],
    query: { enabled: !!ESCROW_ADDRESS && contractsDeployed }
  });

  if (!contractsDeployed) {
    return (
      <div className="alert-warn p-6">
        Escrow contracts are not configured on this network. See the home page banner for setup.
      </div>
    );
  }

  if (isLoading || !bounty) {
    return <div className="skeleton h-40" />;
  }

  const b = bounty as unknown as {
    id: bigint;
    creator: string;
    latE5: number;
    lngE5: number;
    regionCell: number;
    totalPledged: bigint;
    createdAt: bigint;
    claimDeadline: bigint;
    worker: string;
    visualChallengeCode: number;
    arkivEntityKey: string;
    evidenceHash: string;
    selectionBlock: bigint;
    reviewRound: number;
    reworkCount: number;
    status: number;
  };

  const { lat, lng } = e5ToLatLng(b.latE5, b.lngE5);
  const hasEvidence = !isZeroHash(b.arkivEntityKey);
  const isWorker = !!address && address.toLowerCase() === b.worker?.toLowerCase();
  const nowSeconds = Math.floor(Date.now() / 1000);

  useEffect(() => {
    if (!hasEvidence || !b?.arkivEntityKey) return;
    let cancelled = false;
    (async () => {
      try {
        const client = getArkivClient();
        const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const candidates = [
          lookupStoredEntityKey(b.arkivEntityKey),
          lookupBountyEntityKey(bountyId ?? ""),
          b.arkivEntityKey
        ].filter((k): k is string => !!k && k !== ZERO_KEY);

        for (const k of candidates) {
          try {
            const res = await readEvidenceBundle(client, k);
            const unpacked = await unpackBundle(res.bundle);
            if (!cancelled && unpacked.metadata?.video) {
              setVideoEvidence(unpacked.metadata.video);
              break;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasEvidence, b?.arkivEntityKey, bountyId]);

  const handlePledge = async () => {
    if (!address) return;
    setPledgeError(null);
    setPledgeStatus(null);
    setPledging(true);
    try {
      const amountUsdc = String(Number(pledgeAmount));
      if (Number(pledgeAmount) <= 0) throw new Error("Enter a valid USDC amount.");
      await approveUsdcExact({
        config,
        owner: address,
        spender: ESCROW_ADDRESS!,
        amountUsdc,
        writeContractAsync,
        onPhase: (_p, msg) => setPledgeStatus(msg ?? null)
      });
      setPledgeStatus("Pledging…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: ESCROW_ABI,
        functionName: "pledge",
        args: [BigInt(bountyId), parseUsdc(amountUsdc)]
      });
      await waitForTransactionReceipt(config, { hash });
      setPledgeAmount("");
      setPledgeStatus("Pledge confirmed");
      void refetch();
    } catch (e) {
      setPledgeStatus(null);
      setPledgeError(e instanceof Error ? e.message : String(e));
    } finally {
      setPledging(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="animate-rise flex items-center justify-between">
        <Link href="/" className="text-sm font-medium text-brand-300 transition hover:text-brand-200">
          ← Map
        </Link>
        <StatusBadge status={b.status} />
      </div>

      <div className="card animate-rise stagger-1 p-6">
        <h1 className="heading text-2xl">Bounty #{b.id.toString()}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {lat.toFixed(5)}, {lng.toFixed(5)} · region cell {b.regionCell}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Field label="Escrow pool" value={`${formatUsdcDisplay(b.totalPledged)} USDC`} />
          <Field label="Creator" value={shortAddress(b.creator)} />
          <Field
            label="Worker"
            value={b.worker === "0x0000000000000000000000000000000000000000" ? "— unclaimed" : shortAddress(b.worker)}
          />
          <Field label="Review round" value={String(b.reviewRound)} />
          <Field label="Created" value={formatUtc(b.createdAt)} />
          <Field label="Claim deadline" value={formatUtc(b.claimDeadline)} />
          <Field label="Rework count" value={`${b.reworkCount} / 1`} />
          <Field label="Selection block" value={b.selectionBlock.toString()} />
        </div>

        {b.status === 1 && b.visualChallengeCode > 0 && (
          <div className="alert-info mt-4 flex items-center gap-4 p-5">
            <div>
              <p className="label-micro !text-brand-300">
                Visual Challenge Code
              </p>
              <p className="text-gradient font-mono text-4xl font-black tracking-[0.3em]">
                {String(b.visualChallengeCode).padStart(4, "0")}
              </p>
            </div>
            <p className="text-xs text-slate-400">
              Anti-spoofing code burned into evidence photos by the worker&apos;s camera.
            </p>
          </div>
        )}

        {hasEvidence && (
          <div className="mt-4 space-y-2">
            <HashBadge label="Evidence hash (SHA-256)" hash={b.evidenceHash} />
            <HashBadge label="Arkiv entity key" hash={b.arkivEntityKey} />
          </div>
        )}

        {videoEvidence && (
          <div className="alert-warn mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
                  Ethereum Swarm (BZZ)
                </span>
                <span className="text-xs font-semibold text-amber-200">
                  Walkthrough Video Attached ({videoEvidence.durationSeconds}s)
                </span>
              </div>
              <a
                href={getVideoUrl(videoEvidence.swarmReference)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-amber-300 underline transition hover:text-amber-200"
              >
                Verify on Swarm Gateway ↗
              </a>
            </div>
            <video
              src={getVideoPlaybackUrl(videoEvidence.swarmReference)}
              controls
              playsInline
              className="w-full max-h-64 rounded-xl bg-black object-contain ring-1 ring-white/10"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-amber-300/80">
              <span>Swarm Ref: {videoEvidence.swarmReference.slice(0, 20)}…</span>
              <span>SHA: {videoEvidence.videoSha256.slice(0, 16)}…</span>
            </div>
          </div>
        )}

        {b.status === 3 && tallyTuple && (
          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <Field label="Revealed" value={`${Number(tallyTuple[0])} / 3`} />
            <Field label="Approvals" value={String(Number(tallyTuple[1]))} />
            <Field
              label="Reveal ends"
              value={revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
            />
            {commitDeadline ? (
              <p className="col-span-3 text-[11px] text-slate-500">
                Commit window ends {formatUtc(commitDeadline as bigint)} · reveal{" "}
                {revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
                {nowSeconds > Number(revealDeadline ?? 0n) && " (expired — pokeOrReplace available)"}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="animate-rise stagger-2 grid gap-4 md:grid-cols-3">
        {b.status === 0 && (
          <div className="card p-5 md:col-span-2">
            <p className="heading text-base">Fund this bounty</p>
            <div className="mt-3 flex gap-2">
              <input
                value={pledgeAmount}
                onChange={(e) => setPledgeAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC amount"
                className="field"
              />
              <button
                onClick={handlePledge}
                disabled={!isConnected || !pledgeAmount || pledging}
                className="btn-success shrink-0 px-5"
              >
                {pledging && <span className="spinner spinner-sm border-white/30 border-t-white" aria-hidden />}
                {pledging ? "Pledging…" : "Pledge"}
              </button>
            </div>
            {pledgeStatus && <p className="mt-2 text-xs font-medium text-brand-300">{pledgeStatus}</p>}
            {pledgeError && (
              <p className="alert-error mt-2 !p-2 text-xs">
                {pledgeError}
              </p>
            )}
          </div>
        )}

        {b.status === 0 && (
          <ActionCard
            title="Work on it"
            description="Verify with World ID, claim, and submit before/after evidence."
            href={`/bounty/${bountyId}/work`}
            cta="Start work"
          />
        )}

        {isWorker && (b.status === 1 || b.reworkCount > 0) && (
          <ActionCard
            title="Continue work"
            description="Capture before/after photos and submit evidence."
            href={`/bounty/${bountyId}/work`}
            cta="Open workbench"
          />
        )}

        {hasEvidence && (
          <>
            <ActionCard
              title="Public audit"
              description="Recompute SHA-256 in the browser and test tamper detection. No wallet needed."
              href={`/audit/${bountyId}`}
              cta="Audit evidence"
            />
            <ActionCard
              title="Review dashboard"
              description="Commit-reveal voting for assigned reviewers."
              href="/review"
              cta="Open review"
            />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-inset px-3 py-2.5">
      <p className="label-micro">{label}</p>
      <p className="mt-0.5 font-mono text-xs font-semibold text-slate-200">{value}</p>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  cta
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="card card-hover flex flex-col p-5">
      <p className="heading text-base">{title}</p>
      <p className="mt-1 flex-1 text-xs text-slate-400">{description}</p>
      <Link
        href={href}
        className="btn-primary mt-4"
      >
        {cta}
      </Link>
    </div>
  );
}
