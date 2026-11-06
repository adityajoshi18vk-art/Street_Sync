"use client";

import { useState } from "react";
import { useChainId, useConfig, useReadContract, useWriteContract } from "wagmi";
import {
  ACTIVE_CHAIN, ESCROW_ABI, ESCROW_ADDRESS, contractsDeployed
} from "@/config/contracts";
import WorldIdButton from "@/components/WorldIdButton";
import type { Attestation, GeoPoint } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { requestPosition } from "@/lib/geo";
import { canFinalizeValidation, canVoteProblem, countdownLabel } from "@/lib/lifecycle";
import { waitTx } from "@/lib/tx";
import { useNowSeconds } from "@/lib/useNow";

interface Props {
  bountyId: string;
  address: `0x${string}` | undefined;
  creator: string;
  validationDeadline: number;
  confirmations: number;
  disputes: number;
  quorum: number;
  onChanged: () => void;
}

/** Neighbour validation while a bounty is Proposed: tally, countdown, and World-ID-gated votes. */
export default function NeighbourValidationPanel({
  bountyId, address, creator, validationDeadline, confirmations, disputes, quorum, onChanged
}: Props) {
  const config = useConfig();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const now = useNowSeconds(1_000);
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id && !!address;
  const bountyIdBig = BigInt(bountyId);

  const [choice, setChoice] = useState<boolean | null>(null);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: myVoteRaw, refetch: refetchVote } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI,
    functionName: "problemVote",
    args: address ? [bountyIdBig, address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });
  const myVote = Number(myVoteRaw ?? 0);
  const isCreator = !!address && address.toLowerCase() === creator.toLowerCase();
  const lifecycle = { status: 7, validationDeadline, claimDeadline: 0, workDeadline: 0, reworkCount: 0 };
  const mayVote = !!address && canVoteProblem({ bounty: lifecycle, now, isCreator, myVote });
  const mayFinalize = canFinalizeValidation(lifecycle, now);

  const choose = async (isReal: boolean) => {
    setError(null);
    setStatus(null);
    setChoice(isReal);
    setLocation(null);
    setLocating(true);
    try {
      setLocation(await requestPosition());
    } catch (e) {
      setChoice(null);
      setError(friendlyError(e));
    } finally {
      setLocating(false);
    }
  };

  const castVote = async (attestation: Attestation) => {
    if (!canWrite || !address || !ESCROW_ADDRESS || choice === null) {
      setError("Connect a wallet on the configured network to vote.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStatus("Confirm your vote in your wallet…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "voteProblem",
        args: [bountyIdBig, choice, BigInt(attestation.nonce), BigInt(attestation.expiry), attestation.signature],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setStatus("Waiting for confirmation…");
      await waitTx(config, hash);
      setStatus("Vote recorded. Thanks for helping verify this report.");
      setChoice(null);
      setLocation(null);
      await refetchVote();
      onChanged();
    } catch (e) {
      setStatus(null);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!canWrite || !address || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured network first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStatus("Closing validation…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "finalizeValidation",
        args: [bountyIdBig],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);
      setStatus("Validation closed. The report didn't reach quorum, so pledges can be withdrawn.");
      onChanged();
    } catch (e) {
      setStatus(null);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const bar = (value: number, color: string) => (
    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full ${color}`}
        style={{ width: `${quorum > 0 ? Math.min(100, (value / quorum) * 100) : 0}%` }}
      />
    </div>
  );

  return (
    <div className="rounded-xl bg-cyan-50 p-5 shadow-card ring-1 ring-cyan-200">
      <p className="text-sm font-bold text-cyan-900">Neighbour validation</p>
      <p className="mt-1 text-xs text-cyan-800">
        Is this a real problem? {quorum > 0 ? quorum : "A few"} verified neighbours must agree before
        the bounty opens for work. If {quorum > 0 ? quorum : "enough"} neighbours say it isn&apos;t
        real, or the vote ends without a decision, every pledge can be withdrawn.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-semibold text-emerald-700">Real · {confirmations} / {quorum}</p>
          {bar(confirmations, "bg-emerald-500")}
        </div>
        <div>
          <p className="mb-1 font-semibold text-red-700">Not real · {disputes} / {quorum}</p>
          {bar(disputes, "bg-red-500")}
        </div>
      </div>
      <p className="mt-3 text-xs font-medium text-cyan-900">
        Validation {countdownLabel(validationDeadline, now)}
      </p>

      {isCreator && (
        <p className="mt-3 rounded-lg bg-white/70 p-2.5 text-xs text-gray-600">
          You reported this problem, so neighbours decide. Share the link to speed things up.
        </p>
      )}
      {!isCreator && myVote !== 0 && (
        <p className="mt-3 rounded-lg bg-white/70 p-2.5 text-xs text-gray-700">
          You voted <strong>{myVote === 1 ? "real" : "not real"}</strong> on this report.
        </p>
      )}

      {mayVote && choice === null && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy || locating || !canWrite}
            onClick={() => void choose(true)}
            className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Yes, it&apos;s a real problem
          </button>
          <button
            type="button"
            disabled={busy || locating || !canWrite}
            onClick={() => void choose(false)}
            className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            No, it isn&apos;t
          </button>
        </div>
      )}
      {mayVote && !canWrite && (
        <p className="mt-2 text-[11px] text-amber-700">
          Connect to {ACTIVE_CHAIN.name} with your wallet to vote. You also need to be physically nearby.
        </p>
      )}

      {mayVote && choice !== null && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-cyan-900">
            Your vote: <strong>{choice ? "real problem" : "not a problem"}</strong>
            {locating && " · getting your location…"}
            {location && ` · location shared (${location.lat.toFixed(3)}, ${location.lng.toFixed(3)})`}
          </p>
          {location && (
            <WorldIdButton
              role="neighbour"
              bountyId={bountyId}
              wallet={address}
              location={location}
              disabled={busy || !canWrite}
              label="Verify with World ID & submit vote"
              busyLabel="Verifying…"
              onAttestation={castVote}
              onError={(m) => setError(friendlyError(m))}
            />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => { setChoice(null); setLocation(null); }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Change my answer
          </button>
        </div>
      )}

      {mayFinalize && (
        <button
          type="button"
          disabled={busy || !canWrite}
          onClick={() => void finalize()}
          className="mt-4 w-full rounded-lg bg-gray-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
        >
          Close validation
        </button>
      )}

      {status && <p className="mt-3 text-xs font-medium text-cyan-900">{status}</p>}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 ring-1 ring-red-200">{error}</p>
      )}
    </div>
  );
}
