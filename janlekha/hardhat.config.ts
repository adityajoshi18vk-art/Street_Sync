import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.34",
    settings: {
      // Hedera's EVM targets Cancun; newer default EVM versions may emit unsupported opcodes.
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hederaTestnet: {
      type: "http",
      chainType: "generic",
      chainId: 296,
      // The RPC URL is public; the key is a config variable, resolved only when this network is used,
      // from the server-only env var or `npx hardhat keystore set HEDERA_TESTNET_PRIVATE_KEY`.
      url: process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
      accounts: [configVariable("HEDERA_TESTNET_PRIVATE_KEY")],
      timeout: 120_000,
    },
    // Rehearsal target for the deployment scripts: `npm run contracts:node` in another terminal.
    localhost: {
      type: "http",
      chainType: "generic",
      url: "http://127.0.0.1:8545",
    },
  },
});
