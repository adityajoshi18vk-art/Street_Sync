// JanLekha client side state, adapted from the JanLekha 2.0 AppContext.
// "use client" and SSR safe: state starts from the seed demo data and is
// hydrated from localStorage after mount, so server rendering never reads
// localStorage.
//
// DEMO LIMITS, stated honestly in the UI as well:
// - All payments are simulated. initiatePayment creates a SIM-ARC demo
//   reference, never a real transaction hash. No contracts are deployed yet.
// - The second authoriser rule is shown in the demo (a payment over the
//   single release limit is flagged, and one seed payment is Pending
//   authorisation), but new payments created here currently mark Settled
//   immediately. That gap is real and is labelled in the UI.
// - All figures are DEMO DATA, realistic synthetic data, not actual
//   government expenditure.
"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as seed from "./data";
import type { AuditFlag, AuditReport, Complaint, Contractor, Department, DocRecord, Milestone, NotificationItem, Payment, Project, Tender, TxEvent } from "./data";
import type { Role } from "./permissions";
import { simulateArcPayment } from "./arc";

export interface Allocation {
  id: string;
  projectId: string;
  project: string;
  department: string;
  amountInr: number;
  status: "Approved" | "Pending" | "Released";
  date: string;
  approvedBy: string;
}

export interface JanLekhaState {
  departments: Department[];
  projects: Project[];
  tenders: Tender[];
  milestones: Milestone[];
  contractors: Contractor[];
  reports: AuditReport[];
  allocations: Allocation[];
  payments: Payment[];
  documents: DocRecord[];
  flags: AuditFlag[];
  complaints: Complaint[];
  events: TxEvent[];
  notifications: NotificationItem[];
  role: Role;
  setRole: (r: Role) => void;
  addDepartment: (d: Omit<Department, "id" | "allocatedInr" | "releasedInr" | "spentInr">) => void;
  addProject: (p: Omit<Project, "id" | "allocatedInr" | "releasedInr" | "spentInr" | "progress" | "status">) => void;
  createAllocation: (projectId: string, amountInr: number) => void;
  approveAllocation: (allocationId: string) => void;
  publishTender: (t: Omit<Tender, "id" | "bids" | "status">) => void;
  submitBid: (tenderId: string, contractorId: string, contractor: string, amountInr: number) => void;
  selectBid: (tenderId: string, bidId: string) => void;
  submitMilestone: (projectId: string, title: string, amountInr: number, dueDate: string) => void;
  verifyMilestone: (milestoneId: string, auditor: string) => void;
  initiatePayment: (projectId: string, milestoneId: string, amountInr: number, amountUsdc: number, payee: string) => string;
  addComplaint: (c: Omit<Complaint, "id" | "status" | "date" | "updates">) => void;
  resolveFlag: (flagId: string, note: string) => void;
  addDocument: (d: Omit<DocRecord, "id" | "verified">) => void;
  addReport: (r: Omit<AuditReport, "id" | "date" | "status">) => void;
  publishAuditFinding: (r: Omit<AuditReport, "id" | "date" | "status">) => void;
  markNotificationRead: (id: string) => void;
  resetDemo: () => void;
  addEvent: (e: Omit<TxEvent, "id">) => void;
}

const Ctx = createContext<JanLekhaState | null>(null);
const KEY = "janlekha-demo-v1";
const ROLE_KEY = "janlekha-role";

function seedAllocations(): Allocation[] {
  return seed.projects.map((p, i) => ({
    id: "alloc-" + p.id,
    projectId: p.id,
    project: p.name,
    department: p.department,
    amountInr: p.allocatedInr,
    status: "Approved" as const,
    date: p.startDate,
    approvedBy: "Finance Officer",
  }));
}

type Persisted = {
  departments: Department[];
  projects: Project[];
  tenders: Tender[];
  milestones: Milestone[];
  payments: Payment[];
  documents: DocRecord[];
  flags: AuditFlag[];
  complaints: Complaint[];
  events: TxEvent[];
  notifications: NotificationItem[];
  reports: AuditReport[];
  allocations: Allocation[];
};

function seedPersisted(): Persisted {
  return {
    departments: seed.departments,
    projects: seed.projects,
    tenders: seed.tenders,
    milestones: seed.milestones,
    payments: seed.payments,
    documents: seed.documents,
    flags: seed.flags,
    complaints: seed.complaints,
    events: seed.events,
    notifications: seed.notifications,
    reports: seed.reports,
    allocations: seedAllocations(),
  };
}

export function JanLekhaProvider({ children }: { children: ReactNode }) {
  const existing = useContext(Ctx);
  if (existing) return <>{children}</>;
  return <JanLekhaProviderInner>{children}</JanLekhaProviderInner>;
}

function JanLekhaProviderInner({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("CITIZEN");
  const [departments, setDepartments] = useState<Department[]>(seed.departments);
  const [projects, setProjects] = useState<Project[]>(seed.projects);
  const [tenders, setTenders] = useState<Tender[]>(seed.tenders);
  const [milestones, setMilestones] = useState<Milestone[]>(seed.milestones);
  const [payments, setPayments] = useState<Payment[]>(seed.payments);
  const [documents, setDocuments] = useState<DocRecord[]>(seed.documents);
  const [flags, setFlags] = useState<AuditFlag[]>(seed.flags);
  const [complaints, setComplaints] = useState<Complaint[]>(seed.complaints);
  const [events, setEvents] = useState<TxEvent[]>(seed.events);
  const [notifications, setNotifications] = useState<NotificationItem[]>(seed.notifications);
  const [reports, setReports] = useState<AuditReport[]>(seed.reports);
  const [allocations, setAllocations] = useState<Allocation[]>(seedAllocations);
  const [hydrated, setHydrated] = useState(false);
  const contractors: Contractor[] = seed.contractors;

  // Hydrate from localStorage once, after mount, so SSR output matches.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        if (parsed.departments) setDepartments(parsed.departments);
        if (parsed.projects) setProjects(parsed.projects);
        if (parsed.tenders) setTenders(parsed.tenders);
        if (parsed.milestones) setMilestones(parsed.milestones);
        if (parsed.payments) setPayments(parsed.payments);
        if (parsed.documents) setDocuments(parsed.documents);
        if (parsed.flags) setFlags(parsed.flags);
        if (parsed.complaints) setComplaints(parsed.complaints);
        if (parsed.events) setEvents(parsed.events);
        if (parsed.notifications) setNotifications(parsed.notifications);
        if (parsed.reports) setReports(parsed.reports);
        if (parsed.allocations) setAllocations(parsed.allocations);
      }
      const savedRole = localStorage.getItem(ROLE_KEY) as Role | null;
      if (savedRole) setRoleState(savedRole);
    } catch {
      // storage unavailable, keep seed data
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ departments, projects, tenders, milestones, payments, documents, flags, complaints, events, notifications, reports, allocations })
      );
    } catch {
      // storage unavailable
    }
  }, [hydrated, departments, projects, tenders, milestones, payments, documents, flags, complaints, events, notifications, reports, allocations]);

  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem(ROLE_KEY, r);
    } catch {
      // ignore
    }
  };

  const uid = (p: string) => p + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 9000 + 1000);
  const today = () => new Date().toISOString().slice(0, 10);
  const addEvent = (e: Omit<TxEvent, "id">) => setEvents((prev) => [{ ...e, id: uid("ev") }, ...prev]);
  const notify = (roleR: string, title: string, body: string) =>
    setNotifications((prev) => [{ id: uid("nt"), role: roleR, title, body, date: today(), read: false }, ...prev]);

  const value: JanLekhaState = useMemo(
    () => ({
      departments,
      projects,
      tenders,
      milestones,
      payments,
      documents,
      flags,
      complaints,
      events,
      notifications,
      contractors,
      reports,
      allocations,
      role,
      setRole,
      addEvent,
      addDepartment: (d) => {
        const nd: Department = { ...d, id: uid("dept"), allocatedInr: 0, releasedInr: 0, spentInr: 0 };
        setDepartments((p) => [...p, nd]);
        addEvent({ date: today(), type: "Department created", actor: "Government Administrator", role: "GOVERNMENT_ADMIN", description: "Department " + d.name + " created with budget.", projectId: "", txRef: "SIM-ARC-" + today() });
        notify("GOVERNMENT_ADMIN", "Department created", d.name + " was added.");
      },
      addProject: (p) => {
        const np: Project = { ...p, id: uid("proj"), allocatedInr: 0, releasedInr: 0, spentInr: 0, progress: 0, status: "New" };
        setProjects((prev) => [...prev, np]);
        addEvent({ date: today(), type: "Project registered", actor: "Government Administrator", role: "GOVERNMENT_ADMIN", description: "Project " + p.name + " registered.", projectId: np.id, txRef: "SIM-ARC-" + today() });
      },
      createAllocation: (projectId, amountInr) => {
        const pr = projects.find((p) => p.id === projectId);
        setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, allocatedInr: p.allocatedInr + amountInr, releasedInr: p.releasedInr + amountInr } : p)));
        setAllocations((prev) => [
          { id: uid("alloc"), projectId, project: pr?.name ?? projectId, department: pr?.department ?? "", amountInr, status: "Approved", date: today(), approvedBy: "Finance Officer" },
          ...prev,
        ]);
        addEvent({ date: today(), type: "Budget allocated", actor: "Finance Officer", role: "FINANCE_OFFICER", description: "Allocation approved for " + (pr?.name ?? projectId) + ".", projectId, txRef: "SIM-ARC-" + today() });
        notify("FINANCE_OFFICER", "Allocation approved", "Funds allocated for " + (pr?.name ?? projectId) + ".");
      },
      approveAllocation: (allocationId) => {
        const a = allocations.find((x) => x.id === allocationId);
        setAllocations((prev) => prev.map((x) => (x.id === allocationId ? { ...x, status: "Approved" } : x)));
        if (a) {
          addEvent({ date: today(), type: "Budget allocated", actor: "Finance Officer", role: "FINANCE_OFFICER", description: "Allocation approved for " + a.project + ".", projectId: a.projectId, txRef: "SIM-ARC-" + today() });
        }
      },
      publishTender: (t) => {
        const nt: Tender = { ...t, id: uid("ten"), bids: [], status: "Open" };
        setTenders((p) => [...p, nt]);
        addEvent({ date: today(), type: "Tender published", actor: "Procurement Officer", role: "PROCUREMENT_OFFICER", description: "Tender " + t.title + " published.", projectId: t.projectId, txRef: "SIM-ARC-" + today() });
      },
      submitBid: (tenderId, contractorId, contractor, amountInr) => {
        setTenders((prev) =>
          prev.map((t) =>
            t.id === tenderId
              ? { ...t, bids: [...t.bids, { id: uid("bid"), contractorId, contractor, amountInr, status: "Submitted", submitted: today() }] }
              : t
          )
        );
      },
      selectBid: (tenderId, bidId) => {
        setTenders((prev) =>
          prev.map((t) =>
            t.id === tenderId
              ? { ...t, status: "Awarded", bids: t.bids.map((b) => ({ ...b, status: b.id === bidId ? "Selected" : "Not selected" })) }
              : t
          )
        );
        const t = tenders.find((x) => x.id === tenderId);
        const b = t?.bids.find((x) => x.id === bidId);
        addEvent({ date: today(), type: "Bid selected", actor: "Procurement Officer", role: "PROCUREMENT_OFFICER", description: "Bid selected for " + (t?.title ?? tenderId) + ": " + (b?.contractor ?? ""), projectId: t?.projectId ?? "", txRef: "SIM-ARC-" + today() });
      },
      submitMilestone: (projectId, title, amountInr, dueDate) => {
        const pr = projects.find((p) => p.id === projectId);
        const nm: Milestone = { id: uid("ms"), projectId, project: pr?.name ?? projectId, title, amountInr, dueDate, status: "Submitted", evidenceHash: "", verifiedBy: "" };
        setMilestones((p) => [...p, nm]);
        addEvent({ date: today(), type: "Milestone submitted", actor: "Contractor", role: "CONTRACTOR", description: "Milestone " + title + " submitted for " + (pr?.name ?? projectId) + ".", projectId, txRef: "SIM-ARC-" + today() });
        notify("INDEPENDENT_AUDITOR", "Milestone awaiting verification", title + " was submitted.");
      },
      verifyMilestone: (milestoneId, auditor) => {
        setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, status: "Verified", verifiedBy: auditor } : m)));
        const m = milestones.find((x) => x.id === milestoneId);
        addEvent({ date: today(), type: "Milestone verified", actor: auditor, role: "INDEPENDENT_AUDITOR", description: "Milestone " + (m?.title ?? milestoneId) + " verified.", projectId: m?.projectId ?? "", txRef: "SIM-ARC-" + today() });
        notify("CONTRACTOR", "Milestone verified", (m?.title ?? "") + " was verified.");
      },
      // Simulated payment only. Returns a SIM-ARC demo reference, not a
      // transaction hash. Note the honest limit: the second authoriser rule
      // is shown in the demo, but new payments here mark Settled immediately.
      initiatePayment: (projectId, milestoneId, amountInr, amountUsdc, payee) => {
        const sim = simulateArcPayment(amountUsdc);
        const pr = projects.find((p) => p.id === projectId);
        const np: Payment = { id: uid("pay"), projectId, project: pr?.name ?? projectId, milestoneId, payee, amountInr, amountUsdc, txRef: sim.ref, status: "Settled", date: today(), kind: "Milestone payment", simulated: true };
        setPayments((p) => [np, ...p]);
        setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, status: "Paid" } : m)));
        setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, spentInr: p.spentInr + amountInr } : p)));
        addEvent({ date: today(), type: "Payment settled", actor: "Finance Officer", role: "FINANCE_OFFICER", description: "Simulated USDC payment settled to " + payee + " for " + (pr?.name ?? projectId) + ".", projectId, txRef: sim.ref });
        return sim.ref;
      },
      addComplaint: (c) => {
        const nc: Complaint = { ...c, id: uid("cmp"), status: "Submitted", date: today(), updates: [today() + ": Complaint received."] };
        setComplaints((p) => [nc, ...p]);
        addEvent({ date: today(), type: "Complaint submitted", actor: c.citizen, role: "CITIZEN", description: "Complaint submitted for " + c.project + ": " + c.subject, projectId: c.projectId, txRef: "SIM-ARC-" + today() });
      },
      resolveFlag: (flagId, note) => {
        const f = flags.find((x) => x.id === flagId);
        setFlags((prev) => prev.map((x) => (x.id === flagId ? { ...x, status: "Resolved", notes: note, history: [...x.history, today() + ": " + note] } : x)));
        addEvent({ date: today(), type: "Audit flag resolved", actor: "Independent Auditor", role: "INDEPENDENT_AUDITOR", description: "Risk flag resolved for " + (f?.project ?? flagId) + ".", projectId: f?.projectId ?? "", txRef: "SIM-ARC-" + today() });
      },
      addDocument: (d) => {
        const nd: DocRecord = { ...d, id: uid("doc"), verified: false };
        setDocuments((p) => [nd, ...p]);
      },
      addReport: (r) => {
        const nr: AuditReport = { ...r, id: uid("rep"), date: today(), status: "Published" };
        setReports((p) => [nr, ...p]);
        addEvent({ date: today(), type: "Audit report published", actor: r.auditor, role: "INDEPENDENT_AUDITOR", description: "Audit report published: " + r.title, projectId: r.projectId, txRef: "SIM-ARC-" + today() });
      },
      publishAuditFinding: (r) => {
        const nr: AuditReport = { ...r, id: uid("rep"), date: today(), status: "Published" };
        setReports((p) => [nr, ...p]);
        addEvent({ date: today(), type: "Audit report published", actor: r.auditor, role: "INDEPENDENT_AUDITOR", description: "Audit report published: " + r.title, projectId: r.projectId, txRef: "SIM-ARC-" + today() });
      },
      markNotificationRead: (id) => setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n))),
      resetDemo: () => {
        const s = seedPersisted();
        setDepartments(s.departments);
        setProjects(s.projects);
        setTenders(s.tenders);
        setMilestones(s.milestones);
        setPayments(s.payments);
        setDocuments(s.documents);
        setFlags(s.flags);
        setComplaints(s.complaints);
        setEvents(s.events);
        setNotifications(s.notifications);
        setReports(s.reports);
        setAllocations(s.allocations);
        try {
          localStorage.removeItem(KEY);
        } catch {
          // ignore
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [departments, projects, tenders, milestones, payments, documents, flags, complaints, events, notifications, reports, allocations, role]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJanLekha(): JanLekhaState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useJanLekha must be used inside JanLekhaProvider");
  return v;
}

// Alias matching the original JanLekha hook name.
export const useApp = useJanLekha;
export type { Role };
