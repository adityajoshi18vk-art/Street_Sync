import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfig, custom, type Connector } from "wagmi";
import { encodeAbiParameters } from "viem";

process.env.NEXT_PUBLIC_ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111";
const { ACTIVE_CHAIN, ARC_TESTNET, HARDHAT_LOCAL, ARC_USDC_ADDRESS, ESCROW_ADDRESS } = require("../src/config/contracts") as typeof import("../src/config/contracts");
const { approveUsdcExact } = require("../src/lib/tx") as typeof import("../src/lib/tx");
const owner = "0x2222222222222222222222222222222222222222" as const;

function fixture(options: { chainId?: number; code?: string; decimals?: number; allowance?: bigint } = {}) {
  let reads = 0;
  let writes = 0;
  const transport = custom({ async request({ method, params }) {
    reads++;
    if (method === "eth_getCode") return options.code ?? "0x6000";
    if (method === "eth_call") {
      const data = (params as [{ data: string }])[0].data;
      if (data.startsWith("0x313ce567")) return encodeAbiParameters([{ type: "uint8" }], [options.decimals ?? 6]);
      if (data.startsWith("0xdd62ed3e")) return encodeAbiParameters([{ type: "uint256" }], [options.allowance ?? 1000000n]);
      return encodeAbiParameters([{ type: "address" }], [ARC_USDC_ADDRESS]);
    }
    throw new Error("Unexpected RPC method " + method);
  } });
  const config = createConfig({ chains: [ARC_TESTNET, HARDHAT_LOCAL], transports: {
    [ARC_TESTNET.id]: transport, [HARDHAT_LOCAL.id]: transport
  } });
  config.setState({
    chainId: ACTIVE_CHAIN.id,
    current: "test",
    status: "connected",
    connections: new Map([["test", {
      accounts: [owner], chainId: options.chainId ?? ACTIVE_CHAIN.id,
      connector: { id: "test", uid: "test", name: "Test", type: "mock" } as Connector
    }]])
  });
  const run = () => approveUsdcExact({
    config, owner, spender: ESCROW_ADDRESS!, amountUsdc: "1",
    writeContractAsync: async () => { writes++; throw new Error("Unexpected approval"); }
  });
  return { run, reads: () => reads, writes: () => writes };
}

test("wrong-chain wallet fails before RPC", async () => {
  const f = fixture({ chainId: HARDHAT_LOCAL.id });
  await assert.rejects(f.run(), /Switch your wallet/);
  assert.equal(f.reads(), 0);
  assert.equal(f.writes(), 0);
});

test("undeployed escrow fails before allowance or approval", async () => {
  const f = fixture({ code: "0x" });
  await assert.rejects(f.run(), /No StreetSyncEscrow contract/);
  assert.equal(f.reads(), 1);
  assert.equal(f.writes(), 0);
});

test("wrong token decimals cannot reach allowance or approval", async () => {
  const f = fixture({ decimals: 18 });
  await assert.rejects(f.run(), /six-decimal USDC/);
  assert.equal(f.writes(), 0);
});

test("sufficient allowance needs no new wallet approval", async () => {
  const f = fixture();
  assert.equal(await f.run(), false);
  assert.equal(f.writes(), 0);
});
