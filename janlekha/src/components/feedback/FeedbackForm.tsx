"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { proofOfHuman } from "@worldcoin/idkit";
import { FEEDBACK_MAX_CHARS, UNIQUE_HUMAN_LABEL, feedbackLengthError, feedbackSignal } from "@/lib/feedback/signal";

// Loaded only when a citizen starts verification; public pages never need it.
const IDKitRequestWidget = dynamic(() => import("@worldcoin/idkit").then((m) => m.IDKitRequestWidget), { ssr: false });

interface PreparedRequest {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
  rp_context: RpContext;
  signal: string;
}

const IDKIT_ERRORS: Record<string, string> = {
  user_rejected: "You cancelled the verification in World App.",
  verification_rejected: "World App declined the verification.",
  credential_unavailable: "Your World ID does not have the required proof-of-human credential.",
  max_verifications_reached: "This World ID has already submitted feedback for this project.",
  nullifier_replayed: "This World ID has already submitted feedback for this project.",
  rp_signature_expired: "The verification request expired. Please try again.",
  connection_failed: "Could not connect to World App. Please try again.",
};

export function FeedbackForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [request, setRequest] = useState<PreparedRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lengthError = feedbackLengthError(text);

  async function start() {
    setError(null);
    setPreparing(true);
    try {
      const res = await fetch("/api/world-id/rp-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as Omit<PreparedRequest, "signal"> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not start verification (HTTP ${res.status}).`);
      // The proof is bound to this exact text; editing it later requires a new proof.
      setRequest({ ...data, signal: await feedbackSignal(projectId, text) });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }

  async function submit(result: IDKitResult) {
    const res = await fetch(`/api/projects/${projectId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, idkitResult: result }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const message = data.error ?? `Feedback could not be stored (HTTP ${res.status}).`;
      setError(message);
      throw new Error(message); // tells IDKit the host rejected the proof
    }
  }

  if (done) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        Thank you. Your feedback is recorded as <strong>{UNIQUE_HUMAN_LABEL}</strong>. It is public, off-chain, and does not change any
        milestone or payment record.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <label htmlFor="feedback-text" className="text-sm font-medium text-neutral-800">
        Your feedback on this project
      </label>
      <textarea
        id="feedback-text"
        value={text}
        readOnly={!!request}
        maxLength={FEEDBACK_MAX_CHARS + 50}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="What have you observed at the site? Do not include personal data."
        className="mt-2 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm read-only:bg-neutral-50"
      />
      <p className="mt-1 text-xs text-neutral-500">
        {[...text.trim()].length}/{FEEDBACK_MAX_CHARS} characters. Feedback is published as written; do not include names, phone numbers
        or identity documents.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!request ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!!lengthError || preparing}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          >
            {preparing ? "Preparing…" : "Verify with World ID and submit"}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
              Continue World ID verification
            </button>
            <button
              type="button"
              onClick={() => {
                setRequest(null);
                setError(null);
              }}
              className="text-sm text-neutral-600 underline underline-offset-2"
            >
              Edit text
            </button>
          </>
        )}
        {lengthError && text.length > 0 && <span className="text-xs text-amber-800">{lengthError}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={request.app_id}
          action={request.action}
          rp_context={request.rp_context}
          environment={request.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: request.signal })}
          handleVerify={submit}
          onSuccess={() => {
            setDone(true);
            router.refresh();
          }}
          onError={(code) => setError((prev) => prev ?? IDKIT_ERRORS[code] ?? `World ID verification did not complete (${code}).`)}
        />
      )}
    </div>
  );
}
