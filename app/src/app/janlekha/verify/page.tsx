"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Copy, ExternalLink, FileSearch, ShieldCheck, Upload } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import type { DocRecord } from "@/lib/janlekha/data";
import { Badge, Card, DemoNotice, PageHeader } from "@/components/janlekha/ui";
import { formatDate, sha256Hex, shortHash } from "@/lib/janlekha/format";
import { ARC_TESTNET } from "@/lib/janlekha/arc";

type Verdict = "idle" | "computing" | "match" | "no-match" | "error";

function normaliseHash(raw: string): string {
  return raw.trim().toLowerCase().replace(/^0x/, "");
}

function VerifyInner() {
  const { documents } = useApp();
  const params = useSearchParams();
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [computedHash, setComputedHash] = useState("");
  const [pastedHash, setPastedHash] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("idle");
  const [matched, setMatched] = useState<DocRecord | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function checkHash(hash: string) {
    const clean = normaliseHash(hash);
    if (!clean) { setVerdict("error"); setMessage("Enter a hash, or upload a file to compute one."); setMatched(null); return; }
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      setVerdict("error");
      setMatched(null);
      setMessage("That does not look like a SHA-256 hash. A SHA-256 hash is 64 hexadecimal characters.");
      return;
    }
    const found = documents.find((d) => d.hash.toLowerCase() === clean) ?? null;
    setComputedHash(clean);
    setMatched(found);
    if (found) {
      setVerdict("match");
      setMessage("MATCH. A document with this exact hash is registered.");
    } else {
      setVerdict("no-match");
      setMessage("NO MATCH. No document in the registry has this hash.");
    }
  }

  useEffect(() => {
    const preset = params.get("hash");
    if (preset) {
      setPastedHash(preset);
      checkHash(preset);
    }
    // Run once on load for a shared link. documents is live state, the preset is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setFileSize(file.size);
    setVerdict("computing");
    setMessage("Computing the SHA-256 hash in your browser. The file is not uploaded to any server.");
    setMatched(null);
    try {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      setComputedHash(hash);
      const found = documents.find((d) => d.hash.toLowerCase() === hash) ?? null;
      setMatched(found);
      if (found) {
        setVerdict("match");
        setMessage("MATCH. A document with this exact hash is registered.");
      } else {
        setVerdict("no-match");
        setMessage("NO MATCH. No document in the registry has this hash, so this file is not registered or it differs from the registered file.");
      }
    } catch {
      setVerdict("error");
      setMessage("The hash could not be computed in this browser. This page needs a secure context with WebCrypto support. Try a modern browser over HTTPS or localhost.");
    }
  }

  async function copyHash() {
    if (!computedHash) return;
    try {
      await navigator.clipboard.writeText(computedHash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setMessage("Copy failed. Select the hash text and copy it manually.");
    }
  }

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Verify a Document"
          subtitle="Check whether a file matches a document registered in JanLekha. The hash is computed in your browser, and the file never leaves your device."
          actions={<Link href="/janlekha/documents" className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"><FileSearch className="h-4 w-4" aria-hidden /> Browse the registry</Link>}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Upload className="h-5 w-5 text-cyan-600" aria-hidden /> Upload a file to verify
          </h2>
          <p className="mt-1 text-sm text-slate-600">Any file type works. We compute its SHA-256 hash and compare it with the registered hashes.</p>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-900">Choose a file</span>
            <input
              type="file"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          {fileName ? <p className="mt-2 text-sm text-slate-600">File: <strong className="text-slate-900">{fileName}</strong> ({fileSize.toLocaleString("en-IN")} bytes)</p> : null}

          <div className="my-5 border-t border-slate-100 pt-5">
            <h2 className="text-lg font-semibold text-slate-900">Or paste a hash to check</h2>
            <form
              onSubmit={(e) => { e.preventDefault(); checkHash(pastedHash); }}
              className="mt-3 flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={pastedHash}
                onChange={(e) => setPastedHash(e.target.value)}
                placeholder="Paste a 64 character SHA-256 hash"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
              />
              <button type="submit" className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Check hash</button>
            </form>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Registered documents: {documents.length} (demo data)</p>
            <p className="mt-1">Try a hash from the <Link href="/janlekha/documents" className="font-medium text-cyan-700 hover:underline">document registry</Link>, for example the hospital contract hash starting a1b2c3d4.</p>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <ShieldCheck className="h-5 w-5 text-cyan-600" aria-hidden /> Result
            </h2>
            {verdict === "idle" ? (
              <p className="mt-2 text-sm text-slate-600">Upload a file or paste a hash. Nothing has been checked yet.</p>
            ) : null}
            {verdict === "computing" ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
            {verdict === "error" ? (
              <div className="mt-3 rounded-xl bg-red-50 p-4"><p className="text-sm font-semibold text-red-800">Could not check</p><p className="mt-1 text-sm text-red-700">{message}</p></div>
            ) : null}
            {verdict === "match" && matched ? (
              <div className="mt-3 rounded-xl bg-emerald-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="green">MATCH</Badge>
                  {matched.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not yet verified</Badge>}
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">DEMO DATA</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-emerald-900">{message}</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Document</dt><dd className="text-right font-medium text-slate-900">{matched.title}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Project</dt><dd className="text-right"><Link href={"/janlekha/projects/" + matched.projectId} className="font-medium text-cyan-700 hover:underline">{matched.project}</Link></dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Type</dt><dd className="text-right text-slate-900">{matched.type}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Uploaded by</dt><dd className="text-right text-slate-900">{matched.uploadedBy}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Date</dt><dd className="text-right text-slate-900">{formatDate(matched.date)}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-slate-600">
                  Arc explorer reference: <a href={ARC_TESTNET.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-cyan-700 hover:underline">Arc Testnet explorer <ExternalLink className="h-3 w-3" aria-hidden /></a>.
                  This demo reference is a registry reference, not a real transaction hash. No real transaction hash is shown here.
                </p>
              </div>
            ) : null}
            {verdict === "no-match" ? (
              <div className="mt-3 rounded-xl bg-amber-50 p-4">
                <Badge tone="amber">NO MATCH</Badge>
                <p className="mt-2 text-sm font-semibold text-amber-900">{message}</p>
                <p className="mt-1 text-sm text-amber-800">
                  A different file, even one changed by a single character, produces a completely different hash. Check that you uploaded the exact registered file, or that the hash was copied in full.
                </p>
              </div>
            ) : null}
            {computedHash ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">SHA-256 hash</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-800">{computedHash}</p>
                <p className="mt-1 text-xs text-slate-500">Short form: {shortHash(computedHash)}</p>
                <button type="button" onClick={() => void copyHash()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? "Copied" : "Copy hash"}
                </button>
              </div>
            ) : null}
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">What verification does and does not prove</h2>
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              <p><strong className="text-slate-900">It proves:</strong> the file you checked has exactly the same bytes as the file that was registered under this hash, at the date shown in the registry.</p>
              <p><strong className="text-slate-900">It does not prove:</strong> that the contents of the document are true, that the uploader named in the registry is who they claim to be, or that the document is genuine outside this registry. A match proves a hash comparison only, nothing more.</p>
              <p><strong className="text-slate-900">It does not prove:</strong> that an unmatched file is fake. It only shows the file is not registered here, or that it differs from the registered copy.</p>
            </div>
            <DemoNotice />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <JanLekhaProvider>
      <Suspense fallback={<div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-600">Loading the verifier...</div>}>
        <VerifyInner />
      </Suspense>
    </JanLekhaProvider>
  );
}
