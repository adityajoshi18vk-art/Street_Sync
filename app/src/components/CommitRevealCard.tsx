"use client";

import { waitTx } from "@/lib/tx";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  useWriteContract
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { ACTIVE_CHAIN, contractsDeployed, ESCROW_ABI, ESCROW_ADDRESS, formatUsdcDisplay } from "@/config/contracts";
import {
  computeVoteHash,
  generateSalt,
  loadVote,
  saveVote,
  voteStorageKey,
  type StoredVote
} from "@/lib/evidence";
import { shortHash, formatUtc } from "@/lib/types";

interface CommitRevealCardProps {
  bountyId: bigint;
  reviewRound: number;
  commitDeadline: bigint;
  revealDeadline: bigint;
  totalPledged: bigint;
  onTxSuccess?: () => void;
}

type Phase = "commit" | "reveal" | "expired";

function countdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CommitRevealCard({
  bountyId,
  reviewRound,
  commitDeadline,
  revealDeadline,
  totalPledged,
  onTxSuccess
}: CommitRevealCardProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id && !!address;
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [approve, setApprove] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"commit" | "reveal" | "poke" | null>(null);
  const [storedVote, setStoredVote] = useState<StoredVote | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const storageKey = useMemo(
    () => (address ? voteStorageKey(bountyId, reviewRound, address) : null),
    [address, bountyId, reviewRound]
  );

  useEffect(() => {
    setStoredVote(storageKey ? loadVote(storageKey) : null);
  }, [storageKey, now >= Number(commitDeadline)]);

  const phase: Phase =
    now <= Number(commitDeadline) ? "commit" : now <= Number(revealDeadline) ? "reveal" : "expired";

  const commitSecondsLeft = Math.max(0, Number(commitDeadline) - now);
  const revealSecondsLeft = Math.max(0, Number(revealDeadline) - now);

  const handleCommit = async () => {
    if (!canWrite || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured contract network before voting.");
      return;
    }
    if (!address || !storageKey) return;
    setError(null);
    setBusy("commit");
    try {
      const salt = generateSalt();
      const voteHash = await computeVoteHash({
        bountyId,
        reviewRound,
        approve,
        salt,
        voter: address
      });

      const vote: StoredVote = {
        salt,
        approve,
        committedAt: Date.now(),
        commitHash: voteHash
      };

      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "commitVote",
        args: [bountyId, voteHash],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);

      // Salt is saved ONLY after the commit tx confirms, keyed by
      // bountyId + round + wallet so re-votes in later rounds never collide.
      saveVote(storageKey, vote);
      setStoredVote(vote);
      onTxSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleReveal = async () => {
    if (!canWrite || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured contract network before voting.");
      return;
    }
    if (!storageKey) return;
    const vote = loadVote(storageKey);
    if (!vote) {
      setError(
        "No saved salt found for this bounty + round + wallet on this device. Commit votes are device-bound."
      );
      return;
    }
    setError(null);
    setBusy("reveal");
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "revealVote",
        args: [bountyId, vote.approve, vote.salt],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);
      onTxSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePoke = async () => {
    if (!canWrite || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured contract network before taking this action.");
      return;
    }
    setError(null);
    setBusy("poke");
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "pokeOrReplace",
        args: [bountyId],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);
      onTxSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          Commit-Reveal Vote <span className="text-gray-400">· round {reviewRound}</span>
        </p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${
            phase === "commit"
              ? "bg-brand-50 text-brand-700 ring-brand-200"
              : phase === "reveal"
                ? "bg-orange-50 text-orange-700 ring-orange-200"
                : "bg-red-50 text-red-700 ring-red-200"
          }`}
        >
          {phase === "commit" ? "COMMIT OPEN" : phase === "reveal" ? "REVEAL OPEN" : "WINDOW EXPIRED"}
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        Pool: {formatUsdcDisplay(totalPledged)} USDC · 90% to worker on approval, 10% + slashed
        stakes to majority reviewers.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="rounded-lg bg-gray-50 p-2.5 ring-1 ring-gray-200">
          <p className="text-gray-400">Commit ends</p>
          <p className="font-mono text-sm font-semibold text-gray-800">
            {phase === "commit" ? countdown(commitSecondsLeft) : formatUtc(commitDeadline)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2.5 ring-1 ring-gray-200">
          <p className="text-gray-400">Reveal ends</p>
          <p className="font-mono text-sm font-semibold text-gray-800">
            {phase !== "commit" ? countdown(revealSecondsLeft) : formatUtc(revealDeadline)}
          </p>
        </div>
      </div>

      {storedVote && (
        <div className="mt-3 rounded-lg bg-brand-50 p-3 text-[11px] ring-1 ring-brand-200">
          <p className="font-semibold text-brand-800">
            Saved vote: {storedVote.approve ? "APPROVE" : "REJECT"}
          </p>
          <p className="mt-0.5 font-mono text-brand-700">
            salt {shortHash(storedVote.salt, 8)} · commit {shortHash(storedVote.commitHash, 8)}
          </p>
          <p className="mt-0.5 text-brand-600">
            Stored in localStorage under <code>{storageKey}</code>
          </p>
        </div>
      )}

      {phase === "commit" && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setApprove(true)}
              className={`rounded-lg py-2.5 text-sm font-semibold ring-1 transition ${
                approve
                  ? "bg-emerald-600 text-white ring-emerald-600"
                  : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-50"
              }`}
            >
              Approve work
            </button>
            <button
              onClick={() => setApprove(false)}
              className={`rounded-lg py-2.5 text-sm font-semibold ring-1 transition ${
                !approve
                  ? "bg-red-600 text-white ring-red-600"
                  : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-50"
              }`}
            >
              Reject work
            </button>
          </div>
          <button
            onClick={handleCommit}
            disabled={!canWrite || isPending || busy !== null || !!storedVote}
            className="mt-2 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-40"
          >
            {busy === "commit"
              ? "Committing…"
              : storedVote
                ? "Vote committed"
                : "1-click Commit Vote"}
          </button>
          <p className="mt-1.5 text-[11px] text-gray-400">
            A random 32-byte salt is generated in your browser and saved locally — only the
            keccak256 hash goes on-chain.
          </p>
        </div>
      )}

      {phase === "reveal" && (
        <button
          onClick={handleReveal}
          disabled={!canWrite || isPending || busy !== null}
          className="mt-4 w-full rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-40"
        >
          {busy === "reveal" ? "Revealing…" : "Reveal Vote"}
        </button>
      )}

      {phase === "expired" && (
        <button
          onClick={handlePoke}
          disabled={!canWrite || isPending || busy !== null}
          className="mt-4 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
        >
          {busy === "poke" ? "Poking…" : "Slash / Replace Inactive Reviewers (pokeOrReplace)"}
        </button>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
