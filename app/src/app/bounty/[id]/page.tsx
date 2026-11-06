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
      <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-amber-200">
        Escrow contracts are not configured on this network. See the home page banner for setup.
      </div>
    );
  }

  if (isLoading || !bounty) {
    return <div className="h-40 animate-pulse rounded-xl bg-gray-200" />;
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
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">
          ← Map
        </Link>
        <StatusBadge status={b.status} />
      </div>

      <div className="rounded-xl bg-white p-6 shadow-card ring-1 ring-gray-200">
        <h1 className="text-xl font-bold text-gray-900">Bounty #{b.id.toString()}</h1>
        <p className="mt-1 text-sm text-gray-500">
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
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-brand-50 p-4 ring-1 ring-brand-200">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                Visual Challenge Code
              </p>
              <p className="text-3xl font-black tracking-widest text-brand-800">
                {String(b.visualChallengeCode).padStart(4, "0")}
              </p>
            </div>
            <p className="text-[11px] text-brand-700">
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
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                  Ethereum Swarm (BZZ)
                </span>
                <span className="text-xs font-semibold text-amber-800">
                  Walkthrough Video Attached ({videoEvidence.durationSeconds}s)
                </span>
              </div>
              <a
                href={getVideoUrl(videoEvidence.swarmReference)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline"
              >
                Verify on Swarm Gateway ↗
              </a>
            </div>
            <video
              src={getVideoPlaybackUrl(videoEvidence.swarmReference)}
              controls
              playsInline
              className="w-full max-h-64 rounded-lg bg-black object-contain"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-amber-800">
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
              <p className="col-span-3 text-[11px] text-gray-400">
                Commit window ends {formatUtc(commitDeadline as bigint)} · reveal{" "}
                {revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
                {nowSeconds > Number(revealDeadline ?? 0n) && " (expired — pokeOrReplace available)"}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        {b.status === 0 && (
          <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200 md:col-span-2">
            <p className="text-sm font-bold text-gray-900">Fund this bounty</p>
            <div className="mt-3 flex gap-2">
              <input
                value={pledgeAmount}
                onChange={(e) => setPledgeAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC amount"
                className="w-full rounded-lg text-sm ring-1 ring-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={handlePledge}
                disabled={!isConnected || !pledgeAmount}
                className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
              >
                Pledge
              </button>
            </div>
            {pledgeStatus && <p className="mt-2 text-xs font-medium text-brand-700">{pledgeStatus}</p>}
            {pledgeError && (
              <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200">
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
    <div className="rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-mono text-xs font-semibold text-gray-800">{value}</p>
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
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
      <p className="text-sm font-bold text-gray-900">{title}</p>
      <p className="mt-1 flex-1 text-xs text-gray-500">{description}</p>
      <Link
        href={href}
        className="mt-3 rounded-lg bg-brand-600 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        {cta}
      </Link>
    </div>
  );
}
