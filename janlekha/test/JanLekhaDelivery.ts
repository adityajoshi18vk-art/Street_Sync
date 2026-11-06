import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

const BID_WINDOW = 3_600n;
const REVEAL_WINDOW = 3_600n;
const ALLOCATION = 50_00_000_00n; // ₹50,00,000 in paise
const BID_A = 42_00_000_00n;
const BID_B = 45_50_000_00n;
const M1 = 12_00_000_00n;
const M2 = 18_00_000_00n;

const Status = { None: 0, Defined: 1, EvidenceSubmitted: 2, Approved: 3, Paid: 4 } as const;

function sha256Hex(text: string): Hex {
  return `0x${createHash("sha256").update(text).digest("hex")}`;
}

function commitmentFor(projectId: bigint, vendor: Address, amount: bigint, doc: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, uint256, bytes32, bytes32"), [
      projectId,
      vendor,
      amount,
      doc,
      salt,
    ]),
  );
}

const SANCTION_HASH = sha256Hex("synthetic sanction order");
const TENDER_HASH = sha256Hex("synthetic tender notice");
const EVALUATION_HASH = sha256Hex("synthetic bid evaluation report");
const CONTRACT_HASH = sha256Hex("synthetic signed contract");
const SPEC_1 = sha256Hex("milestone 1: excavation");
const SPEC_2 = sha256Hex("milestone 2: pipe laying");
const EVIDENCE_1 = sha256Hex("milestone 1 geotagged photos");
const REPORT_1 = sha256Hex("milestone 1 inspection report");
const PAYMENT_REF_1 = sha256Hex("mock PFMS payment advice #1");

describe("JanLekha award and delivery", async function () {
  const { viem, networkHelpers } = await network.create();
  const { time, loadFixture } = networkHelpers;

  /** Tender closed: A and B revealed, C committed without revealing; now == revealDeadline. */
  async function awardableFixture() {
    const [admin, department, otherDepartment, vendorA, vendorB, vendorC, inspector, pao, outsider] =
      await viem.getWalletClients();
    const janLekha = await viem.deployContract("JanLekha", [admin.account.address]);

    const roles = {
      DEFAULT_ADMIN_ROLE: await janLekha.read.DEFAULT_ADMIN_ROLE(),
      DEPARTMENT_ROLE: await janLekha.read.DEPARTMENT_ROLE(),
      VENDOR_ROLE: await janLekha.read.VENDOR_ROLE(),
      INSPECTOR_ROLE: await janLekha.read.INSPECTOR_ROLE(),
      PAO_ROLE: await janLekha.read.PAO_ROLE(),
    };
    for (const [role, wallet] of [
      [roles.DEPARTMENT_ROLE, department],
      [roles.DEPARTMENT_ROLE, otherDepartment],
      [roles.VENDOR_ROLE, vendorA],
      [roles.VENDOR_ROLE, vendorB],
      [roles.VENDOR_ROLE, vendorC],
      [roles.INSPECTOR_ROLE, inspector],
      [roles.PAO_ROLE, pao],
    ] as const) {
      await janLekha.write.grantRole([role, wallet.account.address]);
    }

    const as = (wallet: typeof admin) =>
      viem.getContractAt("JanLekha", janLekha.address, { client: { wallet } });
    const c = {
      department: await as(department),
      otherDepartment: await as(otherDepartment),
      vendorA: await as(vendorA),
      vendorB: await as(vendorB),
      vendorC: await as(vendorC),
      inspector: await as(inspector),
      pao: await as(pao),
      outsider: await as(outsider),
    };

    const projectId = 1n;
    await c.department.write.createProject([SANCTION_HASH, ALLOCATION]);
    const now = BigInt(await time.latest());
    const bidDeadline = now + BID_WINDOW;
    const revealDeadline = bidDeadline + REVEAL_WINDOW;
    await c.department.write.publishTender([projectId, TENDER_HASH, bidDeadline, revealDeadline]);

    const bids = [
      { contract: c.vendorA, wallet: vendorA, amount: BID_A, doc: sha256Hex("quotation A"), salt: toHex(randomBytes(32)) },
      { contract: c.vendorB, wallet: vendorB, amount: BID_B, doc: sha256Hex("quotation B"), salt: toHex(randomBytes(32)) },
      { contract: c.vendorC, wallet: vendorC, amount: 1_00n, doc: sha256Hex("quotation C"), salt: toHex(randomBytes(32)) },
    ];
    for (const b of bids) {
      await b.contract.write.commitBid([
        projectId,
        commitmentFor(projectId, b.wallet.account.address, b.amount, b.doc, b.salt),
      ]);
    }
    await time.increaseTo(bidDeadline);
    for (const b of bids.slice(0, 2)) {
      await b.contract.write.revealBid([projectId, b.amount, b.doc, b.salt]);
    }
    await time.increaseTo(revealDeadline);

    return {
      janLekha,
      roles,
      c,
      wallets: { admin, department, otherDepartment, vendorA, vendorB, vendorC, inspector, pao, outsider },
      projectId,
      revealDeadline,
    };
  }

  async function awardedFixture() {
    const base = await awardableFixture();
    await base.c.department.write.awardContract([
      base.projectId,
      base.wallets.vendorA.account.address,
      EVALUATION_HASH,
      CONTRACT_HASH,
    ]);
    return base;
  }

  async function milestonesFixture() {
    const base = await awardedFixture();
    await base.c.department.write.defineMilestone([base.projectId, M1, SPEC_1]);
    await base.c.department.write.defineMilestone([base.projectId, M2, SPEC_2]);
    return base;
  }

  async function evidenceFixture() {
    const base = await milestonesFixture();
    await base.c.vendorA.write.submitMilestoneEvidence([base.projectId, 1n, EVIDENCE_1]);
    return base;
  }

  async function approvedFixture() {
    const base = await evidenceFixture();
    await base.c.inspector.write.approveMilestone([base.projectId, 1n, REPORT_1]);
    return base;
  }

  type Ctx = Awaited<ReturnType<typeof awardableFixture>>;

  /** Checks the stored budget and that reserved + paid <= allocation. */
  async function assertBudget(ctx: Ctx, reserved: bigint, paid: bigint) {
    const budget = await ctx.janLekha.read.getBudget([ctx.projectId]);
    assert.equal(budget.allocationPaise, ALLOCATION);
    assert.equal(budget.reservedPaise, reserved, "reserved");
    assert.equal(budget.paidPaise, paid, "paid");
    assert.ok(budget.reservedPaise + budget.paidPaise <= budget.allocationPaise, "reserved + paid <= allocation");
  }

  async function expectUnauthorized(ctx: Ctx, call: Promise<unknown>, wallet: { account: { address: Address } }, role: Hex) {
    await viem.assertions.revertWithCustomErrorWithArgs(
      call as Promise<Hex>,
      ctx.janLekha,
      "AccessControlUnauthorizedAccount",
      [wallet.account.address, role],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  describe("awardContract", function () {
    it("awards a revealed vendor at its revealed amount, reserves budget and emits ContractAwarded", async function () {
      const ctx = await loadFixture(awardableFixture);
      const { janLekha, c, wallets, projectId } = ctx;
      await assertBudget(ctx, 0n, 0n);

      await viem.assertions.emitWithArgs(
        c.department.write.awardContract([projectId, wallets.vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "ContractAwarded",
        [projectId, wallets.vendorA.account.address, BID_A, EVALUATION_HASH, CONTRACT_HASH],
      );

      const award = await janLekha.read.getAward([projectId]);
      assert.equal(award.vendor.toLowerCase(), wallets.vendorA.account.address);
      assert.equal(award.amountPaise, BID_A);
      assert.equal(award.evaluationDocumentHash, EVALUATION_HASH);
      assert.equal(award.contractDocumentHash, CONTRACT_HASH);
      assert.equal(award.awardedAt, BigInt(await time.latest()));
      assert.equal(award.milestoneCount, 0);
      assert.equal(award.milestoneTotalPaise, 0n);
      await assertBudget(ctx, BID_A, 0n);
    });

    it("may award a revealed vendor that is not the lowest bidder (evaluation hash records why)", async function () {
      const ctx = await loadFixture(awardableFixture);
      await ctx.c.department.write.awardContract([
        ctx.projectId,
        ctx.wallets.vendorB.account.address,
        EVALUATION_HASH,
        CONTRACT_HASH,
      ]);
      assert.equal((await ctx.janLekha.read.getAward([ctx.projectId])).amountPaise, BID_B);
      await assertBudget(ctx, BID_B, 0n);
    });

    it("returns a zeroed award before the project is awarded", async function () {
      const { janLekha, projectId } = await loadFixture(awardableFixture);
      const award = await janLekha.read.getAward([projectId]);
      assert.equal(award.awardedAt, 0n);
      assert.equal(award.vendor, zeroAddress);
    });

    it("opens exactly at revealDeadline and rejects one second earlier", async function () {
      const [admin, department, , vendorA] = await viem.getWalletClients();
      const janLekha = await viem.deployContract("JanLekha", [admin.account.address]);
      await janLekha.write.grantRole([await janLekha.read.DEPARTMENT_ROLE(), department.account.address]);
      await janLekha.write.grantRole([await janLekha.read.VENDOR_ROLE(), vendorA.account.address]);
      const dept = await viem.getContractAt("JanLekha", janLekha.address, { client: { wallet: department } });
      const vendor = await viem.getContractAt("JanLekha", janLekha.address, { client: { wallet: vendorA } });

      await dept.write.createProject([SANCTION_HASH, ALLOCATION]);
      const now = BigInt(await time.latest());
      const bidDeadline = now + BID_WINDOW;
      const revealDeadline = bidDeadline + REVEAL_WINDOW;
      await dept.write.publishTender([1n, TENDER_HASH, bidDeadline, revealDeadline]);
      const salt = toHex(randomBytes(32));
      const doc = sha256Hex("q");
      await vendor.write.commitBid([1n, commitmentFor(1n, vendorA.account.address, BID_A, doc, salt)]);
      await time.increaseTo(bidDeadline);
      await vendor.write.revealBid([1n, BID_A, doc, salt]);

      await time.setNextBlockTimestamp(revealDeadline - 1n);
      await viem.assertions.revertWithCustomErrorWithArgs(
        dept.write.awardContract([1n, vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "AwardNotOpen",
        [1n],
      );
      await time.setNextBlockTimestamp(revealDeadline);
      await dept.write.awardContract([1n, vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH]);
      assert.equal((await janLekha.read.getAward([1n])).awardedAt, revealDeadline);
    });

    it("rejects a vendor that committed but did not reveal, and an address with no bid", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(awardableFixture);
      for (const w of [wallets.vendorC, wallets.outsider]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          c.department.write.awardContract([projectId, w.account.address, EVALUATION_HASH, CONTRACT_HASH]),
          janLekha,
          "BidNotRevealed",
          [projectId, w.account.address],
        );
      }
    });

    it("rejects a revealed vendor whose VENDOR_ROLE was revoked", async function () {
      const { janLekha, c, wallets, projectId, roles } = await loadFixture(awardableFixture);
      await janLekha.write.revokeRole([roles.VENDOR_ROLE, wallets.vendorA.account.address]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.awardContract([projectId, wallets.vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "VendorNotEligible",
        [wallets.vendorA.account.address],
      );
    });

    it("enforces awardAmount <= allocation (boundary: equal passes, one paise over fails)", async function () {
      const { janLekha, c, wallets } = await loadFixture(awardableFixture);
      const allocation = 1_000n;
      for (const [projectId, amount] of [[2n, allocation + 1n], [3n, allocation]] as const) {
        await c.department.write.createProject([SANCTION_HASH, allocation]);
        const now = BigInt(await time.latest());
        await c.department.write.publishTender([projectId, TENDER_HASH, now + 100n, now + 200n]);
        const salt = toHex(randomBytes(32));
        const doc = sha256Hex(`q${projectId}`);
        await c.vendorA.write.commitBid([projectId, commitmentFor(projectId, wallets.vendorA.account.address, amount, doc, salt)]);
        await time.increaseTo(now + 100n);
        await c.vendorA.write.revealBid([projectId, amount, doc, salt]);
        await time.increaseTo(now + 200n);

        const award = c.department.write.awardContract([projectId, wallets.vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH]);
        if (amount > allocation) {
          await viem.assertions.revertWithCustomErrorWithArgs(award, janLekha, "AwardExceedsAllocation", [
            projectId,
            amount,
            allocation,
          ]);
          assert.equal((await janLekha.read.getBudget([projectId])).reservedPaise, 0n);
        } else {
          await award;
          const budget = await janLekha.read.getBudget([projectId]);
          assert.equal(budget.reservedPaise, allocation);
          assert.equal(budget.reservedPaise + budget.paidPaise, budget.allocationPaise);
        }
      }
    });

    it("awards only once", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(awardedFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.awardContract([projectId, wallets.vendorB.account.address, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "AlreadyAwarded",
        [projectId],
      );
      assert.equal((await janLekha.read.getBudget([projectId])).reservedPaise, BID_A, "no double reservation");
    });

    it("rejects zero evaluation or contract hashes", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(awardableFixture);
      const v = wallets.vendorA.account.address;
      for (const [evalHash, contractHash] of [[zeroHash, CONTRACT_HASH], [EVALUATION_HASH, zeroHash]] as const) {
        await viem.assertions.revertWithCustomError(
          c.department.write.awardContract([projectId, v, evalHash, contractHash]),
          janLekha,
          "InvalidDocumentHash",
        );
      }
    });

    it("rejects vendor, inspector, PAO and outsiders; and departments that do not own the project", async function () {
      const ctx = await loadFixture(awardableFixture);
      const { janLekha, c, wallets, projectId, roles } = ctx;
      const args = [projectId, wallets.vendorA.account.address, EVALUATION_HASH, CONTRACT_HASH] as const;
      for (const [contract, wallet] of [
        [c.vendorA, wallets.vendorA],
        [c.inspector, wallets.inspector],
        [c.pao, wallets.pao],
        [c.outsider, wallets.outsider],
      ] as const) {
        await expectUnauthorized(ctx, contract.write.awardContract([...args]), wallet, roles.DEPARTMENT_ROLE);
      }
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.otherDepartment.write.awardContract([...args]),
        janLekha,
        "NotProjectDepartment",
        [projectId, wallets.otherDepartment.account.address],
      );
    });

    it("rejects unknown projects and projects without a tender", async function () {
      const { janLekha, c, wallets } = await loadFixture(awardableFixture);
      const v = wallets.vendorA.account.address;
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.awardContract([9n, v, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "UnknownProject",
        [9n],
      );
      await c.department.write.createProject([SANCTION_HASH, ALLOCATION]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.awardContract([2n, v, EVALUATION_HASH, CONTRACT_HASH]),
        janLekha,
        "TenderNotPublished",
        [2n],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("defineMilestone", function () {
    it("defines sequential milestones and emits MilestoneDefined", async function () {
      const ctx = await loadFixture(awardedFixture);
      const { janLekha, c, projectId } = ctx;
      await viem.assertions.emitWithArgs(
        c.department.write.defineMilestone([projectId, M1, SPEC_1]),
        janLekha,
        "MilestoneDefined",
        [projectId, 1n, M1, SPEC_1],
      );
      await viem.assertions.emitWithArgs(
        c.department.write.defineMilestone([projectId, M2, SPEC_2]),
        janLekha,
        "MilestoneDefined",
        [projectId, 2n, M2, SPEC_2],
      );

      const m = await janLekha.read.getMilestone([projectId, 2n]);
      assert.equal(m.amountPaise, M2);
      assert.equal(m.specificationDocumentHash, SPEC_2);
      assert.equal(m.status, Status.Defined);
      assert.equal(m.definedAt, BigInt(await time.latest()));
      const award = await janLekha.read.getAward([projectId]);
      assert.equal(award.milestoneCount, 2);
      assert.equal(award.milestoneTotalPaise, M1 + M2);
      await assertBudget(ctx, BID_A, 0n); // defining milestones does not move budget
    });

    it("enforces sum(milestones) <= awardAmount (boundary: exact fill passes, one paise over fails)", async function () {
      const { janLekha, c, projectId } = await loadFixture(milestonesFixture);
      const remaining = BID_A - M1 - M2;
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.defineMilestone([projectId, remaining + 1n, SPEC_1]),
        janLekha,
        "MilestoneExceedsAward",
        [projectId, BID_A + 1n, BID_A],
      );
      await c.department.write.defineMilestone([projectId, remaining, SPEC_1]);
      assert.equal((await janLekha.read.getAward([projectId])).milestoneTotalPaise, BID_A);
      await viem.assertions.revertWithCustomError(
        c.department.write.defineMilestone([projectId, 1n, SPEC_1]),
        janLekha,
        "MilestoneExceedsAward",
      );
    });

    it("requires an award first", async function () {
      const { janLekha, c, projectId } = await loadFixture(awardableFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.department.write.defineMilestone([projectId, M1, SPEC_1]),
        janLekha,
        "NotAwarded",
        [projectId],
      );
    });

    it("rejects a zero amount and a zero specification hash", async function () {
      const { janLekha, c, projectId } = await loadFixture(awardedFixture);
      await viem.assertions.revertWithCustomError(
        c.department.write.defineMilestone([projectId, 0n, SPEC_1]),
        janLekha,
        "InvalidAmount",
      );
      await viem.assertions.revertWithCustomError(
        c.department.write.defineMilestone([projectId, M1, zeroHash]),
        janLekha,
        "InvalidDocumentHash",
      );
    });

    it("rejects vendor, inspector, PAO and non-owning departments", async function () {
      const ctx = await loadFixture(awardedFixture);
      const { janLekha, c, wallets, projectId, roles } = ctx;
      for (const [contract, wallet] of [
        [c.vendorA, wallets.vendorA],
        [c.inspector, wallets.inspector],
        [c.pao, wallets.pao],
      ] as const) {
        await expectUnauthorized(ctx, contract.write.defineMilestone([projectId, M1, SPEC_1]), wallet, roles.DEPARTMENT_ROLE);
      }
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.otherDepartment.write.defineMilestone([projectId, M1, SPEC_1]),
        janLekha,
        "NotProjectDepartment",
        [projectId, wallets.otherDepartment.account.address],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("submitMilestoneEvidence", function () {
    it("lets the awarded vendor submit evidence and emits MilestoneEvidenceSubmitted", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(milestonesFixture);
      await viem.assertions.emitWithArgs(
        c.vendorA.write.submitMilestoneEvidence([projectId, 1n, EVIDENCE_1]),
        janLekha,
        "MilestoneEvidenceSubmitted",
        [projectId, 1n, wallets.vendorA.account.address, EVIDENCE_1],
      );
      const m = await janLekha.read.getMilestone([projectId, 1n]);
      assert.equal(m.status, Status.EvidenceSubmitted);
      assert.equal(m.evidenceDocumentHash, EVIDENCE_1);
      assert.equal(m.evidenceSubmittedAt, BigInt(await time.latest()));
      assert.equal((await janLekha.read.getMilestone([projectId, 2n])).status, Status.Defined);
    });

    it("rejects other registered vendors (e.g. the losing bidder)", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(milestonesFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.vendorB.write.submitMilestoneEvidence([projectId, 1n, EVIDENCE_1]),
        janLekha,
        "NotAwardedVendor",
        [projectId, wallets.vendorB.account.address],
      );
    });

    it("rejects inspector, PAO and department (no role substitution)", async function () {
      const ctx = await loadFixture(milestonesFixture);
      const { c, wallets, projectId, roles } = ctx;
      for (const [contract, wallet] of [
        [c.inspector, wallets.inspector],
        [c.pao, wallets.pao],
        [c.department, wallets.department],
      ] as const) {
        await expectUnauthorized(ctx, contract.write.submitMilestoneEvidence([projectId, 1n, EVIDENCE_1]), wallet, roles.VENDOR_ROLE);
      }
    });

    it("rejects the awarded vendor after its VENDOR_ROLE is revoked", async function () {
      const ctx = await loadFixture(milestonesFixture);
      const { janLekha, c, wallets, projectId, roles } = ctx;
      await janLekha.write.revokeRole([roles.VENDOR_ROLE, wallets.vendorA.account.address]);
      await expectUnauthorized(ctx, c.vendorA.write.submitMilestoneEvidence([projectId, 1n, EVIDENCE_1]), wallets.vendorA, roles.VENDOR_ROLE);
    });

    it("accepts evidence only once per milestone", async function () {
      const { janLekha, c, projectId } = await loadFixture(evidenceFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.vendorA.write.submitMilestoneEvidence([projectId, 1n, sha256Hex("replacement")]),
        janLekha,
        "EvidenceAlreadySubmitted",
        [projectId, 1n],
      );
      assert.equal((await janLekha.read.getMilestone([projectId, 1n])).evidenceDocumentHash, EVIDENCE_1);
    });

    it("rejects unknown milestones, unawarded projects and zero hashes", async function () {
      const { janLekha, c, projectId } = await loadFixture(milestonesFixture);
      for (const id of [0n, 3n]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          c.vendorA.write.submitMilestoneEvidence([projectId, id, EVIDENCE_1]),
          janLekha,
          "UnknownMilestone",
          [projectId, id],
        );
      }
      await viem.assertions.revertWithCustomError(
        c.vendorA.write.submitMilestoneEvidence([projectId, 1n, zeroHash]),
        janLekha,
        "InvalidDocumentHash",
      );
      await c.department.write.createProject([SANCTION_HASH, ALLOCATION]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.vendorA.write.submitMilestoneEvidence([2n, 1n, EVIDENCE_1]),
        janLekha,
        "NotAwarded",
        [2n],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("approveMilestone", function () {
    it("requires evidence before approval", async function () {
      const { janLekha, c, projectId } = await loadFixture(milestonesFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.inspector.write.approveMilestone([projectId, 1n, REPORT_1]),
        janLekha,
        "EvidenceNotSubmitted",
        [projectId, 1n],
      );
    });

    it("approves submitted evidence and emits MilestoneApproved", async function () {
      const ctx = await loadFixture(evidenceFixture);
      const { janLekha, c, wallets, projectId } = ctx;
      await viem.assertions.emitWithArgs(
        c.inspector.write.approveMilestone([projectId, 1n, REPORT_1]),
        janLekha,
        "MilestoneApproved",
        [projectId, 1n, wallets.inspector.account.address, REPORT_1],
      );
      const m = await janLekha.read.getMilestone([projectId, 1n]);
      assert.equal(m.status, Status.Approved);
      assert.equal(m.inspector.toLowerCase(), wallets.inspector.account.address);
      assert.equal(m.inspectionReportHash, REPORT_1);
      assert.equal(m.approvedAt, BigInt(await time.latest()));
      await assertBudget(ctx, BID_A, 0n); // approval alone does not move budget
    });

    it("approves only once, including after payment", async function () {
      const { janLekha, c, projectId } = await loadFixture(approvedFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.inspector.write.approveMilestone([projectId, 1n, REPORT_1]),
        janLekha,
        "MilestoneAlreadyApproved",
        [projectId, 1n],
      );
      await c.pao.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]);
      await viem.assertions.revertWithCustomError(
        c.inspector.write.approveMilestone([projectId, 1n, REPORT_1]),
        janLekha,
        "MilestoneAlreadyApproved",
      );
    });

    it("rejects vendor, PAO and department (no role substitution)", async function () {
      const ctx = await loadFixture(evidenceFixture);
      const { c, wallets, projectId, roles } = ctx;
      for (const [contract, wallet] of [
        [c.vendorA, wallets.vendorA],
        [c.pao, wallets.pao],
        [c.department, wallets.department],
      ] as const) {
        await expectUnauthorized(ctx, contract.write.approveMilestone([projectId, 1n, REPORT_1]), wallet, roles.INSPECTOR_ROLE);
      }
    });

    it("blocks the awarded vendor from inspecting its own work even if it holds INSPECTOR_ROLE", async function () {
      const { janLekha, c, wallets, projectId, roles } = await loadFixture(evidenceFixture);
      await janLekha.write.grantRole([roles.INSPECTOR_ROLE, wallets.vendorA.account.address]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.vendorA.write.approveMilestone([projectId, 1n, REPORT_1]),
        janLekha,
        "ConflictOfInterest",
        [wallets.vendorA.account.address],
      );
    });

    it("rejects a zero inspection report hash and unknown milestones", async function () {
      const { janLekha, c, projectId } = await loadFixture(evidenceFixture);
      await viem.assertions.revertWithCustomError(
        c.inspector.write.approveMilestone([projectId, 1n, zeroHash]),
        janLekha,
        "InvalidDocumentHash",
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.inspector.write.approveMilestone([projectId, 3n, REPORT_1]),
        janLekha,
        "UnknownMilestone",
        [projectId, 3n],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("attestMockPayment", function () {
    it("requires approval before attestation (Defined and EvidenceSubmitted both rejected)", async function () {
      const { janLekha, c, projectId } = await loadFixture(evidenceFixture);
      for (const [id, amount] of [[1n, M1], [2n, M2]] as const) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          c.pao.write.attestMockPayment([projectId, id, amount, PAYMENT_REF_1]),
          janLekha,
          "MilestoneNotApproved",
          [projectId, id],
        );
      }
    });

    it("attests the approved amount, moves reserved → paid and emits MockPaymentAttested", async function () {
      const ctx = await loadFixture(approvedFixture);
      const { janLekha, c, wallets, projectId } = ctx;
      await viem.assertions.emitWithArgs(
        c.pao.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]),
        janLekha,
        "MockPaymentAttested",
        [projectId, 1n, wallets.pao.account.address, wallets.vendorA.account.address, M1, PAYMENT_REF_1],
      );
      const m = await janLekha.read.getMilestone([projectId, 1n]);
      assert.equal(m.status, Status.Paid);
      assert.equal(m.pao.toLowerCase(), wallets.pao.account.address);
      assert.equal(m.paymentReferenceHash, PAYMENT_REF_1);
      assert.equal(m.paidAt, BigInt(await time.latest()));
      await assertBudget(ctx, BID_A - M1, M1);
    });

    it("requires the attested amount to equal the approved milestone amount", async function () {
      const ctx = await loadFixture(approvedFixture);
      const { janLekha, c, projectId } = ctx;
      for (const wrong of [M1 - 1n, M1 + 1n, 0n, M2]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          c.pao.write.attestMockPayment([projectId, 1n, wrong, PAYMENT_REF_1]),
          janLekha,
          "PaymentAmountMismatch",
          [M1, wrong],
        );
      }
      await assertBudget(ctx, BID_A, 0n);
    });

    it("allows only one attestation per milestone", async function () {
      const ctx = await loadFixture(approvedFixture);
      const { janLekha, c, projectId } = ctx;
      await c.pao.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.pao.write.attestMockPayment([projectId, 1n, M1, sha256Hex("second advice")]),
        janLekha,
        "PaymentAlreadyAttested",
        [projectId, 1n],
      );
      await assertBudget(ctx, BID_A - M1, M1);
    });

    it("rejects vendor, inspector and department (no role substitution)", async function () {
      const ctx = await loadFixture(approvedFixture);
      const { c, wallets, projectId, roles } = ctx;
      for (const [contract, wallet] of [
        [c.vendorA, wallets.vendorA],
        [c.inspector, wallets.inspector],
        [c.department, wallets.department],
      ] as const) {
        await expectUnauthorized(ctx, contract.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]), wallet, roles.PAO_ROLE);
      }
    });

    it("blocks a PAO who inspected the milestone, or who is the awarded vendor", async function () {
      const { janLekha, c, wallets, projectId, roles } = await loadFixture(approvedFixture);
      await janLekha.write.grantRole([roles.PAO_ROLE, wallets.inspector.account.address]);
      await janLekha.write.grantRole([roles.PAO_ROLE, wallets.vendorA.account.address]);
      for (const [contract, wallet] of [
        [c.inspector, wallets.inspector],
        [c.vendorA, wallets.vendorA],
      ] as const) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          contract.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]),
          janLekha,
          "ConflictOfInterest",
          [wallet.account.address],
        );
      }
      // An independent PAO still can
      await c.pao.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]);
    });

    it("rejects a zero payment reference hash and unknown milestones", async function () {
      const { janLekha, c, projectId } = await loadFixture(approvedFixture);
      await viem.assertions.revertWithCustomError(
        c.pao.write.attestMockPayment([projectId, 1n, M1, zeroHash]),
        janLekha,
        "InvalidDocumentHash",
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        c.pao.write.attestMockPayment([projectId, 9n, M1, PAYMENT_REF_1]),
        janLekha,
        "UnknownMilestone",
        [projectId, 9n],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("end-to-end budget invariants", function () {
    it("keeps reserved + paid == award <= allocation through a fully delivered contract", async function () {
      const ctx = await loadFixture(awardedFixture);
      const { janLekha, c, projectId } = ctx;
      const amounts = [M1, M2, BID_A - M1 - M2]; // milestones exactly fill the award
      let paid = 0n;
      await assertBudget(ctx, BID_A, 0n);

      for (const [i, amount] of amounts.entries()) {
        const id = BigInt(i + 1);
        await c.department.write.defineMilestone([projectId, amount, sha256Hex(`spec ${id}`)]);
        await assertBudget(ctx, BID_A - paid, paid);
        await c.vendorA.write.submitMilestoneEvidence([projectId, id, sha256Hex(`evidence ${id}`)]);
        await assertBudget(ctx, BID_A - paid, paid);
        await c.inspector.write.approveMilestone([projectId, id, sha256Hex(`report ${id}`)]);
        await assertBudget(ctx, BID_A - paid, paid);
        await c.pao.write.attestMockPayment([projectId, id, amount, sha256Hex(`advice ${id}`)]);
        paid += amount;
        await assertBudget(ctx, BID_A - paid, paid);
      }

      const budget = await janLekha.read.getBudget([projectId]);
      assert.equal(budget.paidPaise, BID_A, "total paid == award");
      assert.equal(budget.reservedPaise, 0n);
      assert.ok(budget.paidPaise <= (await janLekha.read.getAward([projectId])).amountPaise);
    });

    it("leaves bid records unchanged by award and delivery", async function () {
      const { janLekha, c, wallets, projectId } = await loadFixture(approvedFixture);
      await c.pao.write.attestMockPayment([projectId, 1n, M1, PAYMENT_REF_1]);
      const bid = await janLekha.read.getBid([projectId, wallets.vendorA.account.address]);
      assert.equal(bid.revealed, true);
      assert.equal(bid.amountPaise, BID_A);
      const tender = await janLekha.read.getTender([projectId]);
      assert.equal(tender.commitCount, 3);
      assert.equal(tender.revealCount, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("getters for unknown ids", function () {
    it("reverts getAward/getBudget for unknown projects and getMilestone for unknown/unawarded", async function () {
      const { janLekha, c, projectId } = await loadFixture(milestonesFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(janLekha.read.getAward([9n]), janLekha, "UnknownProject", [9n]);
      await viem.assertions.revertWithCustomErrorWithArgs(janLekha.read.getBudget([9n]), janLekha, "UnknownProject", [9n]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        janLekha.read.getMilestone([projectId, 0n]),
        janLekha,
        "UnknownMilestone",
        [projectId, 0n],
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        janLekha.read.getMilestone([projectId, 3n]),
        janLekha,
        "UnknownMilestone",
        [projectId, 3n],
      );
      await c.department.write.createProject([SANCTION_HASH, ALLOCATION]);
      await viem.assertions.revertWithCustomErrorWithArgs(janLekha.read.getMilestone([2n, 1n]), janLekha, "NotAwarded", [2n]);
    });
  });
});
