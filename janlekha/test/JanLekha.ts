import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  toHex,
  zeroHash,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const BID_WINDOW = 3_600n;
const REVEAL_WINDOW = 3_600n;
const ALLOCATION = 50_00_000_00n; // ₹50,00,000 in paise

function sha256Hex(text: string): Hex {
  return `0x${createHash("sha256").update(text).digest("hex")}`;
}

function randomSalt(): Hex {
  return toHex(randomBytes(32));
}

function commitmentFor(
  projectId: bigint,
  vendor: Address,
  amountPaise: bigint,
  quotationDocumentHash: Hex,
  salt: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, uint256, bytes32, bytes32"), [
      projectId,
      vendor,
      amountPaise,
      quotationDocumentHash,
      salt,
    ]),
  );
}

const SANCTION_HASH = sha256Hex("synthetic sanction order: ward 12 drainage");
const TENDER_HASH = sha256Hex("synthetic tender notice: ward 12 drainage");

describe("JanLekha", async function () {
  const { viem, networkHelpers } = await network.create();
  const { time, loadFixture } = networkHelpers;

  async function deployFixture() {
    const [admin, department, otherDepartment, vendorA, vendorB, vendorC, outsider] =
      await viem.getWalletClients();
    const janLekha = await viem.deployContract("JanLekha", [admin.account.address]);

    const DEPARTMENT_ROLE = await janLekha.read.DEPARTMENT_ROLE();
    const VENDOR_ROLE = await janLekha.read.VENDOR_ROLE();
    await janLekha.write.grantRole([DEPARTMENT_ROLE, department.account.address]);
    await janLekha.write.grantRole([DEPARTMENT_ROLE, otherDepartment.account.address]);
    await janLekha.write.grantRole([VENDOR_ROLE, vendorA.account.address]);
    await janLekha.write.grantRole([VENDOR_ROLE, vendorB.account.address]);
    await janLekha.write.grantRole([VENDOR_ROLE, vendorC.account.address]);

    const as = (wallet: typeof admin) =>
      viem.getContractAt("JanLekha", janLekha.address, { client: { wallet } });

    return {
      janLekha,
      DEPARTMENT_ROLE,
      VENDOR_ROLE,
      wallets: { admin, department, otherDepartment, vendorA, vendorB, vendorC, outsider },
      asDepartment: await as(department),
      asOtherDepartment: await as(otherDepartment),
      asVendorA: await as(vendorA),
      asVendorB: await as(vendorB),
      asVendorC: await as(vendorC),
      asOutsider: await as(outsider),
    };
  }

  async function projectFixture() {
    const base = await deployFixture();
    await base.asDepartment.write.createProject([SANCTION_HASH, ALLOCATION]);
    return { ...base, projectId: 1n };
  }

  async function tenderFixture() {
    const base = await projectFixture();
    const now = BigInt(await time.latest());
    const bidDeadline = now + BID_WINDOW;
    const revealDeadline = bidDeadline + REVEAL_WINDOW;
    await base.asDepartment.write.publishTender([
      base.projectId,
      TENDER_HASH,
      bidDeadline,
      revealDeadline,
    ]);
    return { ...base, bidDeadline, revealDeadline };
  }

  /** Two vendors commit sealed bids; returns the secrets each vendor keeps for reveal. */
  async function committedFixture() {
    const base = await tenderFixture();
    const { vendorA, vendorB } = base.wallets;
    const bidA = {
      amountPaise: 42_00_000_00n,
      quotationDocumentHash: sha256Hex("vendor A quotation"),
      salt: randomSalt(),
    };
    const bidB = {
      amountPaise: 45_50_000_00n,
      quotationDocumentHash: sha256Hex("vendor B quotation"),
      salt: randomSalt(),
    };
    const commitmentA = commitmentFor(
      base.projectId,
      vendorA.account.address,
      bidA.amountPaise,
      bidA.quotationDocumentHash,
      bidA.salt,
    );
    const commitmentB = commitmentFor(
      base.projectId,
      vendorB.account.address,
      bidB.amountPaise,
      bidB.quotationDocumentHash,
      bidB.salt,
    );
    await base.asVendorA.write.commitBid([base.projectId, commitmentA]);
    await base.asVendorB.write.commitBid([base.projectId, commitmentB]);
    return { ...base, bidA, bidB, commitmentA, commitmentB };
  }

  // ═══════════════════════════════════════════════════════════════════════
  describe("deployment and roles", function () {
    it("grants DEFAULT_ADMIN_ROLE to the constructor admin only", async function () {
      const { janLekha, wallets } = await loadFixture(deployFixture);
      const adminRole = await janLekha.read.DEFAULT_ADMIN_ROLE();
      assert.equal(await janLekha.read.hasRole([adminRole, wallets.admin.account.address]), true);
      assert.equal(
        await janLekha.read.hasRole([adminRole, wallets.department.account.address]),
        false,
      );
      assert.equal(await janLekha.read.projectCount(), 0n);
    });

    it("exposes role identifiers as keccak256 of their names", async function () {
      const { janLekha } = await loadFixture(deployFixture);
      for (const name of ["DEPARTMENT_ROLE", "VENDOR_ROLE", "INSPECTOR_ROLE", "PAO_ROLE"] as const) {
        assert.equal(await janLekha.read[name](), keccak256(toHex(name)));
      }
    });

    it("rejects a zero admin address", async function () {
      const { janLekha } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(
        viem.deployContract("JanLekha", [zeroAddress]),
        janLekha,
        "ZeroAddress",
      );
    });

    it("only the admin can assign roles", async function () {
      const { janLekha, asOutsider, wallets, VENDOR_ROLE } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asOutsider.write.grantRole([VENDOR_ROLE, wallets.outsider.account.address]),
        janLekha,
        "AccessControlUnauthorizedAccount",
        [wallets.outsider.account.address, await janLekha.read.DEFAULT_ADMIN_ROLE()],
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("createProject", function () {
    it("stores the project and emits ProjectCreated", async function () {
      const { janLekha, asDepartment, wallets } = await loadFixture(deployFixture);

      await viem.assertions.emitWithArgs(
        asDepartment.write.createProject([SANCTION_HASH, ALLOCATION]),
        janLekha,
        "ProjectCreated",
        [1n, wallets.department.account.address, SANCTION_HASH, ALLOCATION],
      );

      const project = await janLekha.read.getProject([1n]);
      assert.equal(project.id, 1n);
      assert.equal(project.department.toLowerCase(), wallets.department.account.address);
      assert.equal(project.sanctionDocumentHash, SANCTION_HASH);
      assert.equal(project.allocationPaise, ALLOCATION);
      assert.equal(project.createdAt, BigInt(await time.latest()));
      assert.equal(await janLekha.read.projectCount(), 1n);
    });

    it("assigns sequential project ids", async function () {
      const { janLekha, asDepartment, asOtherDepartment } = await loadFixture(deployFixture);
      await asDepartment.write.createProject([SANCTION_HASH, ALLOCATION]);
      await asOtherDepartment.write.createProject([sha256Hex("second"), 1n]);
      assert.equal(await janLekha.read.projectCount(), 2n);
      assert.equal((await janLekha.read.getProject([2n])).allocationPaise, 1n);
    });

    it("rejects callers without DEPARTMENT_ROLE", async function () {
      const { janLekha, asVendorA, asOutsider, wallets, DEPARTMENT_ROLE } =
        await loadFixture(deployFixture);
      for (const [contract, wallet] of [
        [asVendorA, wallets.vendorA],
        [asOutsider, wallets.outsider],
      ] as const) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          contract.write.createProject([SANCTION_HASH, ALLOCATION]),
          janLekha,
          "AccessControlUnauthorizedAccount",
          [wallet.account.address, DEPARTMENT_ROLE],
        );
      }
    });

    it("rejects a zero sanction hash and zero allocation", async function () {
      const { janLekha, asDepartment } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(
        asDepartment.write.createProject([zeroHash, ALLOCATION]),
        janLekha,
        "InvalidDocumentHash",
      );
      await viem.assertions.revertWithCustomError(
        asDepartment.write.createProject([SANCTION_HASH, 0n]),
        janLekha,
        "InvalidAllocation",
      );
    });

    it("reverts getters for unknown project ids", async function () {
      const { janLekha, wallets } = await loadFixture(projectFixture);
      for (const id of [0n, 2n, 999n]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          janLekha.read.getProject([id]),
          janLekha,
          "UnknownProject",
          [id],
        );
      }
      await viem.assertions.revertWithCustomError(
        janLekha.read.getTender([2n]),
        janLekha,
        "UnknownProject",
      );
      await viem.assertions.revertWithCustomError(
        janLekha.read.getBid([2n, wallets.vendorA.account.address]),
        janLekha,
        "UnknownProject",
      );
      await viem.assertions.revertWithCustomError(
        janLekha.read.getBidders([2n]),
        janLekha,
        "UnknownProject",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("publishTender", function () {
    it("stores the tender and emits TenderPublished", async function () {
      const { janLekha, asDepartment, projectId } = await loadFixture(projectFixture);
      const now = BigInt(await time.latest());
      const bidDeadline = now + BID_WINDOW;
      const revealDeadline = bidDeadline + REVEAL_WINDOW;

      await viem.assertions.emitWithArgs(
        asDepartment.write.publishTender([projectId, TENDER_HASH, bidDeadline, revealDeadline]),
        janLekha,
        "TenderPublished",
        [projectId, TENDER_HASH, bidDeadline, revealDeadline],
      );

      const tender = await janLekha.read.getTender([projectId]);
      assert.equal(tender.tenderDocumentHash, TENDER_HASH);
      assert.equal(tender.bidDeadline, bidDeadline);
      assert.equal(tender.revealDeadline, revealDeadline);
      assert.equal(tender.publishedAt, BigInt(await time.latest()));
      assert.equal(tender.commitCount, 0);
      assert.equal(tender.revealCount, 0);
    });

    it("returns an unpublished (zeroed) tender before publication", async function () {
      const { janLekha, projectId } = await loadFixture(projectFixture);
      const tender = await janLekha.read.getTender([projectId]);
      assert.equal(tender.publishedAt, 0n);
      assert.equal(tender.tenderDocumentHash, zeroHash);
    });

    it("rejects callers without DEPARTMENT_ROLE", async function () {
      const { janLekha, asVendorA, wallets, projectId, DEPARTMENT_ROLE } =
        await loadFixture(projectFixture);
      const now = BigInt(await time.latest());
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.publishTender([projectId, TENDER_HASH, now + 100n, now + 200n]),
        janLekha,
        "AccessControlUnauthorizedAccount",
        [wallets.vendorA.account.address, DEPARTMENT_ROLE],
      );
    });

    it("rejects a department that does not own the project", async function () {
      const { janLekha, asOtherDepartment, wallets, projectId } =
        await loadFixture(projectFixture);
      const now = BigInt(await time.latest());
      await viem.assertions.revertWithCustomErrorWithArgs(
        asOtherDepartment.write.publishTender([projectId, TENDER_HASH, now + 100n, now + 200n]),
        janLekha,
        "NotProjectDepartment",
        [projectId, wallets.otherDepartment.account.address],
      );
    });

    it("rejects an unknown project", async function () {
      const { janLekha, asDepartment } = await loadFixture(projectFixture);
      const now = BigInt(await time.latest());
      await viem.assertions.revertWithCustomErrorWithArgs(
        asDepartment.write.publishTender([7n, TENDER_HASH, now + 100n, now + 200n]),
        janLekha,
        "UnknownProject",
        [7n],
      );
    });

    it("allows only one tender per project", async function () {
      const { janLekha, asDepartment, projectId } = await loadFixture(tenderFixture);
      const now = BigInt(await time.latest());
      await viem.assertions.revertWithCustomErrorWithArgs(
        asDepartment.write.publishTender([projectId, sha256Hex("v2"), now + 100n, now + 200n]),
        janLekha,
        "TenderAlreadyPublished",
        [projectId],
      );
    });

    it("rejects a zero tender document hash", async function () {
      const { janLekha, asDepartment, projectId } = await loadFixture(projectFixture);
      const now = BigInt(await time.latest());
      await viem.assertions.revertWithCustomError(
        asDepartment.write.publishTender([projectId, zeroHash, now + 100n, now + 200n]),
        janLekha,
        "InvalidDocumentHash",
      );
    });

    it("requires bidDeadline strictly in the future (boundary)", async function () {
      const { janLekha, asDepartment, projectId } = await loadFixture(projectFixture);
      const t = BigInt(await time.latest()) + 10n;

      await time.setNextBlockTimestamp(t);
      await viem.assertions.revertWithCustomError(
        asDepartment.write.publishTender([projectId, TENDER_HASH, t, t + 100n]),
        janLekha,
        "InvalidDeadlines",
      );
      await viem.assertions.revertWithCustomError(
        asDepartment.write.publishTender([projectId, TENDER_HASH, t - 5n, t + 100n]),
        janLekha,
        "InvalidDeadlines",
      );

      const t2 = BigInt(await time.latest()) + 10n;
      await time.setNextBlockTimestamp(t2);
      await asDepartment.write.publishTender([projectId, TENDER_HASH, t2 + 1n, t2 + 2n]);
      assert.equal((await janLekha.read.getTender([projectId])).bidDeadline, t2 + 1n);
    });

    it("requires revealDeadline strictly after bidDeadline", async function () {
      const { janLekha, asDepartment, projectId } = await loadFixture(projectFixture);
      const bid = BigInt(await time.latest()) + 1_000n;
      for (const reveal of [bid, bid - 1n]) {
        await viem.assertions.revertWithCustomError(
          asDepartment.write.publishTender([projectId, TENDER_HASH, bid, reveal]),
          janLekha,
          "InvalidDeadlines",
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("commitBid", function () {
    it("records sealed commitments from two vendors and emits BidCommitted", async function () {
      const { janLekha, asVendorA, asVendorB, wallets, projectId } =
        await loadFixture(tenderFixture);
      const cA = keccak256(toHex("a"));
      const cB = keccak256(toHex("b"));

      await viem.assertions.emitWithArgs(
        asVendorA.write.commitBid([projectId, cA]),
        janLekha,
        "BidCommitted",
        [projectId, wallets.vendorA.account.address, cA],
      );
      await asVendorB.write.commitBid([projectId, cB]);

      const bid = await janLekha.read.getBid([projectId, wallets.vendorA.account.address]);
      assert.equal(bid.commitment, cA);
      assert.equal(bid.committedAt, BigInt(await time.latest()) - 1n);
      assert.equal(bid.revealed, false);
      assert.equal(bid.amountPaise, 0n, "amount stays sealed before reveal");
      assert.equal(bid.quotationDocumentHash, zeroHash);

      const bidders = (await janLekha.read.getBidders([projectId])).map((a) => a.toLowerCase());
      assert.deepEqual(bidders, [wallets.vendorA.account.address, wallets.vendorB.account.address]);
      assert.equal((await janLekha.read.getTender([projectId])).commitCount, 2);
    });

    it("rejects callers without VENDOR_ROLE", async function () {
      const { janLekha, asDepartment, asOutsider, wallets, projectId, VENDOR_ROLE } =
        await loadFixture(tenderFixture);
      for (const [contract, wallet] of [
        [asDepartment, wallets.department],
        [asOutsider, wallets.outsider],
      ] as const) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          contract.write.commitBid([projectId, keccak256(toHex("x"))]),
          janLekha,
          "AccessControlUnauthorizedAccount",
          [wallet.account.address, VENDOR_ROLE],
        );
      }
    });

    it("rejects an unknown project and an unpublished tender", async function () {
      const { janLekha, asVendorA, projectId } = await loadFixture(projectFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.commitBid([5n, keccak256(toHex("x"))]),
        janLekha,
        "UnknownProject",
        [5n],
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.commitBid([projectId, keccak256(toHex("x"))]),
        janLekha,
        "TenderNotPublished",
        [projectId],
      );
    });

    it("allows only one commitment per vendor per project", async function () {
      const { janLekha, asVendorA, wallets, projectId } = await loadFixture(tenderFixture);
      await asVendorA.write.commitBid([projectId, keccak256(toHex("first"))]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.commitBid([projectId, keccak256(toHex("second"))]),
        janLekha,
        "AlreadyCommitted",
        [projectId, wallets.vendorA.account.address],
      );
      assert.equal(
        (await janLekha.read.getBid([projectId, wallets.vendorA.account.address])).commitment,
        keccak256(toHex("first")),
      );
    });

    it("rejects a zero commitment", async function () {
      const { janLekha, asVendorA, projectId } = await loadFixture(tenderFixture);
      await viem.assertions.revertWithCustomError(
        asVendorA.write.commitBid([projectId, zeroHash]),
        janLekha,
        "InvalidCommitment",
      );
    });

    it("accepts commitments until one second before bidDeadline", async function () {
      const { janLekha, asVendorA, projectId, bidDeadline } = await loadFixture(tenderFixture);
      await time.setNextBlockTimestamp(bidDeadline - 1n);
      await asVendorA.write.commitBid([projectId, keccak256(toHex("x"))]);
      assert.equal((await janLekha.read.getTender([projectId])).commitCount, 1);
    });

    it("rejects commitments at and after bidDeadline", async function () {
      const { janLekha, asVendorA, asVendorB, projectId, bidDeadline } =
        await loadFixture(tenderFixture);
      await time.setNextBlockTimestamp(bidDeadline);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.commitBid([projectId, keccak256(toHex("x"))]),
        janLekha,
        "BiddingClosed",
        [projectId],
      );
      await time.increaseTo(bidDeadline + 500n);
      await viem.assertions.revertWithCustomError(
        asVendorB.write.commitBid([projectId, keccak256(toHex("y"))]),
        janLekha,
        "BiddingClosed",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("revealBid", function () {
    it("reveals both sealed bids after the bid deadline (happy path)", async function () {
      const { janLekha, asVendorA, asVendorB, wallets, projectId, bidA, bidB, bidDeadline } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);

      await viem.assertions.emitWithArgs(
        asVendorA.write.revealBid([projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "BidRevealed",
        [projectId, wallets.vendorA.account.address, bidA.amountPaise, bidA.quotationDocumentHash],
      );
      const revealedAt = BigInt(await time.latest());
      await asVendorB.write.revealBid([
        projectId,
        bidB.amountPaise,
        bidB.quotationDocumentHash,
        bidB.salt,
      ]);

      const a = await janLekha.read.getBid([projectId, wallets.vendorA.account.address]);
      assert.equal(a.revealed, true);
      assert.equal(a.revealedAt, revealedAt);
      assert.equal(a.amountPaise, bidA.amountPaise);
      assert.equal(a.quotationDocumentHash, bidA.quotationDocumentHash);

      const tender = await janLekha.read.getTender([projectId]);
      assert.equal(tender.commitCount, 2);
      assert.equal(tender.revealCount, 2);
    });

    it("opens exactly at bidDeadline and rejects one second earlier", async function () {
      const { janLekha, asVendorA, projectId, bidA, bidDeadline } =
        await loadFixture(committedFixture);
      const args = [projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt] as const;

      await time.setNextBlockTimestamp(bidDeadline - 1n);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.revealBid([...args]),
        janLekha,
        "RevealNotOpen",
        [projectId],
      );
      await time.setNextBlockTimestamp(bidDeadline);
      await asVendorA.write.revealBid([...args]);
    });

    it("closes exactly at revealDeadline and accepts one second earlier", async function () {
      const { janLekha, asVendorA, asVendorB, projectId, bidA, bidB, revealDeadline } =
        await loadFixture(committedFixture);

      await time.setNextBlockTimestamp(revealDeadline - 1n);
      await asVendorA.write.revealBid([
        projectId,
        bidA.amountPaise,
        bidA.quotationDocumentHash,
        bidA.salt,
      ]);
      await time.setNextBlockTimestamp(revealDeadline);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorB.write.revealBid([projectId, bidB.amountPaise, bidB.quotationDocumentHash, bidB.salt]),
        janLekha,
        "RevealClosed",
        [projectId],
      );
    });

    it("rejects a wrong amount, document hash or salt", async function () {
      const { janLekha, asVendorA, projectId, bidA, bidDeadline } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);

      const wrongInputs = [
        [bidA.amountPaise - 1n, bidA.quotationDocumentHash, bidA.salt],
        [bidA.amountPaise, sha256Hex("tampered quotation"), bidA.salt],
        [bidA.amountPaise, bidA.quotationDocumentHash, randomSalt()],
      ] as const;
      for (const [amount, doc, salt] of wrongInputs) {
        await viem.assertions.revertWithCustomError(
          asVendorA.write.revealBid([projectId, amount, doc, salt]),
          janLekha,
          "CommitmentMismatch",
        );
      }
      // Correct values still work after failed attempts
      await asVendorA.write.revealBid([
        projectId,
        bidA.amountPaise,
        bidA.quotationDocumentHash,
        bidA.salt,
      ]);
    });

    it("binds the commitment to the committing vendor", async function () {
      const { janLekha, asVendorB, projectId, bidA, bidDeadline } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);
      // Vendor B replaying vendor A's secrets cannot match B's own commitment
      await viem.assertions.revertWithCustomError(
        asVendorB.write.revealBid([projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "CommitmentMismatch",
      );
    });

    it("binds the commitment to the project id", async function () {
      const { janLekha, asDepartment, asVendorA, wallets, bidA } =
        await loadFixture(committedFixture);
      // Second project whose commitment was computed for project 1
      await asDepartment.write.createProject([SANCTION_HASH, ALLOCATION]);
      const now = BigInt(await time.latest());
      await asDepartment.write.publishTender([2n, TENDER_HASH, now + 100n, now + 200n]);
      const forProjectOne = commitmentFor(
        1n,
        wallets.vendorA.account.address,
        bidA.amountPaise,
        bidA.quotationDocumentHash,
        bidA.salt,
      );
      await asVendorA.write.commitBid([2n, forProjectOne]);
      await time.increaseTo(now + 100n);
      await viem.assertions.revertWithCustomError(
        asVendorA.write.revealBid([2n, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "CommitmentMismatch",
      );
    });

    it("rejects a second reveal", async function () {
      const { janLekha, asVendorA, wallets, projectId, bidA, bidDeadline } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);
      const args = [projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt] as const;
      await asVendorA.write.revealBid([...args]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.revealBid([...args]),
        janLekha,
        "AlreadyRevealed",
        [projectId, wallets.vendorA.account.address],
      );
      assert.equal((await janLekha.read.getTender([projectId])).revealCount, 1);
    });

    it("rejects a vendor without a commitment", async function () {
      const { janLekha, asVendorC, wallets, projectId, bidA, bidDeadline } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorC.write.revealBid([projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "NoCommitment",
        [projectId, wallets.vendorC.account.address],
      );
    });

    it("rejects zero amount and zero document hash even if committed", async function () {
      const { janLekha, asVendorC, wallets, projectId, bidDeadline } =
        await loadFixture(tenderFixture);
      const salt = randomSalt();
      const vendor = wallets.vendorC.account.address;
      // A single commitment is enough: both checks fire before the hash comparison
      await asVendorC.write.commitBid([projectId, commitmentFor(projectId, vendor, 0n, zeroHash, salt)]);
      await time.increaseTo(bidDeadline);
      await viem.assertions.revertWithCustomError(
        asVendorC.write.revealBid([projectId, 0n, sha256Hex("q"), salt]),
        janLekha,
        "InvalidAmount",
      );
      await viem.assertions.revertWithCustomError(
        asVendorC.write.revealBid([projectId, 1n, zeroHash, salt]),
        janLekha,
        "InvalidDocumentHash",
      );
    });

    it("rejects callers without VENDOR_ROLE, including revoked vendors", async function () {
      const { janLekha, asDepartment, asVendorA, wallets, projectId, bidA, bidDeadline, VENDOR_ROLE } =
        await loadFixture(committedFixture);
      await time.increaseTo(bidDeadline);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asDepartment.write.revealBid([projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "AccessControlUnauthorizedAccount",
        [wallets.department.account.address, VENDOR_ROLE],
      );

      await janLekha.write.revokeRole([VENDOR_ROLE, wallets.vendorA.account.address]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.revealBid([projectId, bidA.amountPaise, bidA.quotationDocumentHash, bidA.salt]),
        janLekha,
        "AccessControlUnauthorizedAccount",
        [wallets.vendorA.account.address, VENDOR_ROLE],
      );
    });

    it("rejects an unknown project and an unpublished tender", async function () {
      const { janLekha, asVendorA, projectId } = await loadFixture(projectFixture);
      const salt = randomSalt();
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.revealBid([9n, 1n, sha256Hex("q"), salt]),
        janLekha,
        "UnknownProject",
        [9n],
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        asVendorA.write.revealBid([projectId, 1n, sha256Hex("q"), salt]),
        janLekha,
        "TenderNotPublished",
        [projectId],
      );
    });
  });
});
