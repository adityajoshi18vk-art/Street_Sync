"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, FileSearch } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, EmptyState, PageHeader } from "@/components/janlekha/ui";
import { formatDate, shortHash } from "@/lib/janlekha/format";

function DocumentsInner() {
  const { documents, projects } = useApp();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [copiedId, setCopiedId] = useState("");

  const types = useMemo(() => Array.from(new Set(documents.map((d) => d.type))), [documents]);

  const filtered = documents.filter((d) => {
    if (typeFilter !== "All" && d.type !== typeFilter) return false;
    if (projectFilter !== "All" && d.projectId !== projectFilter) return false;
    if (search && !(d.title + " " + d.project + " " + d.uploadedBy + " " + d.hash).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function copyHash(id: string, hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 2000);
    } catch {
      setCopiedId("");
    }
  }

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Document Registry"
          subtitle="Every registered document is listed with its SHA-256 hash, so anyone can check a copy against the registry. All entries are demo data."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, project, uploader, or hash" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
            <option>All</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Project</span>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
            <option value="All">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-4 text-sm text-slate-600">{filtered.length} of {documents.length} documents shown. Hashes are SHA-256. A matching hash proves the file bytes match the registered copy, and nothing more.</p>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No documents match" body="Try clearing the search or a filter." link="/janlekha/documents" linkLabel="Show all documents" />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {filtered.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="cyan">{d.type}</Badge>
                    {d.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not yet verified</Badge>}
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-slate-900">{d.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    <Link href={"/janlekha/projects/" + d.projectId} className="font-medium text-cyan-700 hover:underline">{d.project}</Link>
                    {" . Uploaded by " + d.uploadedBy + " . " + formatDate(d.date)}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-slate-700" title={d.hash}>
                    SHA-256: {d.hash}
                  </p>
                  <p className="text-xs text-slate-500">Short form: {shortHash(d.hash)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => void copyHash(d.id, d.hash)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {copiedId === d.id ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    {copiedId === d.id ? "Copied" : "Copy hash"}
                  </button>
                  <Link href={"/janlekha/verify?hash=" + d.hash} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
                    <FileSearch className="h-4 w-4" aria-hidden /> Verify
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <JanLekhaProvider>
      <DocumentsInner />
    </JanLekhaProvider>
  );
}
