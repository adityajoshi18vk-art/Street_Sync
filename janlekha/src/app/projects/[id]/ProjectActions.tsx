"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { getAddress, type Address, type Hex } from "viem";
import { ActionCard, SubmitRow, TextInput } from "@/components/wallet/ActionCard";
import { DocumentInput } from "@/components/wallet/DocumentInput";
import { useConnection } from "wagmi";
import { useChainTime, useWriteGate, type WriteGate } from "@/components/wallet/hooks";
import { TxActivityProvider, useContractTx } from "@/components/wallet/tx";
import type { ActionState } from "@/lib/janlekha/action-state";
import { formatPaise, formatTimestamp, shortHex } from "@/lib/janlekha/format";
import { fromDateTimeLocal, parseRupeesToPaise, toDateTimeLocal } from "@/lib/wallet/amounts";
import {
  computeCommitment,
  createBidBackup,
  downloadBidBackup,
  loadBidBackup,
  parseBidBackup,
  saveBidBackup,
  type BidBackup,
} from "@/lib/wallet/bid-backup";
import { appChain, CONTRACT_ADDRESS } from "@/lib/wallet/chain";

const same = (a: Address | undefined, b: Address | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const DAY = 86_400n;

function ownerReason(gate: WriteGate, s: ActionState, action: string): string | null {
  return (
    gate.needRole("DEPARTMENT_ROLE", action) ??
    (same(gate.account, s.department) ? null : `Only the department that created this project (${shortHex(s.department)}) can ${action}.`)
  );
}

// ─── Department: publish tender ─────────────────────────────────────────────

function PublishTender({ s, now }: { s: ActionState; now: bigint }) {
  const gate = useWriteGate();
  const tx = useContractTx("Publish tender");
  const [doc, setDoc] = useState<Hex | null>(null);
  const [bidLocal, setBidLocal] = useState(() => toDateTimeLocal(((BigInt(s.chainTime) + DAY) / 60n + 1n) * 60n));
  const [revealLocal, setRevealLocal] = useState(() => toDateTimeLocal(((BigInt(s.chainTime) + 2n * DAY) / 60n + 1n) * 60n));
  const bid = fromDateTimeLocal(bidLocal);
  const reveal = fromDateTimeLocal(revealLocal);

  const blocked =
    gate.reason ??
    ownerReason(gate, s, "publish its tender") ??
    (!doc ? "Add the tender document PDF first." : null) ??
    (!bid || bid <= now ? `The bid deadline must be after the current chain time (${formatTimestamp(now)}).` : null) ??
    (!reveal || reveal <= bid! ? "The reveal deadline must be after the bid deadline." : null);

  return (
    <ActionCard title="Publish the tender" actor="Department" testId="publish-tender">
      <DocumentInput label="Tender document (PDF)" purpose="public" onChange={setDoc} testId="tender-doc" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Bid deadline (your local time)" type="datetime-local" value={bidLocal} onChange={setBidLocal} testId="bid-deadline" />
        <TextInput label="Reveal deadline (your local time)" type="datetime-local" value={revealLocal} onChange={setRevealLocal} testId="reveal-deadline" />
      </div>
      <p className="text-xs text-neutral-500">Vendors commit sealed bids until the bid deadline, then reveal them until the reveal deadline. Only one tender can be published per project.</p>
      <SubmitRow label="Publish tender" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("publishTender", [BigInt(s.projectId), doc!, bid!, reveal!])} />
    </ActionCard>
  );
}

// ─── Vendor: commit sealed bid ──────────────────────────────────────────────

function CommitBid({ s, now }: { s: ActionState; now: bigint }) {
  const gate = useWriteGate();
  const tx = useContractTx("Commit sealed bid");
  const [amount, setAmount] = useState("");
  const [quotation, setQuotation] = useState<Hex | null>(null);
  const [sealedState, setSealedState] = useState<{ key: string; backup: BidBackup; backedUp: boolean } | null>(null);
  const paise = parseRupeesToPaise(amount);
  const myBid = s.bids.find((b) => same(b.vendor, gate.account));
  const stored = useStoredBackup(s, gate.account);
  // Any change to the inputs or account invalidates a previously sealed bid.
  const inputKey = `${amount}|${quotation}|${gate.account}`;
  const sealed = sealedState?.key === inputKey ? sealedState.backup : null;
  const backedUp = sealedState?.key === inputKey && sealedState.backedUp;

  const tender = s.tender!;
  const baseBlocked =
    gate.reason ??
    gate.needRole("VENDOR_ROLE", "submit a bid") ??
    (now >= BigInt(tender.bidDeadline) ? "The bid deadline has passed; commitments are closed." : null) ??
    (myBid ? `You committed a sealed bid at this account already. Reveal it after ${formatTimestamp(BigInt(tender.bidDeadline))}.` : null);
  const sealBlocked =
    baseBlocked ??
    (!quotation ? "Add your quotation PDF (it stays on your device)." : null) ??
    (!paise ? "Enter your quoted amount in rupees." : null);
  const commitBlocked = sealBlocked ?? (!sealed ? "Seal the bid first." : null) ?? (!backedUp ? "Download the bid backup before committing. Without it you cannot reveal." : null);

  return (
    <ActionCard title="Submit a sealed bid" actor="Vendor" testId="commit-bid">
      {myBid ? (
        <>
          <p className="text-sm text-neutral-700">Your sealed bid is recorded (commitment <code className="font-mono text-xs">{shortHex(myBid.commitment, 10)}</code>).</p>
          {stored && (
            <button type="button" onClick={() => downloadBidBackup(stored)} className="text-sm text-blue-700 underline underline-offset-2">
              Download bid backup again
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-neutral-600">
            Only a hash of your bid is published now. Amount and quotation stay secret until you reveal after the bid deadline.
          </p>
          <DocumentInput label="Quotation (PDF)" purpose="confidential" onChange={setQuotation} testId="quotation-doc" />
          <TextInput label="Quoted amount (₹)" value={amount} onChange={setAmount} placeholder="42,00,000" hint={paise ? `= ${formatPaise(paise)}` : undefined} testId="bid-amount" />
          {!sealed ? (
            <SubmitRow
              label="Seal bid"
              blocked={sealBlocked}
              busy={false}
              state={{ status: "idle" }}
              onSubmit={() => {
                const backup = createBidBackup({
                  chainId: appChain.id,
                  contract: CONTRACT_ADDRESS!,
                  projectId: BigInt(s.projectId),
                  vendor: gate.account!,
                  amountPaise: paise!,
                  quotationDocumentHash: quotation!,
                });
                saveBidBackup(backup);
                setSealedState({ key: inputKey, backup, backedUp: false });
              }}
            />
          ) : (
            <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700">
              <p>
                Sealed with a 32-byte salt from <code>crypto.getRandomValues</code>. Commitment{" "}
                <code data-testid="sealed-commitment" className="break-all font-mono">{sealed.commitment}</code>
              </p>
              <button
                type="button"
                onClick={() => {
                  downloadBidBackup(sealed);
                  setSealedState({ key: inputKey, backup: sealed, backedUp: true });
                }}
                className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium"
              >
                {backedUp ? "Backup downloaded ✓ (download again)" : "Download bid backup (required)"}
              </button>
              <p className="mt-1 text-neutral-500">Also saved in this browser. Keep the file private until you reveal.</p>
            </div>
          )}
          {sealed && <SubmitRow label="Commit sealed bid" blocked={commitBlocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("commitBid", [BigInt(s.projectId), sealed.commitment])} />}
        </>
      )}
    </ActionCard>
  );
}

/** Recomputes the commitment from the backup's own values; the file's stored commitment field is not trusted. */
function backupMatchesBid(backup: BidBackup, onChainCommitment: Hex): boolean {
  const recomputed = computeCommitment(
    BigInt(backup.projectId),
    getAddress(backup.vendor),
    BigInt(backup.amountPaise),
    backup.quotationDocumentHash,
    backup.salt,
  );
  return recomputed.toLowerCase() === onChainCommitment.toLowerCase();
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Bid backup saved in this browser; read as an external store so SSR and hydration agree. */
function useStoredBackup(s: ActionState, account: Address | undefined) {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => (account && CONTRACT_ADDRESS ? JSON.stringify(loadBidBackup(appChain.id, CONTRACT_ADDRESS, s.projectId, account)) : "null"),
    () => "null",
  );
  return useMemo(() => JSON.parse(raw) as BidBackup | null, [raw]);
}

// ─── Vendor: reveal bid ─────────────────────────────────────────────────────

function RevealBid({ s, now }: { s: ActionState; now: bigint }) {
  const gate = useWriteGate();
  const tx = useContractTx("Reveal bid");
  const stored = useStoredBackup(s, gate.account);
  const [imported, setImported] = useState<BidBackup | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const backup = imported ?? stored;
  const myBid = s.bids.find((b) => same(b.vendor, gate.account));
  const tender = s.tender!;

  const backupProblem = !backup
    ? "Import your bid backup file to reveal."
    : backup.chainId !== appChain.id || !same(backup.contract, CONTRACT_ADDRESS) || backup.projectId !== s.projectId
      ? "This backup belongs to a different contract, network or project."
      : !same(backup.vendor, gate.account)
        ? `This backup belongs to vendor ${shortHex(backup.vendor)}, not the connected account.`
        : myBid && !backupMatchesBid(backup, myBid.commitment)
          ? "This backup does not match your sealed bid on-chain: its amount, quotation hash or salt differ from what you committed."
          : null;

  const blocked =
    gate.reason ??
    gate.needRole("VENDOR_ROLE", "reveal a bid") ??
    (now < BigInt(tender.bidDeadline) ? `Reveals open at the bid deadline (${formatTimestamp(BigInt(tender.bidDeadline))}).` : null) ??
    (now >= BigInt(tender.revealDeadline) ? "The reveal deadline has passed." : null) ??
    (!myBid ? "The connected account has no sealed bid on this project." : null) ??
    (myBid?.revealed ? "Your bid has already been revealed." : null) ??
    backupProblem;

  return (
    <ActionCard title="Reveal your sealed bid" actor="Vendor" testId="reveal-bid">
      <p className="text-xs text-neutral-600">Revealing publishes your amount and quotation hash. The contract checks them against your commitment.</p>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">{stored ? "Using the backup saved in this browser. Import a file instead:" : "Import bid backup (JSON)"}</span>
        <input
          type="file"
          accept="application/json,.json"
          data-testid="backup-import"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setImportError(null);
            if (!file) return;
            try {
              setImported(parseBidBackup(await file.text()));
            } catch (error) {
              setImported(null);
              setImportError(error instanceof Error ? error.message : String(error));
            }
          }}
          className="mt-1 block w-full text-sm"
        />
      </label>
      {importError && <p role="alert" className="text-xs text-red-700">{importError}</p>}
      {backup && (
        <p data-testid="active-backup" className="text-xs text-neutral-700">
          Revealing with the {imported ? "imported file" : "backup saved in this browser"}: {formatPaise(BigInt(backup.amountPaise))}, quotation{" "}
          <code className="font-mono">{shortHex(backup.quotationDocumentHash, 10)}</code>
        </p>
      )}
      <SubmitRow
        label="Reveal bid"
        blocked={blocked}
        busy={tx.busy}
        state={tx.state}
        onSubmit={() => void tx.run("revealBid", [BigInt(s.projectId), BigInt(backup!.amountPaise), backup!.quotationDocumentHash, backup!.salt])}
      />
    </ActionCard>
  );
}

// ─── Department: award ──────────────────────────────────────────────────────

function AwardContract({ s }: { s: ActionState }) {
  const gate = useWriteGate();
  const tx = useContractTx("Record award");
  const revealed = s.bids.filter((b) => b.revealed);
  const [vendor, setVendor] = useState<Address | null>(null);
  const [evaluation, setEvaluation] = useState<Hex | null>(null);
  const [contractDoc, setContractDoc] = useState<Hex | null>(null);
  const available = BigInt(s.allocationPaise) - BigInt(s.reservedPaise) - BigInt(s.paidPaise);
  const chosen = revealed.find((b) => same(b.vendor, vendor ?? undefined));

  const blocked =
    gate.reason ??
    ownerReason(gate, s, "record the award") ??
    (revealed.length === 0 ? "No bid was revealed, so there is no eligible vendor to award." : null) ??
    (!chosen ? "Select a revealed bid." : null) ??
    (chosen && BigInt(chosen.amountPaise) > available ? `This bid exceeds the unreserved allocation of ${formatPaise(available)}.` : null) ??
    (!evaluation ? "Add the bid evaluation report PDF." : null) ??
    (!contractDoc ? "Add the signed contract PDF." : null);

  return (
    <ActionCard title="Record the award" actor="Department" testId="award">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-neutral-800">Revealed bids (the award amount is taken from the chosen bid)</legend>
        {revealed.length === 0 && <p className="text-xs text-neutral-500">No revealed bids.</p>}
        {revealed.map((b) => (
          <label key={b.vendor} className="flex items-center gap-2 text-sm">
            <input type="radio" name="award-vendor" checked={same(vendor ?? undefined, b.vendor)} onChange={() => setVendor(getAddress(b.vendor))} />
            <code className="font-mono text-xs">{shortHex(b.vendor)}</code>
            <span className="font-medium tabular-nums">{formatPaise(BigInt(b.amountPaise))}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <DocumentInput label="Bid evaluation report (PDF)" purpose="public" onChange={setEvaluation} testId="evaluation-doc" />
        <DocumentInput label="Signed contract (PDF)" purpose="public" onChange={setContractDoc} testId="contract-doc" />
      </div>
      <SubmitRow label="Record award" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("awardContract", [BigInt(s.projectId), chosen!.vendor, evaluation!, contractDoc!])} />
    </ActionCard>
  );
}

// ─── Department: define milestone ───────────────────────────────────────────

function DefineMilestone({ s }: { s: ActionState }) {
  const gate = useWriteGate();
  const tx = useContractTx("Define milestone");
  const [amount, setAmount] = useState("");
  const [spec, setSpec] = useState<Hex | null>(null);
  const paise = parseRupeesToPaise(amount);
  const award = s.award!;
  const remaining = BigInt(award.amountPaise) - BigInt(award.milestoneTotalPaise);

  const blocked =
    gate.reason ??
    ownerReason(gate, s, "define milestones") ??
    (remaining === 0n ? "Milestones already cover the full award amount." : null) ??
    (!paise ? "Enter the milestone amount in rupees." : null) ??
    (paise && paise > remaining ? `Only ${formatPaise(remaining)} of the award is not yet assigned to milestones.` : null) ??
    (!spec ? "Add the milestone specification PDF." : null);

  return (
    <ActionCard title="Define a milestone" actor="Department" testId="define-milestone">
      <p className="text-xs text-neutral-600">{formatPaise(remaining)} of the {formatPaise(BigInt(award.amountPaise))} award is not yet assigned to milestones.</p>
      <TextInput label="Milestone amount (₹)" value={amount} onChange={setAmount} placeholder="12,00,000" hint={paise ? `= ${formatPaise(paise)}` : undefined} testId="milestone-amount" />
      <DocumentInput label="Milestone specification (PDF)" purpose="public" onChange={setSpec} testId="spec-doc" />
      <SubmitRow label="Define milestone" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("defineMilestone", [BigInt(s.projectId), paise!, spec!])} />
    </ActionCard>
  );
}

// ─── Milestone steps: evidence → inspection → mock PFMS attestation ─────────

function SubmitEvidence({ s, m }: { s: ActionState; m: ActionState["milestones"][number] }) {
  const gate = useWriteGate();
  const tx = useContractTx(`Milestone ${m.id}: submit evidence`);
  const [doc, setDoc] = useState<Hex | null>(null);
  const blocked =
    gate.reason ??
    gate.needRole("VENDOR_ROLE", "submit milestone evidence") ??
    (same(gate.account, s.award!.vendor) ? null : `Only the awarded vendor (${shortHex(s.award!.vendor)}) can submit evidence.`) ??
    (!doc ? "Add the evidence PDF." : null);
  return (
    <ActionCard title={`Milestone ${m.id}: submit completion evidence`} actor="Awarded vendor" testId={`evidence-${m.id}`}>
      <DocumentInput label="Evidence (PDF)" purpose="public" onChange={setDoc} testId={`evidence-doc-${m.id}`} />
      <SubmitRow label="Submit evidence" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("submitMilestoneEvidence", [BigInt(s.projectId), BigInt(m.id), doc!])} />
    </ActionCard>
  );
}

function ApproveMilestone({ s, m }: { s: ActionState; m: ActionState["milestones"][number] }) {
  const gate = useWriteGate();
  const tx = useContractTx(`Milestone ${m.id}: inspection approval`);
  const [doc, setDoc] = useState<Hex | null>(null);
  const blocked =
    gate.reason ??
    gate.needRole("INSPECTOR_ROLE", "approve milestones") ??
    (same(gate.account, s.award!.vendor) ? "The awarded vendor cannot inspect its own work." : null) ??
    (!doc ? "Add the inspection report PDF." : null);
  return (
    <ActionCard title={`Milestone ${m.id}: approve after inspection`} actor="Inspector" testId={`approve-${m.id}`}>
      <DocumentInput label="Inspection report (PDF)" purpose="public" onChange={setDoc} testId={`inspection-doc-${m.id}`} />
      <SubmitRow label="Approve milestone" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("approveMilestone", [BigInt(s.projectId), BigInt(m.id), doc!])} />
    </ActionCard>
  );
}

function AttestPayment({ s, m }: { s: ActionState; m: ActionState["milestones"][number] }) {
  const gate = useWriteGate();
  const tx = useContractTx(`Milestone ${m.id}: mock PFMS attestation`);
  const [doc, setDoc] = useState<Hex | null>(null);
  const blocked =
    gate.reason ??
    gate.needRole("PAO_ROLE", "attest mock PFMS payments") ??
    (same(gate.account, s.award!.vendor) ? "The awarded vendor cannot attest its own payment." : null) ??
    (same(gate.account, m.inspector) ? "The inspector who approved this milestone cannot also attest its payment." : null) ??
    (!doc ? "Add the mock PFMS payment advice PDF." : null);
  return (
    <ActionCard title={`Milestone ${m.id}: record mock PFMS payment attestation`} actor="PAO" testId={`attest-${m.id}`}>
      <p className="text-xs text-amber-900">
        Mock PFMS payment attestation only. This records that a synthetic payment advice exists; no INR, HBAR or token moves.
      </p>
      <p className="text-sm">
        Amount (fixed to the approved milestone): <span className="font-semibold tabular-nums">{formatPaise(BigInt(m.amountPaise))}</span>
      </p>
      <DocumentInput label="Mock PFMS payment advice (PDF)" purpose="public" onChange={setDoc} testId={`payment-doc-${m.id}`} />
      <SubmitRow label="Record mock PFMS attestation" blocked={blocked} busy={tx.busy} state={tx.state} onSubmit={() => void tx.run("attestMockPayment", [BigInt(s.projectId), BigInt(m.id), BigInt(m.amountPaise), doc!])} />
    </ActionCard>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

export function ProjectActions({ state }: { state: ActionState }) {
  const now = useChainTime(BigInt(state.chainTime));
  const connection = useConnection();
  const t = state.tender;
  const panels = useMemo(() => {
    const out: React.ReactNode[] = [];
    if (!t) return [<PublishTender key="publish" s={state} now={now} />];
    if (now < BigInt(t.bidDeadline)) out.push(<CommitBid key="commit" s={state} now={now} />);
    else if (now < BigInt(t.revealDeadline)) out.push(<RevealBid key="reveal" s={state} now={now} />);
    else if (!state.award) out.push(<AwardContract key="award" s={state} />);
    if (state.award) {
      if (BigInt(state.award.milestoneTotalPaise) < BigInt(state.award.amountPaise)) out.push(<DefineMilestone key={`define-${state.award.milestoneCount}`} s={state} />);
      for (const m of state.milestones) {
        if (m.status === "Defined") out.push(<SubmitEvidence key={`e${m.id}`} s={state} m={m} />);
        if (m.status === "EvidenceSubmitted") out.push(<ApproveMilestone key={`a${m.id}`} s={state} m={m} />);
        if (m.status === "Approved") out.push(<AttestPayment key={`p${m.id}`} s={state} m={m} />);
      }
    }
    return out;
  }, [state, now, t]);

  return (
    <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <h2 className="text-base font-semibold">Authorised actions</h2>
      <p className="mb-3 text-xs text-neutral-600">
        For department, vendor, inspector and PAO accounts. Each action is a transaction on {appChain.name}; the records above update only after it
        is confirmed. Citizens do not need a wallet.
      </p>
      <TxActivityProvider>
        {panels.length === 0 ? (
          <p className="text-sm text-neutral-600">No further actions: all milestones are complete.</p>
        ) : (
          // Remount every form when the account changes: one account's inputs (e.g. a confidential quotation)
          // and confirmed-action locks must never carry over to another account.
          <div key={connection.address ?? "disconnected"} className="space-y-3">
            {panels}
          </div>
        )}
      </TxActivityProvider>
    </section>
  );
}
