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
      // Resolved lazily, so local compile/test never needs these values.
      url: configVariable("HEDERA_TESTNET_RPC_URL"),
      accounts: [configVariable("HEDERA_TESTNET_PRIVATE_KEY")],
    },
  },
});
