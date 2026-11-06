"use client";

import { useRef, useState } from "react";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import {
  requestWorldIdContext,
  reuseWorldIdAttestation,
  verifyWorldIdProof,
  type Attestation,
  type WorldIdRequestContext,
  type WorldIdRole
} from "@/lib/api";
import { WORLD_ACTION_REVIEWER, WORLD_ACTION_WORKER } from "@/config/contracts";

interface WorldIdButtonProps {
  role: WorldIdRole;
  bountyId: string;
  wallet: string | undefined;
  disabled?: boolean;
  label: string;
  busyLabel?: string;
  onAttestation: (attestation: Attestation) => void | Promise<void>;
  onError: (message: string) => void;
}

/**
 * World ID 4.0 gate. A wallet that already verified for this role gets a fresh
 * attestation straight from the backend; otherwise IDKit asks World App for a proof
 * bound to the wallet (signal) and the backend verifies it.
 */
export default function WorldIdButton({
  role, bountyId, wallet, disabled, label, busyLabel, onAttestation, onError
}: WorldIdButtonProps) {
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<WorldIdRequestContext | null>(null);
  const [open, setOpen] = useState(false);
  const attestationRef = useRef<Attestation | null>(null);
  const action = role === "worker" ? WORLD_ACTION_WORKER : WORLD_ACTION_REVIEWER;

  const start = async () => {
    if (!wallet) return onError("Connect a wallet first.");
    setBusy(true);
    try {
      const existing = await reuseWorldIdAttestation({ wallet, role, bountyId });
      if (existing) {
        await onAttestation(existing);
        return;
      }
      attestationRef.current = null;
      setRequest(await requestWorldIdContext(action));
      setOpen(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || busy || !wallet}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:bg-gray-300"
      >
        {busy ? busyLabel ?? "Checking World ID…" : label}
      </button>
      {request && wallet && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={request.app_id}
          action={action}
          rp_context={request.rp_context}
          environment={request.environment}
          allow_legacy_proofs={true}
          preset={proofOfHuman({ signal: wallet.toLowerCase() })}
          handleVerify={async (result: IDKitResult) => {
            attestationRef.current = await verifyWorldIdProof({ wallet, role, bountyId, idkitResponse: result });
          }}
          onSuccess={async () => {
            if (attestationRef.current) await onAttestation(attestationRef.current);
          }}
          onError={(code) => onError(`World ID error: ${code}`)}
        />
      )}
    </>
  );
}
