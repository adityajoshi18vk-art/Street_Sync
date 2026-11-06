/**
 * Smoke test for a deployed JanLekha instance.
 *
 *   npm run contracts:smoke:hedera
 *   npm run contracts:smoke:local
 *
 * 1. Reads public state (code present, roles, projectCount).
 * 2. Sends one harmless createProject() with a clearly synthetic sanction hash.
 * 3. Reads the project back through a wallet-less public client and checks every field.
 */
import { network } from "hardhat";
import { createPublicClient, decodeEventLog, getAddress, http } from "viem";

import {
  CONTRACT_NAME,
  assertEcdsaKeyFormat,
  requireArtifact,
  sha256Hex,
  txRecord,
  writeArtifact,
} from "./lib/deployment.js";

const SMOKE_ALLOCATION_PAISE = 1_00_000_00n; // ₹1,00,000

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const { viem, networkName, networkConfig } = await network.create();
if (networkName === "hederaTestnet") assertEcdsaKeyFormat("HEDERA_TESTNET_PRIVATE_KEY");
const publicClient = await viem.getPublicClient();
const [signer] = await viem.getWalletClients();
const artifact = await requireArtifact(networkName);
const { address } = artifact.contract;
const chainId = await publicClient.getChainId();

console.log(`Smoke test: ${CONTRACT_NAME} at ${address} on ${networkName} (chain ${chainId})`);
check(chainId === artifact.chainId, `chain id matches artifact (${chainId})`);
const code = await publicClient.getCode({ address });
check(!!code && code !== "0x", "contract code is deployed");

const contract = await viem.getContractAt(CONTRACT_NAME, address);
const [adminRole, departmentRole] = await Promise.all([
  contract.read.DEFAULT_ADMIN_ROLE(),
  contract.read.DEPARTMENT_ROLE(),
]);
check(await contract.read.hasRole([adminRole, artifact.admin]), `admin ${artifact.admin} holds DEFAULT_ADMIN_ROLE`);
for (const grant of artifact.roles) {
  check(await contract.read.hasRole([grant.roleId, grant.account]), `${grant.account} holds ${grant.role}`);
}
if (!(await contract.read.hasRole([departmentRole, signer.account.address]))) {
  throw new Error(`Signer ${signer.account.address} lacks DEPARTMENT_ROLE; run the grant-roles script first.`);
}
const countBefore = await contract.read.projectCount();
console.log(`  projectCount before: ${countBefore}`);

const ranAt = new Date().toISOString();
const sanctionText = `SYNTHETIC JanLekha smoke-test sanction order. Not a real government document. ${ranAt}`;
const sanctionHash = sha256Hex(sanctionText);

// Simulate first so a revert surfaces with its reason before any fee is spent.
await contract.simulate.createProject([sanctionHash, SMOKE_ALLOCATION_PAISE], { account: signer.account.address });
const hash = await contract.write.createProject([sanctionHash, SMOKE_ALLOCATION_PAISE]);
console.log(`  createProject tx ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
check(receipt.status === "success", `transaction confirmed in block ${receipt.blockNumber}`);

let projectId: bigint | undefined;
for (const log of receipt.logs) {
  if (getAddress(log.address) !== getAddress(address)) continue;
  try {
    const event = decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics });
    if (event.eventName === "ProjectCreated") projectId = event.args.projectId;
  } catch {
    // not a JanLekha event
  }
}
check(projectId !== undefined, `ProjectCreated emitted (projectId ${projectId})`);

// Independent, wallet-less client: the same read a citizen's browser would perform.
const rpcUrl = "url" in networkConfig ? await networkConfig.url.get() : undefined;
const reader = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : publicClient;
const project = await reader.readContract({
  address,
  abi: contract.abi,
  functionName: "getProject",
  args: [projectId!],
});
check(project.id === projectId, "readback: project id");
check(getAddress(project.department) === getAddress(signer.account.address), "readback: department is the signer");
check(project.sanctionDocumentHash === sanctionHash, "readback: sanction document hash");
check(project.allocationPaise === SMOKE_ALLOCATION_PAISE, "readback: allocation (paise)");
check((await contract.read.projectCount()) === countBefore + 1n, "projectCount incremented by one");

artifact.smokeTest = {
  ranAt,
  projectId: projectId!.toString(),
  sanctionDocumentHash: sanctionHash,
  sanctionDocumentText: sanctionText,
  allocationPaise: SMOKE_ALLOCATION_PAISE.toString(),
  transaction: await txRecord(chainId, hash, receipt.blockNumber),
  readback: {
    department: getAddress(project.department),
    sanctionDocumentHash: project.sanctionDocumentHash,
    allocationPaise: project.allocationPaise.toString(),
    createdAt: new Date(Number(project.createdAt) * 1000).toISOString(),
  },
};
await writeArtifact(artifact);
console.log("Smoke test passed; artifact updated.");
if (artifact.smokeTest.transaction.hederaTransactionId) {
  console.log(`  Hedera transaction id: ${artifact.smokeTest.transaction.hederaTransactionId}`);
}
