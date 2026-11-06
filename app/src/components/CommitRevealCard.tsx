"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useConfig,
  useWriteContract
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { ESCROW_ABI, ESCROW_ADDRESS, formatUsdcDisplay } from "@/config/contracts";
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
        address: ESCROW_ADDRESS!,
        abi: ESCROW_ABI,
        functionName: "commitVote",
        args: [bountyId, voteHash]
      });
      await waitForTransactionReceipt(config, { hash });

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
        address: ESCROW_ADDRESS!,
        abi: ESCROW_ABI,
        functionName: "revealVote",
        args: [bountyId, vote.approve, vote.salt]
      });
      await waitForTransactionReceipt(config, { hash });
      onTxSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePoke = async () => {
    setError(null);
    setBusy("poke");
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: ESCROW_ABI,
        functionName: "pokeOrReplace",
        args: [bountyId]
      });
      await waitForTransactionReceipt(config, { hash });
      onTxSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="heading text-sm">
          Commit-Reveal Vote <span className="text-slate-500">· round {reviewRound}</span>
        </p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${
            phase === "commit"
              ? "bg-brand-400/10 text-brand-300 ring-brand-400/30"
              : phase === "reveal"
                ? "bg-orange-400/10 text-orange-300 ring-orange-400/30"
                : "bg-red-400/10 text-red-300 ring-red-400/30"
          }`}
        >
          {phase === "commit" ? "COMMIT OPEN" : phase === "reveal" ? "REVEAL OPEN" : "WINDOW EXPIRED"}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-400">
        Pool: {formatUsdcDisplay(totalPledged)} USDC · 90% to worker on approval, 10% + slashed
        stakes to majority reviewers.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="card-inset p-2.5">
          <p className="text-slate-500">Commit ends</p>
          <p className="font-mono text-sm font-semibold text-slate-200">
            {phase === "commit" ? countdown(commitSecondsLeft) : formatUtc(commitDeadline)}
          </p>
        </div>
        <div className="card-inset p-2.5">
          <p className="text-slate-500">Reveal ends</p>
          <p className="font-mono text-sm font-semibold text-slate-200">
            {phase !== "commit" ? countdown(revealSecondsLeft) : formatUtc(revealDeadline)}
          </p>
        </div>
      </div>

      {storedVote && (
        <div className="mt-3 rounded-xl bg-brand-400/10 p-3 text-[11px] ring-1 ring-brand-400/30">
          <p className="font-semibold text-brand-200">
            Saved vote: {storedVote.approve ? "APPROVE" : "REJECT"}
          </p>
          <p className="mt-0.5 font-mono text-brand-300">
            salt {shortHash(storedVote.salt, 8)} · commit {shortHash(storedVote.commitHash, 8)}
          </p>
          <p className="mt-0.5 text-brand-300/80">
            Stored in localStorage under <code className="code-pill">{storageKey}</code>
          </p>
        </div>
      )}

      {phase === "commit" && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setApprove(true)}
              className={`rounded-xl py-2.5 text-sm font-semibold ring-1 transition ${
                approve
                  ? "bg-emerald-500 text-white ring-emerald-400/50 shadow-lg shadow-emerald-500/20"
                  : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10"
              }`}
            >
              Approve work
            </button>
            <button
              onClick={() => setApprove(false)}
              className={`rounded-xl py-2.5 text-sm font-semibold ring-1 transition ${
                !approve
                  ? "bg-red-500 text-white ring-red-400/50 shadow-lg shadow-red-500/20"
                  : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10"
              }`}
            >
              Reject work
            </button>
          </div>
          <button
            onClick={handleCommit}
            disabled={isPending || busy !== null || !address || !!storedVote}
            className="btn-primary mt-2 w-full py-2.5 text-sm"
          >
            {busy === "commit"
              ? "Committing…"
              : storedVote
                ? "Vote committed"
                : "1-click Commit Vote"}
          </button>
          <p className="mt-1.5 text-[11px] text-slate-500">
            A random 32-byte salt is generated in your browser and saved locally — only the
            keccak256 hash goes on-chain.
          </p>
        </div>
      )}

      {phase === "reveal" && (
        <button
          onClick={handleReveal}
          disabled={isPending || busy !== null}
          className="btn-primary mt-4 w-full py-2.5 text-sm"
        >
          {busy === "reveal" ? "Revealing…" : "Reveal Vote"}
        </button>
      )}

      {phase === "expired" && (
        <button
          onClick={handlePoke}
          disabled={isPending || busy !== null}
          className="btn-danger mt-4 w-full py-2.5 text-sm"
        >
          {busy === "poke" ? "Poking…" : "Slash / Replace Inactive Reviewers (pokeOrReplace)"}
        </button>
      )}

      {error && (
        <p className="mt-3 alert-error text-[11px]">
          {error}
        </p>
      )}
    </div>
  );
}
