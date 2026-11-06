import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";

export const RPC_URL = "http://127.0.0.1:8546";
/** First CREATE from Hardhat account #0 on a fresh node; inlined into the e2e build. */
export const EXPECTED_CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const ROLE_ORDER = ["admin", "department", "vendorA", "vendorB", "inspector", "pao", "citizen"] as const;
export type Actor = (typeof ROLE_ORDER)[number];

/** Test actors, taken from the node's own unlocked dev accounts (filled in by deployContract). */
export const ACCOUNTS = {} as Record<Actor, Address>;

async function loadAccounts() {
  const accounts = await rpc<string[]>("eth_accounts");
  ROLE_ORDER.forEach((name, i) => (ACCOUNTS[name] = getAddress(accounts[i])));
}

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw Object.assign(new Error(body.error.message), body.error);
  return body.result as T;
}

let deployedContract: Address | null = null;

/** Deploys JanLekha from the admin account and grants the synthetic demo roles. */
export async function deployContract(): Promise<Address> {
  await loadAccounts();
  const artifact = JSON.parse(await readFile("artifacts/contracts/JanLekha.sol/JanLekha.json", "utf8")) as {
    abi: Abi;
    bytecode: Hex;
  };
  const transport = http(RPC_URL);
  const wallet = createWalletClient({ transport, account: ACCOUNTS.admin, chain: hardhat });
  const client = createPublicClient({ transport, chain: hardhat });

  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [ACCOUNTS.admin] });
  const { contractAddress } = await client.waitForTransactionReceipt({ hash });
  expect(contractAddress?.toLowerCase(), "fresh node must deploy at the address inlined into the build").toBe(EXPECTED_CONTRACT.toLowerCase());

  const grants: [string, Address][] = [
    ["DEPARTMENT_ROLE", ACCOUNTS.department],
    ["VENDOR_ROLE", ACCOUNTS.vendorA],
    ["VENDOR_ROLE", ACCOUNTS.vendorB],
    ["INSPECTOR_ROLE", ACCOUNTS.inspector],
    ["PAO_ROLE", ACCOUNTS.pao],
  ];
  for (const [role, account] of grants) {
    const tx = await wallet.writeContract({
      address: contractAddress!,
      abi: parseAbi(["function grantRole(bytes32 role, address account)"]),
      functionName: "grantRole",
      args: [keccak256(toHex(role)), account],
    });
    await client.waitForTransactionReceipt({ hash: tx });
  }
  deployedContract = contractAddress!;
  return contractAddress!;
}

/** Admin action outside the UI, e.g. to make the UI's cached view of a role stale. */
export async function revokeRole(role: string, account: Address) {
  const transport = http(RPC_URL);
  const wallet = createWalletClient({ transport, account: ACCOUNTS.admin, chain: hardhat });
  const client = createPublicClient({ transport, chain: hardhat });
  if (!deployedContract) throw new Error("deployContract() must run first");
  const contract = deployedContract;
  const hash = await wallet.writeContract({
    address: contract,
    abi: parseAbi(["function revokeRole(bytes32 role, address account)"]),
    functionName: "revokeRole",
    args: [keccak256(toHex(role)), account],
  });
  await client.waitForTransactionReceipt({ hash });
}

export async function latestChainTime(): Promise<number> {
  const block = await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]);
  return Number(BigInt(block.timestamp));
}

export async function advanceChainTime(seconds: number) {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
}

/** Installs the test wallet into every page of the context. */
export async function installWallet(page: Page) {
  // Return errors as data: exposed functions only carry an error's message, not its JSON-RPC code.
  await page.context().exposeFunction("__e2eRpc", async (method: string, params: unknown[]) => {
    try {
      return { result: await rpc(method, params) };
    } catch (error) {
      const e = error as { code?: number; message: string; data?: unknown };
      return { error: { code: e.code ?? -32603, message: e.message, data: e.data } };
    }
  });
  await page.context().addInitScript({ path: "e2e/fixtures/injected-wallet.js" });
}

/** Selects the wallet account and connects it through the app's own connect button. */
export async function actAs(page: Page, account: Address) {
  await page.evaluate((a) => (window as unknown as { __wallet: { setAccount(a: string): void } }).__wallet.setAccount(a), account);
  const connect = page.getByRole("button", { name: "Connect wallet" });
  if (await connect.isVisible()) await connect.click();
  await expect(page.getByTestId("wallet-address")).toHaveAttribute("title", account);
}

let pdfCounter = 0;
/** Minimal valid synthetic PDF with unique content. */
export function syntheticPdf(label: string) {
  const text = `SYNTHETIC JanLekha e2e document: ${label} #${++pdfCounter}`;
  const body = `%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
  return { name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(body) };
}

/** Attaches a public (stored) document inside the DocumentInput identified by testId. */
export async function attachPublicDoc(page: Page, testId: string, label: string) {
  const box = page.getByTestId(testId);
  await box.getByRole("checkbox").check();
  await box.locator('input[type="file"]').setInputFiles(syntheticPdf(label));
  await expect(box.getByTestId(`${testId}-hash`)).toBeVisible();
}

async function newestTx(page: Page): Promise<{ id: number; status: string } | null> {
  const entry = page.getByTestId("tx-entry").first();
  if ((await entry.count()) === 0) return null;
  return { id: Number(await entry.getAttribute("data-tx-id")), status: (await entry.getAttribute("data-status")) ?? "" };
}

/** Clicks a submit button and waits until that transaction's receipt confirms it (never assumed). */
export async function submit(page: Page, card: string, button: string, expected: "confirmed" | "failed" = "confirmed") {
  const before = (await newestTx(page))?.id ?? 0;
  await page.getByTestId(card).getByRole("button", { name: button }).click();
  await expect
    .poll(async () => {
      const tx = await newestTx(page);
      return tx && tx.id > before && ["confirmed", "failed"].includes(tx.status) ? tx.status : "in-flight";
    }, { timeout: 60_000 })
    .toBe(expected);
}
