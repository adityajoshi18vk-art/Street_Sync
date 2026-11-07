"use client";
// Project Manager / Contractor workspace. Ported from
// ~/workspace/janlekha/src/pages/roles/ContractorDashboard.tsx.
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { JanLekhaProvider, useApp } from "@/lib/janlekha/context";
import { can } from "@/lib/janlekha/permissions";
import { contractors } from "@/lib/janlekha/data";
import { formatINR, formatUSDC, formatDate, sha256Hex, shortHash } from "@/lib/janlekha/format";
import { statusTone } from "@/components/janlekha/ui";
import {
  AccessDenied, ActivityTimeline, DarkBadge, DarkCard, DarkCardTitle, DarkStat, DataTable, DemoStrip, Field,
  NotificationsPanel, PrimaryButton, SelectInput, SuccessNote, Td, TextInput, WorkspaceLayout,
} from "@/components/janlekha/RoleShared";

const CR = 10000000;

export default function ContractorRolePage() {
  return (
    <JanLekhaProvider>
      <ContractorInner />
    </JanLekhaProvider>
  );
}

function ContractorInner() {
  const { role, projects, tenders, milestones, payments, documents, events, notifications, submitBid, submitMilestone, addDocument } = useApp();

  const [companyId, setCompanyId] = useState(contractors[0]?.id ?? "");
  const [bidTender, setBidTender] = useState("");
  const [bidCr, setBidCr] = useState("");
  const [bidMsg, setBidMsg] = useState<string | null>(null);

  const [msProject, setMsProject] = useState("");
  const [msTitle, setMsTitle] = useState("");
  const [msCr, setMsCr] = useState("");
  const [msDue, setMsDue] = useState("");
  const [msMsg, setMsMsg] = useState<string | null>(null);

  const [uploadProject, setUploadProject] = useState("");
  const [uploadKind, setUploadKind] = useState("Invoice");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [search, setSearch] = useState("");

  const company = contractors.find((c) => c.id === companyId);
  const myProjects = projects.filter((p) => p.contractorId === companyId);
  const myProjectIds = new Set(myProjects.map((p) => p.id));
  const myMilestones = milestones.filter((m) => myProjectIds.has(m.projectId));
  const myPayments = payments.filter((p) => p.payee === company?.name);
  const myDocuments = documents.filter((d) => myProjectIds.has(d.projectId));
  const openTenders = tenders.filter((t) => t.status === "Open");
  const myBids = tenders.flatMap((t) => t.bids.filter((b) => b.contractorId === companyId).map((b) => ({ tender: t, bid: b })));
  const awaitingVerification = myMilestones.filter((m) => m.status === "Submitted").length;
  const paidToMe = myPayments.filter((p) => p.status === "Settled").reduce((s, p) => s + p.amountInr, 0);
  const canBid = can(role, "submit_bid");
  const canSubmitMilestone = can(role, "submit_milestone");
  const canVerify = can(role, "verify_milestone");

  const visibleMilestones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myMilestones;
    return myMilestones.filter((m) => (m.title + " " + m.project + " " + m.status).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMilestones, search]);

  if (role !== "CONTRACTOR") {
    return (
      <WorkspaceLayout title="Project Manager / Contractor" subtitle="Contractor workspace">
        <AccessDenied required="CONTRACTOR" />
      </WorkspaceLayout>
    );
  }

  const submitBidForm = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(bidCr) * CR;
    const tender = tenders.find((t) => t.id === bidTender);
    if (!company || !tender || !(amount > 0)) {
      setBidMsg("Pick an open tender and enter a bid amount above zero.");
      return;
    }
    submitBid(tender.id, company.id, company.name, amount);
    setBidMsg("Bid of " + formatINR(amount) + " submitted by " + company.name + " for " + tender.title + ". Demo data only.");
    setBidCr("");
  };

  const submitMilestoneForm = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(msCr) * CR;
    const project = myProjects.find((p) => p.id === msProject);
    if (!project || !msTitle.trim() || !(amount > 0) || !msDue) {
      setMsMsg("Pick one of your awarded projects, add a title, an amount above zero, and a due date.");
      return;
    }
    submitMilestone(project.id, msTitle.trim(), amount, msDue);
    setMsMsg("Milestone " + msTitle.trim() + " submitted for " + project.name + ". It now awaits independent verification. Demo data only.");
    setMsTitle("");
    setMsCr("");
    setMsDue("");
  };

  const uploadEvidence = async (e: FormEvent) => {
    e.preventDefault();
    const input = document.getElementById("contractor-file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    const project = myProjects.find((p) => p.id === uploadProject);
    if (!project || !file) {
      setUploadMsg("Pick one of your awarded projects and choose a file to upload.");
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      addDocument({
        title: file.name,
        projectId: project.id,
        project: project.name,
        hash,
        type: uploadKind,
        uploadedBy: company?.name ?? "Contractor",
        date: new Date().toISOString().slice(0, 10),
      });
      setUploadMsg("Uploaded " + file.name + " for " + project.name + " as " + uploadKind + ". SHA-256 " + shortHash(hash) + ". The record is unverified until an auditor checks it. Demo data only.");
      if (input) input.value = "";
    } catch {
      setUploadMsg("The file could not be read. Try again with a different file.");
    }
    setUploading(false);
  };

  return (
    <WorkspaceLayout title="Project Manager / Contractor" subtitle="Bids, awarded projects, milestones, and payments. All figures are demo data.">
      <div className="space-y-6">
        <DemoStrip text="All figures on this page are realistic synthetic demonstration data. This is not actual government expenditure." />

        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-5">
          <h2 className="text-base font-semibold text-red-300">You cannot verify your own milestones</h2>
          <p className="mt-2 text-sm leading-relaxed text-red-100/90">
            Verification is reserved for the Independent Auditor. The permission check can(role, verify_milestone) returns{" "}
            {canVerify ? "true" : "false"} for this role, so there is no verify button anywhere on this page. A milestone you submit stays Submitted until
            an auditor verifies it, and only a Verified milestone can be paid.
          </p>
        </div>

        <DarkCard>
          <DarkCardTitle title="Your company" sub="This demo role covers all registered contractors. Pick your company to see its awarded projects, bids, milestones, and payments." />
          <Field label="Company">
            <SelectInput
              value={companyId}
              onChange={setCompanyId}
              options={contractors.map((c) => ({ value: c.id, label: c.name + " | " + c.location + " | Rating " + c.rating }))}
            />
          </Field>
          {company ? (
            <p className="mt-3 text-sm text-slate-400">
              {company.type}. {company.projectsCompleted} projects completed on record. All figures are demo data.
            </p>
          ) : null}
        </DarkCard>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DarkStat label="Awarded projects (demo)" value={String(myProjects.length)} sub={company?.name ?? ""} />
          <DarkStat label="Bids submitted (demo)" value={String(myBids.length)} sub={myBids.filter((x) => x.bid.status === "Selected").length + " selected"} tone="green" />
          <DarkStat label="Awaiting verification (demo)" value={String(awaitingVerification)} sub={myMilestones.length + " milestones in total"} tone={awaitingVerification > 0 ? "amber" : "green"} />
          <DarkStat label="Settled payments (demo)" value={formatINR(paidToMe)} sub={myPayments.length + " payment records"} tone="green" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Submit a bid" sub="Uses submitBid on an Open tender. The bid is recorded as Submitted." />
            {openTenders.length === 0 ? (
              <p className="text-sm text-slate-400">No open tenders right now. Publish one from the Procurement workspace to see bidding here.</p>
            ) : canBid ? (
              <form onSubmit={submitBidForm} className="space-y-3">
                <Field label="Open tender">
                  <SelectInput
                    value={bidTender}
                    onChange={setBidTender}
                    options={[{ value: "", label: "Choose an open tender" }, ...openTenders.map((t) => ({ value: t.id, label: t.title + " | " + t.project + " | " + formatINR(t.valueInr) }))]}
                  />
                </Field>
                <Field label="Bid amount (Rs Cr)" hint="Entered in crore, stored in rupees.">
                  <TextInput type="number" min="0" step="0.01" value={bidCr} onChange={setBidCr} placeholder="e.g. 36.5" required />
                </Field>
                <PrimaryButton type="submit">Submit bid</PrimaryButton>
                <SuccessNote message={bidMsg} />
              </form>
            ) : (
              <p className="text-sm text-slate-400">Your role cannot submit bids.</p>
            )}
            {myBids.length > 0 ? (
              <div className="mt-6">
                <h3 className="mb-3 text-sm font-semibold text-white">Your bids</h3>
                <DataTable headers={["Tender", "Bid amount", "Status"]}>
                  {myBids.map((x) => (
                    <tr key={x.bid.id}>
                      <Td><span className="font-semibold text-white">{x.tender.title}</span></Td>
                      <Td>{formatINR(x.bid.amountInr)}</Td>
                      <Td><DarkBadge tone={statusTone(x.bid.status)}>{x.bid.status}</DarkBadge></Td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            ) : null}
          </DarkCard>

          <DarkCard>
            <DarkCardTitle title="Submit a milestone" sub="Uses submitMilestone. The milestone is recorded as Submitted, with no evidence hash until the auditor verifies it." />
            {myProjects.length === 0 ? (
              <p className="text-sm text-slate-400">This company has no awarded projects in the demo data.</p>
            ) : canSubmitMilestone ? (
              <form onSubmit={submitMilestoneForm} className="space-y-3">
                <Field label="Awarded project">
                  <SelectInput
                    value={msProject}
                    onChange={setMsProject}
                    options={[{ value: "", label: "Choose one of your projects" }, ...myProjects.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </Field>
                <Field label="Milestone title"><TextInput value={msTitle} onChange={setMsTitle} placeholder="e.g. Emergency wing structure complete" required /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Amount (Rs Cr)"><TextInput type="number" min="0" step="0.01" value={msCr} onChange={setMsCr} placeholder="e.g. 12" required /></Field>
                  <Field label="Due date"><TextInput type="date" value={msDue} onChange={setMsDue} required /></Field>
                </div>
                <PrimaryButton type="submit">Submit milestone</PrimaryButton>
                <SuccessNote message={msMsg} />
              </form>
            ) : (
              <p className="text-sm text-slate-400">Your role cannot submit milestones.</p>
            )}
          </DarkCard>
        </div>

        <DarkCard>
          <DarkCardTitle title="Upload invoices and evidence" sub="The file is hashed in this browser with SHA-256 and registered as a document record. Nothing is uploaded to a server in this demo." />
          {myProjects.length === 0 ? (
            <p className="text-sm text-slate-400">This company has no awarded projects in the demo data.</p>
          ) : (
            <form onSubmit={uploadEvidence} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Awarded project">
                  <SelectInput
                    value={uploadProject}
                    onChange={setUploadProject}
                    options={[{ value: "", label: "Choose one of your projects" }, ...myProjects.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </Field>
                <Field label="Document type">
                  <SelectInput
                    value={uploadKind}
                    onChange={setUploadKind}
                    options={[
                      { value: "Invoice", label: "Invoice" },
                      { value: "Evidence", label: "Evidence" },
                      { value: "Certificate", label: "Certificate" },
                      { value: "Delivery note", label: "Delivery note" },
                    ]}
                  />
                </Field>
              </div>
              <Field label="File">
                <input id="contractor-file" type="file" className="w-full rounded-lg border border-white/15 bg-[#111D2E] px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#080F1C]" />
              </Field>
              <PrimaryButton type="submit" disabled={uploading}>{uploading ? "Hashing file..." : "Upload and register document"}</PrimaryButton>
              <SuccessNote message={uploadMsg} />
            </form>
          )}
          {myDocuments.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold text-white">Your documents on record</h3>
              <DataTable headers={["Document", "Type", "Hash", "Verified"]}>
                {myDocuments.map((d) => (
                  <tr key={d.id}>
                    <Td><span className="font-semibold text-white">{d.title}</span><span className="block text-xs text-slate-500">{d.project}</span></Td>
                    <Td>{d.type}</Td>
                    <Td><span className="break-all text-xs">{shortHash(d.hash)}</span></Td>
                    <Td><DarkBadge tone={d.verified ? "green" : "amber"}>{d.verified ? "Verified" : "Not verified"}</DarkBadge></Td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : null}
          <div className="mt-4">
            <Link href="/janlekha/documents" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open public documents page</Link>
          </div>
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Awarded projects" sub="Projects awarded to the selected company. All figures are demo data." />
          {myProjects.length === 0 ? (
            <p className="text-sm text-slate-400">No awarded projects for this company.</p>
          ) : (
            <DataTable headers={["Project", "Department", "Budget", "Allocated", "Spent", "Progress", "Status"]}>
              {myProjects.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={"/janlekha/projects/" + p.id} className="font-semibold text-cyan-300 hover:underline">{p.name}</Link>
                    <span className="block text-xs text-slate-500">{p.location}</span>
                  </Td>
                  <Td>{p.department}</Td>
                  <Td>{formatINR(p.budgetInr)}</Td>
                  <Td>{formatINR(p.allocatedInr)}</Td>
                  <Td>{formatINR(p.spentInr)}</Td>
                  <Td>{p.progress}%</Td>
                  <Td><DarkBadge tone={statusTone(p.status)}>{p.status}</DarkBadge></Td>
                </tr>
              ))}
            </DataTable>
          )}
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Milestone status" sub="Submitted milestones wait for the Independent Auditor. Verified milestones can be paid by Finance. There is no verify action here, by design." />
          <div className="mb-4">
            <TextInput value={search} onChange={setSearch} placeholder="Search milestones by title, project, or status" />
          </div>
          {visibleMilestones.length === 0 ? (
            <p className="text-sm text-slate-400">No milestones match that search.</p>
          ) : (
            <DataTable headers={["Milestone", "Project", "Amount", "Due", "Status", "Verified by"]}>
              {visibleMilestones.map((m) => (
                <tr key={m.id}>
                  <Td><span className="font-semibold text-white">{m.title}</span></Td>
                  <Td>{m.project}</Td>
                  <Td>{formatINR(m.amountInr)}</Td>
                  <Td>{formatDate(m.dueDate)}</Td>
                  <Td><DarkBadge tone={statusTone(m.status)}>{m.status}</DarkBadge></Td>
                  <Td>{m.verifiedBy || "Not verified yet"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </DarkCard>

        <DarkCard>
          <DarkCardTitle title="Payment tracking" sub="Payments to the selected company. References starting SIM-ARC are simulated, not real transaction hashes." />
          {myPayments.length === 0 ? (
            <p className="text-sm text-slate-400">No payments recorded for this company.</p>
          ) : (
            <DataTable headers={["Date", "Project", "INR amount", "USDC amount", "Reference", "Status"]}>
              {myPayments.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDate(p.date)}</Td>
                  <Td>
                    <Link href={"/janlekha/projects/" + p.projectId} className="font-semibold text-cyan-300 hover:underline">{p.project}</Link>
                  </Td>
                  <Td>{formatINR(p.amountInr)}</Td>
                  <Td>{formatUSDC(p.amountUsdc)}</Td>
                  <Td><span className="break-all text-xs">{p.txRef}</span><span className="block text-xs text-amber-300">Simulated</span></Td>
                  <Td><DarkBadge tone={statusTone(p.status)}>{p.status}</DarkBadge></Td>
                </tr>
              ))}
            </DataTable>
          )}
          <div className="mt-4">
            <Link href="/janlekha/projects" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5">Open public projects page</Link>
          </div>
        </DarkCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <DarkCard>
            <DarkCardTitle title="Notifications" sub="For the Contractor role." />
            <NotificationsPanel role="CONTRACTOR" items={notifications} />
          </DarkCard>
          <DarkCard>
            <DarkCardTitle title="Contractor activity" sub="Latest contractor events, newest first." />
            <ActivityTimeline events={events.filter((e) => e.role === "CONTRACTOR")} limit={8} />
          </DarkCard>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
