import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  JanLekhaRoleRegistry,
  JanLekhaBudgetRegistry,
  JanLekhaProjectRegistry,
  JanLekhaProcurementRegistry,
  JanLekhaMilestoneRegistry,
  JanLekhaPaymentRegistry,
  JanLekhaDocumentRegistry,
  JanLekhaAuditRegistry,
} from "../typechain-types";

// ─────────────────────────────────────────────────────────────────────────────
// JanLekha registries ported from JanLekha 2.0 (Foundry) to Hardhat.
// All amounts in these tests are demo figures, not real expenditure.
// USDC amounts are 6-decimal base units: 1 USDC = 1,000,000.
// ─────────────────────────────────────────────────────────────────────────────

const id = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

const PROJECT_ID = id("proj-1");
const DEPT_ID = id("dept-health");
const MILESTONE_ID = id("ms-1");
const INVOICE_HASH = id("invoice-001");

const MilestoneStatus = { Submitted: 0, Verified: 1, Paid: 2, Rejected: 3 } as const;
const ProjectStatus = { Registered: 0, Active: 1, Delayed: 2, Completed: 3, Cancelled: 4 } as const;
const FundStage = {
  Budget: 0, Approval: 1, Allocation: 2, Release: 3, Execution: 4,
  Expenditure: 5, Verification: 6, Audit: 7, Completion: 8,
} as const;

describe("JanLekha", function () {
  let roles: JanLekhaRoleRegistry;
  let budgets: JanLekhaBudgetRegistry;
  let projects: JanLekhaProjectRegistry;
  let procurement: JanLekhaProcurementRegistry;
  let milestones: JanLekhaMilestoneRegistry;
  let payments: JanLekhaPaymentRegistry;
  let documents: JanLekhaDocumentRegistry;
  let audits: JanLekhaAuditRegistry;

  let admin: SignerWithAddress;
  let finance: SignerWithAddress;
  let procurementOfficer: SignerWithAddress;
  let contractor: SignerWithAddress;
  let contractorTwo: SignerWithAddress;
  let auditor: SignerWithAddress;
  let auditorTwo: SignerWithAddress;
  let stranger: SignerWithAddress;

  beforeEach(async function () {
    [admin, finance, procurementOfficer, contractor, contractorTwo,
     auditor, auditorTwo, stranger] = await ethers.getSigners();

    const Roles = await ethers.getContractFactory("JanLekhaRoleRegistry");
    roles = await Roles.deploy(admin.address);
    await roles.waitForDeployment();

    const role = (name: string) => (roles as any)[name]();

    await roles.connect(admin).grantRole(await role("FINANCE_ROLE"), finance.address);
    await roles.connect(admin).grantRole(await role("PROCUREMENT_ROLE"), procurementOfficer.address);
    await roles.connect(admin).grantRole(await role("CONTRACTOR_ROLE"), contractor.address);
    await roles.connect(admin).grantRole(await role("CONTRACTOR_ROLE"), contractorTwo.address);
    await roles.connect(admin).grantRole(await role("AUDITOR_ROLE"), auditor.address);
    await roles.connect(admin).grantRole(await role("AUDITOR_ROLE"), auditorTwo.address);

    const Budgets = await ethers.getContractFactory("JanLekhaBudgetRegistry");
    budgets = await Budgets.deploy(await roles.getAddress());
    await budgets.waitForDeployment();

    const Projects = await ethers.getContractFactory("JanLekhaProjectRegistry");
    projects = await Projects.deploy(await roles.getAddress());
    await projects.waitForDeployment();

    const Procurement = await ethers.getContractFactory("JanLekhaProcurementRegistry");
    procurement = await Procurement.deploy(await roles.getAddress());
    await procurement.waitForDeployment();

    const Milestones = await ethers.getContractFactory("JanLekhaMilestoneRegistry");
    milestones = await Milestones.deploy(await roles.getAddress());
    await milestones.waitForDeployment();

    const Payments = await ethers.getContractFactory("JanLekhaPaymentRegistry");
    payments = await Payments.deploy(
      await roles.getAddress(),
      await budgets.getAddress(),
      await milestones.getAddress(),
    );
    await payments.waitForDeployment();

    const Documents = await ethers.getContractFactory("JanLekhaDocumentRegistry");
    documents = await Documents.deploy(await roles.getAddress());
    await documents.waitForDeployment();

    const Audits = await ethers.getContractFactory("JanLekhaAuditRegistry");
    audits = await Audits.deploy(await roles.getAddress());
    await audits.waitForDeployment();

    await milestones.connect(admin).setPaymentRegistry(await payments.getAddress());

    await projects.connect(admin).registerProject(
      PROJECT_ID, "District Hospital Modernisation", DEPT_ID, contractor.address, 420_000_000_000,
    );
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function approveLimit(amountUsdc: bigint, allocId = id("alloc-main")) {
    await budgets.connect(finance).approveAllocation(allocId, DEPT_ID, PROJECT_ID, 1000, amountUsdc);
  }

  async function submitMilestone(milestoneId = MILESTONE_ID, by = contractor) {
    await milestones.connect(by).submitMilestone(
      milestoneId, PROJECT_ID, 1000, 1_000_000n, id("evidence-1"),
    );
  }

  async function verifiedMilestone(milestoneId = MILESTONE_ID, by = contractor) {
    await submitMilestone(milestoneId, by);
    await milestones.connect(auditor).verifyMilestone(milestoneId);
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Role access control
  // ═════════════════════════════════════════════════════════════════════════

  it("Only admin can grant roles; admin can grant and revoke", async function () {
    const financeRole = await roles.FINANCE_ROLE();
    await expect(
      roles.connect(stranger).grantRole(financeRole, stranger.address),
    ).to.be.revertedWithCustomError(roles, "NotAdmin").withArgs(stranger.address);
    expect(await roles.hasRole(financeRole, stranger.address)).to.equal(false);

    await roles.connect(admin).grantRole(await roles.AUDITOR_ROLE(), stranger.address);
    expect(await roles.hasRole(await roles.AUDITOR_ROLE(), stranger.address)).to.equal(true);
    await roles.connect(admin).revokeRole(await roles.AUDITOR_ROLE(), stranger.address);
    expect(await roles.hasRole(await roles.AUDITOR_ROLE(), stranger.address)).to.equal(false);
  });

  it("Last admin cannot be revoked, so the registry is never orphaned", async function () {
    expect(await roles.adminCount()).to.equal(1);
    await expect(
      roles.connect(admin).revokeRole(await roles.ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(roles, "LastAdmin").withArgs(admin.address);
  });

  it("Role changes emit events with the granting account", async function () {
    await expect(roles.connect(admin).grantRole(await roles.AUDITOR_ROLE(), stranger.address))
      .to.emit(roles, "RoleGranted")
      .withArgs(await roles.AUDITOR_ROLE(), stranger.address, admin.address);
  });

  it("Only admin can register a project", async function () {
    await expect(
      projects.connect(contractor).registerProject(
        id("proj-9"), "Other", DEPT_ID, contractor.address, 1000,
      ),
    ).to.be.revertedWithCustomError(projects, "NotAdmin").withArgs(contractor.address);
    expect(await projects.projectExists(PROJECT_ID)).to.equal(true);
    expect(await projects.projectCount()).to.equal(1);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Budgets: only Finance
  // ═════════════════════════════════════════════════════════════════════════

  it("Only Finance can approve allocations", async function () {
    await expect(
      budgets.connect(stranger).approveAllocation(id("alloc-1"), DEPT_ID, PROJECT_ID, 1000, 1_000_000n),
    ).to.be.revertedWithCustomError(budgets, "NotFinance").withArgs(stranger.address);

    await budgets.connect(finance).approveAllocation(id("alloc-1"), DEPT_ID, PROJECT_ID, 1000, 1_000_000n);
    expect(await budgets.authorizedLimitUsdc(PROJECT_ID)).to.equal(1_000_000n);
  });

  it("Allocation approval emits the fund lifecycle record at Allocation stage", async function () {
    await expect(
      budgets.connect(finance).approveAllocation(id("alloc-1"), DEPT_ID, PROJECT_ID, 1000, 1_000_000n),
    ).to.emit(budgets, "JanLekhaLifecycleRecorded")
      .withArgs(
        id("alloc-1"), PROJECT_ID, DEPT_ID, "AllocationApproved", FundStage.Allocation,
        1000, 1_000_000n, finance.address, ethers.ZeroHash, ethers.ZeroHash,
      );
  });

  it("Only Finance can release an allocation, and only once", async function () {
    await approveLimit(1_000_000n);
    await expect(
      budgets.connect(stranger).releaseAllocation(id("alloc-main")),
    ).to.be.revertedWithCustomError(budgets, "NotFinance").withArgs(stranger.address);

    await budgets.connect(finance).releaseAllocation(id("alloc-main"));
    expect((await budgets.getAllocation(id("alloc-main"))).released).to.equal(true);
    await expect(
      budgets.connect(finance).releaseAllocation(id("alloc-main")),
    ).to.be.revertedWithCustomError(budgets, "AlreadyReleased").withArgs(id("alloc-main"));
  });

  it("Allocation correction is a new traceable record, original untouched", async function () {
    await approveLimit(1_000_000n);
    await budgets.connect(finance).correctAllocation(
      id("alloc-fix"), id("alloc-main"), DEPT_ID, PROJECT_ID, 1500, 1_500_000n,
    );
    // Limit moved by the delta only: 1,000,000 -> 1,500,000
    expect(await budgets.authorizedLimitUsdc(PROJECT_ID)).to.equal(1_500_000n);
    // Original record unchanged
    const original = await budgets.getAllocation(id("alloc-main"));
    expect(original.amountUsdcBaseUnits).to.equal(1_000_000n);
    expect(original.amountInr).to.equal(1000);
    await expect(
      budgets.connect(finance).correctAllocation(
        id("alloc-fix-2"), id("alloc-main"), DEPT_ID, id("other-project"), 1500, 1_500_000n,
      ),
    ).to.be.revertedWithCustomError(budgets, "CorrectionProjectMismatch");
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Milestones: separation of duties
  // ═════════════════════════════════════════════════════════════════════════

  it("Contractor cannot verify own milestone, even with an auditor role", async function () {
    await submitMilestone();
    // The submitting contractor holds no auditor role, so this reverts on role.
    await expect(
      milestones.connect(contractor).verifyMilestone(MILESTONE_ID),
    ).to.be.revertedWithCustomError(milestones, "NotAuditor").withArgs(contractor.address);

    // Even an auditor who is also the submitter cannot self verify.
    await roles.connect(admin).grantRole(await roles.AUDITOR_ROLE(), contractor.address);
    await expect(
      milestones.connect(contractor).verifyMilestone(MILESTONE_ID),
    ).to.be.revertedWithCustomError(milestones, "SelfVerification").withArgs(contractor.address);
  });

  it("Independent auditor can verify a milestone; it cannot be verified twice", async function () {
    await submitMilestone();
    await milestones.connect(auditor).verifyMilestone(MILESTONE_ID);
    const m = await milestones.getMilestone(MILESTONE_ID);
    expect(Number(m.status)).to.equal(MilestoneStatus.Verified);
    expect(m.verifiedBy).to.equal(auditor.address);

    await expect(
      milestones.connect(auditorTwo).verifyMilestone(MILESTONE_ID),
    ).to.be.revertedWithCustomError(milestones, "WrongStatus")
      .withArgs(MILESTONE_ID, MilestoneStatus.Verified);
  });

  it("Rejected milestone is resubmitted as a new record referencing the original", async function () {
    await submitMilestone();
    await milestones.connect(auditor).rejectMilestone(MILESTONE_ID);
    expect(Number((await milestones.getMilestone(MILESTONE_ID)).status))
      .to.equal(MilestoneStatus.Rejected);

    await expect(
      milestones.connect(contractor).resubmitMilestone(
        id("ms-1b"), MILESTONE_ID, 1000, 1_000_000n, id("evidence-1b"),
      ),
    ).to.emit(milestones, "MilestoneResubmitted")
      .withArgs(id("ms-1b"), MILESTONE_ID, PROJECT_ID, contractor.address);

    const resubmitted = await milestones.getMilestone(id("ms-1b"));
    expect(Number(resubmitted.status)).to.equal(MilestoneStatus.Submitted);
    // Original stays Rejected, never rewritten
    expect(Number((await milestones.getMilestone(MILESTONE_ID)).status))
      .to.equal(MilestoneStatus.Rejected);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Documents: auditor cannot edit original records
  // ═════════════════════════════════════════════════════════════════════════

  it("Auditor cannot edit original records; verification only flips the flag", async function () {
    const docId = id("doc-1");
    const contentHash = id("contract-bytes");
    await documents.connect(procurementOfficer).registerDocument(
      docId, PROJECT_ID, contentHash, "Contract",
    );

    await documents.connect(auditor).verifyDocument(docId);

    const doc = await documents.getDocument(docId);
    expect(doc.contentHash).to.equal(contentHash);
    expect(doc.uploadedBy).to.equal(procurementOfficer.address);
    expect(doc.verified).to.equal(true);
    expect(doc.verifiedBy).to.equal(auditor.address);

    // Re-registering the same content hash is rejected, so the original
    // record cannot be replaced by a second upload with the same hash.
    await expect(
      documents.connect(procurementOfficer).registerDocument(
        id("doc-2"), PROJECT_ID, contentHash, "Contract",
      ),
    ).to.be.revertedWithCustomError(documents, "DuplicateContentHash").withArgs(contentHash);
  });

  it("Only an auditor can verify documents; citizens cannot upload", async function () {
    const docId = id("doc-9");
    await documents.connect(procurementOfficer).registerDocument(
      docId, PROJECT_ID, id("bytes-9"), "Invoice",
    );
    await expect(
      documents.connect(finance).verifyDocument(docId),
    ).to.be.revertedWithCustomError(documents, "NotAuditor").withArgs(finance.address);

    // Stranger holds no role, so has no write permission at all.
    await expect(
      documents.connect(stranger).registerDocument(id("doc-10"), PROJECT_ID, id("bytes-10"), "Invoice"),
    ).to.be.revertedWithCustomError(documents, "NoRole").withArgs(stranger.address);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Payments: invariants
  // ═════════════════════════════════════════════════════════════════════════

  it("Only Finance can record payments", async function () {
    await approveLimit(10_000_000n);
    await verifiedMilestone();
    await expect(
      payments.connect(auditor).recordPayment(
        id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_000_000n, INVOICE_HASH,
      ),
    ).to.be.revertedWithCustomError(payments, "NotFinance").withArgs(auditor.address);
  });

  it("Payment cannot exceed authorised limit; paying exactly the limit succeeds", async function () {
    await approveLimit(1_000_000n);
    await verifiedMilestone();

    // 1,000,001 base units is 1 USDC over the 1 USDC authorised limit.
    await expect(
      payments.connect(finance).recordPayment(
        id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_000_001n, INVOICE_HASH,
      ),
    ).to.be.revertedWithCustomError(payments, "ExceedsAuthorisedLimit")
      .withArgs(PROJECT_ID, 1_000_001n, 1_000_000n);

    await payments.connect(finance).recordPayment(
      id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_000_000n, INVOICE_HASH,
    );
    expect(await payments.totalPaidUsdc(PROJECT_ID)).to.equal(1_000_000n);
    expect(await payments.remainingLimitUsdc(PROJECT_ID)).to.equal(0);
  });

  it("Duplicate invoice hash is rejected", async function () {
    await approveLimit(10_000_000n);
    await verifiedMilestone();

    await payments.connect(finance).recordPayment(
      id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_000_000n, INVOICE_HASH,
    );

    const milestoneTwo = id("ms-2");
    await milestones.connect(contractorTwo).submitMilestone(
      milestoneTwo, PROJECT_ID, 1000, 1_000_000n, id("evidence-2"),
    );
    await milestones.connect(auditor).verifyMilestone(milestoneTwo);

    await expect(
      payments.connect(finance).recordPayment(
        id("pay-2"), PROJECT_ID, milestoneTwo, contractorTwo.address, 1_000_000n, INVOICE_HASH,
      ),
    ).to.be.revertedWithCustomError(payments, "DuplicateInvoiceHash").withArgs(INVOICE_HASH);
  });

  it("Payment requires a verified milestone", async function () {
    await approveLimit(10_000_000n);
    await submitMilestone();
    await expect(
      payments.connect(finance).recordPayment(
        id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_000_000n, INVOICE_HASH,
      ),
    ).to.be.revertedWithCustomError(payments, "MilestoneNotVerified").withArgs(MILESTONE_ID);
  });

  it("Payment correction is a new traceable record referencing the original", async function () {
    await approveLimit(5_000_000n);
    await verifiedMilestone();
    await payments.connect(finance).recordPayment(
      id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 2_000_000n, INVOICE_HASH,
    );

    await payments.connect(finance).correctPayment(
      id("pay-1-fix"), id("pay-1"), 2_500_000n, id("invoice-001-fix"),
    );
    // Total paid moved by the delta only: 2,000,000 -> 2,500,000
    expect(await payments.totalPaidUsdc(PROJECT_ID)).to.equal(2_500_000n);
    expect(await payments.supersededBy(id("pay-1"))).to.equal(id("pay-1-fix"));
    // Original record unchanged
    expect((await payments.getPayment(id("pay-1"))).amountUsdcBaseUnits).to.equal(2_000_000n);
    // The corrected invoice hash is now used, the original stays used too
    expect(await payments.invoiceUsed(INVOICE_HASH)).to.equal(true);
    expect(await payments.invoiceUsed(id("invoice-001-fix"))).to.equal(true);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  USDC 6-decimal handling
  // ═════════════════════════════════════════════════════════════════════════

  it("USDC 6-decimal handling: 1 USDC is 1,000,000 base units, never 1e18", async function () {
    expect(await payments.USDC_DECIMALS()).to.equal(6);
    expect(await payments.USDC_BASE_UNIT()).to.equal(1_000_000n);
    expect(await payments.usdcToBaseUnits(1)).to.equal(1_000_000n);
    expect(await payments.usdcToBaseUnits(250)).to.equal(250_000_000n);
    // 1.5 USDC expressed in base units is 1,500,000, never 1.5e18.
    expect(await payments.usdcToBaseUnits(3) / 2n).to.equal(1_500_000n);

    await approveLimit(1_500_000n);
    await verifiedMilestone();
    await payments.connect(finance).recordPayment(
      id("pay-1"), PROJECT_ID, MILESTONE_ID, contractor.address, 1_500_000n, INVOICE_HASH,
    );
    const p = await payments.getPayment(id("pay-1"));
    expect(p.amountUsdcBaseUnits).to.equal(1_500_000n);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Audit flags
  // ═════════════════════════════════════════════════════════════════════════

  it("Auditor cannot edit flag reason on resolve; original stays intact", async function () {
    const flagId = id("flag-1");
    await audits.connect(auditor).raiseFlag(
      flagId, PROJECT_ID, "Payment above authorised limit", 4,
    );
    await audits.connect(auditorTwo).resolveFlag(
      flagId, "Checked, second authoriser confirmed",
    );
    const flag = await audits.getFlag(flagId);
    expect(flag.reason).to.equal("Payment above authorised limit");
    expect(flag.risk).to.equal(4);
    expect(flag.raisedBy).to.equal(auditor.address);
    expect(flag.resolved).to.equal(true);
    expect(flag.resolutionNote).to.equal("Checked, second authoriser confirmed");
  });

  it("Only an auditor can raise flags or publish reports", async function () {
    await expect(
      audits.connect(finance).raiseFlag(id("flag-9"), PROJECT_ID, "Late milestone", 2),
    ).to.be.revertedWithCustomError(audits, "NotAuditor").withArgs(finance.address);

    await audits.connect(auditor).publishReport(
      id("rep-1"), PROJECT_ID, "Q3 audit", 3,
    );
    const report = await audits.getReport(id("rep-1"));
    expect(report.title).to.equal("Q3 audit");
    expect(report.findings).to.equal(3);
    expect(report.auditor).to.equal(auditor.address);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Procurement: tender, bid, award
  // ═════════════════════════════════════════════════════════════════════════

  it("Tender bid and award flow, with one bid per contractor", async function () {
    const tenderId = id("ten-1");
    await expect(
      procurement.connect(contractor).publishTender(
        tenderId, PROJECT_ID, "Civil works", 1000, Math.floor(Date.now() / 1000) + 7 * 86400,
      ),
    ).to.be.revertedWithCustomError(procurement, "NotProcurement").withArgs(contractor.address);

    await procurement.connect(procurementOfficer).publishTender(
      tenderId, PROJECT_ID, "Civil works", 1000, Math.floor(Date.now() / 1000) + 7 * 86400,
    );
    await procurement.connect(contractor).submitBid(tenderId, 900);
    await procurement.connect(contractorTwo).submitBid(tenderId, 850);

    // Second bid from the same contractor is rejected.
    await expect(
      procurement.connect(contractor).submitBid(tenderId, 800),
    ).to.be.revertedWithCustomError(procurement, "DuplicateBid")
      .withArgs(tenderId, contractor.address);

    // Awarding to an address that never bid is rejected.
    await expect(
      procurement.connect(procurementOfficer).selectBid(tenderId, stranger.address),
    ).to.be.revertedWithCustomError(procurement, "BidMissing")
      .withArgs(tenderId, stranger.address);

    await procurement.connect(procurementOfficer).selectBid(tenderId, contractorTwo.address);
    const tender = await procurement.getTender(tenderId);
    expect(tender.open).to.equal(false);
    expect(tender.awardedTo).to.equal(contractorTwo.address);
    expect(tender.awardedAmountInr).to.equal(850);

    const bids = await procurement.getBids(tenderId);
    expect(bids.length).to.equal(2);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  End to end
  // ═════════════════════════════════════════════════════════════════════════

  it("End to end: allocation to verified milestone to payment, milestone Paid", async function () {
    await approveLimit(5_000_000n);
    await verifiedMilestone();
    await payments.connect(finance).recordPayment(
      id("pay-e2e"), PROJECT_ID, MILESTONE_ID, contractor.address, 2_000_000n, INVOICE_HASH,
    );
    const m = await milestones.getMilestone(MILESTONE_ID);
    expect(Number(m.status)).to.equal(MilestoneStatus.Paid);
    expect(await payments.remainingLimitUsdc(PROJECT_ID)).to.equal(3_000_000n);
  });

  it("Project status moves through ADMIN transitions and emits lifecycle records", async function () {
    await expect(projects.connect(admin).updateStatus(PROJECT_ID, ProjectStatus.Completed))
      .to.emit(projects, "JanLekhaLifecycleRecorded")
      .withArgs(
        PROJECT_ID, PROJECT_ID, DEPT_ID, "ProjectStatusUpdated", FundStage.Completion,
        0, 0, admin.address, ethers.ZeroHash, ethers.ZeroHash,
      );
    expect(Number((await projects.getProject(PROJECT_ID)).status)).to.equal(ProjectStatus.Completed);
  });
});
