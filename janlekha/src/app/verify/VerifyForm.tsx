"use client";

import { useState } from "react";

export interface VerifyOption {
  key: string;
  label: string;
  hash: string;
  recordedAt: string;
  offChainFile?: string;
}

type Outcome =
  | { state: "idle" }
  | { state: "hashing"; fileName: string }
  | { state: "error"; message: string }
  | { state: "done"; fileName: string; size: number; fileHash: string; expected: VerifyOption; alsoMatches?: VerifyOption };

async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot compute SHA-256 here (Web Crypto needs HTTPS or localhost).");
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function VerifyForm({ options, initialKey }: { options: VerifyOption[]; initialKey?: string }) {
  const [selectedKey, setSelectedKey] = useState(
    options.some((o) => o.key === initialKey) ? initialKey! : options[0]?.key,
  );
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const expected = options.find((o) => o.key === selectedKey) ?? options[0];

  async function onFile(file: File | undefined) {
    if (!file || !expected) return;
    if (!isPdf(file)) {
      setOutcome({ state: "error", message: `"${file.name}" is not a PDF. Select the PDF document to verify.` });
      return;
    }
    setOutcome({ state: "hashing", fileName: file.name });
    try {
      const fileHash = await sha256Hex(file);
      const alsoMatches =
        fileHash !== expected.hash.toLowerCase() ? options.find((o) => o.hash.toLowerCase() === fileHash) : undefined;
      setOutcome({ state: "done", fileName: file.name, size: file.size, fileHash, expected, alsoMatches });
    } catch (error) {
      setOutcome({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!expected) return null;
  const match = outcome.state === "done" && outcome.fileHash === outcome.expected.hash.toLowerCase();

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <label htmlFor="doc" className="text-sm font-medium text-neutral-800">
          1. Which on-chain document are you checking?
        </label>
        <select
          id="doc"
          value={expected.key}
          onChange={(e) => {
            setSelectedKey(e.target.value);
            setOutcome({ state: "idle" });
          }}
          className="mt-2 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-3 text-xs font-medium text-neutral-500">On-chain SHA-256 (recorded {expected.recordedAt})</p>
        <code data-testid="onchain-hash" className="block break-all font-mono text-xs">{expected.hash}</code>
        {expected.offChainFile && (
          <p className="mt-2 text-xs text-neutral-500">
            Demo copy (off-chain, unverified until you check it):{" "}
            <a href={expected.offChainFile} download className="underline underline-offset-2">
              download
            </a>
          </p>
        )}

        <label htmlFor="file" className="mt-5 block text-sm font-medium text-neutral-800">
          2. Select the PDF on your device
        </label>
        <input
          id="file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <p className="mt-2 text-xs text-neutral-500">
          The file is hashed in your browser and never uploaded.
        </p>
      </div>

      {outcome.state === "hashing" && (
        <p className="text-sm text-neutral-600">Computing SHA-256 of {outcome.fileName}…</p>
      )}
      {outcome.state === "error" && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {outcome.message}
        </div>
      )}
      {outcome.state === "done" && (
        <div
          role="status"
          data-testid="verify-result"
          className={`rounded-xl border-2 p-5 ${match ? "border-emerald-500 bg-emerald-50" : "border-red-500 bg-red-50"}`}
        >
          <p className={`text-2xl font-black tracking-tight ${match ? "text-emerald-800" : "text-red-800"}`}>
            {match ? "MATCH" : "MISMATCH"}
          </p>
          <p className={`mt-1 text-sm ${match ? "text-emerald-900" : "text-red-900"}`}>
            {match
              ? `${outcome.fileName} is byte-for-byte identical to the document whose hash was recorded on-chain as "${outcome.expected.label}".`
              : `${outcome.fileName} differs from the document recorded on-chain as "${outcome.expected.label}". It has been modified or is a different document.`}
          </p>
          <dl className="mt-4 space-y-2 text-xs">
            <div>
              <dt className="font-medium text-neutral-600">On-chain SHA-256 ({outcome.expected.label})</dt>
              <dd><code className="break-all font-mono">{outcome.expected.hash}</code></dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-600">
                SHA-256 of {outcome.fileName} ({outcome.size.toLocaleString("en-IN")} bytes)
              </dt>
              <dd><code data-testid="file-hash" className="break-all font-mono">{outcome.fileHash}</code></dd>
            </div>
          </dl>
          {outcome.alsoMatches && (
            <p className="mt-3 text-xs text-neutral-700">
              Note: this file does match a different on-chain document of this project: “{outcome.alsoMatches.label}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
