/**
 * Deploys JanLekha and writes deployments/<network>.json.
 *
 *   npm run contracts:deploy:hedera          # Hedera Testnet (chain 296)
 *   npm run contracts:deploy:local           # rehearsal against `npm run contracts:node`
 *
 * Idempotent: if the artifact already points at deployed code, nothing is sent.
 * Set JANLEKHA_FORCE_REDEPLOY=true to deploy a fresh instance (the old artifact is replaced).
 * Set JANLEKHA_DEPLOY_TX=<hash> to adopt a deployment that was sent but not recorded.
 */
import { readFile } from "node:fs/promises";

import { network } from "hardhat";
import { formatEther, keccak256, type Hex } from "viem";

import {
  ABI_PATH,
  CONTRACT_NAME,
  HEDERA_TESTNET_CHAIN_ID,
  SYNTHETIC_NOTICE,
  artifactPath,
  assertEcdsaKeyFormat,
  explorerContractUrl,
  isHedera,
  lookupHederaIds,
  readArtifact,
  sha256Hex,
  writeAbi,
  writeArtifact,
  type DeploymentArtifact,
} from "./lib/deployment.js";

const RECEIPT_TIMEOUT_MS = 180_000;

const { viem, networkName } = await network.create();
if (networkName === "hederaTestnet") assertEcdsaKeyFormat("HEDERA_TESTNET_PRIVATE_KEY");
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
if (!deployer) throw new Error(`No deployer account configured for network "${networkName}".`);

const chainId = await publicClient.getChainId();
if (networkName === "hederaTestnet" && chainId !== HEDERA_TESTNET_CHAIN_ID) {
  throw new Error(`RPC reports chain ${chainId}, expected Hedera Testnet (${HEDERA_TESTNET_CHAIN_ID}).`);
}

const compiled = JSON.parse(
  await readFile(`artifacts/contracts/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`, "utf8"),
) as { abi: unknown[]; deployedBytecode: `0x${string}`; buildInfoId?: string; sourceName: string };

console.log(`Network:  ${networkName} (chain ${chainId})`);
console.log(`Deployer: ${deployer.account.address}`);

const existing = await readArtifact(networkName);
if (existing && process.env.JANLEKHA_FORCE_REDEPLOY !== "true") {
  const code = await publicClient.getCode({ address: existing.contract.address });
  if (code && code !== "0x") {
    console.log(`Already deployed at ${existing.contract.address} (${artifactPath(networkName)}); skipping.`);
    console.log("Set JANLEKHA_FORCE_REDEPLOY=true to deploy a new instance.");
    process.exit(0);
  }
  console.log(`Artifact address ${existing.contract.address} has no code on this chain; redeploying.`);
}

const balance = await publicClient.getBalance({ address: deployer.account.address });
console.log(`Balance:  ${formatEther(balance)} ${isHedera(chainId) ? "HBAR" : "ETH"}`);
if (balance === 0n) throw new Error("Deployer account has no balance; fund it from the Hedera testnet faucet.");

// hardhat-viem's sendDeploymentTransaction calls getTransaction right after sending; Hashio
// often hasn't indexed the tx yet ("could not be found") even though it lands. Send with the
// wallet client and poll for the receipt instead.
const adoptHash = process.env.JANLEKHA_DEPLOY_TX?.trim() as Hex | undefined;
let deployHash: Hex;
if (adoptHash) {
  console.log(`Adopting existing deployment tx ${adoptHash}…`);
  deployHash = adoptHash;
} else {
  console.log(`Deploying ${CONTRACT_NAME}(admin = deployer)…`);
  const full = JSON.parse(
    await readFile(`artifacts/contracts/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`, "utf8"),
  ) as { bytecode: Hex };
  deployHash = await deployer.deployContract({
    abi: compiled.abi as never,
    bytecode: full.bytecode,
    args: [deployer.account.address],
  } as never);
}
console.log(`  tx ${deployHash}`);
const receipt = await publicClient.waitForTransactionReceipt({
  hash: deployHash,
  timeout: RECEIPT_TIMEOUT_MS,
  pollingInterval: 2_000,
  retryCount: 10,
});
if (adoptHash && receipt.from.toLowerCase() !== deployer.account.address.toLowerCase()) {
  throw new Error(`Tx ${adoptHash} was sent by ${receipt.from}, not the configured deployer.`);
}
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Deployment transaction failed (status ${receipt.status}).`);
}
// The receipt is authoritative; don't rely on nonce-derived CREATE addresses.
const address = receipt.contractAddress;
const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

const onChainCode = await publicClient.getCode({ address });
const matches = !!onChainCode && keccak256(onChainCode) === keccak256(compiled.deployedBytecode);
if (!matches) console.warn("  WARNING: on-chain runtime bytecode differs from the local artifact.");

const contract = await viem.getContractAt(CONTRACT_NAME, address);
const adminRole = await contract.read.DEFAULT_ADMIN_ROLE();
if (!(await contract.read.hasRole([adminRole, deployer.account.address]))) {
  throw new Error("Deployer does not hold DEFAULT_ADMIN_ROLE after deployment.");
}

const { transactionId, contractId } = await lookupHederaIds(chainId, deployHash);
await writeAbi(compiled.abi);

const artifact: DeploymentArtifact = {
  network: networkName,
  chainId,
  contract: {
    name: CONTRACT_NAME,
    address,
    hederaContractId: contractId,
    abiPath: ABI_PATH,
    sourcePath: compiled.sourceName,
    buildInfoId: compiled.buildInfoId ?? null,
    runtimeBytecodeSha256: sha256Hex(Buffer.from(compiled.deployedBytecode.slice(2), "hex")),
    runtimeBytecodeMatchesChain: matches,
  },
  deployer: deployer.account.address,
  admin: deployer.account.address,
  deployment: {
    hash: deployHash,
    hederaTransactionId: transactionId,
    blockNumber: receipt.blockNumber.toString(),
    explorerUrl: explorerContractUrl(chainId, address),
    timestamp: new Date().toISOString(),
    blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
  },
  roles: [],
  smokeTest: null,
  notice: SYNTHETIC_NOTICE,
};
await writeArtifact(artifact);

console.log(`Deployed ${CONTRACT_NAME} at ${address}${contractId ? ` (${contractId})` : ""}`);
if (transactionId) console.log(`  Hedera transaction id: ${transactionId}`);
if (artifact.deployment.explorerUrl) console.log(`  ${artifact.deployment.explorerUrl}`);
console.log(`Artifact: ${artifactPath(networkName)}   ABI: ${ABI_PATH}`);
console.log(`Frontend: set NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS=${address}`);
