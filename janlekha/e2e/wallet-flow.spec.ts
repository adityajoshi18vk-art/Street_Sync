import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  actAs,
  advanceChainTime,
  attachPublicDoc,
  deployContract,
  installWallet,
  revokeRole,
  submit,
  syntheticPdf,
  type Actor,
} from "./helpers.js";

const DAY = 86_400;

test.describe.serial("JanLekha wallet writes", () => {
  let page: Page;
  const backups: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    await deployContract();
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await installWallet(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  async function sealAndCommit(vendor: Actor, amount: string) {
    await actAs(page, ACCOUNTS[vendor]);
    const card = page.getByTestId("commit-bid");
    await card.getByTestId("quotation-doc").locator('input[type="file"]').setInputFiles(syntheticPdf(`quotation ${vendor}`));
    await card.getByTestId("bid-amount").fill(amount);
    await card.getByRole("button", { name: "Seal bid" }).click();
    await expect(card.getByTestId("sealed-commitment")).toBeVisible();

    // Committing stays disabled until the backup has been exported.
    await expect(card.getByRole("button", { name: "Commit sealed bid" })).toBeDisabled();
    await expect(card.getByTestId("blocked-reason")).toContainText("Download the bid backup");
    const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Download bid backup/ }).click()]);
    backups[vendor] = test.info().outputPath(`${vendor}-backup.json`);
    await download.saveAs(backups[vendor]);

    await submit(page, "commit-bid", "Commit sealed bid");
  }

  test("public pages need no wallet, and a wrong network blocks writes", async () => {
    await page.goto("/projects");
    await expect(page.getByText("No projects have been recorded")).toBeVisible();
    await page.getByText("Department tools: create a project").click();
    await expect(page.getByTestId("create-project").getByTestId("blocked-reason")).toContainText("Connect a wallet");

    // Connecting asks the wallet to switch to the app chain; then the user moves the wallet to another network.
    await actAs(page, ACCOUNTS.department);
    await expect(page.getByTestId("wallet-network")).toContainText("Local development chain (31337)");
    await page.evaluate(() => (window as unknown as { __wallet: { setChain(id: number): void } }).__wallet.setChain(296));
    await expect(page.getByTestId("wallet-network")).toContainText("Wrong network (chain 296)");
    await expect(page.getByTestId("create-project").getByTestId("blocked-reason")).toContainText("Wrong network");
    await page.getByRole("button", { name: /Switch to Local development chain/ }).click();
    await expect(page.getByTestId("wallet-network")).toContainText("Local development chain (31337)");
    await expect(page.getByTestId("wallet-roles")).toHaveText("Department");
  });

  test("department creates a project and publishes its tender", async () => {
    const card = page.getByTestId("create-project");
    await expect(card.getByTestId("blocked-reason")).toContainText("sanction order");
    await attachPublicDoc(page, "sanction-doc", "sanction order");
    await card.getByTestId("allocation-input").fill("50,00,000");
    await card.getByRole("button", { name: "Create project" }).click();

    // Navigation happens only after the receipt confirms the transaction.
    await page.waitForURL("**/projects/1");
    await expect(page.getByText("₹50,00,000.00").first()).toBeVisible();
    await expect(page.getByText("No tender has been published")).toBeVisible();

    await attachPublicDoc(page, "tender-doc", "tender notice");
    await submit(page, "publish-tender", "Publish tender");
    await expect(page.getByText("0 committed · 0 revealed")).toBeVisible();
  });

  test("vendors commit sealed bids after exporting their salt backups", async () => {
    await sealAndCommit("vendorA", "42,00,000");
    await expect(page.getByText("1 committed · 0 revealed")).toBeVisible();
    await sealAndCommit("vendorB", "45,50,000");
    await expect(page.getByText("2 committed · 0 revealed")).toBeVisible();

    const backup = JSON.parse(await readFile(backups.vendorB, "utf8"));
    expect(backup.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(backup.amountPaise).toBe("455000000");
    // Amounts stay sealed on the public page.
    await expect(page.getByText("₹45,50,000.00")).toHaveCount(0);
  });

  test("a tampered backup is blocked, and a contract-rejected reveal fails without changing state", async () => {
    await advanceChainTime(DAY + 120);
    await page.reload();
    await actAs(page, ACCOUNTS.vendorB);

    const tampered = JSON.parse(await readFile(backups.vendorB, "utf8"));
    tampered.amountPaise = "400000000"; // claims ₹40,00,000 instead of the committed ₹45,50,000
    const tamperedPath = test.info().outputPath("vendorB-tampered.json");
    await writeFile(tamperedPath, JSON.stringify(tampered));
    // Client-only line (localStorage): proves the reveal card has hydrated before a file is chosen.
    await expect(page.getByTestId("active-backup")).toContainText("saved in this browser: ₹45,50,000.00");
    await page.getByTestId("reveal-bid").getByTestId("backup-import").setInputFiles(tamperedPath);
    await expect(page.getByTestId("active-backup")).toContainText("imported file: ₹40,00,000.00");
    // The commitment is recomputed from the file's values, so tampering is caught before anything is sent.
    const reveal = page.getByTestId("reveal-bid");
    await expect(reveal.getByRole("button", { name: "Reveal bid" })).toBeDisabled();
    await expect(reveal.getByTestId("blocked-reason")).toContainText("does not match your sealed bid on-chain");

    // Failed transaction: the role is revoked on-chain after the page read it, so the UI still allows the
    // click and the contract rejects it in the pre-flight check.
    await reveal.getByTestId("backup-import").setInputFiles(backups.vendorB);
    await expect(page.getByTestId("active-backup")).toContainText("imported file: ₹45,50,000.00");
    await revokeRole("VENDOR_ROLE", ACCOUNTS.vendorB);
    await submit(page, "reveal-bid", "Reveal bid", "failed");
    const status = reveal.getByTestId("tx-status");
    await expect(status).toHaveAttribute("data-stage", "preflight");
    await expect(status).toContainText("does not hold the role");
    await expect(status).toContainText("Nothing was sent");

    await page.reload();
    await expect(page.getByText("2 committed · 0 revealed")).toBeVisible();
    await expect(page.getByText("Bid revealed")).toHaveCount(0);
  });

  test("vendor reveals, department awards and defines a milestone", async () => {
    await actAs(page, ACCOUNTS.vendorA);
    await expect(page.getByTestId("active-backup")).toContainText("saved in this browser: ₹42,00,000.00");
    await submit(page, "reveal-bid", "Reveal bid");
    await expect(page.getByText("2 committed · 1 revealed")).toBeVisible();

    await advanceChainTime(DAY);
    await page.reload();
    await actAs(page, ACCOUNTS.department);
    const award = page.getByTestId("award");
    await expect(award.getByRole("radio")).toHaveCount(1); // only the revealed bid is eligible
    await award.getByRole("radio").check();
    await attachPublicDoc(page, "evaluation-doc", "evaluation report");
    await attachPublicDoc(page, "contract-doc", "contract agreement");
    await submit(page, "award", "Record award");
    await expect(page.getByText("Award amount (from revealed bid)")).toBeVisible();

    await page.getByTestId("define-milestone").getByTestId("milestone-amount").fill("12,00,000");
    await attachPublicDoc(page, "spec-doc", "milestone 1 spec");
    await submit(page, "define-milestone", "Define milestone");
    await expect(page.getByText("Milestone 1 · ₹12,00,000.00")).toBeVisible();
    // The form resets after confirmation, so the same milestone cannot be submitted twice by accident.
    await expect(page.getByTestId("define-milestone").getByTestId("milestone-amount")).toHaveValue("");
    await expect(page.getByTestId("define-milestone").getByTestId("blocked-reason")).toContainText("Enter the milestone amount");
  });

  test("evidence, inspection approval and mock PFMS attestation", async () => {
    await actAs(page, ACCOUNTS.vendorA);
    await attachPublicDoc(page, "evidence-doc-1", "milestone 1 evidence");
    await submit(page, "evidence-1", "Submit evidence");

    // The vendor cannot approve its own milestone; the reason is shown.
    const approve = page.getByTestId("approve-1");
    await expect(approve.getByTestId("blocked-reason")).toContainText("does not hold Inspector role");

    await actAs(page, ACCOUNTS.inspector);
    await attachPublicDoc(page, "inspection-doc-1", "milestone 1 inspection");
    await submit(page, "approve-1", "Approve milestone");

    await actAs(page, ACCOUNTS.pao);
    await expect(page.getByTestId("attest-1")).toContainText("₹12,00,000.00");
    await attachPublicDoc(page, "payment-doc-1", "mock pfms advice");
    await submit(page, "attest-1", "Record mock PFMS attestation");

    await expect(page.getByText("Mock PFMS payment attested").first()).toBeVisible();
    await expect(page.getByText("Milestone 1: mock PFMS payment attested")).toBeVisible();

    // Fresh, wallet-free read of the public record.
    await page.goto("/projects/1");
    for (const amount of ["₹50,00,000.00", "₹30,00,000.00", "₹12,00,000.00", "₹8,00,000.00"]) {
      await expect(page.getByText(amount).first()).toBeVisible();
    }
    for (const event of ["Project created", "Tender published", "Contract awarded", "Milestone 1 approved by inspector"]) {
      await expect(page.getByText(event).first()).toBeVisible();
    }
  });
});
