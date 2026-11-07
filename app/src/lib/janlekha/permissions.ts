export type Role = "GOVERNMENT_ADMIN" | "FINANCE_OFFICER" | "PROCUREMENT_OFFICER" | "CONTRACTOR" | "INDEPENDENT_AUDITOR" | "CITIZEN";
export const ROLE_LABELS: Record<Role, string> = {
  GOVERNMENT_ADMIN: "Government Administrator",
  FINANCE_OFFICER: "Finance Officer",
  PROCUREMENT_OFFICER: "Procurement Officer",
  CONTRACTOR: "Project Manager / Contractor",
  INDEPENDENT_AUDITOR: "Independent Auditor",
  CITIZEN: "Citizen / Taxpayer",
};
export const ROLE_ROUTES: Record<Role, string> = {
  GOVERNMENT_ADMIN: "/janlekha/roles/admin",
  FINANCE_OFFICER: "/janlekha/roles/finance",
  PROCUREMENT_OFFICER: "/janlekha/roles/procurement",
  CONTRACTOR: "/janlekha/roles/contractor",
  INDEPENDENT_AUDITOR: "/janlekha/roles/auditor",
  CITIZEN: "/janlekha/roles/citizen",
};
export type Permission = "manage_departments" | "create_project" | "approve_budget" | "release_funds" | "initiate_payment" | "authorise_payment" | "publish_tender" | "evaluate_bids" | "submit_bid" | "submit_milestone" | "verify_milestone" | "publish_audit" | "edit_records" | "view_public";
export const PERMISSIONS: Record<Role, Permission[]> = {
  GOVERNMENT_ADMIN: ["manage_departments", "create_project", "approve_budget", "view_public"],
  FINANCE_OFFICER: ["approve_budget", "release_funds", "initiate_payment", "view_public"],
  PROCUREMENT_OFFICER: ["publish_tender", "evaluate_bids", "view_public"],
  CONTRACTOR: ["submit_bid", "submit_milestone", "view_public"],
  INDEPENDENT_AUDITOR: ["verify_milestone", "publish_audit", "view_public"],
  CITIZEN: ["view_public"],
};
export function can(role: Role, perm: Permission): boolean { return PERMISSIONS[role].includes(perm); }
export function canAuthorisePayment(role: Role, initiatorRole: Role): boolean {
  return role === "FINANCE_OFFICER" && initiatorRole !== role;
}
