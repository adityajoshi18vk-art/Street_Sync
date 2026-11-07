"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquarePlus, ShieldCheck } from "lucide-react";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { Badge, Card, EmptyState, PageHeader, statusTone } from "@/components/janlekha/ui";
import { formatDate } from "@/lib/janlekha/format";

const CATEGORIES = ["Work quality", "Delay", "Safety", "Corruption concern", "Access and facilities", "Other"];

function ComplaintsInner() {
  const { complaints, projects, addComplaint } = useApp();
  const [citizen, setCitizen] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState("");
  const [formMsg, setFormMsg] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      complaints.filter((c) => {
        if (statusFilter !== "All" && c.status !== statusFilter) return false;
        if (search && !(c.project + " " + c.subject + " " + c.detail + " " + c.status).toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [complaints, search, statusFilter],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const project = projects.find((p) => p.id === projectId);
    if (!project) { setFormMsg("Choose a project for the complaint."); return; }
    if (!citizen.trim() || !subject.trim() || !detail.trim()) {
      setFormMsg("Fill in your name, a subject, and the detail of the complaint.");
      return;
    }
    addComplaint({ projectId: project.id, project: project.name, citizen: citizen.trim(), subject: subject.trim(), detail: "Category: " + category + ". " + detail.trim() });
    setFormMsg("Complaint submitted. It appears at the top of the list below with status Submitted, and its updates timeline starts with the receipt note.");
    setCitizen("");
    setSubject("");
    setDetail("");
  }

  return (
    <div className="rounded-3xl bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <Link href="/janlekha" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the JanLekha portal
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Citizen Complaints"
          subtitle="Raise a complaint about a project, and track its status and updates. Complaints shown here are demo data. Do not include sensitive personal information such as bank details or identity numbers."
        />
      </div>

      <Card className="mb-6 border-cyan-200 bg-cyan-50 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShieldCheck className="h-5 w-5 text-cyan-700" aria-hidden /> Sybil resistance and identity
        </h2>
        <p className="mt-1 text-sm text-slate-700">
          World ID sybil resistance for complaints is handled by the StreetSync World ID integration, not by this page.
          This demo does not collect identity: the name you enter is a display name only, and no identity document,
          phone number, or wallet address is asked for or stored here.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="p-5 sm:p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <MessageSquarePlus className="h-5 w-5 text-cyan-600" aria-hidden /> Submit a complaint
          </h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Your name</span>
              <input value={citizen} onChange={(e) => setCitizen(e.target.value)} placeholder="For example: R. Sharma" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Project</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of the problem" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Detail</span>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} placeholder="What happened, where, and since when?" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <button type="submit" className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
              Submit complaint
            </button>
            {formMsg ? <p className="text-sm text-emerald-700">{formMsg}</p> : null}
          </form>
          <p className="mt-4 text-xs text-slate-500">
            A new complaint starts as Submitted. Status changes and updates are recorded in its timeline below.
          </p>
        </Card>

        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, subject, or status" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                <option>All</option><option>Submitted</option><option>Under Review</option><option>Resolved</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-sm text-slate-600">{filtered.length} of {complaints.length} complaints shown.</p>

          {filtered.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No complaints match" body="Try clearing the search or the status filter." link="/janlekha/complaints" linkLabel="Show all complaints" />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {filtered.map((c) => (
                <Card key={c.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">DEMO DATA</span>
                      </div>
                      <h2 className="mt-2 text-lg font-semibold text-slate-900">{c.subject}</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        <Link href={"/janlekha/projects/" + c.projectId} className="font-medium text-cyan-700 hover:underline">{c.project}</Link>
                        {" . By " + c.citizen + " . " + formatDate(c.date)}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{c.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {expandedId === c.id ? "Hide updates" : "View updates (" + c.updates.length + ")"}
                    </button>
                  </div>
                  {expandedId === c.id ? (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Updates timeline</p>
                      <ol className="mt-2 space-y-2">
                        {c.updates.map((u, i) => (
                          <li key={i} className="flex gap-3 text-sm text-slate-700">
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                            <span>{u}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-3 text-xs text-slate-500">Status tracking: {c.status}. New updates appear here when the complaint is reviewed.</p>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ComplaintsPage() {
  return (
    <JanLekhaProvider>
      <ComplaintsInner />
    </JanLekhaProvider>
  );
}
