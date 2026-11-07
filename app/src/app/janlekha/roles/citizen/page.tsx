"use client";
// Citizen / Taxpayer workspace. Ported from
// ~/workspace/janlekha/src/pages/roles/CitizenDashboard.tsx.
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { formatINR, formatDate, shortHash } from "@/lib/janlekha/format";
import { statusTone } from "@/components/janlekha/ui";
import {
  AccessDenied, ActivityTimeline, DarkBadge, DarkCard, DarkCardTitle, DarkStat, DataTable, DemoStrip, Field,
  GhostButton, NotificationsPanel, PrimaryButton, SelectInput, SuccessNote, Td, TextAreaInput, TextInput, WorkspaceLayout,
} from "@/components/janlekha/RoleShared";

const FOLLOW_KEY = "janlekha-followed-v1";
const SEARCH_KEY = "janlekha-saved-searches-v1";

function loadList(key: string): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function CitizenRolePage() {
  return (
    <JanLekhaProvider>
      <CitizenInner />
    </JanLekhaProvider>
  );
}

function CitizenInner() {
  const { role, projects, departments, documents, complaints, events, notifications, addComplaint } = useApp();

  const [followed, setFollowed] = useState<string[]>(() => loadList(FOLLOW_KEY));
  const [savedSearches, setSavedSearches] = useState<string[]>(() => loadList(SEARCH_KEY));
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  const [cmpProject, setCmpProject] = useState(projects[0]?.id ?? "");
  const [cmpName, setCmpName] = useState("");
  const [cmpSubject, setCmpSubject] = useState("");
  const [cmpDetail, setCmpDetail] = useState("");
  const [cmpMsg, setCmpMsg] = useState<string | null>(null);

  const [hashInput, setHashInput] = useState("");
  const [hashResult, setHashResult] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(FOLLOW_KEY, JSON.stringify(followed));
    } catch {
      /* storage unavailable */
    }
  }, [followed]);

  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_KEY, JSON.stringify(savedSearches));
    } catch {
      /* storage unavailable */
    }
  }, [savedSearches]);

  if (role !== "CITIZEN") {
    return (
      <WorkspaceLayout title="Citizen / Taxpayer" subtitle="Citizen workspace">
        <AccessDenied required="CITIZEN" />
      </WorkspaceLayout>
    );
  }

  const followedProjects = projects.filter((p) => followed.includes(p.id));
  const followedBudget = followedProjects.reduce((s, p) => s + p.budgetInr, 0);
  const q = activeSearch.trim().toLowerCase();
  const visibleProjects = q
    ? projects.filter((p) => (p.name + " " + p.location + " " + p.department + " " + p.state).toLowerCase().includes(q))
    : projects;
  const resolvedComplaints = complaints.filter((c) => c.status === "Resolved").length;

  const toggleFollow = (id: string) => setFollowed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const saveSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term) {
      setSearchMsg("Type a search term first.");
      return;
    }
    if (!savedSearches.includes(term)) setSavedSearches((prev) => [term, ...prev]);
    setActiveSearch(term);
    setSearchMsg("Search saved and applied: " + term);
  };

  const submitComplaint = (e: FormEvent) => {
    e.preventDefault();
    const project = projects.find((p) => p.id === cmpProject);
    if (!project || !cmpName.trim() || !cmpSubject.trim() || !cmpDetail.trim()) {
      setCmpMsg("Pick a project and fill in your name, subject, and detail.");
      return;
    }
    addComplaint({ projectId: project.id, project: project.name, citizen: cmpName.trim(), subject: cmpSubject.trim(), detail: cmpDetail.trim() });
    setCmpMsg("Complaint submitted for " + project.name + ". It is now listed as Submitted. Demo data only.");
    setCmpName("");
    setCmpSubject("");
    setCmpDetail("");
  };

  const checkHash = (e: FormEvent) => {
    e.preventDefault();
    const h = hashInput.trim().toLowerCase();
    if (!h) {
      setHashResult("Paste a document hash first.");
      return;
    }
    const doc = documents.find((d) => d.hash.toLowerCase() === h || d.hash.toLowerCase().startsWith(h));
    if (!doc) {
      setHashResult("No document in this demo matches that hash. Check the hash and try again, or open the full verification page.");
      return;
    }
    setHashResult(
      "Match found: " + doc.title + " (" + doc.type + ", " + doc.project + "). Registered " + formatDate(doc.date) +
        ", uploaded by " + doc.uploadedBy + ". Status: " + (doc.verified ? "Verified" : "Not verified") + ".",
    );
  };

  return (
    <WorkspaceLayout title="Citizen / Taxpayer" subtitle="Your dark workspace view of the public record. Read only. All figures are demo data.">
      <div className="space-y-6">
        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-5">
          <h2 className="text-base font-semibold text-cyan-300">Read only workspace</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">
            As a citizen you can follow projects, save searches, check documents, and file complaints. You cannot edit budgets, projects, tenders,
            milestones, or payments. Anything you change here, a followed project or a saved search, is stored only in this browser. All figures are
            demo data, not actual government expenditure.
          </p>
        </div>
        <DemoStrip text="All figures on this page are realistic synthetic demonstration data. This is not actual government expenditure." />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DarkStat label="Projects on record (demo)" value={String(projects.length)} sub={departments.length + " departments"} />
          <DarkStat label="Followed projects" value={String(followedProjects.length)} sub={formatINR(followedBudget) + " followed budget (demo)"} tone="green" />
          <DarkStat label="Saved searches" value={String(savedSearches.length)} sub={activeSearch ? "Active: " + activeSearch : "No search active"} />
          <DarkStat label="Complaints on record (demo)" value={String(complaints.length)} sub={resolvedComplaints + " resolved"} tone={resolvedComplaints > 0 ? "green" : "amber"} />
        </div>

        <DarkCard>
          <DarkCardTitle title="Verify a document" sub="Shortcut to document verification. Paste a SHA-256 hash from a document record and check it against the demo register." />
          <form onSubmit={checkHash} className="flex flex-wrap gap-3">
            <div className="min-w-0 flex-1">
              <TextInput value={hashInput} onChange={setHashInput} placeholder="Paste a SHA-256 hash, e.g. a1b2c3d4..." />
            </div>
            <PrimaryButton type="submit">Check hash</PrimaryButton>
            <Link href="/janlekha/verify" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open full verification page</Link>
          </form>
          {hashResult ? <p className="mt-3 text-sm leading-relaxed text-slate-200">{hashResult}</p> : null}
          <p className="mt-3 text-xs text-slate-500">
            Example hash from the demo register: {shortHash(documents[0]?.hash ?? "")} (first document, {documents[0]?.title ?? "none"}).
          </p>
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Saved searches" sub="Save a search, then apply it to the project list below. Saved in this browser only." />
          <form onSubmit={saveSearch} className="flex flex-wrap gap-3">
            <div className="min-w-0 flex-1">
              <TextInput value={searchTerm} onChange={setSearchTerm} placeholder="e.g. hospital, solar, Mysuru" />
            </div>
            <PrimaryButton type="submit">Save and apply search</PrimaryButton>
            {activeSearch ? <GhostButton onClick={() => { setActiveSearch(""); setSearchMsg(null); }}>Clear search</GhostButton> : null}
          </form>
          <SuccessNote message={searchMsg} />
          {savedSearches.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {savedSearches.map((s) => (
                <span key={s} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {s}
                  <button type="button" onClick={() => { setActiveSearch(s); setSearchTerm(s); }} className="font-semibold text-cyan-300 hover:underline">Apply</button>
                  <button
                    type="button"
                    onClick={() => {
                      setSavedSearches((prev) => prev.filter((x) => x !== s));
                      if (activeSearch === s) setActiveSearch("");
                    }}
                    className="text-slate-400 hover:text-white"
                    aria-label={"Remove saved search " + s}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No saved searches yet.</p>
          )}
        </DarkCard>

        <DarkCard>
          <DarkCardTitle
            title={activeSearch ? "Projects matching " + activeSearch : "Projects"}
            sub="Follow a project to keep it in your followed list. All figures are demo data."
          />
          <DataTable headers={["Project", "Department", "Budget", "Spent", "Progress", "Status", "Follow"]}>
            {visibleProjects.map((p) => (
              <tr key={p.id}>
                <Td>
                  <Link href={"/janlekha/projects/" + p.id} className="font-semibold text-cyan-300 hover:underline">{p.name}</Link>
                  <span className="block text-xs text-slate-500">{p.location}</span>
                </Td>
                <Td>{p.department}</Td>
                <Td>{formatINR(p.budgetInr)}</Td>
                <Td>{formatINR(p.spentInr)}</Td>
                <Td>{p.progress}%</Td>
                <Td><DarkBadge tone={statusTone(p.status)}>{p.status}</DarkBadge></Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => toggleFollow(p.id)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
                  >
                    {followed.includes(p.id) ? "Unfollow" : "Follow"}
                  </button>
                </Td>
              </tr>
            ))}
          </DataTable>
          {visibleProjects.length === 0 ? <p className="mt-3 text-sm text-slate-400">No projects match that search.</p> : null}
        </DarkCard>

        {followedProjects.length > 0 ? (
          <DarkCard>
            <DarkCardTitle title="Followed projects" sub="Your followed list, stored in this browser." />
            <DataTable headers={["Project", "Budget", "Spent", "Progress", "Status"]}>
              {followedProjects.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={"/janlekha/projects/" + p.id} className="font-semibold text-cyan-300 hover:underline">{p.name}</Link>
                    <span className="block text-xs text-slate-500">{p.location}</span>
                  </Td>
                  <Td>{formatINR(p.budgetInr)}</Td>
                  <Td>{formatINR(p.spentInr)}</Td>
                  <Td>{p.progress}%</Td>
                  <Td><DarkBadge tone={statusTone(p.status)}>{p.status}</DarkBadge></Td>
                </tr>
              ))}
            </DataTable>
          </DarkCard>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="File a complaint" sub="Complaints are recorded as Submitted, with the date set by the system. Demo data only." />
            <form onSubmit={submitComplaint} className="space-y-3">
              <Field label="Project">
                <SelectInput value={cmpProject} onChange={setCmpProject} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
              <Field label="Your name"><TextInput value={cmpName} onChange={setCmpName} placeholder="e.g. R. Sharma" required /></Field>
              <Field label="Subject"><TextInput value={cmpSubject} onChange={setCmpSubject} placeholder="e.g. Drainage work blocked our street" required /></Field>
              <Field label="Detail"><TextAreaInput value={cmpDetail} onChange={setCmpDetail} placeholder="What happened, where, and since when." required /></Field>
              <PrimaryButton type="submit">Submit complaint</PrimaryButton>
              <SuccessNote message={cmpMsg} />
            </form>
          </DarkCard>

          <DarkCard>
            <DarkCardTitle title="Complaint status" sub="Complaints on record in this demo, with their latest status." />
            {complaints.length === 0 ? (
              <p className="text-sm text-slate-400">No complaints on record.</p>
            ) : (
              <ul className="space-y-3">
                {complaints.map((c) => (
                  <li key={c.id} className="rounded-xl border border-white/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{c.subject}</p>
                      <DarkBadge tone={statusTone(c.status)}>{c.status}</DarkBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{c.project} | {c.citizen} | {formatDate(c.date)}</p>
                    <p className="mt-1 text-sm text-slate-300">{c.detail}</p>
                    {c.updates.length > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">Latest update: {c.updates[c.updates.length - 1]}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/janlekha/complaints" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open public complaints page</Link>
            </div>
          </DarkCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Notifications" sub="For the Citizen role." />
            <NotificationsPanel role="CITIZEN" items={notifications} />
          </DarkCard>
          <DarkCard>
            <DarkCardTitle title="Public activity" sub="Latest public events, newest first." />
            <ActivityTimeline events={events} limit={8} />
          </DarkCard>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
