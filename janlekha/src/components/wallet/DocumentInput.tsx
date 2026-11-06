"use client";

import { useId, useState } from "react";
import type { Hex } from "viem";
import { formatBytes } from "@/lib/janlekha/format";
import { ACCEPTED_DOCUMENT_TYPE, MAX_DOCUMENT_BYTES, sha256OfBytes, startsWithPdfMagic } from "@/lib/documents/limits";

type Purpose = "public" | "confidential";

type DocState =
  | { status: "empty" }
  | { status: "working"; name: string; step: string }
  | { status: "error"; message: string }
  | { status: "ready"; name: string; size: number; hash: Hex; url?: string; existing?: boolean };

/**
 * Selects a PDF, hashes it in the browser and, for public documents, stores a copy in
 * content-addressed off-chain storage. The hash only becomes official when an authorised
 * role references it in a confirmed contract transaction.
 */
export function DocumentInput({
  label,
  purpose,
  onChange,
  testId,
}: {
  label: string;
  purpose: Purpose;
  onChange: (hash: Hex | null) => void;
  testId: string;
}) {
  const id = useId();
  const [attested, setAttested] = useState(false);
  const [state, setState] = useState<DocState>({ status: "empty" });
  const canPick = purpose === "confidential" || attested;

  async function handle(file: File | undefined) {
    onChange(null);
    if (!file) return setState({ status: "empty" });
    if (file.type !== ACCEPTED_DOCUMENT_TYPE && !file.name.toLowerCase().endsWith(".pdf")) {
      return setState({ status: "error", message: "Only PDF documents are accepted." });
    }
    if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) {
      return setState({ status: "error", message: `The PDF must be between 1 byte and ${formatBytes(MAX_DOCUMENT_BYTES)}.` });
    }
    setState({ status: "working", name: file.name, step: "Computing SHA-256 in your browser…" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!startsWithPdfMagic(bytes)) return setState({ status: "error", message: "This file is not a valid PDF." });
    const hash = await sha256OfBytes(bytes);

    if (purpose === "confidential") {
      setState({ status: "ready", name: file.name, size: file.size, hash });
      return onChange(hash);
    }

    setState({ status: "working", name: file.name, step: "Storing a public, content-addressed copy…" });
    const body = new FormData();
    body.set("file", file);
    body.set("sha256", hash);
    body.set("synthetic", "true");
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      const data = (await res.json()) as { sha256?: string; url?: string; existing?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`);
      if (data.sha256 !== hash) throw new Error("The server stored a different hash than your browser computed.");
      setState({ status: "ready", name: file.name, size: file.size, hash, url: data.url, existing: data.existing });
      onChange(hash);
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3" data-testid={testId}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      {purpose === "public" ? (
        <label className="mt-2 flex items-start gap-2 text-xs text-neutral-700">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
          <span>
            This is a synthetic or public demo document. It contains no personal data (no Aadhaar, PAN, bank details or
            identity documents) and no confidential procurement records.
          </span>
        </label>
      ) : (
        <p className="mt-1 text-xs text-neutral-600">
          Confidential until the reveal: hashed in your browser only and never uploaded. Keep the original file.
        </p>
      )}
      <input
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        disabled={!canPick}
        onChange={(e) => void handle(e.target.files?.[0])}
        className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-neutral-500">PDF only, up to {formatBytes(MAX_DOCUMENT_BYTES)}.</p>
      {state.status === "working" && <p className="mt-2 text-xs text-neutral-600">{state.step}</p>}
      {state.status === "error" && <p role="alert" className="mt-2 text-xs text-red-700">{state.message}</p>}
      {state.status === "ready" && (
        <div className="mt-2 text-xs text-neutral-700">
          <p>
            {state.name} ({formatBytes(state.size)}) · SHA-256 <code data-testid={`${testId}-hash`} className="break-all font-mono">{state.hash}</code>
          </p>
          {state.url && (
            <p className="mt-1 text-neutral-500">
              {state.existing ? "Already stored" : "Stored"} off-chain at{" "}
              <a href={state.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                a content-addressed copy
              </a>
              . Not official until an authorised role references this hash in a confirmed transaction.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
