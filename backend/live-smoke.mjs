// One-off live check against Arc Testnet + Arkiv (Rabdi) through the running backend.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createPublicClient, createWalletClient, http, erc20Abi, parseUnits, decodeEventLog, defineChain, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { packReport, unpackReport } from "@streetsync/evidence";
const d = JSON.parse(readFileSync("../contracts/deployments/arcTestnet.json", "utf8"));
const env = Object.fromEntries(readFileSync("../.env", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const arc = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } });
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: arc, transport: http() });
const wal = createWalletClient({ chain: arc, transport: http(), account });
const escrow = d.contracts.StreetSyncEscrow.address, abi = d.contracts.StreetSyncEscrow.abi;
const USDC = "0x3600000000000000000000000000000000000000";
const ok = async (hash, label) => { const r = await pub.waitForTransactionReceipt({ hash }); if (r.status !== "success") throw new Error(label + " reverted"); console.log("✓", label, hash); return r; };

const photo = new Uint8Array(await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 90, b: 95 } } })
  .composite([{ input: Buffer.from('<svg width="640" height="480"><circle cx="320" cy="260" r="120" fill="#222"/></svg>') }]).webp({ quality: 70 }).toBuffer());
const latE5 = 1304797, lngE5 = 8028456;
const { bundle, reportHash, descriptionHash } = await packReport({ creator: account.address, description: "Live smoke test: deep pothole outside the bus stop", latE5, lngE5, capturedAtMs: Date.now(), photo });
console.log("report bundle bytes:", bundle.length);

const amt = parseUnits("0.10", 6);
await ok(await wal.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [escrow, amt] }), "approve 0.10 USDC");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86400);
const r = await ok(await wal.writeContract({ address: escrow, abi, functionName: "createBounty", args: [descriptionHash, reportHash, latE5, lngE5, 9000, amt, deadline] }), "createBounty");
let id; for (const log of r.logs) { try { const e = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (e.eventName === "BountyCreated") id = e.args.bountyId; } catch {} }
const b = await pub.readContract({ address: escrow, abi, functionName: "getBounty", args: [id] });
console.log("bounty", id.toString(), "status", b.status, "(7 = Proposed)", "validation ends", new Date(Number(b.validationDeadline) * 1000).toISOString());

const up = await fetch("http://localhost:3000/api/arkiv/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bountyId: id.toString(), payload: Buffer.from(bundle).toString("base64") }) });
const upBody = await up.json(); console.log("upload HTTP", up.status, JSON.stringify(upBody));
const again = await fetch("http://localhost:3000/api/arkiv/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bountyId: id.toString(), payload: Buffer.from(bundle).toString("base64") }) });
console.log("re-upload HTTP", again.status, "alreadyStored:", (await again.json()).alreadyStored);
const tampered = Buffer.from(bundle); tampered[tampered.length - 5] ^= 0xff;
const bad = await fetch("http://localhost:3000/api/arkiv/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bountyId: id.toString(), payload: tampered.toString("base64") }) });
console.log("tampered upload HTTP", bad.status, (await bad.json()).error);
const get = await fetch(`http://localhost:3000/api/bounties/${id}/report`); const rep = await get.json();
console.log("GET report HTTP", get.status, "| description:", rep.description, "| photo bytes match:", Buffer.from(rep.photoBase64, "base64").equals(Buffer.from(photo)));
console.log("USDC left:", formatUnits(await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }), 6));
console.log("BOUNTY_ID=" + id.toString() + " ENTITY=" + upBody.entityKey);
