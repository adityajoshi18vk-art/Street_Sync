import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, erc20Abi, parseUnits, formatUnits, keccak256, toHex, decodeEventLog, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import d from "./contracts/deployments/arcTestnet.json" with { type: "json" };
const env = Object.fromEntries(readFileSync(".env","utf8").trim().split("\n").map(l=>l.split(/=(.*)/s).slice(0,2)));
const arc = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } });
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: arc, transport: http() });
const wal = createWalletClient({ chain: arc, transport: http(), account });
const escrow = d.contracts.StreetSyncEscrow.address, abi = d.contracts.StreetSyncEscrow.abi;
const USDC = "0x3600000000000000000000000000000000000000";
const bal = async () => formatUnits(await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }), 6);
const ok = async (hash, label) => { const r = await pub.waitForTransactionReceipt({ hash }); if (r.status !== "success") throw new Error(label + " reverted"); console.log("✓", label, hash); return r; };
console.log("start USDC:", await bal());
// The exact call that failed originally: allowance(owner, escrow) on the real USDC address.
console.log("allowance before:", await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, escrow] }));
const amt = parseUnits("0.10", 6);
await ok(await wal.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [escrow, amt] }), "approve 0.10 USDC");
const deadline = BigInt(Math.floor(Date.now()/1000) + 20);
const r = await ok(await wal.writeContract({ address: escrow, abi, functionName: "createBounty",
  args: [keccak256(toHex("Smoke test: pothole on test street")), 1304797, 8028456, 9000, amt, deadline] }), "createBounty");
let id; for (const log of r.logs) { try { const e = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (e.eventName === "BountyCreated") id = e.args.bountyId; } catch {} }
const b = await pub.readContract({ address: escrow, abi, functionName: "getBounty", args: [id] });
console.log("bounty", id, "status", b.status, "totalPledged", formatUnits(b.totalPledged, 6));
console.log("after create USDC:", await bal());
await new Promise(res => setTimeout(res, 26000));
await ok(await wal.writeContract({ address: escrow, abi, functionName: "withdrawPledge", args: [id] }), "withdrawPledge after deadline");
console.log("end USDC:", await bal());
