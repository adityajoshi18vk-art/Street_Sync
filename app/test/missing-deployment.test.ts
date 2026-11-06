import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfig, http } from "wagmi";

// An explicitly empty override simulates an undeployed escrow.
process.env.NEXT_PUBLIC_ESCROW_ADDRESS = "";
const { ARC_TESTNET, HARDHAT_LOCAL, ARC_USDC_ADDRESS, contractsDeployed } =
  require("../src/config/contracts") as typeof import("../src/config/contracts");
const { approveUsdcExact } = require("../src/lib/tx") as typeof import("../src/lib/tx");

test("missing deployment fails before any RPC or wallet request", async () => {
  assert.equal(contractsDeployed, false);
  let requests = 0;
  const config = createConfig({ chains: [ARC_TESTNET, HARDHAT_LOCAL], transports: {
    [HARDHAT_LOCAL.id]: http(),
    [ARC_TESTNET.id]: http("https://invalid.example", { fetchFn: async () => {
      requests++; throw new Error("RPC must not be called");
    } })
  } });
  await assert.rejects(approveUsdcExact({ config, owner: ARC_USDC_ADDRESS,
    spender: "0x" + "0".repeat(40), amountUsdc: "1",
    writeContractAsync: async () => { requests++; throw new Error("Wallet must not be called"); }
  }), /contracts are not configured/);
  assert.equal(requests, 0);
});
